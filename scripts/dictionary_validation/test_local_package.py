#!/usr/bin/env python3
"""Meaningful package regressions; set LONGMAN_PACKAGE to an actual built text package."""
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import unittest

from package_query import LocalDictionary, safe_path
from package_semantics import validate_result

class PackageRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        package=os.environ.get('LONGMAN_PACKAGE')
        if not package:
            raise unittest.SkipTest('set LONGMAN_PACKAGE to an actual built text package')
        cls.root=Path(package)
        if not (cls.root/'runtime.sqlite').exists():
            raise unittest.SkipTest('build actual runtime package first; set LONGMAN_PACKAGE')
        cls.dictionary=LocalDictionary(cls.root)
        if cls.dictionary.error:
            raise AssertionError(cls.dictionary.error)

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls,'dictionary'):
            cls.dictionary.close()

    def test_original_query_and_sense_scope_are_independent(self):
        full1=self.dictionary.query('look up')
        scoped=self.dictionary.query('looked the word up',context='I looked the word up yesterday.')
        full2=self.dictionary.query('look up')
        ids=lambda r:{s['id'] for e in r['entries'] for g in e['groups'] for s in g['senses']}
        self.assertEqual(ids(full1),ids(full2))
        self.assertEqual(len(ids(scoped)),1)
        self.assertTrue(ids(scoped)<ids(full1))
        self.assertEqual(scoped['query']['text'],'looked the word up')
        self.assertEqual(scoped['query']['context'],'I looked the word up yesterday.')
        self.assertFalse(validate_result(scoped,self.root))
        unicode_result=self.dictionary.query('be dressed in … clothes')
        ascii_result=self.dictionary.query('be dressed in ... clothes')
        self.assertIn(unicode_result['status'],['found','partial'])
        self.assertEqual(unicode_result['default_entry_id'],ascii_result['default_entry_id'])

    def test_case_distinct_and_english_only_status(self):
        upper=self.dictionary.query('US');lower=self.dictionary.query('us')
        self.assertEqual(upper['status'],'partial')
        self.assertEqual(lower['status'],'found')
        self.assertNotEqual(upper['default_entry_id'],lower['default_entry_id'])
        self.assertTrue(upper['notices'])
        links=[link for e in self.dictionary.query('male')['entries'] for link in e['related_expressions']]
        self.assertTrue(links)
        for link in links:
            self.assertNotIn('#',link['target_query'])
            self.assertIn(self.dictionary.query(link['target_query'])['status'],['found','partial'])

    def test_semantics_reject_wrong_default_and_scope(self):
        original=self.dictionary.query('look it up')
        wrong_default=copy.deepcopy(original);wrong_default['default_entry_id']='longman:missing:entry:unknown'
        self.assertTrue(validate_result(wrong_default,self.root))
        wrong_scope=copy.deepcopy(original)
        wrong_scope['entries'][0]['match']['sense_ids']=['longman:missing:sense:unknown']
        self.assertTrue(validate_result(wrong_scope,self.root))

    def test_resource_path_cannot_escape_package(self):
        for value in ['../secrets.mp3','/tmp/secrets.mp3','audio/../../secrets.mp3']:
            with self.subTest(value=value):
                with self.assertRaises(ValueError):safe_path(self.root,value)

    def test_missing_and_corrupt_are_unavailable(self):
        with tempfile.TemporaryDirectory(prefix='longman-regression-') as tmp:
            fixture=LocalDictionary(Path(tmp)/'missing');missing=fixture.query('record');fixture.close()
            self.assertEqual(missing['status'],'unavailable')
            broken=Path(tmp)/'broken';broken.mkdir()
            (broken/'manifest.json').write_text(json.dumps({'schema_version':1,'data_release':'fixture','files':[{'path':'runtime.sqlite'}]}))
            (broken/'runtime.sqlite').write_bytes(b'corrupt sqlite bytes')
            fixture=LocalDictionary(broken);corrupt=fixture.query('record');fixture.close()
            self.assertEqual(corrupt['status'],'unavailable')
            self.assertFalse(corrupt['entries'])

    def test_tampered_db_fails_manifest_before_content(self):
        with tempfile.TemporaryDirectory(prefix='longman-tamper-') as tmp:
            root=Path(tmp)/'text';root.mkdir()
            manifest=json.loads((self.root/'manifest.json').read_text())
            # Restrict the fixture manifest to the actual copied database, preserving its digest.
            files=manifest['files']
            if isinstance(files,dict):
                manifest['files']={'runtime.sqlite':files['runtime.sqlite']}
            else:
                manifest['files']=[x for x in files if x['path']=='runtime.sqlite']
            shutil.copy2(self.root/'runtime.sqlite',root/'runtime.sqlite')
            (root/'manifest.json').write_text(json.dumps(manifest))
            with (root/'runtime.sqlite').open('r+b') as stream:
                stream.seek(-10,2);stream.write(b'TAMPERED!!')
            result=LocalDictionary(root).query('record')
            self.assertEqual(result['status'],'unavailable')
            self.assertFalse(result['entries'])
            self.assertIn('checksum',str(result['notices']))

    def test_audio_release_mismatch_preserves_text(self):
        with tempfile.TemporaryDirectory(prefix='longman-audio-mismatch-') as tmp:
            audio=Path(tmp)
            (audio/'manifest.json').write_text(json.dumps({'data_release':'deliberately-wrong-release','files':[]}))
            dictionary=LocalDictionary(self.root,audio_root=audio)
            try:
                result=dictionary.query('record')
                self.assertEqual(result['status'],'found')
                self.assertTrue(any(n['code']=='audio_package_unavailable' for n in result['notices']))
                self.assertTrue(all(p['audio'] is None for e in result['entries'] for g in e['groups'] for p in g['pronunciations']))
            finally:dictionary.close()

    def test_semantics_reject_cross_sense_translation(self):
        result=self.dictionary.query('affect')
        senses=[s for e in result['entries'] for g in e['groups'] for s in g['senses']]
        self.assertGreaterEqual(len(senses),2)
        senses[0]['meaning']['zh']=senses[1]['meaning']['zh']
        self.assertTrue(validate_result(result,self.root))

    def test_note_bodies_and_contextual_edits_survive(self):
        record=json.dumps(self.dictionary.query('record'),ensure_ascii=False)
        self.assertIn('record information about something that is written down',record)
        self.assertIn('a set of written records',record)
        self.assertIn('financial records',record)
        king=json.dumps(self.dictionary.query('king'),ensure_ascii=False)
        self.assertNotIn('someone who later be king',king)
        self.assertIn('someone who will later be king',king)
        male=json.dumps(self.dictionary.query('man'),ensure_ascii=False)
        self.assertIn('通常由男性从事的',male)

    def test_alias_cycles_cannot_recurse_or_substitute(self):
        # This bypasses checksum verification only inside a private corrupted fixture.
        with tempfile.TemporaryDirectory(prefix='longman-alias-cycle-') as tmp:
            root=Path(tmp)/'text';shutil.copytree(self.root,root)
            c=sqlite3.connect(root/'runtime.sqlite')
            names={r[1] for r in c.execute('pragma table_info(aliases)')}
            self.assertTrue({'source_key','target_record'}<=names)
            # Resolved aliases deliberately contain no recursive resolution path.
            c.execute("INSERT INTO source_records(record_index,record_key,record_type,redirect_target) VALUES(90000001,'fixture-cycle-a','redirect','fixture-cycle-b')")
            c.execute("INSERT INTO source_records(record_index,record_key,record_type,redirect_target) VALUES(90000002,'fixture-cycle-b','redirect','fixture-cycle-a')")
            row={k:None for k in names};row.update(source_key='fixture-cycle-a',lookup_key='fixture-cycle-a',target_record=90000002)
            c.execute('INSERT INTO aliases('+','.join(row)+') VALUES('+','.join('?' for _ in row)+')',list(row.values()))
            row.update(source_key='fixture-cycle-b',lookup_key='fixture-cycle-b',target_record=90000001)
            c.execute('INSERT INTO aliases('+','.join(row)+') VALUES('+','.join('?' for _ in row)+')',list(row.values()))
            c.commit();c.close()
            dictionary=LocalDictionary(root,verify=False)
            try:
                for q in ['fixture-cycle-a','fixture-cycle-b']:
                    result=dictionary.query(q)
                    self.assertEqual(result['status'],'not_found')
                    self.assertFalse(result['entries'])
            finally:dictionary.close()

if __name__=='__main__':
    unittest.main()
