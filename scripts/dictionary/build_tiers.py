#!/usr/bin/env python3
"""Create compact, independently queryable daily/extended/specialist packs.

Consumes the SHA-pinned, source-verified audit SQLite. All linguistic text stays
Wiktionary. Frequency statistics and an explicit review list select sense tiers.
"""
import argparse
import collections
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
import sqlite3
import sys
import zlib
import zipfile

from build_pack import HERE, fold, hashes, js, page_url, resource_guard, write_json

RELEASE = 'enwiktionary-20261001-lexicue-v2'
ADAPTER = 'wiktionary-local-v2.0.0'
PACK_IDS = ['daily', 'extended', 'specialist']
KINDS = {'form_of': 1, 'alt_of': 2, 'headword_form': 3, 'mediawiki_redirect': 4}
MAX_BODY = 8 * 1024 * 1024
PARTICLES = {'up','off','out','in','on','over','away','down','along','back','through','into','with','to','about','around','for','after','forward','aside','apart'}
TOKEN = re.compile(r"[a-z]+(?:['’][a-z]+)?")

SCHEMA = '''
PRAGMA application_id=1280857155;
PRAGMA user_version=2;
CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE surfaces(id INTEGER PRIMARY KEY,word TEXT NOT NULL UNIQUE,folded TEXT NOT NULL);
CREATE INDEX surfaces_folded ON surfaces(folded);
CREATE TABLE pages(surface_id INTEGER PRIMARY KEY REFERENCES surfaces(id),page_id INTEGER NOT NULL,revision INTEGER NOT NULL,wikitext_sha256 BLOB NOT NULL CHECK(length(wikitext_sha256)=32));
CREATE TABLE entries(source_line INTEGER PRIMARY KEY,surface_id INTEGER NOT NULL REFERENCES surfaces(id),pos TEXT NOT NULL,etymology_number TEXT NOT NULL,body BLOB NOT NULL);
CREATE INDEX entries_surface ON entries(surface_id);
CREATE TABLE labels(id INTEGER PRIMARY KEY,body TEXT NOT NULL UNIQUE);
CREATE TABLE confirmations(id INTEGER PRIMARY KEY,body TEXT NOT NULL UNIQUE);
CREATE TABLE origins(id INTEGER PRIMARY KEY,source_line INTEGER NOT NULL,ordinal INTEGER NOT NULL,labels_id INTEGER NOT NULL REFERENCES labels(id),confirmation_id INTEGER NOT NULL REFERENCES confirmations(id),UNIQUE(source_line,ordinal,labels_id,confirmation_id));
CREATE TABLE aliases(surface_id INTEGER NOT NULL REFERENCES surfaces(id),entry_line INTEGER NOT NULL REFERENCES entries(source_line),kind INTEGER NOT NULL CHECK(kind BETWEEN 1 AND 4),origin_id INTEGER NOT NULL REFERENCES origins(id),PRIMARY KEY(surface_id,entry_line,kind)) WITHOUT ROWID;
CREATE TABLE surface_records(source_line INTEGER PRIMARY KEY,surface_id INTEGER NOT NULL REFERENCES surfaces(id),pos TEXT NOT NULL,revision INTEGER NOT NULL,body BLOB NOT NULL);
CREATE INDEX surface_records_surface ON surface_records(surface_id);
'''


def encode(value):
    raw = js(value).encode()
    if len(raw) > MAX_BODY: raise ValueError('Runtime record exceeds body limit')
    return zlib.compress(raw, 9)


def decode(blob):
    dec = zlib.decompressobj()
    raw = dec.decompress(blob, MAX_BODY + 1)
    if len(raw) > MAX_BODY or not dec.eof or dec.unused_data or dec.unconsumed_tail:
        raise ValueError('Invalid or oversized runtime body')
    return json.loads(raw)


