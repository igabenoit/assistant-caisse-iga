import os, io, json, time, secrets, hashlib, hmac, uuid
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from urllib.parse import urlparse
from flask import Flask, request, jsonify, session, send_file, render_template, Response, abort
from sqlalchemy import create_engine, select, insert, update, delete, func, text
from sqlalchemy.exc import IntegrityError
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.middleware.proxy_fix import ProxyFix
from PIL import Image, UnidentifiedImageError
from .models import metadata, products, knowledge, logs, settings, sessions, attempts, images, now
from .search import resolve, UNKNOWN, normalize
from .importer import parse_file

ROOT=Path(__file__).resolve().parent.parent

def create_app(test_config=None):
    from dotenv import load_dotenv
    load_dotenv(ROOT/'.env')
    app=Flask(__name__,static_folder=str(ROOT/'static'),template_folder=str(ROOT/'templates'))
    prod=os.getenv('APP_ENV')=='production'
    secret=os.getenv('SECRET_KEY','')
    password=os.getenv('ADMIN_PASSWORD','')
    password_hash=os.getenv('ADMIN_PASSWORD_HASH','')
    pin=os.getenv('KIOSK_PIN','')
    url=os.getenv('DATABASE_URL') or 'sqlite:///'+str(ROOT/'instance'/'caisse.db')
    if test_config:
        secret='isolated-test-secret-key-longer-than-32'; password='Testing-password-123'; pin=''
        url=test_config.get('DATABASE_URL',url); prod=False
    if len(secret)<32: raise RuntimeError('SECRET_KEY manquante. Exécuter python scripts/setup_dev.py ou configurer Render.')
    if not password_hash and len(password)<12: raise RuntimeError('ADMIN_PASSWORD doit contenir au moins 12 caractères.')
    if prod and (not url.startswith(('postgres://','postgresql://','postgresql+psycopg://')) or len(pin)<6):
        raise RuntimeError('En production : DATABASE_URL PostgreSQL et KIOSK_PIN (6 caractères minimum) obligatoires.')
    if url.startswith(('postgres://','postgresql://')): url='postgresql+psycopg://'+url.split('://',1)[1]
    if url.startswith('sqlite:'): (ROOT/'instance').mkdir(exist_ok=True)
    engine=create_engine(url,pool_pre_ping=True,connect_args={'check_same_thread':False,'timeout':20} if url.startswith('sqlite') else {})
    metadata.create_all(engine)
    app.config.update(SECRET_KEY=secret,MAX_CONTENT_LENGTH=6*1024*1024,SESSION_COOKIE_HTTPONLY=True,SESSION_COOKIE_SAMESITE='Strict',SESSION_COOKIE_SECURE=prod,PERMANENT_SESSION_LIFETIME=timedelta(days=30))
    if test_config: app.config.update(test_config)
    if prod: app.wsgi_app=ProxyFix(app.wsgi_app,x_for=1,x_proto=1,x_host=0)
    app.extensions['db']=engine
    admin_hash=password_hash or generate_password_hash(password)
    with engine.begin() as con:
        # Serialize first boot across PostgreSQL workers.
        if engine.dialect.name=='postgresql': con.execute(text('SELECT pg_advisory_xact_lock(739184)'))
        existing=con.execute(select(settings.c.value).where(settings.c.key=='schema_version')).scalar()
        if not existing:
            con.execute(insert(settings),[{'key':'schema_version','value':'1'},{'key':'revision','value':str(uuid.uuid4())},{'key':'seeded','value':'false'}])
        if os.getenv('SEED_DEMO','true').lower()=='true' and con.execute(select(settings.c.value).where(settings.c.key=='seeded')).scalar()=='false':
            seed=json.loads((ROOT/'data'/'demo.json').read_text())
            for table,key in [(products,'products'),(knowledge,'knowledge')]:
                for item in seed[key]: con.execute(insert(table).values(id=str(uuid.uuid4()),updated_at=now(),**item))
            con.execute(update(settings).where(settings.c.key=='seeded').values(value='true'))
        # Add the verified produce list once, including on databases created before
        # the list was bundled. Existing admin-managed records always win.
        catalog_key='produce_catalog_2026_09_27'
        if not test_config and os.getenv('SEED_DEMO','true').lower()=='true' and not con.execute(select(settings.c.value).where(settings.c.key==catalog_key)).scalar():
            catalog=json.loads((ROOT/'data'/'produce_catalog.json').read_text(encoding='utf-8'))
            existing_codes=set(con.execute(select(products.c.code)).scalars())
            for item in catalog:
                if item['code'] not in existing_codes:
                    con.execute(insert(products).values(id=str(uuid.uuid4()),updated_at=now(),active=True,demo=False,**item))
                    existing_codes.add(item['code'])
            con.execute(insert(settings).values(key=catalog_key,value='done'))
            con.execute(update(settings).where(settings.c.key=='revision').values(value=str(uuid.uuid4())))
        # Later photo additions apply to already imported PLUs without replacing
        # images uploaded or assigned by an administrator.
        photo_key='produce_photos_2026_09_28'
        if not test_config and os.getenv('SEED_DEMO','true').lower()=='true' and not con.execute(select(settings.c.value).where(settings.c.key==photo_key)).scalar():
            catalog=json.loads((ROOT/'data'/'produce_catalog.json').read_text(encoding='utf-8'))
            updated=0
            for item in catalog:
                if item['image']:
                    result=con.execute(update(products).where(products.c.code==item['code'],products.c.image=='',products.c.demo==False).values(image=item['image'],updated_at=now()))
                    updated+=result.rowcount
            con.execute(insert(settings).values(key=photo_key,value='done'))
            if updated: con.execute(update(settings).where(settings.c.key=='revision').values(value=str(uuid.uuid4())))
        framing_key='produce_photo_framing_2026_09_28'
        if not test_config and not con.execute(select(settings.c.value).where(settings.c.key==framing_key)).scalar():
            updated=0
            for slug in ('iceberg','cauliflower'):
                old=f'/static/images/produce-{slug}.jpg'
                new=f'/static/images/produce-{slug}-v2.jpg'
                result=con.execute(update(products).where(products.c.image==old,products.c.demo==False).values(image=new,updated_at=now()))
                updated+=result.rowcount
            con.execute(insert(settings).values(key=framing_key,value='done'))
            if updated: con.execute(update(settings).where(settings.c.key=='revision').values(value=str(uuid.uuid4())))
        catalogue_photo_key='catalogue_photos_2026_09_28_a'
        if not con.execute(select(settings.c.value).where(settings.c.key==catalogue_photo_key)).scalar():
            photo_map=json.loads((ROOT/'data'/'catalog_photo_batch_2026_09_28.json').read_text(encoding='utf-8'))
            updated=0
            for image,codes in photo_map.items():
                # A blank or bundled demo image can be upgraded safely. A photo
                # selected or uploaded by a manager always remains untouched.
                result=con.execute(update(products).where(
                    products.c.code.in_(codes),
                    (products.c.image=='') | products.c.image.like('/static/images/demo-%')
                ).values(image=image,updated_at=now()))
                updated+=result.rowcount
            con.execute(insert(settings).values(key=catalogue_photo_key,value='done'))
            if updated: con.execute(update(settings).where(settings.c.key=='revision').values(value=str(uuid.uuid4())))
        catalogue_photo_key_2='catalogue_photos_2026_09_29_a'
        if not con.execute(select(settings.c.value).where(settings.c.key==catalogue_photo_key_2)).scalar():
            photo_map=json.loads((ROOT/'data'/'catalog_photo_batch_2026_09_29.json').read_text(encoding='utf-8'))
            updated=0
            for image,codes in photo_map.items():
                result=con.execute(update(products).where(
                    products.c.code.in_(codes),
                    products.c.image==''
                ).values(image=image,updated_at=now()))
                updated+=result.rowcount
            con.execute(insert(settings).values(key=catalogue_photo_key_2,value='done'))
            if updated: con.execute(update(settings).where(settings.c.key=='revision').values(value=str(uuid.uuid4())))
        catalogue_photo_key_3='catalogue_photos_2026_09_29_b'
        if not con.execute(select(settings.c.value).where(settings.c.key==catalogue_photo_key_3)).scalar():
            photo_map=json.loads((ROOT/'data'/'catalog_photo_batch_2026_09_29_b.json').read_text(encoding='utf-8'))
            updated=0
            for image,codes in photo_map.items():
                result=con.execute(update(products).where(
                    products.c.code.in_(codes),
                    products.c.image==''
                ).values(image=image,updated_at=now()))
                updated+=result.rowcount
            con.execute(insert(settings).values(key=catalogue_photo_key_3,value='done'))
            if updated: con.execute(update(settings).where(settings.c.key=='revision').values(value=str(uuid.uuid4())))
        catalogue_photo_key_4='catalogue_photos_2026_09_29_c'
        if not con.execute(select(settings.c.value).where(settings.c.key==catalogue_photo_key_4)).scalar():
            photo_map=json.loads((ROOT/'data'/'catalog_photo_batch_2026_09_29_c.json').read_text(encoding='utf-8'))
            updated=0
            for image,codes in photo_map.items():
                result=con.execute(update(products).where(
                    products.c.code.in_(codes),
                    products.c.image==''
                ).values(image=image,updated_at=now()))
                updated+=result.rowcount
            con.execute(insert(settings).values(key=catalogue_photo_key_4,value='done'))
            if updated: con.execute(update(settings).where(settings.c.key=='revision').values(value=str(uuid.uuid4())))

        catalogue_photo_key_5='catalogue_photos_2026_09_29_d'
        if not con.execute(select(settings.c.value).where(settings.c.key==catalogue_photo_key_5)).scalar():
            photo_map=json.loads((ROOT/'data'/'catalog_photo_batch_2026_09_29_d.json').read_text(encoding='utf-8'))
            updated=0
            for image,codes in photo_map.items():
                result=con.execute(update(products).where(
                    products.c.code.in_(codes),
                    products.c.image==''
                ).values(image=image,updated_at=now()))
                updated+=result.rowcount
            con.execute(insert(settings).values(key=catalogue_photo_key_5,value='done'))
            if updated: con.execute(update(settings).where(settings.c.key=='revision').values(value=str(uuid.uuid4())))

        catalogue_photo_key_6='catalogue_photos_2026_09_29_e'
        if not con.execute(select(settings.c.value).where(settings.c.key==catalogue_photo_key_6)).scalar():
            photo_map=json.loads((ROOT/'data'/'catalog_photo_batch_2026_09_29_e.json').read_text(encoding='utf-8'))
            updated=0
            for image,codes in photo_map.items():
                result=con.execute(update(products).where(
                    products.c.code.in_(codes),
                    products.c.image==''
                ).values(image=image,updated_at=now()))
                updated+=result.rowcount
            con.execute(insert(settings).values(key=catalogue_photo_key_6,value='done'))
            if updated: con.execute(update(settings).where(settings.c.key=='revision').values(value=str(uuid.uuid4())))

        catalogue_photo_key_7='catalogue_photos_2026_09_29_f'
        if not con.execute(select(settings.c.value).where(settings.c.key==catalogue_photo_key_7)).scalar():
            photo_map=json.loads((ROOT/'data'/'catalog_photo_batch_2026_09_29_f.json').read_text(encoding='utf-8'))
            updated=0
            for image,codes in photo_map.items():
                result=con.execute(update(products).where(
                    products.c.code.in_(codes),
                    products.c.image==''
                ).values(image=image,updated_at=now()))
                updated+=result.rowcount
            con.execute(insert(settings).values(key=catalogue_photo_key_7,value='done'))
            if updated: con.execute(update(settings).where(settings.c.key=='revision').values(value=str(uuid.uuid4())))

        catalogue_photo_key_8='catalogue_photos_2026_09_29_g'
        if not con.execute(select(settings.c.value).where(settings.c.key==catalogue_photo_key_8)).scalar():
            photo_map=json.loads((ROOT/'data'/'catalog_photo_batch_2026_09_29_g.json').read_text(encoding='utf-8'))
            updated=0
            for image,codes in photo_map.items():
                result=con.execute(update(products).where(
                    products.c.code.in_(codes),
                    products.c.image==''
                ).values(image=image,updated_at=now()))
                updated+=result.rowcount
            con.execute(insert(settings).values(key=catalogue_photo_key_8,value='done'))
            if updated: con.execute(update(settings).where(settings.c.key=='revision').values(value=str(uuid.uuid4())))

        catalogue_photo_key_9='catalogue_photos_2026_09_29_h'
        if not con.execute(select(settings.c.value).where(settings.c.key==catalogue_photo_key_9)).scalar():
            photo_map=json.loads((ROOT/'data'/'catalog_photo_batch_2026_09_29_h.json').read_text(encoding='utf-8'))
            updated=0
            for image,codes in photo_map.items():
                result=con.execute(update(products).where(
                    products.c.code.in_(codes),
                    products.c.image==''
                ).values(image=image,updated_at=now()))
                updated+=result.rowcount
            con.execute(insert(settings).values(key=catalogue_photo_key_9,value='done'))
            if updated: con.execute(update(settings).where(settings.c.key=='revision').values(value=str(uuid.uuid4())))
    def revision(con): return con.execute(select(settings.c.value).where(settings.c.key=='revision')).scalar()
    def changed(con): con.execute(update(settings).where(settings.c.key=='revision').values(value=str(uuid.uuid4())))
    def lock_revision(con):
        # All catalogue writers acquire this lock before touching any row.
        # Imports cannot validate a revision and then overwrite a concurrent edit.
        if engine.dialect.name=='postgresql':
            con.execute(select(settings).where(settings.c.key=='revision').with_for_update())
        elif engine.dialect.name=='sqlite':
            con.exec_driver_sql('BEGIN IMMEDIATE')
    def role():
        token=session.get('token','')
        if not token: return None
        with engine.connect() as con:
            return con.execute(select(sessions.c.role).where(sessions.c.token_hash==hashlib.sha256(token.encode()).hexdigest(),sessions.c.expires>int(time.time()))).scalar()
    def allowed(admin=False):
        def wrap(fn):
            @wraps(fn)
            def inner(*args,**kwargs):
                r=role()
                if r!='admin' and (admin or (pin and r!='kiosk')): return jsonify(error='Connexion requise.'),401
                return fn(*args,**kwargs)
            return inner
        return wrap
    def body():
        data=request.get_json(silent=True)
        if not isinstance(data,dict): raise ValueError('Données invalides.')
        return data
    def string(data,key,maximum,required=False):
        v=data.get(key,'')
        if not isinstance(v,str): raise ValueError(f'{key} doit être du texte.')
        v=v.strip()
        if len(v)>maximum or (required and not v): raise ValueError(f'Champ {key} invalide (maximum {maximum} caractères).')
        return v
    def validate(data,table):
        if not isinstance(data,dict): raise ValueError('Chaque fiche doit être un objet valide.')
        fields={'name':160,'code':32,'keywords':2000,'category':80,'image':2000,'note':500} if table is products else {'title':160,'keywords':4000,'answer':8000}
        required={'name','code'} if table is products else {'title','keywords','answer'}
        out={k:string(data,k,n,k in required) for k,n in fields.items()}
        for k in ['demo','active']:
            if k in data and not isinstance(data[k],bool): raise ValueError(f'{k} doit être vrai ou faux.')
            out[k]=data.get(k,k=='active')
        if table is products:
            if not all(c.isalnum() or c in '-_.' for c in out['code']): raise ValueError('Le code accepte lettres, chiffres, tiret, point et soulignement.')
            image=out['image']
            if image and not (image.startswith('/static/images/') or image.startswith('/api/images/') or (urlparse(image).scheme=='https' and urlparse(image).netloc)):
                raise ValueError('Image : URL HTTPS ou image téléversée attendue.')
        out['updated_at']=now()
        return out
    @app.before_request
    def csrf():
        if request.path.startswith('/api/') and request.method not in ('GET','HEAD','OPTIONS'):
            origin=request.headers.get('Origin')
            if request.headers.get('X-App-Request')!='1' or (origin and origin!=request.host_url.rstrip('/')):
                return jsonify(error='Requête non autorisée. Recharge la page.'),403
    @app.after_request
    def headers(r):
        r.headers['X-Content-Type-Options']='nosniff'; r.headers['X-Frame-Options']='DENY'
        r.headers['Referrer-Policy']='no-referrer'
        r.headers['Permissions-Policy']='microphone=(self), camera=(), geolocation=()'
        r.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        if request.path.startswith('/api/') or request.path in ('/','/admin'): r.headers['Cache-Control']='no-store'
        if prod: r.headers['Strict-Transport-Security']='max-age=31536000'
        return r
    @app.errorhandler(ValueError)
    def bad(e): return jsonify(error=str(e)),400
    @app.errorhandler(IntegrityError)
    def conflict(e): return jsonify(error='Ce code existe déjà, ou la fiche a été modifiée. Recharge puis réessaie.'),409
    @app.errorhandler(413)
    def large(e): return jsonify(error='Fichier trop volumineux (maximum 5 Mo).'),413
    @app.errorhandler(500)
    def internal(e): return jsonify(error='Erreur serveur. Réessaie ou demande au superviseur.'),500
    @app.get('/')
    def home(): return render_template('index.html')
    @app.get('/credits')
    def credits():
        import re, html
        rows=json.loads((ROOT/'data'/'image-credits.json').read_text())
        for row in rows: row['artist_plain']=html.unescape(re.sub('<[^>]+>','',row.get('Artist','')))
        return render_template('credits.html',credits=rows)
    @app.get('/admin')
    def admin(): return render_template('admin.html')
    @app.get('/sw.js')
    def service_worker():
        r=send_file(ROOT/'static'/'sw.js',mimetype='application/javascript');r.headers['Cache-Control']='no-cache';return r
    @app.get('/healthz')
    def health():
        with engine.connect() as con: con.execute(text('SELECT 1'))
        return jsonify(status='ok',version=os.getenv('RENDER_GIT_COMMIT','local'))
    @app.get('/api/session')
    def session_info(): return jsonify(role=role(),kiosk_required=bool(pin),development=not prod)
    @app.post('/api/login')
    def login():
        data=body(); kind=data.get('role','admin'); entered=string(data,'password',200,True)
        if kind not in ('admin','kiosk'): raise ValueError('Rôle invalide.')
        stamp=int(time.time()); bucket=hmac.new(secret.encode(),(request.remote_addr or 'unknown').encode(),hashlib.sha256).hexdigest()
        with engine.begin() as con:
            con.execute(delete(attempts).where(attempts.c.time<stamp-900))
            if con.execute(select(func.count()).select_from(attempts).where(attempts.c.bucket==bucket)).scalar()>=8:
                return jsonify(error='Trop de tentatives. Réessaie dans 15 minutes.'),429
            con.execute(insert(attempts).values(id=str(uuid.uuid4()),bucket=bucket,time=stamp))
        ok=check_password_hash(admin_hash,entered) if kind=='admin' else (bool(pin) and hmac.compare_digest(pin,entered))
        if not ok: return jsonify(error='Identifiants incorrects.'),401
        token=secrets.token_urlsafe(32)
        with engine.begin() as con:
            con.execute(delete(sessions).where(sessions.c.expires<stamp))
            con.execute(delete(attempts).where(attempts.c.bucket==bucket))
            con.execute(insert(sessions).values(token_hash=hashlib.sha256(token.encode()).hexdigest(),role=kind,expires=stamp+(8*3600 if kind=='admin' else 30*86400)))
        session.clear(); session['token']=token; session.permanent=True
        return jsonify(role=kind)
    @app.post('/api/logout')
    def logout():
        with engine.begin() as con: con.execute(delete(sessions).where(sessions.c.token_hash==hashlib.sha256(session.get('token','').encode()).hexdigest()))
        session.clear(); return jsonify(ok=True)
    @app.post('/api/search')
    @allowed()
    def search():
        data=body(); q=string(data,'query',500,True); device=string(data,'device',80) or 'Tablette non nommée'
        with engine.connect() as con:
            ps=[dict(x) for x in con.execute(select(products).where(products.c.active==True)).mappings()]
            ks=[dict(x) for x in con.execute(select(knowledge).where(knowledge.c.active==True)).mappings()]
            rev=revision(con)
        result=resolve(q,ps,ks); result['revision']=rev
        if data.get('record') is True:
            event=string(data,'event_id',36,True)
            try: uuid.UUID(event)
            except ValueError: raise ValueError('Identifiant de recherche invalide.')
            with engine.begin() as con:
                if not con.execute(select(logs.c.id).where(logs.c.id==event)).scalar():
                    # Savepoint absorbs duplicate concurrent submissions without dropping the search response.
                    try:
                        with con.begin_nested():
                            con.execute(insert(logs).values(id=event,device=device,created_at=now(),kind=result['kind'],query=q,found=result['found'],source='voice' if data.get('source')=='voice' else 'text',count=len(result['products'])+len(result['answers'])))
                    except IntegrityError: pass
                cutoff=(datetime.now(timezone.utc)-timedelta(days=int(os.getenv('LOG_RETENTION_DAYS','30')))).isoformat()
                con.execute(delete(logs).where(logs.c.created_at<cutoff))
        return jsonify(result)
    @app.get('/api/catalog')
    @allowed()
    def catalog():
        with engine.connect() as con:
            rows=[dict(x) for x in con.execute(select(products).where(products.c.active==True)).mappings()]
            rows.sort(key=lambda row:(normalize(row['name']),row['code']))
            demo_count=sum(p['demo'] for p in rows)
            return jsonify(products=rows[:40],total=len(rows),demo_count=demo_count,revision=revision(con))
    @app.get('/api/knowledge/<id>')
    @allowed()
    def get_knowledge(id):
        with engine.connect() as con: row=con.execute(select(knowledge).where(knowledge.c.id==id,knowledge.c.active==True)).mappings().first()
        if not row: return jsonify(error=UNKNOWN),404
        return jsonify(dict(row))
    @app.get('/api/revision')
    @allowed()
    def version():
        with engine.connect() as con: return jsonify(revision=revision(con))
    @app.get('/api/updates')
    @allowed()
    def updates():
        token=session.get('token',''); last=request.args.get('revision','')
        def stream():
            nonlocal last
            for i in range(120):
                with engine.connect() as con:
                    if pin and not con.execute(select(sessions.c.role).where(sessions.c.token_hash==hashlib.sha256(token.encode()).hexdigest(),sessions.c.expires>int(time.time()))).scalar():
                        yield 'event: expired\ndata: {}\n\n'; return
                    current=revision(con)
                if current!=last: last=current; yield 'data: '+json.dumps({'revision':current})+'\n\n'
                elif i%15==0: yield ': heartbeat\n\n'
                time.sleep(1)
        return Response(stream(),mimetype='text/event-stream',headers={'X-Accel-Buffering':'no','Cache-Control':'no-cache'})
    @app.get('/api/admin/<kind>')
    @allowed(admin=True)
    def listing(kind):
        table={'products':products,'knowledge':knowledge}.get(kind)
        if table is None: abort(404)
        with engine.connect() as con:
            items=[dict(x) for x in con.execute(select(table)).mappings()]
        if table is products: items.sort(key=lambda item:(normalize(item['name']),item['code']))
        else: items.sort(key=lambda item:item['updated_at'],reverse=True)
        return jsonify(items=items)
    @app.post('/api/admin/<kind>')
    @allowed(admin=True)
    def create(kind):
        table={'products':products,'knowledge':knowledge}.get(kind)
        if table is None: abort(404)
        item=validate(body(),table);item['id']=str(uuid.uuid4())
        with engine.begin() as con:
            lock_revision(con);con.execute(insert(table).values(**item));changed(con)
        return jsonify(item),201
    @app.put('/api/admin/<kind>/<id>')
    @allowed(admin=True)
    def edit(kind,id):
        table={'products':products,'knowledge':knowledge}.get(kind)
        if table is None: abort(404)
        data=body(); values=validate(data,table)
        expected=string(data,'expected_updated_at',40,True)
        with engine.begin() as con:
            lock_revision(con)
            count=con.execute(update(table).where(table.c.id==id,table.c.updated_at==expected).values(**values)).rowcount
            if not count: return jsonify(error='Cette fiche a changé ou a été supprimée. Recharge avant de modifier.'),409
            changed(con)
        return jsonify(id=id,**values)
    @app.delete('/api/admin/<kind>/<id>')
    @allowed(admin=True)
    def remove(kind,id):
        table={'products':products,'knowledge':knowledge}.get(kind)
        if table is None: abort(404)
        data=body(); expected=string(data,'expected_updated_at',40,True)
        with engine.begin() as con:
            lock_revision(con)
            if not con.execute(delete(table).where(table.c.id==id,table.c.updated_at==expected)).rowcount: return jsonify(error='Fiche modifiée. Recharge la liste.'),409
            changed(con)
        return jsonify(ok=True)
    @app.get('/api/admin/logs/recent')
    @allowed(admin=True)
    def recent():
        missing=request.args.get('missing')=='1'
        stmt=select(logs)
        if missing: stmt=stmt.where(logs.c.found==False)
        with engine.connect() as con:
            items=[dict(x) for x in con.execute(stmt.order_by(logs.c.created_at.desc()).limit(300)).mappings()]
            groups=[dict(x) for x in con.execute(select(logs.c.query,func.count().label('count'),func.max(logs.c.created_at).label('last')).where(logs.c.found==False).group_by(logs.c.query).order_by(func.count().desc()).limit(30)).mappings()]
        return jsonify(items=items,unanswered=groups)
    @app.post('/api/admin/images/upload')
    @allowed(admin=True)
    def upload():
        f=request.files.get('file')
        if not f: raise ValueError('Choisis une image.')
        raw=f.read(5*1024*1024+1)
        if len(raw)>5*1024*1024: raise ValueError('La photo dépasse 5 Mo.')
        try:
            img=Image.open(io.BytesIO(raw))
            if img.width*img.height>20_000_000: raise ValueError('Image trop grande (maximum 20 mégapixels).')
            from PIL import ImageOps
            img=ImageOps.exif_transpose(img).convert('RGB');img.thumbnail((900,900))
            out=io.BytesIO();img.save(out,'JPEG',quality=85)
        except (UnidentifiedImageError,OSError,Image.DecompressionBombError): raise ValueError('Image invalide. Utilise JPG, PNG ou WebP.')
        id=str(uuid.uuid4())
        with engine.begin() as con: con.execute(insert(images).values(id=id,data=out.getvalue(),mime='image/jpeg'))
        return jsonify(image='/api/images/'+id)
    @app.get('/api/images/<id>')
    @allowed()
    def image(id):
        with engine.connect() as con: row=con.execute(select(images).where(images.c.id==id)).mappings().first()
        if not row: abort(404)
        return send_file(io.BytesIO(row['data']),mimetype=row['mime'])
    @app.post('/api/admin/import/preview')
    @allowed(admin=True)
    def preview_import():
        f=request.files.get('file')
        if not f: raise ValueError('Choisis un fichier.')
        rows=parse_file(f)
        for row in rows: validate(row,products)
        with engine.connect() as con:
            codes=set(con.execute(select(products.c.code)).scalars());rev=revision(con)
        return jsonify(rows=rows,create=sum(r['code'] not in codes for r in rows),update=sum(r['code'] in codes for r in rows),revision=rev)
    @app.post('/api/admin/import/commit')
    @allowed(admin=True)
    def commit_import():
        data=body(); rows=data.get('rows'); mode=data.get('mode','add')
        if not isinstance(rows,list) or not 1<=len(rows)<=10000 or mode not in ('add','upsert'): raise ValueError('Import invalide.')
        validated=[validate(row,products) for row in rows]; codes=[r['code'] for r in validated]
        if len(set(codes))!=len(codes): raise ValueError('Codes en double dans le fichier.')
        created=updated=skipped=0
        with engine.begin() as con:
            lock_revision(con)
            if data.get('revision')!=revision(con): return jsonify(error='La base a changé. Relance l’aperçu du fichier avant de confirmer.'),409
            existing={r['code']:dict(r) for r in con.execute(select(products)).mappings()}
            for original,row in zip(rows,validated):
                old=existing.get(row['code'])
                if old and mode=='add': skipped+=1;continue
                if old:
                    # Missing optional columns never erase existing images or synonyms.
                    for k in ['keywords','category','image','note']:
                        if k not in original: row[k]=old[k]
                    con.execute(update(products).where(products.c.id==old['id']).values(**row));updated+=1
                else: con.execute(insert(products).values(id=str(uuid.uuid4()),**row));created+=1
            if data.get('disable_demo') is True: con.execute(update(products).where(products.c.demo==True).values(active=False,updated_at=now()))
            changed(con)
        return jsonify(created=created,updated=updated,skipped=skipped)
    @app.get('/api/admin/export/backup')
    @allowed(admin=True)
    def backup():
        import base64
        with engine.connect() as con:
            if engine.dialect.name=='postgresql': con=con.execution_options(isolation_level='REPEATABLE READ')
            elif engine.dialect.name=='sqlite': con.exec_driver_sql('BEGIN')
            payload={t.name:[dict(r) for r in con.execute(select(t)).mappings()] for t in [products,knowledge]}
            payload['images']=[{'id':r.id,'mime':r.mime,'data':base64.b64encode(r.data).decode()} for r in con.execute(select(images))]
        payload.update(schema_version=1,exported_at=now())
        return Response(json.dumps(payload,ensure_ascii=False),mimetype='application/json',headers={'Content-Disposition':'attachment; filename=assistant-caisse-sauvegarde.json'})
    return app
