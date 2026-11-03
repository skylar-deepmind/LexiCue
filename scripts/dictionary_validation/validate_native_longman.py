#!/usr/bin/env python3
"""Opt-in independent Rust / frozen Python adapter comparison. Development only."""
import argparse
import copy
import gzip
import hashlib
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--package', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--native-test-binary', type=Path, help='Run an already built Rust test binary; do not invoke Cargo')
args = parser.parse_args()
project = Path(__file__).resolve().parents[2]
args.output.mkdir(parents=True, exist_ok=True)
fixed = json.loads((args.package / 'validation-v1/fixed100-v1-results.json').read_text())
boundary = json.loads((args.package / 'validation-v1/boundary-v1-results.json').read_text())
queries = list(dict.fromkeys([r['query']['text'] for r in fixed] + list(boundary) + ['US', 'us', 'record', 'look up', 'look it up', 'looked the word up', 'turned it off', 'a red car', 'calm down', 'told', 'turf', 'pre-nup', 'hurray', 'cost an arm and a leg', 'zzlexicueunknownzz']))
input_file = args.output / 'native-query-input.json'
output_file = args.output / 'native-query-results.json'
sentence_case_queries = {'Curiosity': 'curiosity', 'We': 'we', 'Look it up': 'look it up', 'Record': 'record'}
all_queries = list(dict.fromkeys(queries + list(sentence_case_queries) + ['London']))
input_file.write_text(json.dumps(all_queries, ensure_ascii=False))
env = {**os.environ, 'LEXICUE_LONGMAN_PACKAGE_ROOT': str(args.package.resolve()), 'LEXICUE_LONGMAN_QUERY_INPUT': str(input_file.resolve()), 'LEXICUE_LONGMAN_QUERY_OUTPUT': str(output_file.resolve())}
command = [str(args.native_test_binary.resolve()), 'longman_real_package_', '--ignored', '--nocapture'] if args.native_test_binary else ['cargo', 'test', '--manifest-path', str(project / 'src-tauri/Cargo.toml'), '--lib', 'longman_real_package_', '--offline', '--', '--ignored', '--nocapture']
subprocess.run(command, env=env, check=True, cwd=project)
sys.path.insert(0, str(project / 'scripts/dictionary_validation'))
from package_query import LocalDictionary
from package_semantics import validate_result, validate_schema
reference = LocalDictionary(args.package / 'text-v1', None, verify=False)
actual = json.loads(output_file.read_text())
failures = []
semantic_errors = []
intentional_sentence_case_results = []

def text_reference(query):
    # Product change: recordings are retired; source text/IPA remain strictly compared.
    result = reference.query(query)
    result['notices'] = [notice for notice in result['notices'] if notice['code'] != 'audio_package_unavailable']
    for entry in result['entries']:
        for group in entry['groups']:
            group['pronunciations'] = [pron for pron in group['pronunciations'] if pron['ipa']]
    return result

def differences(a, b, path=''):
    if type(a) is not type(b):
        return [{'path': path, 'expected': b, 'actual': a}]
    if isinstance(a, dict):
        out = []
        for k in sorted(a.keys() | b.keys()):
            if k not in a or k not in b:
                out.append({'path': path + '/' + k, 'expected': b.get(k), 'actual': a.get(k)})
            else:
                out.extend(differences(a[k], b[k], path + '/' + k))
        return out
    if isinstance(a, list):
        out = []
        if len(a) != len(b):
            out.append({'path': path + '/length', 'expected': len(b), 'actual': len(a)})
        for i, (x, y) in enumerate(zip(a, b)):
            out.extend(differences(x, y, path + '/' + str(i)))
        return out
    return [] if a == b else [{'path': path, 'expected': b, 'actual': a}]

for row in actual['queries']:
    r = row['result']
    q = r['query']['text']
    comparison = r
    expected = text_reference(q)
    if q in sentence_case_queries:
        # This is an intentional reading normalization beyond the frozen adapter.
        # Validate the original V1 shape and bind every returned entity to the
        # independently queried lowercase source target, without weakening schema.
        lowercase = sentence_case_queries[q]
        strict_original_status = expected['status']
        expected = text_reference(lowercase)
        comparison = copy.deepcopy(r)
        comparison['query']['text'] = lowercase
        notes_valid = all('Sentence capitalization normalized' in (e['match']['note'] or '') for e in r['entries']) and bool(r['entries'])
        expected_entries = {e['id']: e for e in expected['entries']}
        for e in comparison['entries']:
            if e['id'] in expected_entries:
                e['match']['note'] = expected_entries[e['id']]['match']['note']
        intentional_sentence_case_results.append({'query': q, 'normalized_query': lowercase, 'frozen_reference_status': strict_original_status, 'native_status': r['status'], 'preserves_query': r['query']['text'] == q, 'normalization_note_present': notes_valid})
        if not notes_valid:
            failures.append({'query': q, 'differences': [{'path': '/entries/match/note', 'expected': 'explicit sentence capitalization note', 'actual': r['entries']}]})
    diff = differences(comparison, expected)
    if diff:
        failures.append({'query': q, 'differences': diff})
    errors = validate_schema(r, package_root=args.package / 'text-v1') + validate_result(comparison, args.package / 'text-v1', args.package / 'audio-work/headword-audio', dictionary=reference)
    if errors:
        semantic_errors.append({'query': q, 'errors': errors})
by_query = {r['result']['query']['text']: r['result'] for r in actual['queries']}
fixed_counts = {}
for expected in fixed:
    status = by_query[expected['query']['text']]['status']
    fixed_counts[status] = fixed_counts.get(status, 0) + 1
elapsed = sorted(r['elapsed_ms'] for r in actual['queries'])
manifest = json.loads((args.package / 'text-v1/manifest.json').read_text())
fingerprint = {'text_manifest_sha256': hashlib.sha256((args.package / 'text-v1/manifest.json').read_bytes()).hexdigest(), 'runtime_database': next(x for x in manifest['files'] if x['path'] == 'runtime.sqlite'), 'recordings': 'retired; audio package not used'}
summary = {'fingerprint': fingerprint, 'native_resource_tests': {'text_and_ipa_work_without_recordings': True, 'record_four_ipa_variants_preserved': True, 'dictionary_audio_fields_null': True, 'no_missing_recordings_notices': True}, 'queries': len(all_queries), 'frozen_reference_queries': len(queries), 'fixed100_counts': fixed_counts, 'exact_json_parity': len(queries) - sum(f['query'] in queries for f in failures), 'intentional_sentence_case_normalization': intentional_sentence_case_results, 'additional_exact_source_match': {'query': 'London', 'native_status': by_query['London']['status'], 'exact_source_priority_preserved': by_query['London'] == text_reference('London')}, 'differences': failures, 'schema_semantic_errors': semantic_errors, 'status': actual['status'], 'performance_ms': {'median': statistics.median(elapsed), 'p95': elapsed[int(len(elapsed) * .95)], 'maximum': max(elapsed)}, 'pass': not failures and not semantic_errors}
with gzip.open(args.output / 'native-query-results.json.gz', 'wb', compresslevel=9) as zipped:
    zipped.write(output_file.read_bytes())
output_file.unlink()
(args.output / 'native-parity-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2))
print(json.dumps({k:v for k,v in summary.items() if k not in ('differences', 'schema_semantic_errors')}, ensure_ascii=False, indent=2))
for f in failures:
    print(f['query'], json.dumps(f['differences'][:4], ensure_ascii=False))
reference.close()
raise SystemExit(0 if summary['pass'] else 1)
