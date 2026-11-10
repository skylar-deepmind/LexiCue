#!/usr/bin/env python3
"""Pinned, bounded-memory Wiktionary -> LexiCue data-only package (stdlib only)."""
import argparse
import bz2
import collections
import gzip
import hashlib
import html
import json
import os
from pathlib import Path
import platform
import re
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile

HERE = Path(__file__).resolve().parent
VERSION = 'enwiktionary-20261001-lexicue-v1'
ADAPTER = 'wiktionary-local-v1.0.0'
LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/'
MODIFICATIONS = 'English-only selection; omitted proper-name-only records, media, quotations, translations, etymologies and semantic graphs; retained original gloss ancestry, labels, verified ordinary examples and resolved relation paths. See POLICY.md.'
RELATION_TAGS = {'form-of', 'alt-of'}
ABBREVIATION_TAGS = {'abbreviation', 'acronym', 'initialism'}
RELATION_TEXT = re.compile(r'^(?:\([^)]*\)\s*)?(?:(?:alternative|alternate|obsolete|archaic|rare|nonstandard|standard|uncommon|informal|dated|dialectal|eye-dialect|US|UK|American|British|plural|singular|past|present|simple|third-person|comparative|superlative|inflected|feminine|masculine|neuter|diminutive|misspelling|variant|spelling|form|participle|tense|indicative|of|the|an?|and|or|[-,])\s+)*(?:form|spelling|plural|singular|participle|gerund|tense|inflection|clipping|shortening|misspelling|variant|comparative|superlative|contraction|abbreviation|initialism|acronym)\s+of\b', re.I)


BAD_TEXT = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]')

def valid_text(value):
    return isinstance(value, str) and bool(value.strip()) and not BAD_TEXT.search(value)


