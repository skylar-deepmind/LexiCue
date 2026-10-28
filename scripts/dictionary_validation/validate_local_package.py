#!/usr/bin/env python3
"""Independent evidence audit of the offline Longman package and fixed 100 queries.

This reads the frozen reviewed baseline only during validation, never during queries.
It does not certify whole-dictionary linguistic accuracy.
"""
from __future__ import annotations

import argparse
import collections
import concurrent.futures
import multiprocessing
import hashlib
import json
import math
import platform
import shutil
import sqlite3
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SCHEMA = Path(__file__).resolve().parents[2] / 'docs/implementation/dictionary-result-v1.schema.json'


def raw_id(value):
    return str(value).split(':')[-1]


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(data)
    return h.hexdigest()


def connect(path):
    c = sqlite3.connect(f'file:{Path(path).resolve()}?mode=ro&immutable=1', uri=True)
    c.row_factory = sqlite3.Row
    return c


def text(value):
    return value.strip() if isinstance(value, str) else value


def senses_of(result):
    return [s for e in result['entries'] for g in e['groups'] for s in g['senses']]


def examples_of(result):
    """Return every example with its lexical sense binding, including pattern examples."""
    records = []
    for e in result['entries']:
        for n in e['notes']:
            records += [(None, None, x) for x in n['examples']]
        for g in e['groups']:
            for n in g['notes']:
                records += [(None, None, x) for x in n['examples']]
            for s in g['senses']:
                records += [(raw_id(s['id']), None, x) for x in s['examples']]
                for n in s['notes']:
                    records += [(raw_id(s['id']), None, x) for x in n['examples']]
                for p in s['patterns']:
                    records += [(raw_id(s['id']), raw_id(p['id']), x) for x in p['examples']]
                    for n in p['notes']:
                        records += [(raw_id(s['id']), raw_id(p['id']), x) for x in n['examples']]
    return records


def schema_errors(result, validator):
    return [f"{'/'.join(map(str,e.absolute_path))}: {e.message}" for e in validator.iter_errors(result)]


_SOURCE_CACHE={}
def source_cache(source):
    key=id(source)
    if key not in _SOURCE_CACHE:
        cache={'senses':{r['id']:dict(r) for r in source.execute('SELECT * FROM reviewed_senses')},
               'constructions':{r['id']:dict(r) for r in source.execute('SELECT * FROM reviewed_constructions')},
               'candidates':{r['id'] for r in source.execute('SELECT id FROM candidate_bilingual_senses')},
               'sense_constructions':{tuple(r) for r in source.execute('SELECT sense_id,construction_id FROM sense_constructions')},
               'examples':collections.defaultdict(list)}
        for kind,view in [('sense','reviewed_examples'),('construction','reviewed_sense_construction_examples'),('note','reviewed_note_examples'),('standalone_construction','reviewed_construction_examples')]:
            for row in source.execute('SELECT * FROM '+view):
                row=dict(row)
                if row.get('display_adopted',1):cache['examples'][row['id']].append((kind,row))
        _SOURCE_CACHE[key]=cache
    return _SOURCE_CACHE[key]


def source_bindings(result, source):
    """Compare V1 bilingual pairs and relations with the reviewed source, not output shape."""
    errors = []
    cache=source_cache(source)
    for e in result['entries']:
        for g in e['groups']:
            for s in g['senses']:
                sid = raw_id(s['id'])
                row = cache['senses'].get(sid)
                if row:
                    for lang, field in [('en', 'definition_en'), ('zh', 'definition_zh')]:
                        actual = s['meaning'][lang]
                        expected = text(row[field]) or None
                        if lang=='zh' and sid not in cache['candidates']:
                            expected=None  # Reviewed candidate gate deliberately hides uncertain/dated Chinese.
                        # Full-form expansion is allowed only when original definition is preserved.
                        if actual != expected and not (expected and actual and expected in actual):
                            errors.append(f'sense_text:{sid}:{lang}')
                else:
                    row = cache['constructions'].get(sid)
                    if not row:
                        errors.append(f'unknown_sense:{sid}')
                    else:
                        for lang, field in [('en', 'gloss_en_json'), ('zh', 'explanation_zh_json')]:
                            parts = [x for x in json.loads(row[field] or '[]') if text(x)]
                            actual = s['meaning'][lang]
                            if parts and not all(text(x) in (actual or '') for x in parts):
                                errors.append(f'construction_meaning:{sid}:{lang}')
                            if not parts and actual is not None:
                                errors.append(f'construction_fabricated:{sid}:{lang}')
                for p in s['patterns']:
                    cid = raw_id(p['id'])
                    # Scoped metadata may produce source-local patterns with suffix identifiers.
                    c = cid in cache['constructions']
                    if c and sid in cache['senses']:
                        if (sid,cid) not in cache['sense_constructions']:
                            errors.append(f'cross_sense_pattern:{sid}:{cid}')
    for sid, cid, ex in examples_of(result):
        xid = raw_id(ex['id'])
        candidates = cache['examples'].get(xid,[])
        matching = []
        for kind, r in candidates:
            if text(r['english']) != ex['english'] or (text(r['chinese']) or None) != ex['chinese']:
                continue
            if kind == 'sense' and sid != r['sense_id']:
                continue
            if kind == 'construction' and (sid != r['sense_id'] or (cid and cid != r['construction_id'])):
                continue
            if kind == 'standalone_construction' and sid != r['construction_id'] and cid != r['construction_id']:
                continue
            matching.append(kind)
        if not matching:
            errors.append(f'example_source_or_binding:{sid}:{cid}:{xid}')
    return sorted(set(errors))


