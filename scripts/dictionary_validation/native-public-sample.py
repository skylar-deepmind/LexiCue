"""Bounded native sample using exactly the app's default reqwest transport."""
import json
import os
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parents[2]
output = root / 'docs/implementation/evidence/cambridge-public-v1/live'
cases = ['doomscrolling', 'US', 'us', 'took', 'look it up', 'cost an arm and a leg']
for query in cases:
    slug = {'US': 'us-uppercase', 'us': 'us-lowercase'}.get(query, query.replace(' ', '_'))
    prefix = 'native-live-' + slug
    raw = output / f'{prefix}-raw.json'
    result = output / f'{prefix}-result.json'
    if raw.exists():
        print(query, 'already captured; no repeated request', flush=True)
        continue
    env = dict(os.environ)
    for key in ['LEXICUE_CAMBRIDGE_PUBLIC_TEST_URL', 'LEXICUE_CAMBRIDGE_CHANNEL']:
        env.pop(key, None)
    env.update(LINDERA_DICTIONARIES_PATH=str(root/'scripts/cache/lindera'),
               LEXICUE_CAMBRIDGE_PUBLIC_CACHE_DIR='/private/tmp/lexicue-public-live-cache',
               LEXICUE_CAMBRIDGE_PUBLIC_CAPTURE_RAW=str(raw),
               LEXICUE_CAMBRIDGE_PUBLIC_CAPTURE_RESULT=str(result),
               LEXICUE_CAMBRIDGE_PUBLIC_TEST_QUERY=query)
    with (output/f'{prefix}.log').open('w') as log:
        completed = subprocess.run(['cargo','test','--manifest-path',str(root/'src-tauri/Cargo.toml'),
          'public_live_record_evidence','--lib','--','--ignored','--nocapture','--test-threads=1'],env=env,stdout=log,stderr=subprocess.STDOUT,timeout=180)
    if not raw.exists():
        print(query, 'no raw HTTP response', completed.returncode, flush=True)
        break
    evidence=json.loads(raw.read_text())
    normalized=json.loads(result.read_text())
    print(query, evidence['status'], normalized['status'], [notice['code'] for notice in normalized['notices']],flush=True)
    if evidence['status'] in (403,429):
        print('Stopped on access denial/rate limit, no retry.',flush=True)
        break
