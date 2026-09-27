"""Deterministic expected results, real local HTTP/SQL logic, no AI mocks.
Run with --output report.json. Never contacts or modifies production.
"""
import sys,json,tempfile,time,argparse,statistics
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from caisse import create_app
from caisse.models import products,knowledge
from sqlalchemy import delete,insert
root=Path(__file__).resolve().parent.parent
catalog=json.loads((root/'tests/fixtures/audit_catalog.json').read_text(encoding='utf8'))
cases=json.loads((root/'tests/fixtures/audit_queries.json').read_text(encoding='utf8'))

def run(output):
 with tempfile.TemporaryDirectory() as temp:
  app=create_app({'TESTING':True,'DATABASE_URL':'sqlite:///'+str(Path(temp)/'audit.db')})
  engine=app.extensions['db']
  with engine.begin() as con:
   for table,key in [(products,'products'),(knowledge,'knowledge')]:
    con.execute(delete(table));con.execute(insert(table),catalog[key])
  def session_run(session):
   client=app.test_client();results=[]
   for c in cases:
    started=time.perf_counter()
    r=client.post('/api/search',headers={'X-App-Request':'1'},json={'query':c['query'],'device':f'Audit {session}','record':False})
    elapsed=(time.perf_counter()-started)*1000;data=r.get_json() or {}
    codes=sorted(p['code'] for p in data.get('products',[]));answers=[a['title'] for a in data.get('answers',[])]
    expected_answers=[c['answer']] if 'answer' in c else []
    ok=r.status_code==200 and codes==sorted(c['codes']) and answers==expected_answers
    results.append({**c,'session':session,'status':r.status_code,'actual_codes':codes,'actual_answers':answers,'ok':ok,'ms':round(elapsed,2)})
   return results
  try:
   single=session_run(0)
   with ThreadPoolExecutor(max_workers=3) as pool:concurrent=sum(list(pool.map(session_run,[1,2,3])),[])
   def summary(rows):
    times=sorted(r['ms'] for r in rows)
    return {'count':len(rows),'passed':sum(r['ok'] for r in rows),'unexpected_codes':sum(bool(set(r['actual_codes'])-set(r['codes'])) for r in rows),'missed_products':sum(bool(set(r['codes'])-set(r['actual_codes'])) for r in rows),'expected_ambiguous':sum(len(r['codes'])>1 for r in rows),'median_ms':statistics.median(times),'p95_ms':times[int(.95*(len(times)-1))],'max_ms':max(times)}
   report={'mode':'Flask test clients, SQLite, catalogue snapshot; not network or physical devices','single':summary(single),'three_sessions':summary(concurrent),'failures':[r for r in single if not r['ok']],'results':single}
   Path(output).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
   print(json.dumps({k:v for k,v in report.items() if k!='results'},ensure_ascii=False,indent=2))
   return all(r['ok'] for r in single+concurrent)
  finally:engine.dispose()
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);raise SystemExit(0 if run(p.parse_args().output) else 1)
