"""Small, bounded live sample. No reader context is sent; replay is separate."""
import datetime
import hashlib
import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

out = pathlib.Path(__file__).resolve().parents[2] / 'docs/implementation/evidence/cambridge-public-v1/live'
out.mkdir(parents=True, exist_ok=True)
queries = sys.argv[1:] or ['record', 'doomscrolling', 'US', 'us', 'took', 'look it up', 'cost an arm and a leg', 'a red car']
for query in queries:
    slug = {'US': 'us-uppercase', 'us': 'us-lowercase'}.get(query, query.replace(' ', '_'))
    if (out / f'{slug}.meta.json').exists():
        previous = json.loads((out / f'{slug}.meta.json').read_text())
        if previous.get('status') in (403, 429):
            print('Previous access denial or rate limit is recorded; no new batch sent.')
            break
        print(f'{query}: already captured; no repeat request')
        continue
    url = 'https://dictionary-api.eliaschen.dev/api/dictionary/en-cn/' + urllib.parse.quote(query, safe='')
    started = time.monotonic()
    meta = {'query': query, 'url': url, 'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'mode': 'live author public API', 'request_number': len(list(out.glob('*.meta.json'))) + 1}
    try:
        try:
            response = urllib.request.urlopen(urllib.request.Request(url, headers={'Accept': 'application/json'}), timeout=12)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            body = response.read(2 * 1024 * 1024 + 1)
            meta.update(status=response.code, headers=dict(response.headers), sha256=hashlib.sha256(body).hexdigest(), bytes=len(body))
            (out / f'{slug}.json').write_bytes(body)
    except Exception as error:
        meta['transport_error'] = str(error)
    meta.update(received_at=datetime.datetime.now(datetime.timezone.utc).isoformat(), duration_seconds=round(time.monotonic()-started, 3))
    (out / f'{slug}.meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    print(json.dumps(meta, ensure_ascii=False), flush=True)
    if meta.get('status') in (403, 429):
        print('Access denied or rate limited: stopping this batch without retries.', flush=True)
        break