class Selection:
    def __init__(self, policy, frequencies, attestations=None):
        self.attestations = attestations or {}
        self.policy = policy
        self.freq = frequencies
        self.familiar = {fold(w) for words in policy['familiarity_supplements'].values() for w in words}
        self.function = set(policy['function_pos'])
        self.historical = set(policy['historical_tags'])
        self.narrow = set(policy['narrow_topics'])
        self.technical = set(policy['technical_topics']) | self.narrow
        self.cache = {}

    def head(self, word, pos):
        key = (word, pos)
        if key in self.cache: return self.cache[key]
        w = fold(word)
        score = self.freq.get(w, 0)
        reason = None
        if w in self.familiar: reason = 'familiarity_supplement'
        elif pos in self.function: reason = 'functional_POS'
        elif score >= self.policy['daily_token_zipf_hundredths']: reason = 'observed_token_frequency'
        else:
            tokens = TOKEN.findall(w)
            evidence=self.attestations.get(w,[0,0,0,0]);limits=self.policy.get('phrase_attestation',{})
            established=evidence[0]>=limits.get('minimum_recent_references',2) and evidence[1]>=limits.get('minimum_recent_years',2) and evidence[2]>=limits.get('minimum_latest_year',2000)
            if 2 <= len(tokens) <= 5 and established and all(self.freq.get(t, 0) >= self.policy['compound_component_zipf_hundredths'] for t in tokens):
                reason = 'familiar_components_and_recent_attestations'
            elif pos == 'verb' and 2 <= len(tokens) <= 5 and any(t in PARTICLES for t in tokens) and all(self.freq.get(t, 0) >= self.policy['phrasal_verb_component_zipf_hundredths'] for t in tokens):
                reason = 'phrasal_verb_components'
        result = (bool(reason), reason or 'outside_daily_selection', score)
        self.cache[key] = result
        return result

    def sense(self, word, pos, labels, promoted=False, definition="", familiar_alias=False):
        daily, reason, score = self.head(word, pos)
        tags = set(labels.get('tags', []))
        topics = set(labels.get('topics', []))
        if not re.search(r'[A-Za-z0-9]',word) or 'braille' in js(labels).lower():
            return 'specialist', 'notation_or_Braille', score
        if tags & self.historical:
            return 'extended', 'historical_or_rare_sense', score
        # General familiarity explicitly keeps e.g. pneumonia and quark even
        # when upstream labels their ordinary definition with a field of study.
        if topics & self.narrow and fold(word) not in self.familiar and not familiar_alias:
            return 'specialist', 'narrow_specialist_sense', score
        if daily or promoted or familiar_alias:
            return 'daily', reason if daily else ('explicit_familiarity_alias_target' if familiar_alias else 'frequent_explicit_form_or_alias'), score
        if topics & self.technical:
            return 'specialist', 'less_frequent_domain_term', score
        if any(clue in definition.lower() for clue in self.policy.get('technical_definition_clues',[])) or (len(word)>8 and ' ' not in word and word.lower().endswith(('ology','aceae','idae','ase'))):
            return 'specialist', 'specialist_definition_or_morphology', score
        return 'extended', 'less_frequent_general_or_literary', score


class Runtime:
    def __init__(self, path):
        self.c = sqlite3.connect(path)
        self.c.execute('PRAGMA foreign_keys=ON')
        self.c.execute('PRAGMA synchronous=NORMAL')
        self.c.execute('PRAGMA cache_size=-32768')
        self.c.executescript(SCHEMA)
        self.words = {}
        self.label_ids = {}
        self.confirmation_ids = {}
        self.origin_ids = {}
        self.stats = collections.Counter()

    def surface(self, word):
        ident = self.words.get(word)
        if ident is None:
            ident = len(self.words) + 1
            self.c.execute('INSERT INTO surfaces VALUES(?,?,?)', (ident, word, fold(word)))
            self.words[word] = ident
        return ident

    def pool(self, table, value, cache):
        value = js(value)
        if value not in cache:
            ident = len(cache) + 1
            self.c.execute(f'INSERT INTO {table} VALUES(?,?)', (ident, value))
            cache[value] = ident
        return cache[value]

    def origin(self, step):
        evidence = step['evidence']
        lid = self.pool('labels', evidence.get('labels', {}), self.label_ids)
        confirmation = {k: evidence[k] for k in ['source_target_confirmation', 'fragment'] if evidence.get(k)}
        cid = self.pool('confirmations', confirmation, self.confirmation_ids)
        key = (evidence.get('source_line', 0), evidence.get('sense_ordinal', -1), lid, cid)
        if key not in self.origin_ids:
            ident = len(self.origin_ids) + 1
            self.c.execute('INSERT INTO origins VALUES(?,?,?,?,?)', (ident, *key))
            self.origin_ids[key] = ident
        return self.origin_ids[key]

    def finish(self):
        self.c.commit()
        if self.c.execute('PRAGMA foreign_key_check').fetchall(): raise ValueError('Runtime foreign key failure')
        if self.c.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': raise ValueError('Runtime SQLite integrity failure')
        self.c.execute('VACUUM'); self.c.close()


