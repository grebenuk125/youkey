import json, re, urllib.request
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

urls = [u.rstrip("'") for u in json.loads(Path('research/assets.json').read_text(encoding='utf8')) if re.search(r'\.(jpg|jpeg|png|JPG|PNG)', u) and 'icons8' not in u]
def download(item):
    i, url = item
    path = Path('research') / f'asset-{i:02d}{Path(url).suffix.lower()}'
    try:
        urllib.request.urlretrieve(url, path)
        return {'id': i, 'url': url, 'path': str(path)}
    except Exception as e:
        return {'url': url, 'error': str(e)}
with ThreadPoolExecutor(max_workers=8) as pool:
    manifest = list(pool.map(download, enumerate(urls)))
Path('research/media-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
print(f'Downloaded {sum("path" in x for x in manifest)} / {len(urls)} assets')
