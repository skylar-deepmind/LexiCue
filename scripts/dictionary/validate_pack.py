#!/usr/bin/env python3
"""Validate complete SQLite semantics and produce reproducible quality evidence."""
import argparse
import collections
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sqlite3
import sys
import zipfile

from build_pack import ADAPTER, HERE, LICENSE_URL, VERSION, fold, hashes, js, lookup, norm, relation, write_json

ROOT = HERE.parents[1]
FIXTURES = ROOT / 'tests/dictionary' if (ROOT / 'tests/dictionary/queries.json').exists() else HERE
TOKEN = re.compile(r"[A-Za-z]+(?:['’\-][A-Za-z]+)*")


class Paragraphs(HTMLParser):
    def __init__(self):
        super().__init__(); self.depth = 0; self.current = []; self.paragraphs = []; self.ignore = 0
    def handle_starttag(self, tag, attrs):
        if tag in ['script', 'style']: self.ignore += 1
        if tag == 'p' and not self.ignore: self.depth += 1; self.current = []
    def handle_endtag(self, tag):
        if tag in ['script', 'style']: self.ignore = max(0, self.ignore - 1)
        if tag == 'p' and self.depth:
            text = norm(''.join(self.current))
            if len(text) >= 60: self.paragraphs.append(text)
            self.depth -= 1
    def handle_data(self, data):
        if self.depth and not self.ignore: self.current.append(data)


def capture_corpora(directory, dest):
    """Capture token frequencies only, not copyrighted prose, in the repo."""
    specs = [
        ('pride-and-prejudice.txt', 'https://www.gutenberg.org/ebooks/1342.txt.utf-8', 'Narrative: Pride and Prejudice, first 40,000 characters from the opening sentence'),
        ('python-introduction.html', 'https://docs.python.org/3/tutorial/introduction.html', 'Technical: Python introduction; paragraph text of at least 60 characters'),
        ('nasa-evidence.html', 'https://science.nasa.gov/climate-change/evidence/', 'Science: NASA climate evidence; paragraphs of at least 60 characters before the first numbered reference; reference list and footer omitted'),
    ]
    records = []
    for name, url, desc in specs:
        p = directory / name
        raw = p.read_text(encoding='utf-8-sig')
        if p.suffix == '.html':
            parser = Paragraphs(); parser.feed(raw)
            paragraphs = parser.paragraphs
            if name == 'nasa-evidence.html':
                first_reference = next(i for i, value in enumerate(paragraphs) if re.match(r'^1\.\s', value))
                paragraphs = paragraphs[:first_reference]
            text = '\n'.join(paragraphs)
        else:
            start = raw.index('It is a truth universally acknowledged')
            text = raw[start:start + 40000]
        tokens = TOKEN.findall(text)
        records.append({'id': p.stem, 'url': url, 'description': desc, 'download': hashes(p), 'extracted_text_sha256': hashlib.sha256(text.encode()).hexdigest(), 'tokens': dict(sorted(collections.Counter(tokens).items())), 'tokenization': 'ASCII alphabetic words with internal apostrophes/hyphens; original case retained; no stemming, POS tagging or semantic disambiguation.'})
    write_json(dest, records)


def coverage(c, queries):
    hits, direct, via, folded, misses = [], [], [], [], []
    examples, pron = [], []
    details = {}
    for q in queries:
        result = lookup(c, q)
        es = result['entries']
        if not es:
            misses.append(q); details[q] = {'outcome': 'miss'}; continue
        if result['normalization'] == 'casefold_candidates':
            folded.append(q); outcome = 'casefold_candidates'
        else:
            hits.append(q)
            if any(e['match'] == 'exact' for e in es): direct.append(q); outcome = 'direct'
            else: via.append(q); outcome = 'relation'
        if any(s['examples'] for e in es for s in e['senses']): examples.append(q)
        if any(c.execute('SELECT 1 FROM pronunciations WHERE entry_id=?', (e['entry_id'],)).fetchone() for e in es): pron.append(q)
        details[q] = {'outcome': outcome, 'targets': sorted({(e['headword'], e['pos']) for e in es}), 'senses': sum(len(e['senses']) for e in es)}
    return {'total': len(queries), 'exact_surface_substantive': len(hits), 'direct': len(direct), 'via_relation_only': len(via), 'casefold_candidate_queries': folded, 'misses': misses, 'queries_with_examples': len(examples), 'queries_with_pronunciation_text': len(pron), 'details': details}


