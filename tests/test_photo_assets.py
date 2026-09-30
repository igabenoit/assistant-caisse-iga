import io
from test_app import app, client
from caisse import photo_assets

def test_photo_asset_is_allowlisted(client):
    assert client.get('/photo-assets/untrusted.js').status_code == 404
    assert client.post('/photo-assets/model.json').status_code == 405
    assert client.get('/essai-photo').headers['Cache-Control'] == 'no-store'

def test_photo_asset_rejects_modified_download(client, monkeypatch, tmp_path):
    monkeypatch.setenv('PHOTO_ASSET_CACHE', str(tmp_path/'model'))
    monkeypatch.setattr(photo_assets, 'urlopen', lambda *a, **k: io.BytesIO(b'modified script'))
    assert client.get('/photo-assets/tf.min.js').status_code == 503
    assert not (tmp_path/'model').exists()

def test_photo_asset_cached_without_network(client, monkeypatch, tmp_path):
    monkeypatch.setenv('PHOTO_ASSET_CACHE', str(tmp_path))
    (tmp_path/photo_assets.MANIFEST['tf.min.js']['sha256']).write_bytes(b'cached asset')
    def unexpected(*args, **kwargs):
        raise AssertionError('Cached asset should not download')
    monkeypatch.setattr(photo_assets, 'urlopen', unexpected)
    response=client.get('/photo-assets/tf.min.js')
    assert response.status_code == 200
    assert response.data == b'cached asset'
    assert "script-src 'self'" in response.headers['Content-Security-Policy']
