#!/usr/bin/env python3
"""Independent content projection checks, tier coverage, and runtime packaging."""
import collections
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import sys
import zipfile
import zlib

from build_pack import HERE, hashes, js, relation, write_json
from build_tiers import ADAPTER, KINDS, PACK_IDS, RELEASE, SCHEMA, connect_packs, decode, lookup

ROOT=HERE.parents[1]
FIXTURES=ROOT/'tests/dictionary' if (ROOT/'tests/dictionary/queries.json').exists() else HERE


def score(connections, queries):
    details={};counts=collections.Counter()
    for word in queries:
        result=lookup(connections,word)
        if not result['entries']:kind='miss'
        elif result['normalization']=='casefold_candidates':kind='casefold_candidates'
        elif any(any(m['type']=='exact' for m in e['matches']) for e in result['entries']):kind='direct'
        else:kind='relation'
        counts[kind]+=1
        details[word]={'kind':kind,'targets':sorted({(e['headword'],e['pos']) for e in result['entries']}),'senses':sum(len(e['senses']) for e in result['entries'])}
    return {'total':len(queries),'counts':dict(counts),'misses':[q for q,d in details.items() if d['kind']=='miss'],'details':details}


def validate(audit_db,output):
    policy=json.loads((HERE/'tier-policy.json').read_text())
    report={'release':RELEASE,'checks':{},'packs':{},'coverage':{},'reading_materials':{},'familiarity_supplements':{}}
    def check(name,ok,detail=None):
        report['checks'][name]={'passed':bool(ok),'detail':detail}
        if not ok:print('FAILED',name,detail,flush=True)
    source=sqlite3.connect(f'file:{audit_db}?mode=ro',uri=True)
    check('audit_input_sha256',hashes(audit_db)['sha256']==policy['audit_sqlite_sha256'])
    source_senses=source.execute('SELECT count(*) FROM senses').fetchone()[0]
    owners=set();connections=connect_packs([output/p/'dictionary.sqlite3' for p in PACK_IDS])
    content_errors=[];pos_counts={};seen_senses=0
    for pack,c in zip(PACK_IDS,connections):
        check(f'{pack}_integrity',c.execute('PRAGMA integrity_check').fetchone()[0]=='ok')
        check(f'{pack}_foreign_keys',not c.execute('PRAGMA foreign_key_check').fetchall())
        meta={k:json.loads(v) for k,v in c.execute('SELECT key,value FROM metadata')}
        check(f'{pack}_identity',meta['pack_id']==pack and meta['release']==RELEASE and meta['provider']=='wiktionary' and meta['payload_codec']=='zlib-json-v1' and meta['selection_policy_sha256']==hashes(HERE/'tier-policy.json')['sha256'] and meta['audit_sqlite_sha256']==policy['audit_sqlite_sha256'] and meta['default_bundle']==(pack=='daily'))
        senses=examples=nested=0;pos_counts[pack]=collections.Counter()
        for line,word,pos,etym,body,pid,rev,whash in c.execute('SELECT e.source_line,s.word,e.pos,e.etymology_number,e.body,p.page_id,p.revision,p.wikitext_sha256 FROM entries e JOIN surfaces s ON s.id=e.surface_id JOIN pages p ON p.surface_id=s.id ORDER BY e.source_line'):
            data=decode(body)
            original=source.execute('SELECT id,headword,pos,etymology_number,page_id,revision,wikitext_sha256,labels_json FROM entries WHERE source_line=?',(line,)).fetchone()
            if not original or (word,pos,etym,pid,rev,whash.hex())!=original[1:7] or data['labels']!=json.loads(original[7]):
                content_errors.append(['record_identity',pack,line]);continue
            eid=original[0]
            expected_pron=[{'notation':r[0],'text':r[1],'labels':json.loads(r[2])} for r in source.execute('SELECT notation,text,labels_json FROM pronunciations WHERE entry_id=? ORDER BY ordinal',(eid,))]
            expected_forms=[{'form':r[0],'labels':json.loads(r[1])} for r in source.execute('SELECT form,labels_json FROM forms WHERE entry_id=? ORDER BY ordinal',(eid,))]
            if data['pronunciations']!=expected_pron or data['forms']!=expected_forms:content_errors.append(['pronunciation_or_form',pack,line])
            if not data['senses']:content_errors.append(['empty_entry',pack,line])
            for sense in data['senses']:
                ordinal=sense['ordinal'];key=(line,ordinal)
                if key in owners:content_errors.append(['duplicate_sense_ownership',pack,key])
                owners.add(key);senses+=1;pos_counts[pack][pos]+=1
                raw=source.execute('SELECT id,definition,ancestors_json,raw_gloss_path_json,labels_json,source_senseids_json FROM senses WHERE entry_id=? AND ordinal=?',(eid,ordinal)).fetchone()
                if not raw:content_errors.append(['unknown_sense',pack,key]);continue
                expected={'ordinal':ordinal,'definition':raw[1],'ancestors':json.loads(raw[2]),'raw_gloss_path':json.loads(raw[3]),'labels':json.loads(raw[4]),'source_senseids':json.loads(raw[5])}
                expected['examples']=[{'ordinal':int(r[0].rsplit(':e',1)[1]),'text':r[1],'revision':r[2],'line':r[3],'template':r[4],'labels':json.loads(r[5])} for r in source.execute('SELECT id,text,source_revision,source_line,template,labels_json FROM examples WHERE sense_id=? ORDER BY id',(raw[0],))]
                if sense!=expected:content_errors.append(['sense_or_example_changed',pack,key])
                if not sense['definition'].strip() or relation({'glosses':[sense['definition']]}):content_errors.append(['non_substantive',pack,key])
                examples+=len(sense['examples']);nested+=bool(sense['ancestors'])
            if len(content_errors)>30:raise ValueError(f'Too many content errors: {content_errors[:30]}')
        check(f'{pack}_lossless_source_content',not content_errors,content_errors[:10])
        seen_senses+=senses
        c.execute('ATTACH DATABASE ? AS audit',(f'file:{audit_db}?mode=ro',))
        # Every runtime alias must be one of the original source-verified
        # resolved matches. Pooled origin locators and labels must still match.
        kind_case="CASE a.kind WHEN 1 THEN 'form_of' WHEN 2 THEN 'alt_of' WHEN 3 THEN 'headword_form' WHEN 4 THEN 'mediawiki_redirect' END"
        query=f'''SELECT count(*) FROM aliases a JOIN surfaces s ON s.id=a.surface_id
        JOIN entries re ON re.source_line=a.entry_line
        LEFT JOIN audit.entries e ON e.source_line=a.entry_line
        LEFT JOIN audit.aliases original ON original.surface=s.word AND original.target_entry=e.id AND original.kind={kind_case}
        JOIN origins o ON o.id=a.origin_id JOIN labels l ON l.id=o.labels_id
        WHERE original.surface IS NULL OR o.source_line!=coalesce(json_extract(original.path_json,'$[0].evidence.source_line'),0)
        OR o.ordinal!=coalesce(json_extract(original.path_json,'$[0].evidence.sense_ordinal'),-1)
        OR l.body!=coalesce(json_extract(original.path_json,'$[0].evidence.labels'),'{{}}')'''
        broken=c.execute(query).fetchone()[0]
        check(f'{pack}_all_aliases_and_origin_labels_match_audit',broken==0,broken)
        c.execute('DETACH DATABASE audit')
        # Every lexical surface record, including ordinary examples on relation
        # senses, is preserved exactly from the audited source, not a new gloss.
        metadata_errors=0;relation_examples=0
        for line,word,pos,rev,body in c.execute('SELECT r.source_line,s.word,r.pos,r.revision,r.body FROM surface_records r JOIN surfaces s ON s.id=r.surface_id'):
            r=source.execute('SELECT headword,pos,revision,pronunciations_json,forms_json,labels_json FROM relation_records WHERE source_line=?',(line,)).fetchone();data=decode(body)
            ex=[{'ordinal':int(x[0].rsplit(':e',1)[1]),'sense_ordinal':x[1],'text':x[2],'revision':x[3],'line':x[4],'template':x[5],'labels':json.loads(x[6])} for x in source.execute('SELECT id,sense_ordinal,text,source_revision,source_line,template,labels_json FROM relation_examples WHERE source_record=? ORDER BY id',(line,))]
            expected={'pronunciations':json.loads(r[3]),'forms':json.loads(r[4]),'labels':json.loads(r[5]),'examples':ex}
            if (word,pos,rev)!=r[:3] or data!=expected:metadata_errors+=1
            relation_examples+=len(ex)
        check(f'{pack}_relation_surface_metadata_lossless',metadata_errors==0,metadata_errors)
        report['packs'][pack]={'headwords':c.execute('SELECT count(DISTINCT surface_id) FROM entries').fetchone()[0],'records':c.execute('SELECT count(*) FROM entries').fetchone()[0],'senses':senses,'examples':examples,'relation_examples':relation_examples,'senses_with_ancestors':nested,'aliases':c.execute('SELECT count(*) FROM aliases').fetchone()[0],'surface_records':c.execute('SELECT count(*) FROM surface_records').fetchone()[0],'sense_POS':dict(pos_counts[pack]),'database':hashes(output/pack/'dictionary.sqlite3')}
        print('VALIDATED_CONTENT',pack,report['packs'][pack],flush=True)
    check('all_audited_senses_partitioned_exactly_once',seen_senses==source_senses and len(owners)==source_senses,{'source':source_senses,'runtime':seen_senses,'unique':len(owners)})
    check('daily_database_under_150_MB',report['packs']['daily']['database']['bytes']<=policy['daily_max_bytes'])
    queries=json.loads((FIXTURES/'queries.json').read_text())
    examples=['pneumonia','monologue','soliloquy','eczema','chemotherapy','arthritis','dementia','mortgage','satire','protagonist','photosynthesis','quark','US','U.S.','us']
    queries['familiar_general_vocabulary']=examples
    queries['source_missing_probe']=['one-man show','one person show','one-person show','work from home']
    queries['tier_boundaries']=['monodrama','sesquipedalian','yclept','defenestration','ichthyology','syzygy','homeomorphism','deoxyribonuclease']
    probes={'daily':connections[:1],'daily_extended':connections[:2],'daily_specialist':[connections[0],connections[2]],'all':connections}
    for mode,cs in probes.items():
        report['coverage'][mode]={name:score(cs,qs) for name,qs in queries.items() if isinstance(qs,list)}
        function={}
        for word,expected in queries['function_word_expected_pos'].items():
            es=lookup(cs,word)['entries'];function[word]={'matched':any(e['pos'] in expected and e['senses'] for e in es),'expected_pos':expected}
        report['coverage'][mode]['function_words']={'total':len(function),'hits':sum(x['matched'] for x in function.values()),'details':function}
    daily=report['coverage']['daily']
    check('daily_57_word_baseline',daily['words']['total']==57 and not daily['words']['misses'])
    check('daily_30_expanded_inflections',daily['expanded_inflections']['total']==30 and not daily['expanded_inflections']['misses'])
    check('daily_49_of_50_modern',daily['expanded_modern']['total']==50 and daily['expanded_modern']['misses']==['work from home'])
    check('daily_20_intended_function_POS',daily['function_words']['hits']==20)
    check('daily_phrase_baseline_39_of_40',daily['phrases']['misses']==['pay attention to'])
    check('daily_user_familiarity_examples',not daily['familiar_general_vocabulary']['misses'],daily['familiar_general_vocabulary']['misses'])
    for word,term in [('pneumonia','lung'),('monologue','speech')]:
        text=' '.join(s['definition'] for e in lookup(connections[:1],word)['entries'] for s in e['senses']).lower()
        check(f'daily_{word}_real_substantive_meaning',term in text,text[:500])
    check('US_country_and_own_IPA',any(e['headword']=='United States' for e in lookup(connections[:1],'US')['entries']) and any(r['pronunciations'] for r in lookup(connections[:1],'US')['surface_records']))
    check('US_us_case_separation',all(e['headword']!='US' for e in lookup(connections[:1],'us')['entries']))
    check('no_preposition_guessing',not lookup(connections,'pay attention to')['entries'])
    corpora=json.loads((FIXTURES/'corpora.json').read_text())
    for mode,cs in probes.items():
        results=[]
        for corpus in corpora:
            counts=collections.Counter();misses=collections.Counter()
            for token,n in corpus['tokens'].items():
                result=lookup(cs,token)
                if not result['entries']:kind='miss';misses[token]+=n
                elif result['normalization']=='casefold_candidates':kind='casefold_candidates'
                elif any(any(m['type']=='exact' for m in e['matches']) for e in result['entries']):kind='direct'
                else:kind='relation'
                counts[kind]+=n
            results.append({'id':corpus['id'],'url':corpus['url'],'download':corpus['download'],'tokens':dict(counts),'top_misses':misses.most_common(40),'interpretation':'Surface vocabulary candidates, not sense accuracy; exact and casefold fallback separated.'})
        report['reading_materials'][mode]=results
    for group,words in policy['familiarity_supplements'].items():
        daily_score=score(connections[:1],words);full=score(connections,words)
        available_missing=[w for w in daily_score['misses'] if w not in full['misses']]
        from build_pack import lookup as audit_lookup
        unexpected=[]
        for w in available_missing:
            original=audit_lookup(source,w)
            if any(not set(s['labels'].get('tags',[])) & set(policy['historical_tags']) for e in original['entries'] for s in e['senses']):unexpected.append(w)
        report['familiarity_supplements'][group]={'total':len(words),'daily_hits':len(words)-len(daily_score['misses']),'source_absent':full['misses'],'available_but_not_daily':available_missing,'non_archaic_unexpected_misses':unexpected}
        check(f'familiarity_{group}_non_archaic_available_terms_in_daily',not unexpected,unexpected)
    specimens={word:lookup(connections[:1],word) for word in examples+['bank','field','run','those','doomscrolling','generative AI']}
    write_json(output/'daily-samples.json',specimens)
    report['all_checks_passed']=all(x['passed'] for x in report['checks'].values())
    report['limits']=['Product selection tiers approximate familiarity using frequency and domain signals; not an individual native-speaker proficiency test.','Frequency snapshot is approximately through 2021, complemented with explicit contemporary/general-familiarity terms.','Component familiarity is not an observed phrase frequency.','Only available Wiktionary text can be included; missing common expressions remain misses.','Individual source labels can be incomplete or inconsistent; boundary review and future corrections remain necessary.','Some rare spellings/inflections of common lemmas remain resolvable aliases; they are not counted as substantive headwords.','No downloader UI, installed runtime adapter or device acceptance is implemented.']
    write_json(output/'tier-quality-report.json',report)
    [c.close() for c in connections];source.close()
    if not report['all_checks_passed']:raise ValueError('Tier validation failed; inspect tier-quality-report.json')
    print('TIERS_VALIDATED',len(report['checks']),flush=True)
    return report


