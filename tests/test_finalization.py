import io,json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
from caisse.search import product_results,normalize
from test_app import app,client,login,H,search,preview


def test_all_catalog_exact_codes_and_names():
    rows=json.loads((Path(__file__).resolve().parents[1]/'data/produce_catalog.json').read_text(encoding='utf8'))
    for row in rows:
        assert product_results(row['code'],rows)[0]['code']==row['code']
        assert normalize(product_results(row['name'],rows)[0]['name'])==normalize(row['name']),row


def test_punctuation_and_zeroes_in_codes(client):
    login(client)
    for code in ['A-1','A.1','000401','401','PLU-01','CODE001']:
        client.post('/api/admin/products',headers=H,json={'name':'Produit code '+code,'code':code})
    for code in ['A-1','A.1','000401','401','PLU-01','CODE001']:
        for query in [code,'PLU: '+code]:
            assert [p['code'] for p in search(client,query).json['products']]==[code]


def test_import_upsert_preserves_disabled_and_manual_fields(client):
    login(client)
    row=client.post('/api/admin/products',headers=H,json={'name':'Original','code':'0009','active':False,'demo':True,'note':'Note du gérant','image':'/static/images/catalog/4011-banane.jpg'}).json
    data=preview(client,b'nom;code\nNouveau nom;0009').json
    response=client.post('/api/admin/import/commit',headers=H,json={**data,'mode':'upsert'})
    assert response.status_code==200,response.json
    updated=next(p for p in client.get('/api/admin/products').json['items'] if p['id']==row['id'])
    assert updated['name']=='Nouveau nom'
    for k in ['active','demo','note','image']: assert updated[k]==row[k]
    assert not search(client,'0009').json['products']


def test_transparent_photo_has_white_background(client):
    login(client);raw=io.BytesIO();Image.new('RGBA',(12,12),(0,0,0,0)).save(raw,'PNG')
    uploaded=client.post('/api/admin/images/upload',headers=H,data={'file':(io.BytesIO(raw.getvalue()),'transparent.png')})
    assert uploaded.status_code==200
    image=Image.open(io.BytesIO(client.get(uploaded.json['image']).data))
    assert min(image.getpixel((0,0)))>=250


def test_parallel_failed_logins_respect_limit(app):
    def attempt(_):
        return app.test_client().post('/api/login',headers=H,json={'password':'bad'}).status_code
    with ThreadPoolExecutor(max_workers=12) as pool: statuses=list(pool.map(attempt,range(12)))
    assert statuses.count(401)==8,statuses
    assert statuses.count(429)==4,statuses


def test_featured_skips_ambiguous_names(client):
    login(client)
    for name,code in [('Banane','4011'),('Avocat','4225'),('Avocat','4226')]:
        client.post('/api/admin/products',headers=H,json={'name':name,'code':code})
    assert [p['code'] for p in client.get('/api/catalog').json['featured']]==['4011']


def test_production_filter_hides_fiction_preserving_admin(app,client):
    app.config['HIDE_DEMO']=True
    assert client.get('/api/catalog').json['total']==0
    assert not search(client,'avocat').json['found']
    assert not search(client,'retour sans facture').json['found']
    login(client)
    assert len(client.get('/api/admin/products').json['items'])==26
    docs=client.get('/api/admin/knowledge').json['items']
    assert len(docs)==4
    assert client.get('/api/knowledge/'+docs[0]['id']).status_code==404
    row=client.post('/api/admin/products',headers=H,json={'name':'Réel','code':'000001'}).json
    assert search(client,'000001').json['products'][0]['code']=='000001'
