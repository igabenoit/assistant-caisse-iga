import io,json,uuid
from PIL import Image
from test_app import app,client,login,H
from caisse.photo_bank import MODEL

def photo():
    out=io.BytesIO();Image.new('RGB',(20,20),'green').save(out,'JPEG');return out.getvalue()
def add(client,pid,reference_id=None,vector=None):
    return client.post('/api/admin/photo-bank/'+pid,headers=H,data={'id':reference_id or str(uuid.uuid4()),'model':MODEL,'embedding':json.dumps(vector if vector is not None else [1.0]+[0.0]*511),'file':(io.BytesIO(photo()),'reference.jpg')})
def product(client,**fields):
    return client.post('/api/admin/products',headers=H,json={'name':'Produit rare','code':'00099','image':'/static/images/catalog/4011-banane.jpg',**fields}).json

def test_reference_bank_auth_and_independent_cover(client):
    assert add(client,'none').status_code==401
    login(client);p=product(client);rid=str(uuid.uuid4());before=client.get('/api/revision').json['revision']
    assert add(client,p['id'],rid).status_code==201
    assert add(client,p['id'],rid).json['already_saved']
    bank=client.get('/api/photo-bank');assert bank.json['products'][0]['code']=='00099'
    assert bank.json['products'][0]['image']==p['image']
    assert len(bank.json['products'][0]['vectors'])==1
    assert client.get('/api/photo-bank',headers={'If-None-Match':bank.headers['ETag']}).status_code==304
    assert client.get('/api/revision').json['revision']!=before
    assert client.get('/api/admin/photo-reference/'+rid).status_code==200
    assert client.put('/api/admin/photo-reference/'+rid,headers=H,json={'active':False}).status_code==200
    assert not client.get('/api/photo-bank').json['products']
    exported=client.get('/api/admin/export/backup').json
    assert exported['schema_version']==2 and len(exported['photo_references'])==1
    assert exported['photo_references'][0]['active'] is False
    assert next(x for x in exported['products'] if x['id']==p['id'])['image']==p['image']
    assert client.put('/api/admin/photo-reference/'+rid,headers=H,json={'active':True}).status_code==200
    client.post('/api/logout',headers=H)
    assert client.get('/api/admin/photo-reference/'+rid).status_code==401

def test_bad_vectors_and_inactive_products_are_excluded(client):
    login(client);p=product(client,active=False)
    for vector in [[0]*512,[1],['x']*512,[float('nan')]+[0]*511]:assert add(client,p['id'],vector=vector).status_code==400
    assert add(client,p['id']).status_code==201
    assert not client.get('/api/photo-bank').json['products']
    assert len(client.get('/api/admin/photo-bank/'+p['id']).json['photos'])==1

def test_reference_limit_and_reactivation(client):
    login(client);p=product(client)
    ids=[]
    for i in range(20):
        rid=str(uuid.uuid4());ids.append(rid);assert add(client,p['id'],rid).status_code==201
    assert add(client,p['id']).status_code==400
    assert client.put('/api/admin/photo-reference/'+ids[0],headers=H,json={'active':False}).status_code==200
    assert add(client,p['id']).status_code==201
    assert client.put('/api/admin/photo-reference/'+ids[0],headers=H,json={'active':True}).status_code==400

def test_migration_preserves_originals_and_is_resumable(app,client):
    from sqlalchemy import select,update
    from caisse.models import photo_references as refs
    assert client.get('/api/admin/photo-migration').status_code==401
    login(client);p=product(client);rid=str(uuid.uuid4())
    add(client,p['id'],rid)
    with app.extensions['db'].begin() as con:
        con.execute(update(refs).where(refs.c.id==rid).values(model='legacy',active=False))
        before=dict(con.execute(select(refs).where(refs.c.id==rid)).mappings().one())
    assert client.get('/api/admin/photo-migration').json['photos'][0]['id']==rid
    payload={'source_model':'legacy','model':MODEL,'embedding':[0.0,1.0]+[0.0]*510}
    url='/api/admin/photo-reference/'+rid+'/migrate'
    assert client.post(url,headers=H,json={**payload,'embedding':[0]*512}).status_code==400
    assert client.post(url,headers=H,json={**payload,'source_model':'wrong'}).status_code==409
    assert client.post(url,headers=H,json=payload).status_code==200
    assert client.post(url,headers=H,json=payload).json['already_saved']
    assert client.get('/api/admin/photo-migration').json['photos']==[]
    with app.extensions['db'].connect() as con:
        after=dict(con.execute(select(refs).where(refs.c.id==rid)).mappings().one())
    for key in ('data','active','product_id','created_at','id'): assert after[key]==before[key]
    assert after['model']==MODEL
    assert json.loads(after['embedding'])==payload['embedding']
    assert not client.get('/api/photo-bank').json['products']
    client.put('/api/admin/photo-reference/'+rid,headers=H,json={'active':True})
    assert client.get('/api/photo-bank').json['products'][0]['vectors']==[payload['embedding']]