def validate(output, queries_path, corpora_path, source_stage=None):
    c = sqlite3.connect(f'file:{output / "dictionary.sqlite3"}?mode=ro', uri=True)
    checks = {}
    def check(name, condition, detail=None):
        checks[name] = {'passed': bool(condition), 'detail': detail}
        if not condition: print('VALIDATION_FAILURE', name, detail, file=sys.stderr)
    check('sqlite_integrity', c.execute('PRAGMA integrity_check').fetchone()[0] == 'ok')
    fks = c.execute('PRAGMA foreign_key_check').fetchall()
    check('foreign_keys', not fks, fks[:10])
    check('application_id', c.execute('PRAGMA application_id').fetchone()[0] == 1280857155)
    check('schema_version', c.execute('PRAGMA user_version').fetchone()[0] == 1)
    check('provider', dict(c.execute('SELECT key,value FROM metadata')).get('provider') == 'wiktionary')
    empty = c.execute('SELECT count(*) FROM entries e WHERE NOT EXISTS(SELECT 1 FROM senses s WHERE s.entry_id=e.id)').fetchone()[0]
    check('all_entries_have_substantive_senses', empty == 0, empty)
    broken = c.execute('SELECT count(*) FROM aliases a LEFT JOIN entries e ON e.id=a.target_entry WHERE e.id IS NULL OR NOT EXISTS(SELECT 1 FROM senses s WHERE s.entry_id=e.id)').fetchone()[0]
    check('all_alias_targets_have_substantive_senses', broken == 0, broken)
    errors = collections.Counter(); samples = collections.defaultdict(list)
    for sid, definition, ancestors, gloss, raw in c.execute('SELECT id,definition,ancestors_json,gloss_path_json,raw_gloss_path_json FROM senses'):
        chain, parents, raws = json.loads(gloss), json.loads(ancestors), json.loads(raw)
        if not definition.strip() or relation({'glosses': [definition]}):
            errors['empty_or_relation_sense'] += 1
            if len(samples['relation']) < 20: samples['relation'].append([sid, definition])
        if not chain or chain[-1] != definition or [x['definition'] for x in parents] != chain[:-1]: errors['ancestor_mismatch'] += 1
        if not raws: errors['raw_gloss_missing'] += 1
    check('sense_content_and_ancestry', not errors, dict(errors))
    unicode_issues = []
    control = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]')
    for table, column in [('entries', 'headword'), ('senses', 'definition'), ('senses', 'gloss_path_json'), ('senses', 'raw_gloss_path_json'), ('examples', 'text'), ('pronunciations', 'text'), ('forms', 'form'), ('relation_records', 'headword'), ('relation_examples', 'text')]:
        count, examples = 0, []
        for ident, value in c.execute(f'SELECT rowid,{column} FROM {table}'):
            if control.search(value):
                count += 1
                if len(examples) < 8: examples.append([ident, value[:180]])
        if count: unicode_issues.append({'table': table, 'column': column, 'count': count, 'samples': examples})
    check('no_replacement_or_illegal_control_characters', not unicode_issues, unicode_issues)
    badpaths = 0
    for surface, target_id, payload in c.execute('SELECT surface,target_entry,path_json FROM aliases'):
        path = json.loads(payload)
        target = c.execute('SELECT headword FROM entries WHERE id=?', (target_id,)).fetchone()[0]
        route = [path[0]['from']] + [x['to'] for x in path] if path else []
        if not path or path[0]['from'] != surface or path[-1]['to'] != target or len(route) != len(set(route)) or any(path[i]['to'] != path[i+1]['from'] for i in range(len(path)-1)):
            badpaths += 1
    check('alias_paths_acyclic_contiguous_exact_endpoints', badpaths == 0, badpaths)
    if source_stage is not None:
        c.create_function('lexicue_norm', 1, norm, deterministic=True)
        c.execute('ATTACH DATABASE ? AS source_audit', (str(source_stage),))
        bad_sources = c.execute("SELECT count(*) FROM entries e LEFT JOIN source_audit.pages p ON p.word=e.headword WHERE p.word IS NULL OR e.page_id!=p.page_id OR e.revision!=p.revision OR e.wikitext_sha256!=p.wikitext_sha256").fetchone()[0]
        check('all_entry_revisions_match_pinned_XML', bad_sources == 0, bad_sources)
        bad_examples = c.execute("SELECT count(*) FROM examples x JOIN senses s ON s.id=x.sense_id JOIN entries e ON e.id=s.entry_id LEFT JOIN source_audit.vetted v ON v.word=e.headword AND v.text=lexicue_norm(x.text) WHERE v.word IS NULL OR x.source_revision!=v.revision OR x.source_line!=v.line OR x.template!=v.template").fetchone()[0]
        check('all_examples_match_positive_pinned_XML_template_evidence', bad_examples == 0, bad_examples)
        bad_relations = c.execute("SELECT count(*) FROM relation_records r LEFT JOIN source_audit.pages p ON p.word=r.headword WHERE p.word IS NULL OR r.revision!=p.revision").fetchone()[0]
        check('relation_metadata_revisions_match_pinned_XML', bad_relations == 0, bad_relations)
        bad_relation_examples = c.execute("SELECT count(*) FROM relation_examples x JOIN relation_records r ON r.source_line=x.source_record LEFT JOIN source_audit.vetted v ON v.word=r.headword AND v.text=lexicue_norm(x.text) WHERE v.word IS NULL OR x.source_revision!=v.revision OR x.source_line!=v.line OR x.template!=v.template").fetchone()[0]
        check('relation_examples_match_positive_pinned_XML_template_evidence', bad_relation_examples == 0, bad_relation_examples)
        c.execute('DETACH DATABASE source_audit')
    malformed_examples = c.execute("SELECT count(*) FROM examples WHERE source_revision<=0 OR source_line<=0 OR template NOT IN ('ux','uxi','usex','usex-inline','eg','co') OR length(trim(text))=0").fetchone()[0]
    check('every_example_has_positive_source_evidence', malformed_examples == 0, malformed_examples)
    counts = {table: c.execute(f'SELECT count(*) FROM {table}').fetchone()[0] for table in ['entries', 'senses', 'examples', 'forms', 'pronunciations', 'relation_records', 'relation_examples', 'aliases', 'redirects']}
    counts['exact_case_headwords'] = c.execute('SELECT count(DISTINCT headword) FROM entries').fetchone()[0]
    counts['casefolded_headwords'] = c.execute('SELECT count(DISTINCT folded) FROM entries').fetchone()[0]
    counts['entries_with_examples'] = c.execute('SELECT count(DISTINCT s.entry_id) FROM senses s JOIN examples ex ON ex.sense_id=s.id').fetchone()[0]
    counts['senses_with_examples'] = c.execute('SELECT count(DISTINCT sense_id) FROM examples').fetchone()[0]
    counts['entries_with_pronunciation_text'] = c.execute('SELECT count(DISTINCT entry_id) FROM pronunciations').fetchone()[0]
    counts['senses_with_ancestors'] = c.execute("SELECT count(*) FROM senses WHERE ancestors_json!='[]'").fetchone()[0]
    queries = json.loads(queries_path.read_text())
    queries['expanded_modern'] = ['AI', 'LLM', 'deepfake', 'doomscroll', 'doomscrolling', 'gaslight', 'gaslighting', 'podcast', 'podcasting', 'selfie', 'chatbot', 'blockchain', 'cryptocurrency', 'cryptomining', 'COVID-19', 'coronavirus', 'lockdown', 'livestream', 'livestreaming', 'hashtag', 'crowdfunding', 'crowdfund', 'gig economy', 'social media', 'smartphone', 'app', 'emoji', 'influencer', 'clickbait', 'binge-watch', 'work from home', 'remote work', 'large language model', 'generative AI', 'machine learning', 'neural network', 'algorithm', 'cybersecurity', 'ransomware', 'phishing', 'two-factor authentication', 'contactless', 'unmute', 'mansplain', 'microaggression', 'nonbinary', 'upcycle', 'greenwashing', 'net zero', 'vibe coding']
    queries['expanded_inflections'] = ['was', 'were', 'been', 'has', 'had', 'does', 'did', 'done', 'went', 'gone', 'ran', 'running', 'children', 'mice', 'geese', 'teeth', 'better', 'best', 'worse', 'worst', 'studies', 'studied', 'studying', 'took off', 'taken off', 'looked up', 'gave up', 'giving up', 'putting up with', 'looking forward to']
    queries['case_homographs'] = ['us', 'US', 'it', 'IT', 'may', 'May', 'polish', 'Polish', 'a', 'A', 'apple', 'Apple', 'iPhone']
    scores = {k: coverage(c, qs) for k, qs in queries.items() if isinstance(qs, list)}
    function_results = {}
    for q, expected in queries['function_word_expected_pos'].items():
        es = lookup(c, q)['entries']
        function_results[q] = {'expected_pos': expected, 'matched': any(e['pos'] in expected and e['senses'] for e in es), 'targets': sorted({(e['headword'], e['pos']) for e in es if e['pos'] in expected})}
    scores['function_words'] = {'total': len(function_results), 'intended_pos_hits': sum(x['matched'] for x in function_results.values()), 'details': function_results}
    redirects = {'get along with': 'get along', 'run out of': 'run out', 'a lot of': 'a lot', 'in charge of': 'in charge'}
    for q, target in redirects.items():
        result = lookup(c, q)
        check('frozen_redirect_' + q, any(e['headword'] == target and any(any(step['kind'] == 'mediawiki_redirect' for step in path) for path in e['paths']) for e in result['entries']))
    check('US_country_substantive_target', any(e['headword'] == 'United States' and e['pos'] == 'name' for e in lookup(c, 'US')['entries']))
    check('US_surface_IPA_retained', any(x['pronunciations'] for x in lookup(c, 'US')['surface_records']))
    check('US_dotted_alternative_resolves_country', any(e['headword'] == 'United States' for e in lookup(c, 'U.S.')['entries']))
    check('no_invented_pay_attention_to', not lookup(c, 'pay attention to')['entries'])
    check('baseline_57_words', scores['words']['exact_surface_substantive'] == 57)
    check('function_word_intended_POS', scores['function_words']['intended_pos_hits'] == 20)
    check('baseline_phrases_at_least_39', scores['phrases']['exact_surface_substantive'] >= 39)
    check('US_us_exact_separation', bool(lookup(c, 'us')['entries']) and bool(lookup(c, 'US')['entries']) and all(e['headword'] != 'US' for e in lookup(c, 'us')['entries']) and all(e['headword'] != 'us' for e in lookup(c, 'US')['entries']))
    corpus_results = []
    for corpus in json.loads(corpora_path.read_text()):
        kinds = collections.Counter(); misses = collections.Counter(); unique = collections.Counter()
        for token, n in corpus['tokens'].items():
            result = lookup(c, token)
            if not result['entries']:
                kind = 'miss'; misses[token] += n
            elif result['normalization'] == 'casefold_candidates': kind = 'casefold_candidates'
            elif any(e['match'] == 'exact' for e in result['entries']): kind = 'direct'
            else: kind = 'relation'
            kinds[kind] += n; unique[kind] += 1
        corpus_results.append({k: v for k, v in corpus.items() if k != 'tokens'} | {'token_counts': dict(kinds), 'unique_token_counts': dict(unique), 'top_misses': misses.most_common(80), 'interpretation': 'Surface vocabulary candidate coverage, NOT POS/sense correctness or phrase recognition; inflections and casefold fallback reported separately.'})
    specimen_queries = ['dictionary', 'bank', 'run', 'those', 'US', 'us', 'doomscrolling', 'large language model', 'generative AI', 'get along with', 'run out of', 'a lot of', 'in charge of', 'pay attention to', 'pay attention', 'putting up with', 'looking forward to']
    specimens = {q: lookup(c, q) for q in specimen_queries}
    # All targeted query outcomes are delivered, not only successful examples.
    write_json(output / 'sample-entries.json', specimens)
    report = {'release': VERSION, 'checks': checks, 'all_checks_passed': all(x['passed'] for x in checks.values()), 'counts': counts, 'coverage': scores, 'reading_materials': corpus_results, 'unicode_issues': unicode_issues, 'sense_issue_samples': dict(samples), 'database': hashes(output / 'dictionary.sqlite3'), 'limitations': ['Publisher extraction, not independent full Wiktextract rerun; exact producer commit unavailable.', 'Open lexical selection, not frequency ranked; no total-English coverage claim from directed probes.', 'No phrase pattern inference, pronoun insertion matching or preposition deletion.', 'Some source senses lack examples or pronunciation; positive provenance filtering removes additional examples.', 'Positive ordinary-template evidence does not prove independent authorship or detect all upstream copying.', 'Source order and historical/rare/technical labels retained; no learner sense ranking.', 'Data-only deliverable; application adapter, snapshot validator changes and installed/offline device tests remain future integration work.']}
    write_json(output / 'quality-report.json', report)
    c.close()
    if not report['all_checks_passed']: raise ValueError('Package validation failed; inspect quality-report.json')
    print('VALIDATED', counts, flush=True)
    return report


