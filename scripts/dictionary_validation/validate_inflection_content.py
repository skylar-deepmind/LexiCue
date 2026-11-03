#!/usr/bin/env python3
"""Verify real Rust expansions retain the exact source entry bodies of base queries."""
import argparse
import json
import os
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--binary', required=True, type=Path)
parser.add_argument('--package', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)

relations = {
    'children': ['child'], 'women': ['woman'], 'mice': ['mouse'],
    'went': ['go'], 'gone': ['go'], 'bought': ['buy'],
    'studies': ['study'], 'books': ['book'], 'running': ['run'],
    'studied': ['study'], 'changed': ['change'], 'saw': ['see'],
    'left': ['leave'], 'found': ['find'], 'leaves': ['leaf', 'leave'],
    'axes': ['axe', 'axis'], 'better': ['good', 'well'],
    'walked': ['walk'], 'walking': ['walk'], 'dogs': ['dog'],
    'played': ['play'], 'plays': ['play'], 'happier': ['happy'],
}
negative = {
    'news': ['new'], 'business': ['bus'], 'glass': ['glas'],
    'series': ['sery'], 'species': ['specy'], 'happiness': ['happy'],
    'action': ['act'], 'takeoff': ['take off', 'take'],
    'run-in': ['run in', 'run'], 'US': ['us'], 'us': ['US'],
}
queries = list(dict.fromkeys(list(relations) + [lemma for targets in relations.values() for lemma in targets] + list(negative) + ['look it up', 'looked the word up', 'a red car', 'take off']))
inputs = args.output / 'content-query-input.json'
output = args.output / 'content-query-results.json'
inputs.write_text(json.dumps(queries))
env = {**os.environ, 'LEXICUE_LONGMAN_PACKAGE_ROOT': str(args.package.resolve()),
       'LEXICUE_LONGMAN_QUERY_INPUT': str(inputs.resolve()),
       'LEXICUE_LONGMAN_QUERY_OUTPUT': str(output.resolve())}
run = subprocess.run([str(args.binary.resolve()), 'longman_real_package_export', '--ignored', '--nocapture'], env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
(args.output / 'content-real-rust.log').write_text(run.stdout)
run.check_returncode()
data = json.loads(output.read_text())
results = {row['result']['query']['text']: row['result'] for row in data['queries']}
checks, summary = [], []
for query, lemmas in relations.items():
    result = results[query]
    assert result['status'] in ['found', 'partial'], (query, result['status'])
    for lemma in lemmas:
        expanded = [entry for entry in result['entries'] if entry['headword'] == lemma and entry['match']['type'] == 'inflection']
        assert expanded, (query, 'missing expanded lemma', lemma)
        bases = {entry['id']: entry for entry in results[lemma]['entries']}
        for entry in expanded:
            assert entry['id'] in bases, (query, 'foreign entry ID', entry['id'])
            base = bases[entry['id']]
            for field in ['groups', 'notes', 'related_expressions', 'headword', 'kind', 'source']:
                assert entry[field] == base[field], (query, lemma, field, 'body differs from directly queried source entry')
        checks.append(f'{query} → {lemma}: source bodies including all senses/examples identical')
    summary.append({'query': query, 'status': result['status'], 'entries': [
        {'headword': entry['headword'], 'match': entry['match']['type'],
         'senses': sum(len(group['senses']) for group in entry['groups']),
         'examples': sum(len(sense['examples']) for group in entry['groups'] for sense in group['senses'])}
        for entry in result['entries']]})
for query, rejected in negative.items():
    heads = [entry['headword'] for entry in results[query]['entries']]
    assert not set(heads).intersection(rejected), (query, 'invalid expansion', heads)
    checks.append(f'{query}: no expansion to {", ".join(rejected)}')
for query in ['books', 'running', 'studied', 'changed', 'saw', 'left', 'found', 'better', 'gone']:
    assert any(entry['headword'] == query for entry in results[query]['entries']), (query, 'independent source entry was lost')
    checks.append(f'{query}: independent source entry preserved')
assert results['a red car']['entries'] == [], 'arbitrary phrase must not become component definitions'
checks.append('a red car: no invented whole-expression entry')
report = {'passed': True, 'kind': 'Production Rust package reader, exact source-body comparison; no UI simulation', 'checks': checks, 'summary': summary,
          'total_query_ms': data['total_query_ms'], 'query_count': len(queries)}
(args.output / 'content-validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(f'{len(checks)} content checks passed across {len(queries)} real Rust queries')
