#!/usr/bin/env python3
"""Extract only English token frequency signals from a pinned wordfreq wheel.

Preparation only: msgpack==1.1.2. Runtime package construction is stdlib-only.
No definitions or examples are taken from wordfreq.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import zipfile

WHEEL_SHA256 = '4b1c6ecffc6198be3396d5cf871c4423ca71c907c231348d352dd54d62b97473'


def extract(wheel, output):
    import msgpack
    if msgpack.__version__ != '1.1.2': raise ValueError('Use msgpack==1.1.2 for the recorded extraction')
    if hashlib.sha256(wheel.read_bytes()).hexdigest() != WHEEL_SHA256: raise ValueError('Unexpected wordfreq wheel')
    with zipfile.ZipFile(wheel) as z:
        raw = z.read('wordfreq/data/large_en.msgpack.gz')
    bins = msgpack.unpackb(gzip.decompress(raw), raw=False)
    if bins[0] != {'format': 'cB', 'version': 1}: raise ValueError('Unexpected frequency format')
    # cBpack index excludes header. Zipf=(-index+900)/100, per upstream
    # documented format. Integer hundredths avoid float threshold errors.
    freqs = {w: 900-i for i, words in enumerate(bins[1:]) for w in words}
    if freqs['the'] != 773: raise ValueError('Frequency bin offset regression')
    payload = json.dumps(freqs, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
    with output.open('wb') as f, gzip.GzipFile(filename='', mode='wb', fileobj=f, mtime=0, compresslevel=9) as z: z.write(payload)
    return {'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'bytes': output.stat().st_size, 'tokens': len(freqs), 'input_member_sha256': hashlib.sha256(raw).hexdigest()}


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('wheel',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    print(json.dumps(extract(a.wheel,a.output),indent=2))
