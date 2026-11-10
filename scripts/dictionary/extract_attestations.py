#!/usr/bin/env python3
"""Derive aggregate phrase-attestation signals; never retain quotation text/ref.

Only counts, year counts and latest year are saved. These are selection signals,
not rights clearance or an observed population phrase-frequency measurement.
"""
import argparse
import collections
import gzip
import hashlib
import json
from pathlib import Path
import re
from build_pack import fold, hashes, js


def extract(raw_path, output):
    expected='5ff2c072f8099f2d2ce484bd6957bf179f046d2ad37bc36555edf8bb84cb5291'
    if hashes(raw_path)['sha256']!=expected:raise ValueError('Unexpected raw extraction')
    refs=collections.defaultdict(dict);examples=collections.Counter()
    with gzip.open(raw_path,'rb') as f:
        for line in f:
            if b'"lang_code": "en"' not in line and b'"lang_code":"en"' not in line:continue
            v=json.loads(line)
            if v.get('lang_code')!='en' or not v.get('word'):continue
            word=fold(v['word'])
            if len(re.findall(r"[a-z]+(?:['’][a-z]+)?",word))<2:continue
            for s in v.get('senses',[]):
                for ex in s.get('examples',[]):
                    if ex.get('type')=='example':examples[word]+=1
                    if ex.get('type')!='quotation':continue
                    ref=ex.get('ref','')
                    match=re.match(r'^(\d{4})\b',ref)
                    if match and 1970<=int(match[1])<=2026:
                        refs[word][hashlib.sha256(ref.encode()).digest()]=int(match[1])
    result={}
    for word in sorted(set(refs)|set(examples)):
        years=list(refs.get(word,{}).values())
        result[word]=[len(years),len(set(years)),max(years,default=0),examples[word]]
    with output.open('wb') as f,gzip.GzipFile(filename='',fileobj=f,mode='wb',mtime=0,compresslevel=9) as z:z.write(js(result).encode())
    print(json.dumps({'output':hashes(output),'words':len(result),'columns':['recent_distinct_references','recent_distinct_years','latest_year','ordinary_example_candidates'],'source_sha256':expected},indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('raw',type=Path);p.add_argument('output',type=Path);a=p.parse_args();extract(a.raw,a.output)