def entry_body(source, eid, senses):
    pronunciations = [{'notation': r[0], 'text': r[1], 'labels': json.loads(r[2])} for r in source.execute('SELECT notation,text,labels_json FROM pronunciations WHERE entry_id=? ORDER BY ordinal', (eid,))]
    forms = [{'form': r[0], 'labels': json.loads(r[1])} for r in source.execute('SELECT form,labels_json FROM forms WHERE entry_id=? ORDER BY ordinal', (eid,))]
    return {'senses': senses, 'pronunciations': pronunciations, 'forms': forms}


def build(audit_db, frequency, output, policy_path=HERE / 'tier-policy.json', attestations=None, frequency_lock_path=HERE / 'frequency.lock.json'):
    policy = json.loads(policy_path.read_text())
    freq_lock = json.loads(frequency_lock_path.read_text())
    if hashes(audit_db)['sha256'] != policy['audit_sqlite_sha256']: raise ValueError('Audit dictionary hash mismatch')
    if hashes(frequency)['sha256'] != freq_lock['extraction']['sha256']: raise ValueError('Frequency hash mismatch')
    if policy['release'] != RELEASE: raise ValueError('Unexpected selection policy release')
    if attestations is None or hashes(attestations)['sha256'] != policy['phrase_attestation']['sha256']: raise ValueError('Phrase-attestation input mismatch')
    selection = Selection(policy, json.load(gzip.open(frequency, 'rt', encoding='utf-8')),json.load(gzip.open(attestations,'rt',encoding='utf-8')))
    source = sqlite3.connect(f'file:{audit_db}?mode=ro', uri=True)
    source.execute('PRAGMA cache_size=-32768')
    # Prefer reverse, source-confirmed inflection/spelling evidence; a stale
    # frequency snapshot must not discard a familiar inflected reading surface.
    promoted = set()
    familiar_alias_targets = set()
    for surface, target, kind in source.execute('SELECT surface,target_entry,kind FROM aliases ORDER BY surface,target_entry,kind'):
        if fold(surface) in selection.familiar: familiar_alias_targets.add(target)
        if (surface == surface.lower() or fold(surface) in selection.familiar) and selection.freq.get(fold(surface), 0) >= policy['daily_alias_zipf_hundredths']:
            promoted.add(target)
    print('FREQUENCY_PROMOTED_RECORDS', len(promoted), flush=True)
    runtimes = {}
    for pack in PACK_IDS:
        p = output / pack; p.mkdir(parents=True, exist_ok=True)
        if (p / 'dictionary.sqlite3').exists(): raise ValueError('Use a fresh output directory')
        runtimes[pack] = Runtime(p / 'dictionary.sqlite3')
    membership = {}
    reasons = collections.Counter()
    assignment = output / 'selection-audit.jsonl.gz'
    with assignment.open('wb') as raw, gzip.GzipFile(filename='', fileobj=raw, mode='wb',mtime=0,compresslevel=9) as log:
        for no, e in enumerate(source.execute('SELECT id,headword,pos,etymology_number,source_line,page_id,revision,wikitext_sha256,labels_json FROM entries ORDER BY source_line'), 1):
            eid, word, pos, etym, line, pid, rev, page_hash, entry_labels = e
            split = collections.defaultdict(list)
            for sid, ordinal, definition, ancestors, raw_gloss, labs, senseids in source.execute('SELECT id,ordinal,definition,ancestors_json,raw_gloss_path_json,labels_json,source_senseids_json FROM senses WHERE entry_id=? ORDER BY ordinal', (eid,)):
                labels = json.loads(labs)
                pack, reason, score = selection.sense(word, pos, labels, eid in promoted,definition,eid in familiar_alias_targets)
                examples = [{'ordinal': int(r[0].rsplit(':e',1)[1]), 'text': r[1], 'revision': r[2], 'line': r[3], 'template': r[4], 'labels': json.loads(r[5])} for r in source.execute('SELECT id,text,source_revision,source_line,template,labels_json FROM examples WHERE sense_id=? ORDER BY id', (sid,))]
                sense = {'ordinal': ordinal, 'definition': definition, 'ancestors': json.loads(ancestors), 'raw_gloss_path': json.loads(raw_gloss), 'labels': labels, 'source_senseids': json.loads(senseids), 'examples': examples}
                split[pack].append(sense)
                reasons[(pack,reason)] += 1
                log.write((js({'source_line':line,'sense_ordinal':ordinal,'headword':word,'pos':pos,'pack':pack,'reason':reason,'observed_token_zipf_hundredths':score})+'\n').encode())
            membership[eid] = (line, tuple(split))
            full = entry_body(source, eid, [])
            full['labels'] = json.loads(entry_labels)
            for pack, senses in split.items():
                runtime = runtimes[pack]; c = runtime.c; surface = runtime.surface(word)
                c.execute('INSERT OR IGNORE INTO pages VALUES(?,?,?,?)', (surface,pid,rev,bytes.fromhex(page_hash)))
                body = dict(full, senses=senses)
                c.execute('INSERT INTO entries VALUES(?,?,?,?,?)', (line,surface,pos,etym,encode(body)))
                runtime.stats['records'] += 1
                runtime.stats['senses'] += len(senses)
                runtime.stats['examples'] += sum(len(s['examples']) for s in senses)
                runtime.stats['nested_senses'] += sum(bool(s['ancestors']) for s in senses)
            if no % 50000 == 0:
                for r in runtimes.values(): r.c.commit()
                print('SPLIT_RECORDS',no,flush=True)
    # Aliases are already resolved and source-verified by the audit build. The
    # runtime stores target + pooled minimal source locator, not repeated paths.
    for no, (surface, target, kind, path) in enumerate(source.execute('SELECT surface,target_entry,kind,path_json FROM aliases ORDER BY surface,target_entry,kind'), 1):
        line, packs = membership[target]; steps = json.loads(path)
        for pack in packs:
            r = runtimes[pack]
            r.c.execute('INSERT INTO aliases VALUES(?,?,?,?)', (r.surface(surface),line,KINDS[kind],r.origin(steps[0])))
            r.stats['aliases'] += 1
        if no % 200000 == 0:
            for r in runtimes.values(): r.c.commit()
            print('PROJECTED_ALIASES',no,flush=True)
    # Retain source-surface IPA/forms/examples only for an installed lookup
    # surface and compatible path origin. They never create a definition hit.
    for line, word, pos, rev, pron, forms, labs in source.execute('SELECT source_line,headword,pos,revision,pronunciations_json,forms_json,labels_json FROM relation_records ORDER BY source_line'):
        ex = [{'ordinal':int(r[0].rsplit(':e',1)[1]),'sense_ordinal':r[1],'text':r[2],'revision':r[3],'line':r[4],'template':r[5],'labels':json.loads(r[6])} for r in source.execute('SELECT id,sense_ordinal,text,source_revision,source_line,template,labels_json FROM relation_examples WHERE source_record=? ORDER BY id',(line,))]
        body = {'pronunciations':json.loads(pron),'forms':json.loads(forms),'labels':json.loads(labs),'examples':ex}
        for pack, r in runtimes.items():
            if word not in r.words: continue
            # Source line can appear after the first edge of a chain, so retain
            # lexical metadata for present surfaces without making it a hit.
            r.c.execute('INSERT INTO surface_records VALUES(?,?,?,?,?)',(line,r.words[word],pos,rev,encode(body)))
            r.stats['surface_records'] += 1
            r.stats['relation_examples'] += len(ex)
    report = {'release':RELEASE,'builder_sha256':hashes(__file__)['sha256'],'toolchain':{'python':sys.version.split()[0],'sqlite':sqlite3.sqlite_version,'zlib':zlib.ZLIB_RUNTIME_VERSION},'attestations':hashes(attestations),'audit_sqlite':hashes(audit_db),'frequency':freq_lock,'policy_sha256':hashes(policy_path)['sha256'],'reasons':{p:{reason:n for (pack,reason),n in reasons.items() if pack==p} for p in PACK_IDS},'packs':{},'selection_audit':hashes(assignment)}
    for pack,r in runtimes.items():
        for key,value in {'schema_version':2,'release':RELEASE,'provider':'wiktionary','dataset':'English Wiktionary','language':'en','adapter_version':ADAPTER,'pack_id':pack,'payload_codec':'zlib-json-v1','definition_languages':['en'],'default_bundle':pack=='daily','license':'CC-BY-SA-4.0','source_dump':'2026-10-01','selection_policy_sha256':report['policy_sha256'],'audit_sqlite_sha256':policy['audit_sqlite_sha256']}.items():
            r.c.execute('INSERT INTO metadata VALUES(?,?)',(key,js(value)))
        r.stats['headwords'] = r.c.execute('SELECT count(DISTINCT surface_id) FROM entries').fetchone()[0]
        r.stats['lookup_surfaces'] = r.c.execute('SELECT count(*) FROM surfaces').fetchone()[0]
        r.finish()
        info=dict(r.stats);info['database']=hashes(output/pack/'dictionary.sqlite3')
        report['packs'][pack]=info
    source.close()
    if report['packs']['daily']['database']['bytes'] > policy['daily_max_bytes']:
        raise ValueError('Daily runtime database exceeds the 150 MB hard budget')
    write_json(output/'tier-build-report.json',report)
    print('BUILT_TIERS',report['packs'],flush=True)


