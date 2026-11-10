"""Semantic regressions for the distributable data contract; no network needed."""
import gzip
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('build_pack', ROOT / 'scripts/dictionary/build_pack.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


class ExampleProvenance(unittest.TestCase):
    def test_requires_positive_english_template(self):
        self.assertEqual(b.plain_example("#: {{ux|en|Look it up in the '''dictionary'''.}}"), ('Look it up in the dictionary.', 'ux'))
        self.assertEqual(b.plain_example('#: {{uxi|en|A [[bank|river bank]].}}'), ('A river bank.', 'uxi'))
        for bad in ['#: An unreferenced sentence.', '#* {{ux|en|A sentence.}}', '#: {{ux|fr|A sentence.}}', '#: {{ux|en|A sentence.|ref=book}}', '#: {{ux|en|A sentence.}}<ref>Book</ref>', '#: {{quote-book|en|passage=Sentence.}}', '#: {{ux|en|See https://example.org.}}', '#: {{ux|en|{{l|en|nested}}}}']:
            with self.subTest(bad=bad): self.assertIsNone(b.plain_example(bad))

    def test_relation_is_never_a_definition(self):
        for s in [{'glosses': ['Plural of child.']}, {'glosses': ['Alternative spelling of colour.']}, {'glosses': ['Inflection of run.'], 'form_of': [{'word': 'run'}]}, {'glosses': ['Initialism of United States.']}]:
            self.assertTrue(b.relation(s), s)
        self.assertFalse(b.relation({'glosses': ['A financial institution.']}))


class SourceRelationTargets(unittest.TestCase):
    def test_US_requires_positive_source_template_and_sense_link(self):
        evidence = {'United States': {'source_template': 'place', 'revision': 17, 'wikitext_line': 30}}
        sense = {'links': [['United States', 'United States#English'], ['country', 'country']]}
        target = {'word': 'the United States'}
        self.assertEqual(b.explicit_relation_targets('# {{place|en|@init of:United States|country|cont/North America}}.'), [('United States', 'place')])
        self.assertEqual([x[0] for x in b.target_candidates(sense, target, evidence)], ['the United States', 'United States'])
        self.assertEqual(b.target_candidates(sense, target, {}), [('the United States', None)])
        self.assertEqual(b.target_candidates({'links': []}, target, evidence), [('the United States', None)])
        # No generic article/preposition deletion and no unrelated topic link.
        self.assertEqual(b.target_candidates(sense, {'word': 'pay attention to'}, evidence), [('pay attention to', None)])
        self.assertEqual(b.explicit_relation_targets('#* {{init of|en|United States}}'), [])
        self.assertEqual(b.explicit_relation_targets('# {{init of|fr|United States}}'), [])

    def test_relation_pronunciations_never_carry_audio(self):
        v = {'sounds': [{'ipa': '/juː.ɛs/', 'audio': 'US.wav', 'ogg_url': 'https://example.org/US.ogg', 'tags': ['US']}], 'forms': [{'form': 'U.S.', 'tags': ['alternative']}]}
        self.assertEqual(b.textual_pronunciations(v), [{'notation': 'ipa', 'text': '/juː.ɛs/', 'labels': {'tags': ['US']}}])
        self.assertEqual(b.lexical_forms(v), [{'form': 'U.S.', 'labels': {'tags': ['alternative']}}])


class SqlRedirects(unittest.TestCase):
    def test_mysql_newlines_quotes_namespaces_interwiki_and_fragment(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp)
            with gzip.open(p / 'enwiktionary-20261001-page.sql.gz', 'wt') as f:
                f.write("INSERT INTO `page` VALUES\n(1,0,'get_along_with',0),\n(2,0,'foreign',0),\n(3,0,'fr_fragment',0),\n(4,1,'Talk',0),\n(5,0,'a\\'b',0);\n")
            with gzip.open(p / 'enwiktionary-20261001-redirect.sql.gz', 'wt') as f:
                f.write("INSERT INTO `redirect` VALUES\n(1,0,'get_along','',''),\n(2,0,'target','w',''),\n(3,0,'target','','French'),\n(4,0,'target','',''),\n(5,0,'a\\'b_target','','English');\n")
            self.assertEqual(b.mediawiki_redirects({'dump_date': '2026-10-01'}, p), [("a'b", "a'b target", 'English'), ('get along with', 'get along', '')])


class LookupGraph(unittest.TestCase):
    def setUp(self):
        self.c = sqlite3.connect(':memory:')
        self.c.executescript(b.SCHEMA)
        self.a = sqlite3.connect(':memory:')
        self.a.executescript('CREATE TABLE edges(surface,target,pos,kind,evidence);')
        for eid, word, pos, definition in [(1, 'us', 'pron', 'The speaker and others.'), (2, 'US', 'noun', 'The United States.'), (3, 'run', 'verb', 'To move quickly.'), (4, 'ran', 'noun', 'A rare noun homograph.'), (5, 'get along', 'verb', 'To be friendly.')]:
            self.c.execute('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?)', (eid, word, b.fold(word), pos, '', eid, eid, eid, b.page_url(word), 'a'*64, '{}'))
            self.c.execute('INSERT INTO senses VALUES(?,?,?,?,?,?,?,?,?,?)', (str(eid), eid, 0, definition, '[]', json.dumps([definition]), json.dumps([definition]), '{}', '[]', '/senses/0'))
        self.a.executemany('INSERT INTO edges VALUES(?,?,?,?,?)', [('ran', 'run', 'verb', 'form_of', '{}'), ('get along with', 'get along', '', 'mediawiki_redirect', '{}'), ('a', 'b', '', 'alt_of', '{}'), ('b', 'a', '', 'alt_of', '{}'), ('missing', 'nowhere', '', 'alt_of', '{}'), ('chain', 'get along with', '', 'alt_of', '{}')])
        import collections
        self.problems = b.resolve_aliases(self.c, self.a, collections.Counter())

    def tearDown(self):
        self.c.close(); self.a.close()

    def test_exact_case_precedes_folded_candidates(self):
        self.assertEqual([e['headword'] for e in b.lookup(self.c, 'us')['entries']], ['us'])
        self.assertEqual([e['headword'] for e in b.lookup(self.c, 'US')['entries']], ['US'])
        self.assertEqual(b.lookup(self.c, 'Us')['normalization'], 'casefold_candidates')

    def test_real_homograph_does_not_hide_verb_relation(self):
        entries = b.lookup(self.c, 'ran')['entries']
        self.assertEqual({(e['headword'], e['pos']) for e in entries}, {('ran', 'noun'), ('run', 'verb')})

    def test_cycle_dangling_and_preposition_guessing(self):
        for query in ['a', 'b', 'missing', 'pay attention to']:
            self.assertEqual(b.lookup(self.c, query)['entries'], [])
        self.assertGreater(self.problems['counts']['cycles'], 0)
        self.assertEqual(b.lookup(self.c, 'get along with')['entries'][0]['headword'], 'get along')
        self.assertEqual(len(b.lookup(self.c, 'chain')['entries'][0]['paths'][0]), 2)
        self.assertFalse(self.c.execute('PRAGMA foreign_key_check').fetchall())


class EndToEnd(unittest.TestCase):
    def test_streamed_source_to_substantive_package(self):
        import bz2
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp)
            xml = p / 'fixture.xml-part.bz2'
            xml.write_bytes(bz2.compress(b'''<mediawiki xmlns="urn:test"><page><title>bank</title><ns>0</ns><id>7</id><revision><id>17</id><text>==English==
===Noun===
# Financial institution.
#: {{ux|en|I went to the bank.}}
## A branch.
==French==
#: {{ux|en|Foreign section.}}
</text></revision></page></mediawiki>'''))
            source = {'name': xml.name, **b.hashes(xml)}
            lock = {'dump_date': '2026-10-01', 'wikimedia': [source], 'raw': {'name': 'raw.gz'}}
            for name in ['page', 'redirect']:
                with gzip.open(p / f'enwiktionary-20261001-{name}.sql.gz', 'wt') as f: f.write('-- empty fixture\n')
            v = {'word': 'bank', 'lang_code': 'en', 'pos': 'noun', 'sounds': [{'ipa': '/bæŋk/', 'audio': 'not-shipped.ogg'}], 'senses': [{'glosses': ['Financial institution.'], 'examples': [{'type': 'example', 'text': 'I went to the bank.'}, {'type': 'example', 'text': 'Unverified.'}, {'type': 'quotation', 'text': 'Cited quotation.'}]}, {'glosses': ['Financial institution.', 'A branch.']}, {'glosses': ['Plural of banks.'], 'form_of': [{'word': 'banks'}]}], 'forms': [{'form': 'banks', 'tags': ['plural']}]}
            with gzip.open(p / 'raw.gz', 'wt') as f:
                f.write(json.dumps(v) + '\n')
                f.write(json.dumps({'word': 'foreign', 'lang_code': 'fr', 'pos': 'noun', 'senses': [{'glosses': ['foreign']} ]}) + '\n')
            b.audit_xml(lock, p, p / 'stage.sqlite3')
            # Audit can resume without duplicating pages/examples.
            b.audit_xml(lock, p, p / 'stage.sqlite3')
            b.build(lock, p, p / 'stage.sqlite3', p / 'dictionary.sqlite3', p / 'audit.json')
            c = sqlite3.connect(p / 'dictionary.sqlite3')
            self.assertEqual(c.execute('SELECT count(*) FROM senses').fetchone()[0], 2)
            result = b.lookup(c, 'banks')['entries'][0]
            self.assertEqual(result['headword'], 'bank')
            self.assertEqual(result['senses'][0]['examples'][0]['text'], 'I went to the bank.')
            self.assertEqual(result['senses'][0]['examples'][0]['source_line'], 4)
            self.assertEqual(result['senses'][1]['ancestors'][0]['definition'], 'Financial institution.')
            self.assertEqual(c.execute('SELECT count(*) FROM examples').fetchone()[0], 1)
            self.assertFalse(c.execute('PRAGMA foreign_key_check').fetchall())
            self.assertEqual(c.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            c.close()

    def test_transitive_name_targets_and_relation_surface_metadata(self):
        import bz2
        import xml.etree.ElementTree as ET
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp)
            root = ET.Element('mediawiki', xmlns='urn:test')
            words = ['CC', 'CountryAlias', 'CountryCore']
            for n, word in enumerate(words, 1):
                page = ET.SubElement(root, 'page')
                for tag, value in [('title', word), ('ns', '0'), ('id', str(n))]: ET.SubElement(page, tag).text = value
                revision = ET.SubElement(page, 'revision'); ET.SubElement(revision, 'id').text = str(n + 20)
                ET.SubElement(revision, 'text').text = '==English==\n# A source line.\n#: {{ux|en|CC is an abbreviation.}}\n#: {{ux|en|The abbreviation is CC.}}\n'
            xml = p / 'fixture.xml-part.bz2'; xml.write_bytes(bz2.compress(ET.tostring(root)))
            lock = {'dump_date': '2026-10-01', 'wikimedia': [{'name': xml.name, **b.hashes(xml)}], 'raw': {'name': 'raw.gz'}}
            for name in ['page', 'redirect']:
                with gzip.open(p / f'enwiktionary-20261001-{name}.sql.gz', 'wt') as f: f.write('-- empty fixture\n')
            raw = [
                {'word': 'CC', 'lang_code': 'en', 'pos': 'name', 'sounds': [{'ipa': '/siːsiː/'}], 'forms': [{'form': 'C.C.', 'tags': ['alternative']}], 'senses': [{'glosses': ['Initialism of CountryAlias.'], 'alt_of': [{'word': 'CountryAlias'}], 'examples': [{'type': 'example', 'text': 'CC is an abbreviation.'}, {'type': 'example', 'text': 'The abbreviation is CC.'}]}]},
                {'word': 'CountryAlias', 'lang_code': 'en', 'pos': 'name', 'senses': [{'glosses': ['Alternative form of CountryCore.'], 'alt_of': [{'word': 'CountryCore'}]}]},
                {'word': 'CountryCore', 'lang_code': 'en', 'pos': 'name', 'senses': [{'glosses': ['A country.']}]},
                {'word': 'An excluded name', 'lang_code': 'en', 'pos': 'name', 'senses': [{'glosses': ['A name.'], 'examples': [{'type': 'quotation', 'text': 'CC is an abbreviation.'}]}]},
            ]
            with gzip.open(p / 'raw.gz', 'wt') as f:
                for v in raw: f.write(json.dumps(v) + '\n')
            b.audit_xml(lock, p, p / 'stage.sqlite3')
            b.build(lock, p, p / 'stage.sqlite3', p / 'dictionary.sqlite3', p / 'audit.json')
            c = sqlite3.connect(p / 'dictionary.sqlite3')
            result = b.lookup(c, 'CC')
            self.assertEqual([e['headword'] for e in result['entries']], ['CountryCore'])
            self.assertEqual(result['surface_records'][0]['pronunciations'][0]['text'], '/siːsiː/')
            self.assertEqual(result['surface_records'][0]['examples'][0]['text'], 'The abbreviation is CC.')
            self.assertEqual(b.lookup(c, 'C.C.')['entries'][0]['headword'], 'CountryCore')
            self.assertEqual(c.execute('SELECT count(*) FROM senses').fetchone()[0], 1)
            self.assertEqual(json.loads((p / 'audit.json').read_text())['counts']['excluded_cross_record_quotation_text'], 1)
            c.close()

if __name__ == '__main__': unittest.main()