def fixed_query_audit(dictionary, source, baseline, verdicts, validator):
    rows, outputs = [], []
    for old, verdict in zip(baseline['results'], verdicts, strict=True):
        assert old['query'] == verdict['query']
        start = time.perf_counter()
        result = dictionary.query(old['query'])
        elapsed = (time.perf_counter() - start) * 1000
        outputs.append(result)
        errors = schema_errors(result, validator) + source_bindings(result, source)
        new_senses = {raw_id(s['id']): s for s in senses_of(result)}
        new_examples = collections.defaultdict(list)
        for sid, cid, ex in examples_of(result):
            new_examples[raw_id(ex['id'])].append((sid, cid, ex))
        missing_senses = []
        for old_s in old['gloss_overview']:
            sid = old_s['sense_id']
            if sid not in new_senses:
                missing_senses.append(sid)
            else:
                new_s = new_senses[sid]
                for lang, field in [('en', 'english'), ('zh', 'chinese')]:
                    if text(old_s[field]) != new_s['meaning'][lang] and not (text(old_s[field]) and text(old_s[field]) in (new_s['meaning'][lang] or '')):
                        errors.append(f'baseline_changed_sense:{sid}:{lang}')
        missing_examples = []
        relocated_examples = []
        for old_x in old['examples']:
            expected_sid = old_x.get('sense_id') or old_x.get('construction_id')
            matches = [r for r in new_examples[old_x['id']] if r[0] == expected_sid or r[1] == expected_sid]
            if not matches:
                # Main and construction extraction assign distinct IDs to the same source sentence.
                # Accept relocation only with exact bilingual pair and the very same lexical sense.
                alternatives=[(sid,cid,ex) for sid,cid,ex in examples_of(result) if sid==expected_sid and cid and ex['english']==text(old_x['english']) and ex['chinese']==(text(old_x['chinese']) or None)]
                if alternatives:
                    matches=alternatives
                    relocated_examples.append({'baseline_example_id':old_x['id'],'source_sense_id':expected_sid,'new_example_ids':sorted({raw_id(x[2]['id']) for x in alternatives}),'construction_ids':sorted({x[1] for x in alternatives}),'reason':'Same source sense and exact EN/ZH pair; construction-scoped ID replaces redundant main-example ID.'})
                else:
                    missing_examples.append(old_x['id'])
                    continue
            if not any(r[2]['english'] == text(old_x['english']) and r[2]['chinese'] == (text(old_x['chinese']) or None) for r in matches):
                errors.append(f'baseline_changed_example:{old_x["id"]}')
        if missing_senses:
            errors.append(f'missing_baseline_senses:{len(missing_senses)}')
        if missing_examples:
            errors.append(f'missing_baseline_examples:{len(missing_examples)}')
        has_zh = any(s['meaning']['zh'] for s in new_senses.values())
        expected_status = 'found' if old['has_local_chinese'] else 'partial'
        if result['status'] != expected_status:
            errors.append(f'status:{result["status"]}!={expected_status}')
        if has_zh != old['has_local_chinese']:
            errors.append('chinese_coverage_changed')
        if result['query']['text'] != old['query']:
            errors.append('original_query_changed')
        rows.append({'index': old['index'], 'query': old['query'], 'category': old['category'],
                     'baseline_status': verdict['status'], 'baseline_note': verdict['note'],
                     'status': result['status'], 'has_local_chinese': has_zh,
                     'headwords': [e['headword'] for e in result['entries']],
                     'match_types': sorted({e['match']['type'] for e in result['entries']}),
                     'baseline_senses': len(old['gloss_overview']), 'returned_senses': len(new_senses),
                     'baseline_examples_checked': len(old['examples']),
                     'missing_baseline_sense_ids': missing_senses, 'missing_baseline_example_ids': missing_examples,'relocated_example_ids':relocated_examples,
                     'schema_and_source_errors': errors, 'passed': not errors, 'elapsed_ms': round(elapsed, 3),
                     'change_reason': 'V1 preserves source groups and complete content; examples may move under their source patterns. No linguistic rewrite.'})
    return rows, outputs