def verify_zip(archive):
    with zipfile.ZipFile(archive) as z:
        names = z.namelist()
        if len(names) != len(set(names)) or any(Path(n).name != n for n in names): raise ValueError('Unsafe or duplicate ZIP member')
        m = json.loads(z.read('manifest.json'))
        if set(names) != set(m['files']) | {'manifest.json'}: raise ValueError('Manifest member mismatch')
        for name, expected in m['files'].items():
            h, size = hashlib.sha256(), 0
            with z.open(name) as f:
                while chunk := f.read(1024 * 1024): h.update(chunk); size += len(chunk)
            if h.hexdigest() != expected['sha256'] or size != expected['bytes']: raise ValueError(f'Corrupt member {name}')
        if m['schema_version'] != 1 or m['release'] != VERSION or m['provider'] != 'wiktionary': raise ValueError('Unexpected package identity')
    print('ZIP_VERIFIED', archive, hashes(archive), flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['capture-corpora', 'validate', 'verify-zip'])
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--corpora', type=Path, default=FIXTURES / 'corpora.json')
    p.add_argument('--source-audit', type=Path)
    p.add_argument('--queries', type=Path, default=FIXTURES / 'queries.json')
    args = p.parse_args()
    if args.command == 'capture-corpora': capture_corpora(args.output, args.corpora)
    if args.command == 'validate': validate(args.output, args.queries, args.corpora, args.source_audit)
    if args.command == 'verify-zip': verify_zip(args.output)


if __name__ == '__main__': main()