def make_zip(path,files):
    with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for name,p in sorted(files.items()):
            info=zipfile.ZipInfo(name,(2026,10,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
            with z.open(info,'w',force_zip64=True) as dst,p.open('rb') as src:shutil.copyfileobj(src,dst,1024*1024)


def package(output,policy_path=HERE/'tier-policy.json'):
    report=json.loads((output/'tier-quality-report.json').read_text());policy=json.loads(policy_path.read_text())
    if json.loads((output/'tier-build-report.json').read_text())['policy_sha256']!=hashes(policy_path)['sha256']:raise ValueError('Stale selection policy')
    if not report['all_checks_passed']:raise ValueError('Cannot package failed validation')
    docs=ROOT/'docs/dictionary' if (ROOT/'docs/dictionary/TIERS.md').exists() else HERE
    catalog={'schema_version':2,'release':RELEASE,'default_pack_ids':['daily'],'adapter_version':ADAPTER,'provider':'wiktionary','selection_policy':policy,'packs':[]}
    for pack in PACK_IDS:
        folder=output/pack;db=folder/'dictionary.sqlite3'
        if hashes(db)!=report['packs'][pack]['database']:raise ValueError('Stale runtime validation')
        for source,name in [(docs/'CC-BY-SA-4.0.txt','CC-BY-SA-4.0.txt'),(docs/'TIER-NOTICE.txt','NOTICE.txt'),(docs/'WORDFREQ-NOTICE.md','WORDFREQ-NOTICE.md'),(docs/'TIERS.md','CONTRACT.md'),(docs/'POLICY.md','POLICY.md')]:shutil.copyfile(source,folder/name)
        (folder/'schema.sql').write_text(SCHEMA.strip()+'\n')
        manifest={'schema_version':2,'package_id':f'lexicue.wiktionary.en.{pack}','release':RELEASE,'pack_id':pack,**policy['packs'][pack],'requires':[],'language':'en','definition_languages':['en'],'provider':'wiktionary','dataset':'English Wiktionary','adapter_version':ADAPTER,'license':{'name':'CC BY-SA 4.0','url':'https://creativecommons.org/licenses/by-sa/4.0/'},'payload_codec':'zlib-json-v1','max_uncompressed_record_bytes':8*1024*1024,'selection_policy_sha256':hashes(policy_path)['sha256'],'audit_sqlite_sha256':policy['audit_sqlite_sha256'],'statistics':report['packs'][pack],'files':{}}
        for p in sorted(folder.iterdir()):
            if p.is_file() and p.name!='manifest.json':manifest['files'][p.name]=hashes(p)
        write_json(folder/'manifest.json',manifest)
        archive=output/f'lexicue-{pack}-{RELEASE}.zip';make_zip(archive,{p.name:p for p in folder.iterdir() if p.is_file()})
        entry={'id':pack,**policy['packs'][pack],'filename':archive.name,'download_url':None,'archive':hashes(archive),'database':hashes(db),'statistics':report['packs'][pack]}
        catalog['packs'].append(entry)
    write_json(output/'catalog.json',catalog)
    # Developer/reviewer materials are separate from the three installable ZIPs.
    review=output/'build-review';review.mkdir(exist_ok=True)
    for name in ['build_tiers.py','validate_tiers.py','extract_frequency.py','extract_attestations.py','build_pack.py','validate_pack.py','sources.lock.json','frequency.lock.json','tier-policy.json']:
        shutil.copyfile(policy_path if name=='tier-policy.json' else HERE/name,review/name)
    for name in ['CC-BY-SA-4.0.txt','TIER-NOTICE.txt','WORDFREQ-NOTICE.md','TIERS.md','README.md','POLICY.md','CONTRACT.md','NOTICE.txt','CHANGELOG.md']:
        shutil.copyfile(docs/name,review/name)
    for name in ['queries.json','corpora.json']:shutil.copyfile(FIXTURES/name,review/name)
    for name in ['tier-build-report.json','tier-quality-report.json','daily-samples.json','selection-audit.jsonl.gz','catalog.json']:shutil.copyfile(output/name,review/name)
    write_json(review/'build-info.json',{'python':sys.version.split()[0],'sqlite':sqlite3.sqlite_version,'zlib':zlib.ZLIB_RUNTIME_VERSION,'scripts':{n:hashes(HERE/n) for n in ['build_tiers.py','validate_tiers.py','extract_frequency.py','extract_attestations.py']}})
    (review/'README.md').write_text('''# Rebuild and review the tiered dictionaries

Start with TIERS.md for current runtime schema, selection and commands, and
POLICY.md for upstream audit/example rights rules. The machine acceptance
report is tier-quality-report.json; catalog.json lists the three installable
ZIPs and exact byte/hash values. This reviewer archive is not an install pack.

Only daily is default. The full audit database is a separate developer input,
not a mobile dependency. Build it with build_pack.py download/audit/build from
sources.lock.json, using the recorded toolchain to match its pinned SQLite
hash. The original audit schema is described in CONTRACT.md.

To prepare frequency input, download the exact wheel URL in frequency.lock.json
(or pip download --no-deps wordfreq==3.1.1), then use extract_frequency.py with
msgpack==1.1.2. The extractor verifies the wheel and frequency-bin offset.
extract_attestations.py streams the fixed raw extraction and saves only
aggregate reference/year counts. tier-policy.json binds both prepared inputs.

Run build_tiers.py build/validate/pack as documented in TIERS.md, using fresh
output paths. No downloader UI, application installation or release publication
is performed. Source text and examples are never generated or translated.
''',encoding='utf-8')
    make_zip(output/f'lexicue-build-review-{RELEASE}.zip',{p.name:p for p in review.iterdir() if p.is_file()})
    print('PACKAGED',[(p['id'],p['database']['bytes'],p['archive']['bytes']) for p in catalog['packs']],flush=True)
    return catalog


def verify_archives(output):
    catalog=json.loads((output/'catalog.json').read_text())
    for pack in catalog['packs']:
        path=output/pack['filename']
        if hashes(path)!=pack['archive']:raise ValueError('Catalog archive hash mismatch')
        with zipfile.ZipFile(path) as z:
            names=z.namelist()
            if len(names)!=len(set(names)) or any(Path(n).name!=n for n in names):raise ValueError('Unsafe archive paths')
            manifest=json.loads(z.read('manifest.json'))
            if set(names)!=set(manifest['files'])|{'manifest.json'}:raise ValueError('Manifest member mismatch')
            for name,expected in manifest['files'].items():
                h=hashlib.sha256();size=0
                with z.open(name) as f:
                    while chunk:=f.read(1024*1024):h.update(chunk);size+=len(chunk)
                if h.hexdigest()!=expected['sha256'] or size!=expected['bytes']:raise ValueError('Member mismatch '+name)
        print('VERIFIED_ARCHIVE',pack['id'],pack['archive']['sha256'],flush=True)
