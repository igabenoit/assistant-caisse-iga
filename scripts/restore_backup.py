"""Restore an admin JSON export into an EMPTY database.
Usage: SEED_DEMO=false python scripts/restore_backup.py backup.json
No replace/overwrite mode: a nonempty database is always refused.
"""
import sys,json,base64,uuid,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
os.environ['SEED_DEMO']='false'
from caisse import create_app
from caisse.models import products,knowledge,images,settings
from sqlalchemy import select,insert,update,func

def restore(path):
    data=json.loads(Path(path).read_text())
    if data.get('schema_version')!=1: raise ValueError('Version de sauvegarde non reconnue.')
    app=create_app();engine=app.extensions['db']
    with engine.begin() as con:
        if any(con.execute(select(func.count()).select_from(t)).scalar() for t in [products,knowledge,images]):
            raise ValueError('La base doit être vide. Restauration annulée sans modification.')
        for table,key in [(products,'products'),(knowledge,'knowledge'),(images,'images')]:
            rows=data.get(key,[])
            if not isinstance(rows,list): raise ValueError('Sauvegarde invalide.')
            for row in rows:
                if table is images:
                    row={**row,'data':base64.b64decode(row['data'],validate=True)}
                con.execute(insert(table).values(**row))
        con.execute(update(settings).where(settings.c.key=='revision').values(value=str(uuid.uuid4())))
        con.execute(update(settings).where(settings.c.key=='seeded').values(value='true'))
    print('Restauration terminée dans la base vide.')
if __name__=='__main__':
    if len(sys.argv)!=2: raise SystemExit(__doc__)
    try:restore(sys.argv[1])
    except Exception as e:raise SystemExit(str(e))
