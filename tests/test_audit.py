import io,json,os,subprocess,sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
import pytest
from caisse import create_app
from caisse.search import resolve
from test_app import app,client,login,H,search,preview

def test_exact_ananas_never_bananas(client):
    assert [p['name'] for p in search(client,'ananas').json['products']]==['Ananas']

def test_code_phrase_and_no_digit_guessing(client):
    login(client)
    for name,code in [('Riz 500 g','00401'),('Riz 5000 g','00402')]:
        assert client.post('/api/admin/products',headers=H,json={'name':name,'code':code}).status_code==201
    assert [p['code'] for p in search(client,'code 00401').json['products']]==['00401']
    assert [p['code'] for p in search(client,'riz 500 g').json['products']]==['00401']
    assert not search(client,'riz 5001 g').json['found']

def test_ambiguous_procedures_never_assert_one(client):
    login(client)
    for answer in ['Autorisation du responsable A.','Autorisation du responsable B.']:
        assert client.post('/api/admin/knowledge',headers=H,json={'title':'Retour spécial','keywords':'retour special','answer':answer}).status_code==201
    result=search(client,'retour spécial').json
    assert not result['answers'] and len(result['suggestions'])==2

def test_malformed_imports_do_not_change_data(client):
    login(client);before=client.get('/api/admin/export/backup').json
    assert preview(client,b'not a zip','broken.xlsx').status_code==400
    assert client.post('/api/admin/import/commit',headers=H,json={'rows':[None],'mode':'add'}).status_code==400
    after=client.get('/api/admin/export/backup').json
    for key in ['products','knowledge','images']:assert before[key]==after[key]

def test_photo_limit_server_enforced(client):
    login(client);image=io.BytesIO();Image.new('RGB',(10,10)).save(image,'PNG')
    assert client.post('/api/admin/images/upload',headers=H,data={'file':(io.BytesIO(image.getvalue()+b'\0'*(5*1024*1024)),'large.png')}).status_code==400
    assert client.get('/api/admin/export/backup').json['images']==[]

def test_three_admins_conflicting_update_preserves_winner(app,client):
    login(client)
    row=client.post('/api/admin/products',headers=H,json={'name':'Concurrent','code':'CONC01'}).json
    clients=[app.test_client() for _ in range(3)]
    for c in clients:login(c)
    def change(pair):
        index,c=pair
        return c.put('/api/admin/products/'+row['id'],headers=H,json={**row,'name':f'Concurrent {index}','expected_updated_at':row['updated_at']})
    with ThreadPoolExecutor(max_workers=3) as pool:responses=list(pool.map(change,enumerate(clients)))
    assert sorted(r.status_code for r in responses)==[200,409,409]
    winner=next(r.json for r in responses if r.status_code==200)
    assert next(p for p in client.get('/api/admin/products').json['items'] if p['id']==row['id'])['name']==winner['name']

def test_backup_restores_photos_and_refuses_nonempty(client,tmp_path):
    login(client);image=io.BytesIO();Image.new('RGB',(8,8),'red').save(image,'PNG')
    photo=client.post('/api/admin/images/upload',headers=H,data={'file':(io.BytesIO(image.getvalue()),'photo.png')}).json['image']
    created=client.post('/api/admin/products',headers=H,json={'name':'Photo sauvegardée','code':'BACKUP','image':photo}).json
    from test_photo_bank import add
    assert add(client,created['id']).status_code==201
    before=client.get('/api/admin/export/backup').json;backup=tmp_path/'backup.json';backup.write_text(json.dumps(before),encoding='utf8')
    url='sqlite:///'+str(tmp_path/'restored.db')
    env={**os.environ,'DATABASE_URL':url,'APP_ENV':'development','ADMIN_PASSWORD':'Testing-password-123','SECRET_KEY':'restore-test-only-key-over-32-characters','SEED_DEMO':'false','PYTHONUTF8':'1'}
    command=[sys.executable,str(Path(__file__).resolve().parents[1]/'scripts/restore_backup.py'),str(backup)]
    r=subprocess.run(command,env=env,capture_output=True,text=True);assert r.returncode==0,r.stderr
    restored=create_app({'TESTING':True,'DATABASE_URL':url});c=restored.test_client();login(c)
    try:
        after=c.get('/api/admin/export/backup').json
        for key in ['products','knowledge','images','photo_references']:assert sorted(before[key],key=lambda x:x['id'])==sorted(after[key],key=lambda x:x['id'])
        assert c.get(photo).status_code==200
        refused=subprocess.run(command,env=env,capture_output=True,text=True);assert refused.returncode!=0
        assert c.get('/api/admin/export/backup').json['products']==after['products']
    finally:restored.extensions['db'].dispose()

def test_health_exposes_version(client,monkeypatch):
    monkeypatch.setenv('RENDER_GIT_COMMIT','audit-build')
    assert client.get('/healthz').json['version']=='audit-build'
