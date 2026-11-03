"""Recover source-owned note prose omitted from legacy empty note arrays.

Build overlay only: never changes reviewed inputs. Chinese note text is taken
from the same exponent/collocate block as its explicit source label. Reviewed
example text remains in reviewed_note_examples and is not re-extracted here.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import difflib
import json
from pathlib import Path
import sqlite3

from lxml import html
from longman6 import NOTE_CLASSES, BLOCKED, classes, text_of, unique, digest
from mdict_source import MdictSource
from review_repairs import prepare


def build_overlay(reviewed, mdx_path, output):
    source = sqlite3.connect(Path(reviewed).resolve().as_uri() + "?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    wanted = {r['id']: dict(r) for r in source.execute("""SELECT n.*,b.original_text before_text FROM reviewed_notes n
        JOIN notes b ON b.id=n.id WHERE n.english_json='[]' AND n.chinese_json='[]'""")}
    records = defaultdict(set)
    for row in source.execute("""SELECT sn.note_id,o.record_index,o.record_key FROM reviewed_sense_notes sn
        JOIN occurrences o ON o.sense_id=sn.sense_id ORDER BY o.record_index"""):
        if row['note_id'] in wanted:
            records[(row['record_index'],row['record_key'])].add(row['note_id'])
    mdx = MdictSource(mdx_path)
    out = sqlite3.connect(output)
    out.execute("CREATE TABLE note_bodies(id TEXT PRIMARY KEY,english_json TEXT NOT NULL,chinese_json TEXT NOT NULL,record_index INTEGER,source_locator TEXT)")
    recovered = set(); changes = []; empty = []
    for (index, key), ids in records.items():
        if ids <= recovered:
            continue
        tree = html.fragment_fromstring(mdx.text(index), create_parent='div', parser=html.HTMLParser(no_network=True, recover=True))
        prepare(tree, key)
        for node in tree.iter():
            if not classes(node) & NOTE_CLASSES or any(classes(a) & BLOCKED for a in node.iterancestors()):
                continue
            heading = next((text_of(n) for n in node.iter() if classes(n) & {'heading','boxheading'}), '')
            english = unique(text_of(n, omit_classes={'example'}) for n in node.iter() if isinstance(n.tag,str) and n.tag.lower()=='explen')
            chinese = unique(text_of(n, omit_classes={'example'}) for n in node.iter() if isinstance(n.tag,str) and n.tag.lower()=='explcn')
            raw = text_of(node)
            note_id = digest([heading,english,chinese,raw])
            if note_id not in ids or note_id in recovered:
                continue
            blocks = [n for n in node.iter() if classes(n) & {'exponent','collocate'}]
            if not blocks:
                blocks = [node]
            before = wanted[note_id]['before_text']; after = wanted[note_id]['original_text']
            opcodes = difflib.SequenceMatcher(None,before,after,autojunk=False).get_opcodes()
            projections=[]
            def project(value):
                # Apply only changes whose offsets are inside this exact owned
                # source fragment. An edit to a removed example can never alter
                # an unrelated definition containing the same word.
                if not value or before==after or before.count(value)!=1:
                    return value
                start=before.index(value);end=start+len(value);edits=[]
                for op,a,b,c,d in opcodes:
                    if op=='equal' or not (start<=a and b<=end):
                        continue
                    if a==b and not start<a<end:
                        continue
                    edits.append((a-start,b-start,after[c:d]))
                result=value
                for a,b,new in reversed(edits):
                    result=result[:a]+new+result[b:]
                if result!=value:
                    projections.append({'before':value,'after':result})
                return result
            en_parts = []; zh_parts = []
            for block in blocks:
                en = text_of(block, omit_classes={'heading','boxheading','example','defcn','collocn','gramcn','hintcn'}, omit_tags={'explcn','expcn'})
                if en:
                    en_parts.append(project(en))
                label = next((text_of(n) for n in block.iter() if classes(n)&{'exp','collo','propform'} and not any('example' in classes(a) for a in n.iterancestors() if a is not block)), None)
                cn = unique(text_of(n) for n in block.iter() if (classes(n)&{'defcn','collocn','gramcn','hintcn'} or n.tag=='explcn') and not any('example' in classes(a) for a in n.iterancestors() if a is not block))
                if cn:
                    zh_parts.append(((label+' — ') if label else '')+'；'.join(project(x) for x in cn))
            # Carry source-reviewed prose corrections through this new body
            # extraction. Example-only edits remain in the adopted example view.
            if before != after:
                changes.append({'id':note_id,'projected_owned_fragments':projections,
                                'unprojected_edits':'Outside retained exact body fragments; adopted examples remain in reviewed_note_examples.'})
            en_parts=unique(en_parts);zh_parts=unique(zh_parts)
            if not en_parts and not zh_parts:
                empty.append(note_id)
            out.execute('INSERT INTO note_bodies VALUES(?,?,?,?,?)', (note_id,json.dumps(en_parts,ensure_ascii=False),json.dumps(zh_parts,ensure_ascii=False),index,tree.getroottree().getpath(node)))
            recovered.add(note_id)
    out.commit();out.close();mdx.close();source.close()
    report={'target_notes':len(wanted),'recovered_notes':len(recovered),'unmatched_notes':sorted(set(wanted)-recovered),
            'empty_body_notes':empty,'reviewed_prose_edits':changes,'rule':'same original note and exponent/collocate; no example extraction or generated translation'}
    Path(output).with_suffix('.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    if report['unmatched_notes']:
        raise ValueError(f"Unmapped note prose: {report['unmatched_notes']}")
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--reviewed',required=True);p.add_argument('--mdx',required=True);p.add_argument('--output',required=True)
    a=p.parse_args(); print(json.dumps(build_overlay(a.reviewed,a.mdx,a.output),ensure_ascii=False,indent=2))