def js(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n', encoding='utf-8')


def hashes(path):
    h, s = hashlib.sha256(), hashlib.sha1()
    with Path(path).open('rb') as f:
        while b := f.read(4 * 1024 * 1024):
            h.update(b); s.update(b)
    return {'sha256': h.hexdigest(), 'sha1': s.hexdigest(), 'bytes': Path(path).stat().st_size}


def norm(s):
    return unicodedata.normalize('NFC', ' '.join(s.split()))


def fold(s):
    return norm(s).casefold()


def page_url(word):
    return 'https://en.wiktionary.org/wiki/' + urllib.parse.quote(word.replace(' ', '_'), safe='')


def revision_url(revision):
    return 'https://en.wiktionary.org/w/index.php?oldid=' + str(revision)


def resource_guard(root, min_free=10, max_size=20):
    """Per-task input/output budget; fail closed without deleting user files."""
    def check():
        free = shutil.disk_usage(root).free
        total = sum(p.stat().st_size for p in root.rglob('*') if p.is_file())
        if free < min_free * 2**30 or total > max_size * 2**30:
            raise RuntimeError(f'Resource limit: free={free}, task={total}')
    check()
    def monitor():
        while True:
            time.sleep(5)
            try:
                check()
            except Exception as e:
                print(str(e), file=sys.stderr, flush=True)
                os._exit(70)
    threading.Thread(target=monitor, daemon=True).start()


def download(lock, inputs):
    for source in [lock['raw']] + lock['wikimedia']:
        p = inputs / source['name']
        if not p.exists() or p.stat().st_size != source['bytes']:
            print('DOWNLOAD', source['name'], flush=True)
            subprocess.run(['curl', '-fL', '--retry', '3', '--continue-at', '-', source['url'], '-o', str(p)], check=True)
        actual = hashes(p)
        for k in ['bytes', 'sha1', 'sha256']:
            if k in source and actual[k] != source[k]:
                raise ValueError(f'Input mismatch {p.name} {k}: {actual[k]} != {source[k]}')
        if 'sha256' not in source:
            raise ValueError(f'Unpinned SHA-256: {p.name}. Audit source and pin before building.')


def connect(path):
    c = sqlite3.connect(path)
    c.execute('PRAGMA foreign_keys=ON')
    c.execute('PRAGMA journal_mode=DELETE')
    c.execute('PRAGMA synchronous=NORMAL')
    c.execute('PRAGMA cache_size=-32768')
    return c


# Accept only an entire English ordinary-example template on a definition's
# example line. Nested templates/extra arguments/source markers are rejected.
EXAMPLE_TEMPLATE = re.compile(r'^#+:\s*\{\{(ux|uxi|usex|usex-inline|eg|co)\|en\|([^{}\n]*)\}\}\s*$', re.I)
SUSPICIOUS = re.compile(r'https?://|www\.|<ref\b|\b(?:ISBN|OCLC|doi|copyright|quotation|quote-book|quote-web)\b|©|\[\d+\]', re.I)


def plain_example(line):
    m = EXAMPLE_TEMPLATE.fullmatch(line.strip())
    if not m:
        return None
    # A pipe inside [[target|display]] is handled before template args.
    body = re.sub(r'\[\[([^\[\]]+)\]\]', lambda m: m[1].split('|')[-1], m[2])
    if '|' in body or SUSPICIOUS.search(body):
        return None
    body = html.unescape(re.sub("'{2,5}", '', body))
    if any(x in body for x in ['{', '}', '[', ']', '<', '>']) or '\ufffd' in body:
        return None
    text = norm(body)
    if not 2 <= len(text) <= 500:
        return None
    return text, m[1].lower()


SOURCE_RELATION_NAMES = {'alt form', 'alt sp', 'alternative form of', 'alternative spelling of', 'alternate form of', 'alternate spelling of', 'inflection of', 'infl of', 'plural of', 'singular of', 'past of', 'past participle of', 'present participle of', 'comparative of', 'superlative of', 'init of', 'initialism of', 'abbr of', 'abbreviation of', 'acronym of', 'clipping of', 'short for', 'misspelling of', 'contraction of'}


def explicit_relation_targets(line):
    """Positive source-template targets, never stripping words from a query."""
    if not re.match(r'^#+\s', line): return []
    out = []
    for m in re.finditer(r'\{\{([^{}]*)\}\}', line):
        parts = m[1].split('|')
        name = parts[0].strip().lower()
        if len(parts) < 3 or parts[1].strip() != 'en': continue
        targets = []
        if name in SOURCE_RELATION_NAMES:
            targets = [parts[2].strip()]
        elif name == 'place':
            targets = [p.split(':', 1)[1] for p in parts[2:] if p.startswith(('@init of:', '@abbr of:', '@acronym of:'))]
        for target in targets:
            # Only plain, single explicit target titles in v1. Unsupported
            # template grammar stays unresolved; no comma/article guessing.
            if valid_text(target) and not re.search(r'[{}<>\[\]|,=]', target):
                out.append((norm(target), name))
    return out


def target_candidates(sense, target, source_targets):
    literal = norm(target['word'])
    results = [(literal, None)]
    for display, link in sense.get('links', []):
        title, _, fragment = link.partition('#')
        title = norm(title.replace('_', ' '))
        if (not fragment or fragment.startswith('English')) and title in source_targets and title != literal and (literal == norm(display) or literal == 'the ' + title):
            # The template establishes which link is a relation endpoint; a
            # generic gloss/topic link alone is never used as a redirect.
            results.append((title, source_targets[title] | {'extracted_target': literal, 'sense_link': [display, link]}))
    return results


def textual_pronunciations(v):
    return [{'notation': n, 'text': x[n], 'labels': labels(x)} for x in v.get('sounds', []) for n in ['ipa', 'enpr', 'enPR', 'other'] if valid_text(x.get(n))]


def lexical_forms(v):
    return [{'form': norm(x.get('form', '')), 'labels': labels(x)} for x in v.get('forms', []) if valid_text(x.get('form')) and x['form'] != '-' and not set(x.get('tags', [])) & {'canonical', 'table-tags', 'inflection-template'}]


def audit_xml(lock, inputs, stage):
    c = connect(stage)
    c.executescript('''
    CREATE TABLE IF NOT EXISTS pages(word TEXT PRIMARY KEY,page_id INTEGER NOT NULL,revision INTEGER NOT NULL,wikitext_sha256 TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS vetted(word TEXT NOT NULL,text TEXT NOT NULL,revision INTEGER NOT NULL,line INTEGER NOT NULL,template TEXT NOT NULL,PRIMARY KEY(word,text));
    ''')
    c.execute('CREATE TABLE IF NOT EXISTS audited_files(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL)')
    c.execute('CREATE TABLE IF NOT EXISTS source_relations(word TEXT,target TEXT,template TEXT,revision INTEGER,line INTEGER,PRIMARY KEY(word,target))')
    c.execute('CREATE TABLE IF NOT EXISTS relation_audited_files(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL)')
    n = 0
    for source in lock['wikimedia']:
        if '.xml-' not in source['name']:
            continue
        actual = hashes(inputs / source['name'])
        for key in ['bytes', 'sha1', 'sha256']:
            if key in source and actual[key] != source[key]: raise ValueError(f'XML input mismatch: {source["name"]}')
        if c.execute('SELECT 1 FROM relation_audited_files WHERE name=? AND sha256=?', (source['name'], actual['sha256'])).fetchone(): continue
        print('AUDIT_XML', source['name'], flush=True)
        with bz2.open(inputs / source['name'], 'rb') as f:
            context = ET.iterparse(f, events=('start', 'end'))
            _, root = next(context)
            for event, elem in context:
                if event != 'end' or elem.tag.rsplit('}', 1)[-1] != 'page':
                    continue
                ns = {'m': elem.tag.split('}')[0][1:]}
                if elem.findtext('m:ns', namespaces=ns) == '0':
                    word = elem.findtext('m:title', namespaces=ns)
                    rev = elem.find('m:revision', ns)
                    text = rev.findtext('m:text', default='', namespaces=ns) or ''
                    # Language section boundaries only; no foreign examples.
                    match = re.search(r'^==\s*English\s*==\s*$', text, re.M)
                    if match:
                        end = re.search(r'^==[^=\n][^\n]*?==\s*$', text[match.end():], re.M)
                        body = text[match.end():match.end() + end.start()] if end else text[match.end():]
                        rid = int(rev.findtext('m:id', namespaces=ns))
                        c.execute('INSERT OR REPLACE INTO pages VALUES(?,?,?,?)', (norm(word), int(elem.findtext('m:id', namespaces=ns)), rid, hashlib.sha256(text.encode()).hexdigest()))
                        start_line = text[:match.end()].count('\n') + 1
                        for offset, line in enumerate(body.splitlines()):
                            for target, template in explicit_relation_targets(line):
                                c.execute('INSERT OR IGNORE INTO source_relations VALUES(?,?,?,?,?)', (norm(word), target, template, rid, start_line + offset))
                            accepted = plain_example(line)
                            if accepted:
                                ex, template = accepted
                                c.execute('INSERT OR IGNORE INTO vetted VALUES(?,?,?,?,?)', (norm(word), ex, rid, start_line + offset, template))
                        n += 1
                        if n % 100000 == 0:
                            c.commit(); print('AUDITED_ENGLISH', n, flush=True)
                root.clear()
        c.execute('INSERT OR REPLACE INTO relation_audited_files VALUES(?,?)', (source['name'], actual['sha256']))
        c.execute('INSERT OR REPLACE INTO audited_files VALUES(?,?)', (source['name'], actual['sha256']))
        c.commit()
    print('AUDIT_COMPLETE', n, c.execute('SELECT count(*) FROM vetted').fetchone()[0], flush=True)
    c.close()


def mysql_unescape(text):
    escapes = {'0': '\0', 'n': '\n', 'r': '\r', 't': '\t', 'Z': '\x1a'}
    return re.sub(r'\\(.)', lambda m: escapes.get(m[1], m[1]), text)


def sql_heads(path):
    pattern = re.compile(r"(?:^|VALUES |,)\((\d+),(\d+),'((?:[^'\\]|\\.)*)'")
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        for line in f:
            if line.startswith('INSERT INTO') or line.startswith('('):
                for m in pattern.finditer(line):
                    yield int(m[1]), int(m[2]), norm(mysql_unescape(m[3]).replace('_', ' '))


def mediawiki_redirects(lock, inputs):
    # Read all redirect fields: interwiki and non-English fragment redirects
    # must never become local English matches.
    pattern = re.compile(r"(?:^|VALUES |,)\((\d+),(\d+),'((?:[^'\\]|\\.)*)','((?:[^'\\]|\\.)*)','((?:[^'\\]|\\.)*)'\)")
    redirects = {}
    with gzip.open(inputs / 'enwiktionary-20261001-redirect.sql.gz', 'rt', encoding='utf-8') as f:
        for line in f:
            if line.startswith('INSERT INTO') or line.startswith('('):
                for m in pattern.finditer(line):
                    ident, ns, target, interwiki, fragment = m.groups()
                    if ns == '0' and not interwiki and (not fragment or fragment.startswith('English')):
                        redirects[int(ident)] = (norm(mysql_unescape(target).replace('_', ' ')), mysql_unescape(fragment))
    result = []
    for ident, ns, source in sql_heads(inputs / 'enwiktionary-20261001-page.sql.gz'):
        if ns == 0 and ident in redirects:
            result.append((source, *redirects[ident]))
    return sorted(result)


def relation(s):
    return bool(s.get('form_of') or s.get('alt_of') or set(s.get('tags', [])) & RELATION_TAGS or (s.get('glosses') and RELATION_TEXT.search(s['glosses'][-1])))


def labels(s):
    return {k: s[k] for k in ['tags', 'raw_tags', 'topics', 'qualifier', 'english'] if s.get(k)}


def eligible(v):
    word, pos = v['word'], v.get('pos', '')
    # Keep every non-name English lexical record: no closed historical word list.
    # Names are retained only when abbreviation-like, preserving US/us etc.
    return pos != 'name' or (word.isupper() and len(word) <= 10) or any(set(s.get('tags', [])) & ABBREVIATION_TAGS for s in v.get('senses', []))


SCHEMA = '''
PRAGMA application_id=1280857155;
PRAGMA user_version=1;
CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE entries(id INTEGER PRIMARY KEY,headword TEXT NOT NULL,folded TEXT NOT NULL,pos TEXT NOT NULL,etymology_number TEXT,source_line INTEGER NOT NULL UNIQUE,page_id INTEGER NOT NULL,revision INTEGER NOT NULL,source_url TEXT NOT NULL,wikitext_sha256 TEXT NOT NULL,labels_json TEXT NOT NULL);
CREATE INDEX entries_exact ON entries(headword);
CREATE INDEX entries_folded ON entries(folded);
CREATE TABLE senses(id TEXT PRIMARY KEY,entry_id INTEGER NOT NULL REFERENCES entries(id),ordinal INTEGER NOT NULL,definition TEXT NOT NULL CHECK(length(trim(definition))>0),ancestors_json TEXT NOT NULL,gloss_path_json TEXT NOT NULL,raw_gloss_path_json TEXT NOT NULL,labels_json TEXT NOT NULL,source_senseids_json TEXT NOT NULL,source_path TEXT NOT NULL,UNIQUE(entry_id,ordinal));
CREATE INDEX senses_entry ON senses(entry_id);
CREATE TABLE examples(id TEXT PRIMARY KEY,sense_id TEXT NOT NULL REFERENCES senses(id),text TEXT NOT NULL,source_revision INTEGER NOT NULL,source_line INTEGER NOT NULL,template TEXT NOT NULL,labels_json TEXT NOT NULL);
CREATE INDEX examples_sense ON examples(sense_id);
CREATE TABLE pronunciations(entry_id INTEGER NOT NULL REFERENCES entries(id),ordinal INTEGER NOT NULL,notation TEXT NOT NULL,text TEXT NOT NULL,labels_json TEXT NOT NULL,PRIMARY KEY(entry_id,ordinal));
CREATE TABLE relation_records(source_line INTEGER PRIMARY KEY,headword TEXT NOT NULL,pos TEXT NOT NULL,revision INTEGER NOT NULL,source_url TEXT NOT NULL,pronunciations_json TEXT NOT NULL,forms_json TEXT NOT NULL,labels_json TEXT NOT NULL);
CREATE INDEX relation_records_headword ON relation_records(headword);
CREATE TABLE relation_examples(id TEXT PRIMARY KEY,source_record INTEGER NOT NULL REFERENCES relation_records(source_line),sense_ordinal INTEGER NOT NULL,text TEXT NOT NULL,source_revision INTEGER NOT NULL,source_line INTEGER NOT NULL,template TEXT NOT NULL,labels_json TEXT NOT NULL);
CREATE INDEX relation_examples_record ON relation_examples(source_record);
CREATE TABLE forms(entry_id INTEGER NOT NULL REFERENCES entries(id),ordinal INTEGER NOT NULL,form TEXT NOT NULL,labels_json TEXT NOT NULL,PRIMARY KEY(entry_id,ordinal));
CREATE TABLE aliases(surface TEXT NOT NULL,folded TEXT NOT NULL,target_entry INTEGER NOT NULL REFERENCES entries(id),kind TEXT NOT NULL,path_json TEXT NOT NULL,PRIMARY KEY(surface,target_entry,kind));
CREATE INDEX aliases_folded ON aliases(folded);
CREATE TABLE redirects(surface TEXT PRIMARY KEY,target TEXT NOT NULL,fragment TEXT NOT NULL,source_url TEXT NOT NULL);
'''


def admitted_example(ex, word, audit, stats):
    stats['example_candidates'] += 1
    if ex.get('type') != 'example' or not valid_text(ex.get('text')):
        stats['excluded_not_ordinary'] += 1; return None
    allowed = {'type', 'text', 'bold_text_offsets', 'tags'}
    if any(value and key not in allowed for key, value in ex.items()) or SUSPICIOUS.search(ex['text']):
        stats['excluded_example_metadata'] += 1; return None
    evidence = audit.execute('SELECT revision,line,template FROM vetted WHERE word=? AND text=?', (word, norm(ex['text']))).fetchone()
    if not evidence:
        stats['excluded_no_positive_template_match'] += 1; return None
    return evidence


def build(lock, inputs, stage, dbpath, auditpath):
    audit = connect(stage)
    for source in lock['wikimedia']:
        if '.xml-' in source['name'] and not audit.execute('SELECT 1 FROM audited_files WHERE name=? AND sha256=?', (source['name'], source['sha256'])).fetchone():
            raise ValueError(f'Incomplete XML source audit: {source["name"]}')
    c = connect(dbpath)
    c.executescript(SCHEMA)
    stats = collections.Counter()
    # Temporary graph and quotations live in disk-backed staging, not RAM.
    audit.executescript('''DROP TABLE IF EXISTS edges; DROP TABLE IF EXISTS quotation_hashes; CREATE TABLE edges(surface TEXT,target TEXT,pos TEXT,kind TEXT,evidence TEXT,PRIMARY KEY(surface,target,pos,kind));
    CREATE INDEX edges_surface ON edges(surface);
    CREATE TABLE quotation_hashes(hash TEXT PRIMARY KEY);''')
    for word, target, fragment in mediawiki_redirects(lock, inputs):
        c.execute('INSERT OR IGNORE INTO redirects VALUES(?,?,?,?)', (word, target, fragment, page_url(word)))
        audit.execute('INSERT OR IGNORE INTO edges VALUES(?,?,?,?,?)', (word, target, '', 'mediawiki_redirect', js({'source_url': page_url(word), 'dump': lock['dump_date'], 'fragment': fragment})))
        stats['mediawiki_redirects'] += 1
    print('REDIRECTS', stats['mediawiki_redirects'], flush=True)
    referenced = set()
    name_relations = collections.defaultdict(set)
    with gzip.open(inputs / lock['raw']['name'], 'rb') as raw:
        for line in raw:
            if b'"lang_code": "en"' not in line and b'"lang_code":"en"' not in line: continue
            v = json.loads(line)
            if v.get('lang_code') != 'en' or not valid_text(v.get('word')): continue
            source_targets = None
            endpoints = set()
            for sense in v.get('senses', []):
                for target in sense.get('form_of', []) + sense.get('alt_of', []):
                    if valid_text(target.get('word')):
                        if source_targets is None:
                            source_targets = {r[0]: {'source_template': r[1], 'revision': r[2], 'wikitext_line': r[3]} for r in audit.execute('SELECT target,template,revision,line FROM source_relations WHERE word=?', (norm(v['word']),))}
                        endpoints.update(r[0] for r in target_candidates(sense, target, source_targets))
            if eligible(v): referenced.update(endpoints)
            elif v.get('pos') == 'name': name_relations[norm(v['word'])].update(endpoints)
    # Transitive closure preserves names reached through another name alias.
    pending = list(referenced)
    while pending:
        source = pending.pop()
        for target in name_relations.get(source, set()):
            if target not in referenced:
                referenced.add(target); pending.append(target)
    print('RELATION_TARGET_HEADWORDS', len(referenced), flush=True)
    seq = 0
    with gzip.open(inputs / lock['raw']['name'], 'rb') as f:
        for lineno, line in enumerate(f, 1):
            # Raw extraction uses this spelling. JSON recheck prevents foreign data.
            if b'"lang_code": "en"' not in line and b'"lang_code":"en"' not in line:
                continue
            v = json.loads(line)
            if v.get('lang_code') != 'en' or not v.get('word'):
                continue
            stats['english_records'] += 1
            if not valid_text(v['word']):
                stats['corrupt_headword_records_omitted'] += 1; continue
            word, pos = norm(v['word']), v.get('pos', '')
            for s in v.get('senses', []):
                for ex in s.get('examples', []):
                    if ex.get('type') == 'quotation' and ex.get('text'):
                        audit.execute('INSERT OR IGNORE INTO quotation_hashes VALUES(?)', (hashlib.sha256(norm(ex['text']).encode()).hexdigest(),))
            if not eligible(v) and word not in referenced:
                stats['excluded_name_records'] += 1
                continue
            source_targets = {r[0]: {'source_template': r[1], 'revision': r[2], 'wikitext_line': r[3]} for r in audit.execute('SELECT target,template,revision,line FROM source_relations WHERE word=?', (word,))}
            ss = []
            has_relations = False
            for ordinal, s in enumerate(v.get('senses', [])):
                if relation(s):
                    has_relations = True
                    stats['relation_senses'] += 1
                    targets = s.get('form_of', []) + s.get('alt_of', [])
                    for target in targets:
                        if valid_text(target.get('word')):
                            kind = 'form_of' if target in s.get('form_of', []) else 'alt_of'
                            for actual_target, correction in target_candidates(s, target, source_targets):
                                evidence = {'source_line': lineno, 'sense_ordinal': ordinal, 'labels': labels(s), 'target_extra': target.get('extra')}
                                if correction:
                                    evidence['source_target_confirmation'] = correction
                                    stats['source_confirmed_target_edges'] += 1
                                audit.execute('INSERT OR IGNORE INTO edges VALUES(?,?,?,?,?)', (word, actual_target, pos, kind, js(evidence)))
                    if not targets:
                        stats['relation_without_machine_target'] += 1
                    continue
                glosses = s.get('glosses', [])
                if glosses and all(valid_text(g) for g in glosses + s.get('raw_glosses', [])) and glosses[-1].strip() not in ['-', '...', '?'] and 'no-gloss' not in s.get('tags', []):
                    ss.append((ordinal, s))
                else:
                    stats['empty_or_corrupt_senses_omitted'] += 1
            # Source forms on relation-only pages remain executable edges.
            for form in lexical_forms(v):
                if form['form'] != word:
                    audit.execute('INSERT OR IGNORE INTO edges VALUES(?,?,?,?,?)', (form['form'], word, pos, 'headword_form', js({'source_line': lineno, 'labels': form['labels']})))
            if has_relations:
                pron, forms = textual_pronunciations(v), lexical_forms(v)
                page = audit.execute('SELECT revision FROM pages WHERE word=?', (word,)).fetchone()
                accepted = []
                for ordinal, sense in enumerate(v.get('senses', [])):
                    if not relation(sense): continue
                    for eno, ex in enumerate(sense.get('examples', [])):
                        evidence = admitted_example(ex, word, audit, stats)
                        if evidence: accepted.append((ordinal, eno, ex, evidence))
                if page and (pron or forms or accepted):
                    c.execute('INSERT INTO relation_records VALUES(?,?,?,?,?,?,?,?)', (lineno, word, pos, page[0], page_url(word), js(pron), js(forms), js(labels(v))))
                    for ordinal, eno, ex, evidence in accepted:
                        xid = f'wiktionary:{VERSION}:r{lineno}:s{ordinal}:e{eno}'
                        c.execute('INSERT INTO relation_examples VALUES(?,?,?,?,?,?,?,?)', (xid, lineno, ordinal, ex['text'], *evidence, js(labels(ex))))
            if not ss:
                continue
            page = audit.execute('SELECT page_id,revision,wikitext_sha256 FROM pages WHERE word=?', (word,)).fetchone()
            if not page:
                stats['missing_source_page_records'] += 1
                continue
            seq += 1
            c.execute('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?)', (seq, word, fold(word), pos, str(v.get('etymology_number', '')), lineno, page[0], page[1], page_url(word), page[2], js(labels(v))))
            for ordinal, s in ss:
                glosses = s['glosses']
                sid = f'wiktionary:{VERSION}:r{lineno}:s{ordinal}'
                raw = s.get('raw_glosses', glosses)
                ancestors = [{'definition': g, 'raw_gloss': raw[i] if i < len(raw) else g, 'depth': i + 1} for i, g in enumerate(glosses[:-1])]
                c.execute('INSERT INTO senses VALUES(?,?,?,?,?,?,?,?,?,?)', (sid, seq, ordinal, glosses[-1], js(ancestors), js(glosses), js(raw), js(labels(s)), js(s.get('senseid', [])), f'/records/{lineno}/senses/{ordinal}'))
                stats['substantive_senses'] += 1
                if ancestors:
                    stats['senses_with_ancestors'] += 1
                for eno, ex in enumerate(s.get('examples', [])):
                    vetted = admitted_example(ex, word, audit, stats)
                    if not vetted: continue
                    c.execute('INSERT INTO examples VALUES(?,?,?,?,?,?,?)', (sid + f':e{eno}', sid, ex['text'], *vetted, js(labels(ex))))
            for fno, form in enumerate(v.get('forms', [])):
                surface = norm(form.get('form', ''))
                if not valid_text(surface) or surface == '-' or any(t in form.get('tags', []) for t in ['table-tags', 'inflection-template', 'canonical']):
                    continue
                c.execute('INSERT INTO forms VALUES(?,?,?,?)', (seq, fno, surface, js(labels(form))))
            pno = 0
            for sound in v.get('sounds', []):
                for notation in ['ipa', 'enpr', 'enPR', 'other']:
                    if valid_text(sound.get(notation)):
                        c.execute('INSERT INTO pronunciations VALUES(?,?,?,?,?)', (seq, pno, notation, sound[notation], js(labels(sound))))
                        pno += 1
            if seq % 50000 == 0:
                c.commit(); audit.commit(); print('BUILT', seq, 'raw_line', lineno, flush=True)
    c.commit(); audit.commit()
    # Cross-record negative evidence: omit an ordinary candidate if identical
    # text is marked as a quotation anywhere in the raw English extraction.
    for table in ['examples', 'relation_examples']:
        removed = []
        for eid, text in c.execute(f'SELECT id,text FROM {table}'):
            if audit.execute('SELECT 1 FROM quotation_hashes WHERE hash=?', (hashlib.sha256(norm(text).encode()).hexdigest(),)).fetchone():
                removed.append((eid,))
        c.executemany(f'DELETE FROM {table} WHERE id=?', removed)
        stats['excluded_cross_record_quotation_text'] += len(removed)
    problems = resolve_aliases(c, audit, stats)
    for k, value in {'provider': 'wiktionary', 'dataset': 'English Wiktionary', 'release': VERSION, 'adapter_version': ADAPTER, 'language': 'en', 'license': LICENSE_URL, 'modifications': MODIFICATIONS}.items():
        c.execute('INSERT INTO metadata VALUES(?,?)', (k, value))
    c.commit()
    if c.execute('PRAGMA foreign_key_check').fetchall() or c.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise ValueError('SQLite integrity failed')
    c.execute('VACUUM'); c.close(); audit.close()
    write_json(auditpath, {'counts': dict(stats), 'alias_problems': problems})


def resolve_aliases(c, audit, stats):
    problems = collections.Counter()
    samples = collections.defaultdict(list)
    # One source at a time: preserve paths; every final alias points directly to
    # an entry with substantive senses. No lowercasing or preposition guessing.
    def walk(word, pos, seen, path):
        if word in seen:
            problems['cycles'] += 1
            if len(samples['cycles']) < 30: samples['cycles'].append(path)
            return []
        if len(path) > 16:
            problems['depth_limit'] += 1; return []
        direct = c.execute('SELECT id FROM entries WHERE headword=? AND (?="" OR pos=?)', (word, pos, pos)).fetchall()
        if direct:
            return [(r[0], path) for r in direct]
        out = []
        for target, nextpos, kind, evidence in audit.execute('SELECT target,pos,kind,evidence FROM edges WHERE surface=? ORDER BY target,pos,kind', (word,)):
            if pos and nextpos and pos != nextpos: continue
            edge = {'from': word, 'to': target, 'pos': nextpos, 'kind': kind, 'evidence': json.loads(evidence)}
            out.extend(walk(target, pos or nextpos, seen | {word}, path + [edge]))
        return out
    print('RESOLVING_ALIASES', flush=True)
    for i, (source,) in enumerate(audit.execute('SELECT DISTINCT surface FROM edges ORDER BY surface'), 1):
        for target, pos, kind, evidence in audit.execute('SELECT target,pos,kind,evidence FROM edges WHERE surface=? ORDER BY target,pos,kind', (source,)):
            edge = {'from': source, 'to': target, 'pos': pos, 'kind': kind, 'evidence': json.loads(evidence)}
            found = walk(target, pos, {source}, [edge])
            if not found:
                problems['unresolved_edges'] += 1
                if len(samples['unresolved_edges']) < 60: samples['unresolved_edges'].append(edge)
            for entry, path in found:
                c.execute('INSERT OR IGNORE INTO aliases VALUES(?,?,?,?,?)', (source, fold(source), entry, kind, js(path)))
        if i % 100000 == 0:
            c.commit(); print('ALIASES_SOURCES', i, flush=True)
    c.commit()
    stats['graph_edges'] = audit.execute('SELECT count(*) FROM edges').fetchone()[0]
    return {'counts': dict(problems), 'samples': dict(samples), 'policy': 'Cycles/unresolved graph edges omitted from executable aliases; raw MediaWiki index retained separately for audit.'}


def lookup(c, query):
    exact = norm(query)
    entries = c.execute('SELECT id FROM entries WHERE headword=? ORDER BY id', (exact,)).fetchall()
    aliases = c.execute('SELECT target_entry,kind,path_json FROM aliases WHERE surface=? ORDER BY target_entry,kind', (exact,)).fetchall()
    match = 'exact'
    if not entries and not aliases:
        entries = c.execute('SELECT id FROM entries WHERE folded=? ORDER BY headword,id', (fold(query),)).fetchall()
        aliases = c.execute('SELECT target_entry,kind,path_json FROM aliases WHERE folded=? ORDER BY surface,target_entry,kind', (fold(query),)).fetchall()
        match = 'casefold_candidates'
    direct_ids = {r[0] for r in entries}
    ids = sorted(direct_ids | {r[0] for r in aliases})
    result = []
    for eid in ids:
        e = c.execute('SELECT headword,pos,source_line,revision,source_url FROM entries WHERE id=?', (eid,)).fetchone()
        senses = []
        for sid, definition, ancestors, labels_json in c.execute('SELECT id,definition,ancestors_json,labels_json FROM senses WHERE entry_id=? ORDER BY ordinal', (eid,)):
            examples = [dict(id=x[0], text=x[1], source_revision=x[2], source_line=x[3], template=x[4]) for x in c.execute('SELECT id,text,source_revision,source_line,template FROM examples WHERE sense_id=? ORDER BY id', (sid,))]
            senses.append({'id': sid, 'definition': definition, 'ancestors': json.loads(ancestors), 'labels': json.loads(labels_json), 'examples': examples})
        result.append({'entry_id': eid, 'headword': e[0], 'pos': e[1], 'source_line': e[2], 'revision': e[3], 'source_url': e[4], 'match': match if eid in direct_ids else 'relation', 'paths': [json.loads(r[2]) for r in aliases if r[0] == eid], 'senses': senses})
    surface_records = [{'headword': r[0], 'pos': r[1], 'source_line': r[2], 'revision': r[3], 'source_url': r[4], 'pronunciations': json.loads(r[5]), 'forms': json.loads(r[6])} for r in c.execute('SELECT headword,pos,source_line,revision,source_url,pronunciations_json,forms_json FROM relation_records WHERE headword=? ORDER BY source_line', (exact,))]
    for record in surface_records:
        record['examples'] = [{'id': r[0], 'sense_ordinal': r[1], 'text': r[2], 'source_revision': r[3], 'source_line': r[4], 'template': r[5]} for r in c.execute('SELECT id,sense_ordinal,text,source_revision,source_line,template FROM relation_examples WHERE source_record=? ORDER BY id', (record['source_line'],))]
    return {'requested_form': query, 'normalization': match, 'surface_records': surface_records, 'entries': result}


def prepare_distribution(output):
    repo = HERE.parents[1]
    docs = repo / 'docs/dictionary' if (repo / 'docs/dictionary/POLICY.md').exists() else HERE
    fixtures = repo / 'tests/dictionary' if (repo / 'tests/dictionary/queries.json').exists() else HERE
    for name in ['README.md', 'POLICY.md', 'CONTRACT.md', 'NOTICE.txt', 'CHANGELOG.md', 'CC-BY-SA-4.0.txt']:
        shutil.copyfile(docs / name, output / name)
    for name in ['build_pack.py', 'validate_pack.py', 'sources.lock.json']:
        shutil.copyfile(HERE / name, output / name)
    for name in ['queries.json', 'corpora.json']:
        shutil.copyfile(fixtures / name, output / name)
    (output / 'schema.sql').write_text(SCHEMA.strip() + '\n', encoding='utf-8')


def pack(lock, output):
    report = json.loads((output / 'quality-report.json').read_text())
    if not report['all_checks_passed'] or report['database']['sha256'] != hashes(output / 'dictionary.sqlite3')['sha256']:
        raise ValueError('Missing, failing, or stale quality report')
    prepare_distribution(output)
    manifest = {'schema_version': 1, 'package_id': 'lexicue.wiktionary.en', 'release': VERSION, 'provider': 'wiktionary', 'dataset': 'English Wiktionary', 'language': 'en', 'definition_languages': ['en'], 'license': {'spdx': 'CC-BY-SA-4.0', 'url': LICENSE_URL}, 'attribution': 'English Wiktionary contributors; extracted by Tatu Ylonen and Wiktextract via kaikki.org; selection and conversion by LexiCue contributors.', 'modifications': MODIFICATIONS, 'source_dump_date': lock['dump_date'], 'source_inputs': lock, 'adapter_version': ADAPTER, 'application_integration': 'data-only; requires dedicated adapter and snapshot-validator support', 'files': {}}
    for p in sorted(output.iterdir()):
        if p.is_file() and p.name != 'manifest.json':
            manifest['files'][p.name] = hashes(p)
    write_json(output / 'manifest.json', manifest)
    dest = output.parent / (VERSION + '.zip')
    with zipfile.ZipFile(dest, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in sorted(output.iterdir()):
            if p.is_file():
                info = zipfile.ZipInfo(p.name, (2026, 10, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                with z.open(info, 'w', force_zip64=True) as dst, p.open('rb') as src:
                    shutil.copyfileobj(src, dst, 1024 * 1024)
    write_json(dest.with_suffix('.checksums.json'), hashes(dest))
    print('PACKAGE', dest, hashes(dest), flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['all', 'download', 'audit', 'build', 'pack', 'lookup'])
    p.add_argument('--inputs', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--query')
    args = p.parse_args()
    args.inputs.mkdir(parents=True, exist_ok=True); args.output.mkdir(parents=True, exist_ok=True)
    lock = json.loads((HERE / 'sources.lock.json').read_text())
    resource_guard(args.inputs.parent)
    stage = args.inputs.parent / 'source-audit.sqlite3'
    db = args.output / 'dictionary.sqlite3'
    if args.command in ['all', 'download']: download(lock, args.inputs)
    if args.command in ['all', 'audit']:
        download(lock, args.inputs)
        audit_xml(lock, args.inputs, stage)
    if args.command in ['all', 'build']:
        download(lock, args.inputs)
        if db.exists(): raise ValueError('Refusing to overwrite output database')
        build(lock, args.inputs, stage, db, args.output / 'build-audit.json')
        write_json(args.output / 'build-info.json', {'python': platform.python_version(), 'sqlite': sqlite3.sqlite_version, 'platform': platform.platform(), 'builder_sha256': hashes(__file__)['sha256'], 'input_lock_sha256': hashes(HERE / 'sources.lock.json')['sha256'], 'reproducibility': 'Pinned bytes, deterministic order and ZIP timestamps; byte-identical rebuild requires recorded Python/SQLite/zlib toolchain.', 'zlib': __import__('zlib').ZLIB_RUNTIME_VERSION})
    if args.command == 'all':
        from validate_pack import validate
        repo = HERE.parents[1]
        fixtures = repo / 'tests/dictionary' if (repo / 'tests/dictionary/queries.json').exists() else HERE
        validate(args.output, fixtures / 'queries.json', fixtures / 'corpora.json', stage)
    if args.command in ['all', 'pack']: pack(lock, args.output)
    if args.command == 'lookup':
        c = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
        print(json.dumps(lookup(c, args.query), ensure_ascii=False, indent=2)); c.close()


if __name__ == '__main__':
    main()
