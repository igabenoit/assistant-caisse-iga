"""Serve pinned public model files. No photo is accepted or sent upstream."""
import hashlib
import json
import os
import tempfile
import threading
from pathlib import Path
from urllib.request import urlopen
from flask import abort, send_file

MANIFEST = json.loads((Path(__file__).resolve().parents[1] / 'data/photo-assets.json').read_text())
LOCKS = {name: threading.Lock() for name in MANIFEST}

def photo_asset(name):
    entry = MANIFEST.get(name)
    if not entry:
        abort(404)
    bundled = Path(__file__).resolve().parents[1] / 'static' / 'photo-assets' / name
    if 'PHOTO_ASSET_CACHE' not in os.environ and bundled.is_file():
        if hashlib.sha256(bundled.read_bytes()).hexdigest() != entry['sha256']:
            abort(503, description='Modèle photo intégré invalide.')
        mimetype = 'application/javascript' if name.endswith('.js') else 'application/json' if name.endswith('.json') else 'application/octet-stream'
        response = send_file(bundled, mimetype=mimetype, conditional=True, etag=entry['sha256'])
        response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        return response
    cache = Path(os.environ.get('PHOTO_ASSET_CACHE', str(Path(tempfile.gettempdir()) / 'caisse-photo-model-v1')))
    path = cache / entry['sha256']
    with LOCKS[name]:
        if not path.exists():
            try:
                with urlopen(entry['url'], timeout=20) as response:
                    data = response.read(8 * 1024 * 1024 + 1)
                if hashlib.sha256(data).hexdigest() != entry['sha256']:
                    raise ValueError('Model asset integrity mismatch')
                cache.mkdir(parents=True, exist_ok=True)
                temporary = path.with_suffix('.tmp')
                temporary.write_bytes(data)
                temporary.replace(path)
            except Exception:
                abort(503, description='Modèle photo temporairement indisponible.')
    mimetype = 'application/javascript' if name.endswith('.js') else 'application/json' if name.endswith('.json') else 'application/octet-stream'
    response = send_file(path, mimetype=mimetype, conditional=True, etag=entry['sha256'])
    response.headers['Cache-Control'] = 'public, max-age=86400'
    return response
