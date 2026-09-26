"""Restore missing DEMO photos from the versioned attribution manifest.
Only needed if a bundled image was accidentally removed. Never runs at search time.
"""
import json,urllib.request,io,time
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parent.parent
for row in json.loads((root/'data/image-credits.json').read_text()):
    path=root/'static/images'/row['file']
    if path.exists():continue
    request=urllib.request.Request(row['image_url'],headers={'User-Agent':'AssistantCaisseDemo/1.0'})
    with urllib.request.urlopen(request,timeout=30) as response:
        image=Image.open(io.BytesIO(response.read())).convert('RGB')
        image.thumbnail((500,500));image.save(path,'JPEG',quality=86)
    time.sleep(1)
print('Photos DEMO disponibles. Crédits dans docs/PHOTOS.md.')