def static_audit(package_root, source, note_overlay=None):
    runtime = connect(package_root / 'runtime.sqlite')
    checks = []
    def add(name, passed, detail=None):
        checks.append({'name':name,'passed':bool(passed),'detail':detail})
    add('sqlite_integrity', runtime.execute('PRAGMA integrity_check').fetchone()[0] == 'ok')
    foreign = [tuple(r) for r in runtime.execute('PRAGMA foreign_key_check')]
    add('foreign_keys', not foreign, foreign[:10])
    tables = {r[0] for r in runtime.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    # Equivalent relation checks are needed even if a CTAS table has no declared FK.
    relations = [('senses','unit_id','units','id'),('examples','sense_id','senses','id'),
                 ('sense_notes','sense_id','senses','id'),('sense_notes','note_id','notes','id'),
                 ('note_examples','note_id','notes','id'),('sense_constructions','sense_id','senses','id'),
                 ('sense_constructions','construction_id','constructions','id'),
                 ('sense_construction_examples','sense_id','senses','id'),
                 ('sense_construction_examples','construction_id','constructions','id'),
                 ('occurrences','sense_id','senses','id'),('lookup','unit_id','units','id'),
                 ('query_senses','sense_id','senses','id'),('group_map','sense_id','senses','id'),
                 ('group_map','group_id','groups','id'),('groups','unit_id','units','id'),
                 ('pronunciations','group_id','groups','id'),('forms','group_id','groups','id')]
    for child, col, parent, key in relations:
        if child not in tables or parent not in tables:
            add('relation_'+child+'_'+col, False, 'missing required table')
            continue
        n = runtime.execute(f'SELECT count(*) FROM {child} a LEFT JOIN {parent} b ON a.{col}=b.{key} WHERE b.{key} IS NULL').fetchone()[0]
        add('relation_'+child+'_'+col, n == 0, n)
    for table, required in [('senses',['id','unit_id']),('examples',['id','sense_id','english']),('constructions',['id','pattern']),('units',['id','headword'])]:
        for column in required:
            n=runtime.execute(f"SELECT count(*) FROM {table} WHERE {column} IS NULL OR trim({column})='' OR instr({column},char(65533))>0").fetchone()[0]
            add('valid_'+table+'_'+column,n==0,n)
    n=runtime.execute("SELECT count(*) FROM senses WHERE (definition_en IS NULL OR trim(definition_en)='') AND (definition_zh IS NULL OR trim(definition_zh)='')").fetchone()[0]
    add('nonempty_definition_pairs',n==0,n)
    # Exact content, full forms and scoped annotations must survive packaging.
    source_views={'senses':'reviewed_senses','examples':'reviewed_examples','notes':'reviewed_notes','note_examples':'reviewed_note_examples','constructions':'reviewed_constructions'}
    comparisons={}
    overlays={}
    if note_overlay and Path(note_overlay).is_file():
        nc=connect(note_overlay)
        overlays={r['id']:dict(r) for r in nc.execute('SELECT * FROM note_bodies')}
        nc.close()
    for target, view in source_views.items():
        common=[r[1] for r in runtime.execute(f'PRAGMA table_info({target})') if r[1] in {r[1] for r in source.execute(f'PRAGMA table_info({view})')}]
        columns=[x for x in common if x not in {'audio_json','issues_json','display_adopted'}]
        old={r['id']:dict(r) for r in source.execute(f'SELECT {",".join(columns)} FROM {view}')}
        if target=='notes':
            for key,patch in overlays.items():
                if key in old:
                    for field in ['english_json','chinese_json']:old[key][field]=patch[field]
        mismatches=[]
        for row in runtime.execute(f'SELECT {",".join(columns)} FROM {target}'):
            match=old.get(row['id'])
            if match is None or any(row[k]!=match[k] for k in columns):
                mismatches.append(row['id'])
        add('source_equivalence_'+target,not mismatches,{'compared_columns':columns,'mismatches':mismatches[:10],'count':len(mismatches)})
        comparisons[target]=len(old)
    for target,view,keys in [
        ('sense_construction_examples','reviewed_sense_construction_examples',['sense_id','construction_id','id','english','chinese']),
        ('sense_notes','reviewed_sense_notes',['sense_id','note_id']),
        ('sense_constructions','sense_constructions',['sense_id','construction_id']),
        ('occurrences','occurrences',['sense_id','record_index','record_key','source_json'])]:
        def normalized(row):
            values=[]
            for k,v in zip(keys,row):
                if k.endswith('_json') and v:
                    value=json.loads(v)
                    # Portable runtime removes only the developer's old-edition file path;
                    # retained source fingerprint/record/URL still bind the restored meaning.
                    if k=='source_json' and value.get('definition_origin')=='restored_from_older_edition':
                        reference=value.get('reference',{})
                        if isinstance(reference.get('path'),str) and Path(reference['path']).is_absolute():reference.pop('path')
                    v=json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
                values.append(v)
            return tuple(values)
        source_rows={normalized(r) for r in source.execute(f'SELECT {",".join(keys)} FROM {view}')}
        actual=[normalized(r) for r in runtime.execute(f'SELECT {",".join(keys)} FROM {target}')]
        bad=[r for r in actual if r not in source_rows]
        add('source_binding_'+target,not bad,{'rows':len(actual),'mismatches':len(bad),'sample':bad[:3],'normalization':'JSON whitespace/key order; restored old-edition reference.path developer location omitted, SHA/record/source URL retained' if target=='occurrences' else None})
    mismatch=runtime.execute('SELECT count(*) FROM group_map m JOIN groups g ON g.id=m.group_id JOIN senses s ON s.id=m.sense_id WHERE g.unit_id<>s.unit_id OR m.record_index<>g.record_index OR m.group_locator<>g.locator').fetchone()[0]
    add('group_mapping_sense_unit_record_locator',mismatch==0,mismatch)
    absent=[];scope_fallbacks=[]
    source_occurrences=collections.defaultdict(list)
    for r in source.execute('SELECT * FROM occurrences'):source_occurrences[(r['sense_id'],r['record_index'])].append(json.loads(r['source_json']))
    for row in runtime.execute('SELECT sense_id,record_index,definition_xpath FROM group_map'):
        originals=source_occurrences.get((row['sense_id'],row['record_index']),[])
        if not any(row['definition_xpath']==original.get('definition_xpath') for original in originals):
            if any(original.get('definition_xpath') is None and row['definition_xpath']==original.get('scope_xpath') for original in originals):
                scope_fallbacks.append(tuple(row))
            else:absent.append(tuple(row))
    add('group_mapping_original_definition_source',not absent,{'mismatches':len(absent),'sample':absent[:3],'restored_definition_scope_fallbacks':scope_fallbacks,'explanation':'Two prior-edition restored definitions have null source leaf XPath. Exact original scope XPath binds their genuine groups.'})
    candidates={r[0] for r in source.execute('SELECT id FROM candidate_bilingual_senses')}
    packaged={r[0] for r in runtime.execute('SELECT id FROM senses')}
    missing=candidates-packaged
    add('all_bilingual_candidates_preserved',not missing,{'missing_count':len(missing),'sample':sorted(missing)[:10]})
    excluded={r[0] for r in source.execute("SELECT sense_id FROM meaning_reviews WHERE individual_review LIKE 'needs_verification%' OR individual_review LIKE 'excluded%'")}
    leaked=packaged&excluded
    add('known_excluded_senses_absent',not leaked,sorted(leaked))
    for table in tables:
        for col in [r[1] for r in runtime.execute(f'PRAGMA table_info({table})') if r[1].endswith('_json')]:
            invalid=runtime.execute(f'SELECT count(*) FROM {table} WHERE {col} IS NOT NULL AND NOT json_valid({col})').fetchone()[0]
            add('json_'+table+'_'+col,not invalid,invalid)
    if overlays:
        missing=[key for key in overlays if not runtime.execute('SELECT 1 FROM notes WHERE id=? AND english_json=? AND chinese_json=?',(key,overlays[key]['english_json'],overlays[key]['chinese_json'])).fetchone()]
        add('source_DOM_note_overlay_complete',not missing,{'expected_notes':len(overlays),'mismatches':missing[:10],'overlay':str(note_overlay)})
    runtime.close()
    return checks


def boundary_audit(dictionary, source, validator, package_root, audio_root):
    checks=[]; outputs={}
    def add(name,condition,detail=None):
        checks.append({'name':name,'passed':bool(condition),'detail':detail})
    queries=['took','went','written','color','center','US','us','record','look up','look it up','looked the word up','turned it off','cost an arm and a leg','on cloud nine','kick the bucket','a red car','run-in','run in','run out','read','prenuptial agreement','hurray','tell','tarsus','AA','Akihito','be dressed in … clothes','be dressed in ... clothes','male']
    for q in queries:
        r=dictionary.query(q);outputs[q]=r
        err=schema_errors(r,validator)+source_bindings(r,source)
        add('schema_source_'+q,not err,err)
    for q,word in [('took','take'),('went','go')]:
        r=outputs[q]
        groups=[g for e in r['entries'] if e['headword']==word for g in e['groups']]
        add('inflection_'+q,bool(groups) and all(g['part_of_speech']=='verb' for g in groups) and any(e['match']['type']=='inflection' for e in r['entries']),[g['part_of_speech'] for g in groups])
    add('written_preserves_write_and_adjective',any(e['headword']=='write' for e in outputs['written']['entries']) and any(e['headword']=='written' for e in outputs['written']['entries']))
    for q,word in [('color','colour'),('center','centre')]:
        add('spelling_variant_'+q,any(e['headword']==word and e['match']['type']=='spelling_variant' for e in outputs[q]['entries']))
    add('case_US',outputs['US']['status']=='partial' and all('United States' in (s['meaning']['en'] or '') for s in senses_of(outputs['US'])))
    add('case_us',outputs['us']['status']=='found' and not ({s['id'] for s in senses_of(outputs['US'])}&{s['id'] for s in senses_of(outputs['us'])}))
    lookup_full={s['id'] for s in senses_of(outputs['look up'])}
    for q in ['look it up','looked the word up']:
        r=outputs[q]; scoped={s['id'] for s in senses_of(r)}
        add('look_scope_'+q,len(scoped)==1 and scoped<lookup_full and all('information' in (s['meaning']['en'] or '') for s in senses_of(r)) and all(e['match']['sense_ids'] and e['match']['type']=='expression_pattern' for e in r['entries']),sorted(scoped))
    full_again=dictionary.query('look up')
    add('query_scope_isolation',{s['id'] for s in senses_of(full_again)}==lookup_full)
    add('other_separable_source_pattern',outputs['turned it off']['status'] in ['found','partial'] and all(e['match']['type']=='expression_pattern' and e['match']['sense_ids'] for e in outputs['turned it off']['entries']))
    r=outputs['cost an arm and a leg']
    add('note_expression_and_missing_example_translation',r['status']=='partial' and any(e['parent_headword']=='cost' and e['origin'] in ['construction','note'] for e in r['entries']) and any(ex['chinese'] is None for _,_,ex in examples_of(r)))
    add('expression_no_parent_audio',all(p['audio'] is None for e in r['entries'] for g in e['groups'] for p in g['pronunciations']))
    r=outputs['kick the bucket']
    add('no_example_is_not_failure',r['status']=='found' and not examples_of(r))
    # This is an empirical lookup check, never a hardcoded runtime exception.
    whole_source=source.execute("SELECT count(*) FROM reviewed_lookup WHERE query_text='a red car'").fetchone()[0]+source.execute("SELECT count(*) FROM reviewed_constructions WHERE pattern='a red car'").fetchone()[0]
    add('arbitrary_combination_no_target',whole_source==0 and outputs['a red car']['status']=='not_found',{'source_whole_expression_records':whole_source})
    hyphen={s['id'] for s in senses_of(outputs['run-in'])};plain={s['id'] for s in senses_of(outputs['run in'])}
    add('punctuation_identity',bool(hyphen) and bool(plain) and hyphen!=plain)
    add('run_out_professional_exclusion',all('cricket' not in (s['meaning']['en'] or '') for s in senses_of(outputs['run out'])) and any('use all' in (s['meaning']['en'] or '') for s in senses_of(outputs['run out'])))
    r=outputs['record']; groups=[g for e in r['entries'] for g in e['groups']]
    by_pos=collections.defaultdict(set)
    for g in groups:
        by_pos[g['part_of_speech']].update(p['ipa'] for p in g['pronunciations'] if p['ipa'])
    add('record_group_pronunciation',bool(by_pos['noun']) and bool(by_pos['verb']) and by_pos['noun']!=by_pos['verb'],{k:sorted(v) for k,v in by_pos.items()})
    for q,fragment in [('read','past'),('tell','past'),('tarsus','plural')]:
        labels=[p['form_label'] for e in outputs[q]['entries'] for g in e['groups'] for p in g['pronunciations'] if p['form_label']]
        add('inflected_pronunciation_label_'+q,any(fragment in x.lower() for x in labels),labels)
    for q in ['prenuptial agreement','hurray']:
        variants=[p for e in outputs[q]['entries'] for g in e['groups'] for p in g['pronunciations'] if p['form_label']]
        add('variant_pronunciation_label_'+q,bool(variants),variants)
    c=connect(package_root/'runtime.sqlite')
    expression_pronunciations=c.execute("SELECT count(*) FROM pronunciations p JOIN groups g ON g.id=p.group_id JOIN units u ON u.id=g.unit_id WHERE u.kind='expression'").fetchone()[0]
    add('no_expression_parent_audio_or_ipa',expression_pronunciations==0,{'lexunit_expression_pronunciations':expression_pronunciations,'rule':'Lexunit expressions have no independent source pronunciation owner; phrasal-verb headers retain their own source audio.'})
    c.close()
    for q,required in [('record','financial records'),('king','future king'),('man','通常由男性从事的')]:
        note_result=dictionary.query(q);outputs[q]=note_result
        serialized=json.dumps(note_result,ensure_ascii=False)
        add('source_note_body_'+q,required in serialized,required)
        if q=='record':
            add('note_whitespace_not_replaced_by_apostrophes','record information about something that is written down' in serialized and 'a set of written records' in serialized)
        if q=='king':
            add('note_context_edit_preserves_modal','someone who later be king' not in serialized and ('someone who will later be king' in serialized or 'someone who later will be king' in serialized))
    abbreviation=outputs['AA']
    required_expansions=[]
    for row in source.execute("SELECT s.full_forms_json FROM reviewed_senses s JOIN units u ON u.id=s.unit_id WHERE u.headword='AA'"):
        required_expansions+=json.loads(row[0] or '[]')
    serialized=json.dumps(abbreviation,ensure_ascii=False)
    add('abbreviation_full_form_complements',bool(required_expansions) and all(form in serialized for form in required_expansions),required_expansions)
    add('dated_reference_notice',any(n['code']=='dated_reference' for n in outputs['Akihito']['notices']),outputs['Akihito']['notices'])
    ellipsis=outputs['be dressed in … clothes'];dots=outputs['be dressed in ... clothes']
    add('source_unicode_ellipsis_equivalence',ellipsis['status'] in ['found','partial'] and dots['status'] in ['found','partial'] and ellipsis['default_entry_id']==dots['default_entry_id'],{'source_headwords':[e['headword'] for e in ellipsis['entries']]})
    related=[link for e in outputs['male']['entries'] for link in e['related_expressions']]
    link_results=[{'target_query':link['target_query'],'status':dictionary.query(link['target_query'])['status']} for link in related]
    add('related_link_queries_remove_source_fragments',bool(related) and all('#' not in row['target_query'] and row['status'] in ['found','partial'] for row in link_results),link_results)
    # Use original MDX group locators, because reviewed units intentionally deduplicate spelling/POS.
    runtime=connect(package_root/'runtime.sqlite')
    source_multi=runtime.execute("SELECT u.headword,u.pos,g.unit_id,g.record_index,count(DISTINCT g.locator) n FROM groups g JOIN units u ON u.id=g.unit_id WHERE u.kind='word' GROUP BY g.unit_id,g.record_index HAVING n>1 ORDER BY n DESC LIMIT 1").fetchone()
    if source_multi:
        q=source_multi['headword'];r=dictionary.query(q);outputs[q]=r
        groupids=[g['id'] for e in r['entries'] for g in e['groups'] if g['source_part_of_speech']==source_multi['pos']]
        add('multiple_same_pos_source_groups',len(set(groupids))>=source_multi['n'],{'query':q,'source_groups':source_multi['n'],'record_index':source_multi['record_index'],'returned_group_ids':groupids})
    else:
        add('multiple_same_pos_source_groups',False,'No source group fixture discovered')
    runtime.close()
    # Installation state checks use actual separate filesystem fixtures.
    from package_query import LocalDictionary
    with tempfile.TemporaryDirectory(prefix='longman-validation-') as temp:
        missing=LocalDictionary(Path(temp)/'missing').query('record')
        add('missing_package_unavailable',missing['status']=='unavailable' and not missing['entries'])
        broken=Path(temp)/'broken';broken.mkdir();(broken/'runtime.sqlite').write_bytes(b'not a sqlite database')
        (broken/'manifest.json').write_text('{}')
        corrupted=LocalDictionary(broken).query('record')
        add('corrupt_package_unavailable',corrupted['status']=='unavailable' and not corrupted['entries'])
    if audio_root:
        from package_query import LocalDictionary
        no_audio_dict=LocalDictionary(package_root,verify=False)
        yes_audio_dict=LocalDictionary(package_root,audio_root=audio_root,verify=False)
        no_audio=no_audio_dict.query('record')
        yes_audio=yes_audio_dict.query('record')
        no_audio_dict.close();yes_audio_dict.close()
        add('optional_audio_absent',all(p['audio'] is None for e in no_audio['entries'] for g in e['groups'] for p in g['pronunciations']))
        refs=[p['audio'] for e in yes_audio['entries'] for g in e['groups'] for p in g['pronunciations'] if p['audio']]
        add('optional_audio_installed',bool(refs),refs)
    return checks,outputs


def inventory_audit(package_root,audio_root=None):
    from package_query import LocalDictionary,safe_path
    checks=[];counts={}
    for label,root in [('text',package_root),('audio',audio_root)]:
        if root is None:continue
        manifest=json.loads((root/'manifest.json').read_text())
        inventory=LocalDictionary._file_entries(manifest)
        failures=[];size=0;parents={};root_resolved=root.resolve()
        for item in inventory:
            try:
                relative=Path(item['path'])
                if relative.is_absolute() or '..' in relative.parts:raise ValueError('unsafe package resource path')
                path=root_resolved/relative
                if path.parent not in parents:parents[path.parent]=path.parent.resolve().is_relative_to(root_resolved)
                if not parents[path.parent] or (path.is_symlink() and not path.resolve().is_relative_to(root_resolved)):raise ValueError('resource escapes package root')
                if not path.is_file():failures.append({'path':item['path'],'error':'missing'});continue
                size+=path.stat().st_size
                if item.get('sha256') and digest(path)!=item['sha256']:failures.append({'path':item['path'],'error':'checksum'})
                expected=item.get('bytes',item.get('size'))
                if expected is not None and path.stat().st_size!=expected:failures.append({'path':item['path'],'error':'size'})
            except (ValueError,OSError) as exc:failures.append({'path':item.get('path'),'error':str(exc)})
        checks.append({'name':label+'_whole_manifest_inventory','passed':not failures,'detail':{'files':len(inventory),'bytes':size,'failures':failures[:10]}})
        counts[label]={'files':len(inventory),'bytes':size}
    if audio_root:
        c=connect(package_root/'runtime.sqlite')
        refs={r[0] for r in c.execute('SELECT audio_path FROM pronunciations WHERE audio_path IS NOT NULL')}
        am=json.loads((audio_root/'manifest.json').read_text());files={x['path'] for x in LocalDictionary._file_entries(am)}
        missing=sorted(refs-files)  # File existence, path safety and hashes were verified for the entire inventory above.
        known={x['path'] for x in am.get('issues',[]) if x.get('reason')=='missing_in_mdd'}
        unexpected=sorted(set(missing)-known)
        dictionary=LocalDictionary(package_root,audio_root=audio_root,verify=False)
        escaped=[path for path in missing if dictionary._audio(path) is not None]
        checks.append({'name':'all_pronunciation_resource_refs','passed':not unexpected and not escaped and set(missing)==known,'detail':{'distinct_source_refs':len(refs),'known_source_missing_count':len(known),'known_source_missing':sorted(known),'unexpected_missing':unexpected,'missing_emitted_as_audio':escaped,'rule':'Every installed inventory asset exists and passes SHA. The exact14 MDX paths absent MDD are documented source gaps, and each returns audio=null.'}})
        dictionary.close();c.close()
    return checks


def independent_audit(package_root):
    """Copy only the delivered text package and deny source DB/media/network access."""
    with tempfile.TemporaryDirectory(prefix='longman-independent-') as tmp:
        copied=Path(tmp)/'standalone-text'
        shutil.copytree(package_root,copied)
        script=r'''import json,sys,pathlib,urllib.parse
root=pathlib.Path(sys.argv[1]).resolve()
opened=[];dbs=[]
def audit(event,args):
    if event.startswith('socket.'):
        raise RuntimeError('offline audit blocked network event '+event)
    if event=='sqlite3.connect':
        target=str(args[0]);parsed=urllib.parse.urlparse(target)
        path=pathlib.Path(urllib.parse.unquote(parsed.path) if target.startswith('file:') else target).resolve()
        if not path.is_relative_to(root):raise RuntimeError('source/outside database denied '+target)
        dbs.append(str(path))
    if event=='open' and isinstance(args[0],(str,bytes)):
        name=str(args[0])
        if 'review-edition-v5-quick' in name or name.lower().endswith(('.mdx','.mdd')):
            raise RuntimeError('original source access denied '+name)
        opened.append(name)
sys.addaudithook(audit)
sys.path.insert(0,str(root))
from package_query import LocalDictionary
from package_semantics import validate_result
dictionary=LocalDictionary(root)
results=[]
for q in ['record','took','look it up','cost an arm and a leg','US','a red car']:
    result=dictionary.query(q)
    errors=validate_result(result,root)
    results.append({'query':q,'status':result['status'],'headwords':[e['headword'] for e in result['entries']],'errors':errors})
print(json.dumps({'results':results,'sqlite_databases':sorted(set(dbs)),'file_opens':len(opened),'network_policy':'all socket audit events blocked','source_policy':'all MDX/MDD and reviewed baseline opens blocked'},ensure_ascii=False))
'''
        proc=subprocess.run([sys.executable,'-I','-c',script,str(copied)],cwd=tmp,text=True,capture_output=True)
        if proc.returncode:
            return {'passed':False,'error':proc.stderr,'returncode':proc.returncode}
        evidence=json.loads(proc.stdout)
        expected=['found','found','found','partial','partial','not_found']
        evidence['passed']=([r['status'] for r in evidence['results']]==expected and all(not r['errors'] for r in evidence['results']) and len(evidence['sqlite_databases'])==1)
        evidence['command']='python3 -I <audit runner> <copied text package>; only copied package supplied to LocalDictionary'
        return evidence


_WORKER_DICTIONARY=None
_WORKER_VALIDATOR=None

def schema_worker_init(package_root,audio_root,schema):
    global _WORKER_DICTIONARY,_WORKER_VALIDATOR
    from jsonschema import Draft202012Validator,FormatChecker
    from package_query import LocalDictionary
    _WORKER_DICTIONARY=LocalDictionary(Path(package_root),audio_root=Path(audio_root) if audio_root else None,verify=False)
    _WORKER_VALIDATOR=Draft202012Validator(schema,format_checker=FormatChecker())
    if _WORKER_DICTIONARY.error:raise RuntimeError(_WORKER_DICTIONARY.error)


def schema_worker_chunk(queries):
    failures=[];senseids=set();audio_paths=set()
    for q in queries:
        result=_WORKER_DICTIONARY.query(q)
        errors=schema_errors(result,_WORKER_VALIDATOR)
        if result['status'] not in ['found','partial']:errors.append('canonical_query_did_not_return_content')
        senseids.update(raw_id(s['id']) for s in senses_of(result))
        audio_paths.update(p['audio']['location'] for e in result['entries'] for g in e['groups'] for p in g['pronunciations'] if p['audio'])
        if errors:failures.append({'query':q,'errors':errors[:5]})
    return {'count':len(queries),'failures':failures,'sense_ids':senseids,'audio_paths':audio_paths}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package',type=Path,required=True)
    parser.add_argument('--audio-package',type=Path)
    parser.add_argument('--baseline',type=Path,required=True,help='local reviewed baseline directory')
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--skip-full-schema',action='store_true')
    parser.add_argument('--note-overlay',type=Path)
    parser.add_argument('--schema-workers',type=int,default=4)
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    from jsonschema import Draft202012Validator,FormatChecker
    from package_query import LocalDictionary
    from package_semantics import validate_result
    validator=Draft202012Validator(json.loads(SCHEMA.read_text()),format_checker=FormatChecker())
    baseline=json.loads((args.baseline/'query-results-final.json').read_text())
    verdicts=[json.loads(line) for line in (args.baseline/'quick-query-verdicts.jsonl').read_text().splitlines() if line.strip()]
    assert len(baseline['results'])==len(verdicts)==100
    source=connect(args.baseline/'longman6-reviewed.sqlite')
    dictionary=LocalDictionary(args.package,audio_root=args.audio_package,verify=False)  # Whole inventory is verified once below.
    fixed,results=fixed_query_audit(dictionary,source,baseline,verdicts,validator)
    static=static_audit(args.package,source,args.note_overlay or args.package.parent/'note-bodies-v1.sqlite')
    static+=inventory_audit(args.package,args.audio_package)
    boundaries,boundary_outputs=boundary_audit(dictionary,source,validator,args.package,args.audio_package)
    # Runtime semantics run for every fixed result; relation audit above separately checks evidence.
    semantic_failures=[]
    for result in results:
        try:
            returned=validate_result(result,package_root=args.package,audio_root=args.audio_package,dictionary=dictionary)
            if returned:
                semantic_failures.append({'query':result['query']['text'],'errors':returned})
        except Exception as exc:
            semantic_failures.append({'query':result['query']['text'],'errors':[str(exc)]})
    static.append({'name':'fixed_result_runtime_semantics','passed':not semantic_failures,'detail':semantic_failures})
    print(json.dumps({'stage':'fixed_static_boundaries','fixed_passed':sum(x['passed'] for x in fixed),'fixed_total':len(fixed),'static_failed':[x['name'] for x in static if not x['passed']],'boundary_failed':[x['name'] for x in boundaries if not x['passed']]},ensure_ascii=False),flush=True)
    full_schema={'performed':False}
    if not args.skip_full_schema:
        # Every canonical headword exercises the entire runtime data, preserving full entries.
        c=connect(args.package/'runtime.sqlite')
        unit_queries={r[0] for r in c.execute('SELECT DISTINCT headword FROM units')}
        construction_queries={r[0] for r in c.execute("SELECT DISTINCT pattern FROM constructions WHERE parent_headword IS NOT NULL AND (json_array_length(gloss_en_json)>0 OR json_array_length(explanation_zh_json)>0)")}
        queries=sorted(unit_queries|construction_queries)
        failures=[];start=time.perf_counter();total_senses=set();emitted_audio=set();completed=0
        chunks=[queries[i:i+500] for i in range(0,len(queries),500)]
        workers=max(1,args.schema_workers)
        # Processes keep each adapter's current source head isolated; no shared query state.
        with concurrent.futures.ProcessPoolExecutor(max_workers=workers,mp_context=multiprocessing.get_context('spawn'),initializer=schema_worker_init,initargs=(str(args.package),str(args.audio_package) if args.audio_package else None,json.loads(SCHEMA.read_text()))) as pool:
            for item in pool.map(schema_worker_chunk,chunks):
                completed+=item['count'];failures+=item['failures'];total_senses.update(item['sense_ids']);emitted_audio.update(item['audio_paths'])
                if completed%2000==0 or completed==len(queries):
                    progress={'full_schema_completed':completed,'total':len(queries),'workers':workers,'failures':len(failures),'first_failures':failures[:20]}
                    (args.output/'full-schema-progress.json').write_text(json.dumps(progress,ensure_ascii=False,indent=2)+'\n')
                    print(json.dumps(progress,ensure_ascii=False),flush=True)
        missing_audio=[]
        if args.audio_package:
            am=json.loads((args.audio_package/'manifest.json').read_text())
            actual_assets={x['path'] for x in LocalDictionary._file_entries(am)}
            missing_audio=sorted(emitted_audio-actual_assets)
            if missing_audio:failures.append({'kind':'invalid_emitted_audio_path','paths':missing_audio})
        expected_senses={r[0] for r in c.execute('SELECT id FROM senses')}
        missing_senses=sorted(expected_senses-total_senses)
        if missing_senses:failures.append({'kind':'runtime_sense_coverage','count':len(missing_senses),'sample':missing_senses[:20]})
        full_schema={'workers':workers,'emitted_audio_paths_count':len(emitted_audio),'invalid_emitted_audio_paths':missing_audio,'expected_runtime_senses':len(expected_senses),'missing_runtime_senses':missing_senses,'performed':True,'queries':len(queries),'unit_headwords':len(unit_queries),'source_construction_patterns':len(construction_queries),'unique_senses':len(total_senses),'failures':failures,'elapsed_seconds':round(time.perf_counter()-start,3)}
    timing=sorted(x['elapsed_ms'] for x in fixed)
    independent=independent_audit(args.package)
    report={'independent_copy':independent,'scope':'Fixed100 source regression and whole-package automatic integrity; not a whole-book linguistic audit',
            'package_root':str(args.package.resolve()),'audio_root':str(args.audio_package.resolve()) if args.audio_package else None,
            'baseline_files':{n:{'sha256':digest(args.baseline/n),'bytes':(args.baseline/n).stat().st_size} for n in ['query-results-final.json','quick-query-verdicts.jsonl','100组实际查询结果.txt']},
            'fixed_100':{'total':len(fixed),'passed':sum(x['passed'] for x in fixed),'found':sum(x['status']=='found' for x in fixed),'partial':sum(x['status']=='partial' for x in fixed),'reviewed_examples_compared':sum(x['baseline_examples_checked'] for x in fixed),'queries':fixed},
            'static_checks':static,'boundary_checks':boundaries,'full_schema':full_schema,
            'latency':{'count':len(timing),'median_ms':statistics.median(timing),'p95_ms':timing[math.ceil(len(timing)*.95)-1],'environment':{'python':sys.version,'platform':platform.platform(),'processor':platform.processor()},'method':'One warm process, sequential fixed100 first queries, complete V1 serialization excluded; schema/source audit outside timed section.'}}
    report['passed']=all(x['passed'] for x in fixed+static+boundaries) and not full_schema.get('failures',[]) and independent['passed']
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output/'validation-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    (args.output/'fixed100-v1-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
    (args.output/'boundary-v1-results.json').write_text(json.dumps(boundary_outputs,ensure_ascii=False,indent=2)+'\n')
    readable=['朗文6离线包：固定100组真实查询复测','98/100为样本中文覆盖，不代表全书准确率。','']
    for row in fixed:
        readable.append(f"{row['index']:03}. {row['query']} — {row['status']} / {'通过' if row['passed'] else '未通过'}")
        readable.append(f"  词头：{', '.join(row['headwords'])}；基线意思{row['baseline_senses']}条，样例{row['baseline_examples_checked']}句；{'; '.join(row['schema_and_source_errors']) or '原意思/样例和来源对应保留'}")
    readable+=['','关键边界：']+[f"{x['name']}: {'通过' if x['passed'] else '未通过'} {x['detail'] or ''}" for x in boundaries]
    (args.output/'100组离线查询核查.txt').write_text('\n'.join(readable)+'\n')
    selected=['record','look it up','looked the word up','cost an arm and a leg','US','a red car']
    lines=['代表性V1输出（完整JSON见boundary-v1-results.json）','']
    for q in selected:
        r=boundary_outputs[q];lines.append(f'查询 {q} — {r["status"]}')
        for e in r['entries']:
            lines.append(f"  {e['headword']} [{e['kind']}/{e['origin']}] 匹配={e['match']['type']} 来源={e['source']['release']}")
            for g in e['groups']:
                lines.append(f"    {g['source_part_of_speech']} 音标="+', '.join(p['region']+':'+str(p['ipa']) for p in g['pronunciations']))
                for s in g['senses'][:2]:
                    lines.append(f"      {s['meaning']['zh'] or '仅英文'} | {s['meaning']['en'] or ''}")
                    for ex in s['examples'][:1]:lines.append(f"        {ex['english']} | {ex['chinese'] or '无原中文例译'}")
        lines.append('')
    (args.output/'代表性离线查询输出.txt').write_text('\n'.join(lines)+'\n')
    print(json.dumps({'passed':report['passed'],'fixed_passed':sum(x['passed'] for x in fixed),'static_passed':sum(x['passed'] for x in static),'static_total':len(static),'boundaries_passed':sum(x['passed'] for x in boundaries),'boundaries_total':len(boundaries),'full_schema_failures':len(full_schema.get('failures',[])),'output':str(args.output)},ensure_ascii=False))
    return 0 if report['passed'] else 1

if __name__=='__main__':
    raise SystemExit(main())