def lookup(connections, query):
    """Aggregate installed same-release packs; exact case before folded fallback."""
    connections=sorted(connections,key=lambda c:json.loads(c.execute("SELECT value FROM metadata WHERE key='pack_id'").fetchone()[0]))
    words=[]
    exact = ' '.join(query.split())
    from build_pack import norm
    exact=norm(exact)
    for c in connections:
        rows=c.execute('SELECT id,word FROM surfaces WHERE word=?',(exact,)).fetchall()
        usable=[(sid,word) for sid,word in rows if c.execute('SELECT 1 FROM entries WHERE surface_id=? UNION ALL SELECT 1 FROM aliases WHERE surface_id=? LIMIT 1',(sid,sid)).fetchone()]
        words.append(usable)
    mode='exact'
    if not any(words):
        mode='casefold_candidates';words=[]
        for c in connections:
            rows=c.execute('SELECT id,word FROM surfaces WHERE folded=? ORDER BY word',(fold(query),)).fetchall()
            words.append([(sid,word) for sid,word in rows if c.execute('SELECT 1 FROM entries WHERE surface_id=? UNION ALL SELECT 1 FROM aliases WHERE surface_id=? LIMIT 1',(sid,sid)).fetchone()])
    entries={};surface_records={}
    release=None
    for c, surfaces in zip(connections,words):
        current=json.loads(c.execute("SELECT value FROM metadata WHERE key='release'").fetchone()[0])
        if release is not None and current!=release: raise ValueError('Cannot combine packs from different releases')
        release=current;pack=json.loads(c.execute("SELECT value FROM metadata WHERE key='pack_id'").fetchone()[0])
        for surface,word in surfaces:
            direct={r[0] for r in c.execute('SELECT source_line FROM entries WHERE surface_id=?',(surface,))}
            aliases=c.execute('SELECT entry_line,kind,origin_id FROM aliases WHERE surface_id=? ORDER BY entry_line,kind',(surface,)).fetchall()
            for line in sorted(direct | {r[0] for r in aliases}):
                raw=c.execute('SELECT s.word,e.pos,e.etymology_number,e.body,p.page_id,p.revision,p.wikitext_sha256 FROM entries e JOIN surfaces s ON s.id=e.surface_id JOIN pages p ON p.surface_id=s.id WHERE e.source_line=?',(line,)).fetchone()
                body=decode(raw[3])
                if line not in entries:
                    entries[line]={'id':f'wiktionary:{current}:r{line}','source_line':line,'headword':raw[0],'pos':raw[1],'etymology_number':raw[2],'revision':raw[5],'source_url':page_url(raw[0]),'wikitext_sha256':raw[6].hex(),'pronunciations':body['pronunciations'],'forms':body['forms'],'labels':body['labels'],'senses':{},'matches':[],'packs':[]}
                entry=entries[line]
                entry['packs'].append(pack)
                entry['matches'].append({'surface':word,'type':mode if line in direct else 'relation','pack':pack})
                for sense in body['senses']:
                    ss=dict(sense,id=f'wiktionary:{current}:r{line}:s{sense["ordinal"]}',pack=pack)
                    entry['senses'][sense['ordinal']]=ss
                for target,kind,origin in aliases:
                    if target!=line:continue
                    rr=c.execute('SELECT o.source_line,o.ordinal,l.body,k.body FROM origins o JOIN labels l ON l.id=o.labels_id JOIN confirmations k ON k.id=o.confirmation_id WHERE o.id=?',(origin,)).fetchone()
                    entry['matches'].append({'surface':word,'type':'relation','kind':next(k for k,v in KINDS.items() if v==kind),'source_line':rr[0],'source_ordinal':rr[1],'labels':json.loads(rr[2]),'confirmation':json.loads(rr[3]),'pack':pack})
            for line,pos,rev,body in c.execute('SELECT source_line,pos,revision,body FROM surface_records WHERE surface_id=? ORDER BY source_line',(surface,)):
                surface_records[line]={'headword':word,'pos':pos,'source_line':line,'revision':rev,'source_url':page_url(word),**decode(body)}
    result=[]
    for line,e in sorted(entries.items()):
        e['senses']=[ss for _,ss in sorted(e['senses'].items())];e['packs']=sorted(set(e['packs']));result.append(e)
    return {'schema_version':2,'release':release or RELEASE,'requested_form':query,'normalization':mode,'entries':result,'surface_records':list(surface_records.values())}


def connect_packs(paths):
    connections=[]
    for path in paths:
        c=sqlite3.connect(f'file:{path}?mode=ro',uri=True)
        if c.execute('PRAGMA user_version').fetchone()[0]!=2:raise ValueError('Not a v2 runtime pack')
        connections.append(c)
    return connections


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('command',choices=['build','lookup','validate','pack'])
    p.add_argument('--audit',type=Path);p.add_argument('--frequency',type=Path);p.add_argument('--attestations',type=Path);p.add_argument('--output',type=Path,required=True);p.add_argument('--packs',nargs='+',default=['daily']);p.add_argument('--query')
    a=p.parse_args()
    if a.command=='build':
        a.output.mkdir(parents=True,exist_ok=True);resource_guard(a.output.parent);build(a.audit,a.frequency,a.output,attestations=a.attestations)
    if a.command=='lookup':
        cs=connect_packs([a.output/pack/'dictionary.sqlite3' for pack in a.packs]);print(json.dumps(lookup(cs,a.query),ensure_ascii=False,indent=2));[c.close() for c in cs]
    if a.command in ['validate','pack']:
        from validate_tiers import validate, package
        if a.command=='validate':validate(a.audit,a.output)
        else:package(a.output)


if __name__=='__main__':main()
