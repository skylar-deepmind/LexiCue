"""Tier boundaries, compressed runtime semantics and installed-pack aggregation."""
import gzip
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
import zlib

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/dictionary'))
import build_pack as audit
import build_tiers as tiers

POLICY=json.loads((ROOT/'scripts/dictionary/tier-policy.json').read_text())


class TierSelection(unittest.TestCase):
    def setUp(self):
        self.select=tiers.Selection(POLICY,{'pneumonia':374,'monologue':327,'bank':570,'the':773,'rat':420,'flood':430,'all':620,'night':550,'man':590,'look':610,'up':690}, {'rat flood':[1,1,2010,0],'all-night-man':[0,0,0,1]})

    def test_familiar_medical_and_dramatic_words_are_general(self):
        self.assertEqual(self.select.sense('pneumonia','noun',{'topics':['medicine']})[0],'daily')
        self.assertEqual(self.select.sense('monologue','noun',{})[0],'daily')
        self.assertEqual(self.select.sense('soliloquy','noun',{})[0],'daily')

    def test_rare_and_narrow_senses_are_optional(self):
        self.assertEqual(self.select.sense('bank','noun',{'tags':['archaic']})[0],'extended')
        self.assertEqual(self.select.sense('bank','noun',{'topics':['category-theory']})[0],'specialist')
        self.assertEqual(self.select.sense('ichthyology','noun',{},definition='A branch of zoology that studies fish.')[0],'specialist')
        self.assertEqual(self.select.sense('monodrama','noun',{})[0],'extended')

    def test_familiar_alias_retains_expanded_definition_and_historical_label(self):
        self.assertEqual(self.select.sense('ribonucleic acid','noun',{'topics':['biochemistry']},familiar_alias=True)[0],'daily')
        self.assertEqual(self.select.sense('bank','noun',{'tags':['historical']})[0],'daily')
        self.assertEqual(self.select.sense('bank','noun',{'tags':['archaic']},familiar_alias=True)[0],'extended')

    def test_common_components_do_not_prove_phrase_familiarity(self):
        self.assertFalse(self.select.head('rat flood','noun')[0])
        self.assertFalse(self.select.head('all-night-man','noun')[0])
        self.assertTrue(self.select.head('look up','verb')[0])
        self.assertFalse(self.select.head('nonny','intj')[0])

    def test_braille_is_specialist_without_losing_ordinary_today(self):
        self.assertEqual(self.select.sense('⠞⠙','contraction',{'qualifier':'Braille'},promoted=True)[0],'specialist')
        self.assertEqual(self.select.sense('today','contraction',{'qualifier':'Braille'},promoted=True)[0],'specialist')

    def test_codec_rejects_trailing_and_oversized_payloads(self):
        self.assertEqual(tiers.decode(tiers.encode({'text':'pneumonia'})),{'text':'pneumonia'})
        for payload in [tiers.encode({'a':1})+b'extra',zlib.compress(b'x'*(tiers.MAX_BODY+1))]:
            with self.assertRaises(ValueError):tiers.decode(payload)


