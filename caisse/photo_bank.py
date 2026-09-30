"""Store reference views separately from the cashier-facing product photo."""
import io, json, math, uuid
from flask import request, jsonify, abort, send_file, render_template, Response
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select, insert, update, func
from .models import photo_references as refs, products, now

MODEL='mobilenet-v1-050-gap-subject-v2'
DIMENSIONS=512

def register_photo_bank(app, engine, allowed, revision, changed, lock_revision):
    @app.get('/admin/reconnaissance')
    @app.get('/admin/reconnaissance/<product_id>')
    def reference_page(product_id=''):
        return render_template('photo_bank.html', product_id=product_id)

    @app.get('/api/photo-bank')
    @allowed()
    def reference_bank():
        with engine.connect() as con:
            rev=revision(con)
            if request.if_none_match.contains(rev):
                response=Response(status=304);response.set_etag(rev);return response
            rows=con.execute(select(refs.c.id,refs.c.product_id,refs.c.embedding,products.c.name,products.c.code,products.c.image)
                .join(products,products.c.id==refs.c.product_id)
                .where(refs.c.active==True,refs.c.model==MODEL,products.c.active==True,products.c.demo==False)).mappings()
            grouped={}
            for row in rows:
                p=grouped.setdefault(row['product_id'],dict(id=row['product_id'],name=row['name'],code=row['code'],image=row['image'],vectors=[]))
                p['vectors'].append(json.loads(row['embedding']))
        response=jsonify(model=MODEL,products=list(grouped.values()),revision=rev);response.set_etag(rev);return response

    @app.get('/api/admin/photo-bank/<product_id>')
    @allowed(admin=True)
    def reference_list(product_id):
        with engine.connect() as con:
            product=con.execute(select(products).where(products.c.id==product_id)).mappings().first()
            if not product: abort(404)
            rows=con.execute(select(refs.c.id,refs.c.active,refs.c.created_at,refs.c.model).where(refs.c.product_id==product_id).order_by(refs.c.created_at)).mappings()
            return jsonify(product=dict(product),photos=[dict(r,image='/api/admin/photo-reference/'+r['id']) for r in rows])

    @app.get('/api/admin/photo-reference/<reference_id>')
    @allowed(admin=True)
    def reference_image(reference_id):
        with engine.connect() as con: data=con.execute(select(refs.c.data).where(refs.c.id==reference_id)).scalar()
        if data is None: abort(404)
        return send_file(io.BytesIO(data),mimetype='image/jpeg')

    @app.post('/api/admin/photo-bank/<product_id>')
    @allowed(admin=True)
    def add_reference(product_id):
        try:
            reference_id=str(uuid.UUID(request.form.get('id','')))
            vector=json.loads(request.form.get('embedding',''))
            valid=isinstance(vector,list) and len(vector)==DIMENSIONS and all(type(v) in (int,float) and math.isfinite(v) for v in vector)
            if not valid or request.form.get('model')!=MODEL: raise ValueError()
            norm=math.sqrt(sum(v*v for v in vector))
            if not .99<=norm<=1.01: raise ValueError()
        except (ValueError,TypeError,OverflowError): raise ValueError('Photo non préparée correctement. Recharge la page et réessaie.')
        file=request.files.get('file')
        if not file: raise ValueError('Choisis une photo.')
        raw=file.read(2*1024*1024+1)
        if len(raw)>2*1024*1024: raise ValueError('La photo préparée dépasse 2 Mo.')
        try:
            image=Image.open(io.BytesIO(raw))
            if image.width*image.height>4_000_000: raise ValueError('Photo trop grande.')
            image=ImageOps.exif_transpose(image).convert('RGB');image.thumbnail((640,640))
            output=io.BytesIO();image.save(output,'JPEG',quality=90)
        except (UnidentifiedImageError,OSError,Image.DecompressionBombError): raise ValueError('Photo invalide.')
        with engine.begin() as con:
            lock_revision(con)
            if not con.execute(select(products.c.id).where(products.c.id==product_id)).scalar(): abort(404)
            existing=con.execute(select(refs.c.product_id).where(refs.c.id==reference_id)).scalar()
            if existing:
                if existing!=product_id: abort(409)
                return jsonify(id=reference_id,already_saved=True)
            count=con.execute(select(func.count()).select_from(refs).where(refs.c.product_id==product_id,refs.c.active==True,refs.c.model==MODEL)).scalar()
            total=con.execute(select(func.count()).select_from(refs).where(refs.c.active==True,refs.c.model==MODEL)).scalar()
            if count>=20 or total>=2000: raise ValueError('Limite atteinte : 20 photos actives par produit, 2 000 pour la banque. Désactive une photo avant d’en ajouter.')
            con.execute(insert(refs).values(id=reference_id,product_id=product_id,model=MODEL,embedding=json.dumps(vector),data=output.getvalue(),active=True,created_at=now()));changed(con)
        return jsonify(id=reference_id),201

    @app.put('/api/admin/photo-reference/<reference_id>')
    @allowed(admin=True)
    def toggle_reference(reference_id):
        data=request.get_json(silent=True) or {};active=data.get('active')
        if type(active) is not bool: raise ValueError('État invalide.')
        with engine.begin() as con:
            lock_revision(con)
            row=con.execute(select(refs).where(refs.c.id==reference_id)).mappings().first()
            if not row: abort(404)
            if active and not row['active']:
                count=con.execute(select(func.count()).select_from(refs).where(refs.c.product_id==row['product_id'],refs.c.active==True,refs.c.model==MODEL)).scalar()
                total=con.execute(select(func.count()).select_from(refs).where(refs.c.active==True,refs.c.model==MODEL)).scalar()
                if count>=20 or total>=2000: raise ValueError('Limite de photos actives atteinte.')
            con.execute(update(refs).where(refs.c.id==reference_id).values(active=active));changed(con)
        return jsonify(ok=True)
