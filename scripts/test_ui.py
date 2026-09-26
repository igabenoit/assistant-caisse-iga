"""Optional DOM integration tests. Run npm ci, then python scripts/test_ui.py.
Uses a disposable SQLite database and JSDOM (no real microphone/browser).
"""
import os,sys,tempfile,subprocess,threading
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from caisse import create_app
from werkzeug.serving import make_server
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory() as temp:
    os.environ['SEED_DEMO']='true'
    app=create_app({'TESTING':True,'DATABASE_URL':'sqlite:///'+str(Path(temp)/'ui.db')})
    server=make_server('127.0.0.1',0,app,threaded=True)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    env={**os.environ,'UI_ADMIN_PASSWORD':'Testing-password-123','UI_BASE_URL':f'http://127.0.0.1:{server.server_port}'}
    try:result=subprocess.run(['node','tests/ui-check.cjs'],cwd=root,env=env)
    finally:server.shutdown()
    raise SystemExit(result.returncode)