class RuntimePartition(unittest.TestCase):
    def test_fresh_tiers_preserve_content_and_aggregate_without_case_leaks(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp);c=sqlite3.connect(p/'audit.sqlite3');c.executescript(audit.SCHEMA)
            words=[('pneumonia','noun'),('monologue','noun'),('ichthyology','noun'),('call','verb'),('United States','name'),('us','pron')]
            for n,(word,pos) in enumerate(words,1):
                c.execute('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?)',(n,word,audit.fold(word),pos,'',n,100+n,200+n,audit.page_url(word),'a'*64,'{}'))
            rows=[(1,0,'An infection of the lungs.',[],{'topics':['medicine']}),(2,0,'A long speech by one performer.',[{'definition':'A dramatic speech.','raw_gloss':'(theatre) A dramatic speech.','depth':1}],{}),(2,1,'An old speech meaning.',[],{'tags':['archaic']}),(2,2,'A narrow theoretical object.',[],{'topics':['category-theory']}),(3,0,'A branch of zoology that studies fish.',[],{}),(4,0,'To name or summon.',[],{}),(5,0,'A country in North America.',[],{}),(6,0,'The speaker and others.',[],{})]
            for eid,ordinal,text,parents,labels in rows:
                chain=[x['definition'] for x in parents]+[text];raw=[x['raw_gloss'] for x in parents]+[text]
                c.execute('INSERT INTO senses VALUES(?,?,?,?,?,?,?,?,?,?)',(f's{eid}-{ordinal}',eid,ordinal,text,json.dumps(parents),json.dumps(chain),json.dumps(raw),json.dumps(labels),'[]',f'/records/{eid}/senses/{ordinal}'))
            for surface,target,kind,line in [('called',4,'headword_form',4),('monologues',2,'form_of',7),('US',5,'alt_of',8)]:
                path=[{'from':surface,'to':words[target-1][0],'pos':words[target-1][1],'kind':kind,'evidence':{'source_line':line,'labels':{'tags':['plural']} if surface=='monologues' else {}}}]
                c.execute('INSERT INTO aliases VALUES(?,?,?,?,?)',(surface,audit.fold(surface),target,kind,json.dumps(path)))
            c.execute('INSERT INTO pronunciations VALUES(?,?,?,?,?)',(1,0,'ipa','/nuːˈmoʊniə/','{}'))
            c.commit();c.close()
            with gzip.open(p/'frequency.gz','wt') as f:json.dump({'pneumonia':374,'monologue':327,'call':550,'us':610},f)
            with gzip.open(p/'attestations.gz','wt') as f:json.dump({},f)
            policy=dict(POLICY,audit_sqlite_sha256=audit.hashes(p/'audit.sqlite3')['sha256'])
            policy['phrase_attestation']=dict(POLICY['phrase_attestation'],sha256=audit.hashes(p/'attestations.gz')['sha256'])
            audit.write_json(p/'policy.json',policy);audit.write_json(p/'frequency.lock.json',{'extraction':{'sha256':audit.hashes(p/'frequency.gz')['sha256']}})
            tiers.build(p/'audit.sqlite3',p/'frequency.gz',p/'out',p/'policy.json',p/'attestations.gz',p/'frequency.lock.json')
            cs=tiers.connect_packs([p/'out'/pack/'dictionary.sqlite3' for pack in tiers.PACK_IDS])
            self.assertEqual(tiers.lookup(cs[:1],'monologue')['entries'][0]['senses'][0]['ancestors'][0]['raw_gloss'],'(theatre) A dramatic speech.')
            self.assertEqual([s['ordinal'] for s in tiers.lookup(cs,'monologue')['entries'][0]['senses']],[0,1,2])
            self.assertEqual(tiers.lookup(cs,'monologue'),tiers.lookup(list(reversed(cs)),'monologue'))
            self.assertEqual(tiers.lookup(cs[:1],'ichthyology')['entries'],[])
            self.assertEqual(tiers.lookup(cs,'ichthyology')['entries'][0]['senses'][0]['pack'],'specialist')
            self.assertEqual(tiers.lookup(cs[:1],'called')['entries'][0]['headword'],'call')
            self.assertEqual(tiers.lookup(cs[:1],'US')['entries'][0]['headword'],'United States')
            self.assertEqual([e['headword'] for e in tiers.lookup(cs[:1],'us')['entries']],['us'])
            self.assertEqual(tiers.lookup(cs,'Us')['normalization'],'casefold_candidates')
            self.assertEqual(tiers.lookup(cs,'pay attention to')['entries'],[])
            for conn in cs:self.assertEqual(conn.execute('PRAGMA integrity_check').fetchone()[0],'ok');conn.close()
            # Exercise the complete packaging path (including toolchain info),
            # manifest membership/hashes and separate default-bundle flags.
            from validate_tiers import package,verify_archives
            report={'all_checks_passed':True,'packs':{pack:{'database':audit.hashes(p/'out'/pack/'dictionary.sqlite3')} for pack in tiers.PACK_IDS}}
            audit.write_json(p/'out/tier-quality-report.json',report);audit.write_json(p/'out/daily-samples.json',{})
            catalog=package(p/'out',p/'policy.json');verify_archives(p/'out')
            self.assertEqual([x['id'] for x in catalog['packs'] if x['bundled_by_default']],['daily'])
            self.assertTrue(all(x['download_url'] is None for x in catalog['packs']))


if __name__=='__main__':unittest.main()
