"""Source-bound group/IPA/form extraction and optional headword audio package.

Build-time only. Requires lxml, readmdict; all inputs are opened read-only.
No parent audio is inherited by an embedded expression. Raw source IPA variant
abbreviations are preserved verbatim and labelled, never guessed/expanded.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path, PurePosixPath
import sqlite3
import subprocess
import time
from urllib.parse import unquote
import zipfile
from lxml import html
from longman6 import classes, text_of, compact, BLOCKED
from mdict_source import MdictSource

VERSION = 'longman-head-metadata-v1.0.1'
RELEASE = 'longman6-reviewed-v5-quick-local-v1'
FORM_CLASSES = {'pasttense','pastpart','ptandpp','t3perssing','pluralform','comp','superl','prespart'}
FORM_LABELS = {'pasttense':'past tense','pastpart':'past participle','ptandpp':'past tense and past participle','t3perssing':'third person singular','pluralform':'plural','comp':'comparative','superl':'superlative','prespart':'present participle'}

def js(value): return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()
def digest(value):return hashlib.sha256(js(value).encode()).hexdigest()
def ro(path):return sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True)
def relative_audio(href):
    p=unquote(href.removeprefix('sound://')).replace('\\','/').lstrip('/')
    parts=PurePosixPath(p).parts
    if not parts or parts[0]!='hwd' or '..' in parts or not p.lower().endswith('.mp3'):return None
    return p

def safe_core_signature(owner):
    # Source ordering/classes/content are retained; popup corpora, JS and media
    # paths do not identify a lexical group. Duplicate pages therefore collapse.
    h=hashlib.sha256()
    def walk(n):
        if not isinstance(n.tag,str) or classes(n)&BLOCKED or n.tag.lower() in {'script','style'}:return
        h.update(js([n.tag,sorted(classes(n)),n.text or '']).encode())
        for child in n:
            walk(child)
            h.update((child.tail or '').encode())
        h.update(b'/')
    walk(owner)
    return h.hexdigest()

def source_header(owner,state):
    if owner is None:return None
    return next((n for n in owner.iter() if 'entryhead' in classes(n) and state[n][1] is owner and not state[n][0]),None)

def pronunciation_context(node,header):
    inflection=next((a for a in node.iterancestors() if 'inflections' in classes(a)),None)
    if inflection is None and 'proncodes' in classes(node):
        previous=node.getprevious()
        if previous is not None and 'inflections' in classes(previous):
            candidates=[n for n in previous.iter() if classes(n)&FORM_CLASSES]
            if candidates:
                last=candidates[-1];fc=classes(last)&FORM_CLASSES
                form=text_of(last,omit_classes={'infllab','italic','neutral','proncodes'}).strip(' ,;()')
                return FORM_LABELS[sorted(fc)[0]]+': '+form
    if inflection is not None:
        previous=node.getprevious()
        while previous is not None:
            fc=classes(previous)&FORM_CLASSES
            if fc:
                form=text_of(previous,omit_classes={'infllab','italic','neutral','proncodes'}).strip(' ,;()')
                return (FORM_LABELS[sorted(fc)[0]]+': '+form) if form else text_of(previous)
            previous=previous.getprevious()
        return text_of(inflection)
    variant=next((a for a in node.iterancestors() if classes(a)&{'variant','brevariant','amevariant'}),None)
    if variant is None:
        previous=node.getprevious()
        if previous is not None and classes(previous)&{'variant','brevariant','amevariant'}:
            # A trailing alternative's codes may sit after the closing variant.
            # The first codes after an orthographic alias still apply to head.
            siblings=list(node.getparent())
            if any('proncodes' in classes(n) for n in siblings[:siblings.index(previous)]):variant=previous
    if variant is not None:
        forms=[]
        for candidate in variant.iter():
            if candidate is node:break
            if classes(candidate)&{'lexvar','orthvar'}:
                txt=text_of(candidate,omit_classes={'neutral','proncodes'}).strip(' ,;()')
                if txt:forms.append(txt)
        if not forms:forms=[text_of(variant,omit_classes={'neutral','linkword','proncodes','geo','registerlab'})]
        return 'source variant: '+' / '.join(forms)
    return None

def header_data(owner,header,state,kind):
    if header is None and owner is not None and 'runon' in classes(owner):header=owner
    if header is None:
        return {'source_headword':None,'pattern':None,'pos':None,'homnum':None,'labels':[]},[],[]
    nodes=[n for n in header.iter() if not state[n][0] and state[n][1] is owner]
    title=next((n for n in nodes if classes(n)&{'hwd','phrvbhwd','deriv'}),None)
    meta={'source_headword':text_of(title,omit_classes={'object'}) or None,'pattern':text_of(title) or None,'pos':next((text_of(n) for n in nodes if 'pos' in classes(n)),None),'homnum':next((text_of(n) for n in nodes if 'homnum' in classes(n)),None),'labels':[{'class':next(iter(classes(n)&{'gram','geo','registerlab','freq','level'})),'text':text_of(n)} for n in nodes if classes(n)&{'gram','geo','registerlab','freq','level'} and text_of(n) and not any(classes(a)&{'variant','brevariant','amevariant','inflections'} for a in n.iterancestors() if a is not header)]}
    # A lexunit expression is not its containing word. It receives no header
    # forms or pronunciation unless it has an independent lexical owner.
    if kind=='expression':return meta,[],[]
    forms=[]
    for n in nodes:
        c=classes(n)
        fc=c&FORM_CLASSES
        if fc:
            label=FORM_LABELS[sorted(fc)[0]]
            txt=text_of(n,omit_classes={'infllab','italic','neutral','proncodes'}).strip(' ,;()')
            if txt:forms.append((txt,label))
        elif c&{'lexvar','orthvar'}:
            txt=text_of(n,omit_classes={'proncodes'}).strip(' ,;()')
            if txt:
                container=next((a for a in n.iterancestors() if classes(a)&{'variant','brevariant','amevariant'}),None)
                qualifiers=[text_of(a) for a in container.iter() if classes(a)&{'geo','registerlab'}] if container is not None else []
                forms.append((txt,'source spelling variant'+('; '+'; '.join(qualifiers) if qualifiers else '')))
    # Explicit verb tables supply ordinary forms and their original labels.
    for n in header.iter():
        if 'verb_form' not in classes(n):continue
        ancestor_owner=next((a for a in n.iterancestors() if classes(a)&{'entry','phrvbentry','runon'} and not any(classes(b)&BLOCKED for b in a.iterancestors())),None)
        # Table is in a blocked popup entry nested inside this header; its lemma
        # is checked before use, rather than inheriting another popup's forms.
        table=next((a for a in n.iterancestors() if 'verbtable' in classes(a)),None)
        if table is None:continue
        lemma=next((text_of(a) for a in table.iter() if 'lemma' in classes(a)),None)
        if not lemma or lemma!=meta['source_headword']:continue
        txt=text_of(n)
        if txt:forms.append((txt,'verb form (source table)'))
    forms=list(dict.fromkeys(forms))
    pron=[]
    codes=[n for n in nodes if 'proncodes' in classes(n)]
    for code in codes:
        label=pronunciation_context(code,header)
        base=next((text_of(n) for n in code.iter() if 'pron' in classes(n)),None)
        american=next((text_of(n,omit_classes={'neutral'}) for n in code.iter() if 'amevarpron' in classes(n)),None)
        if base:pron.append({'region':'uk','ipa':base,'audio_path':None,'form_label':label,'_context':label})
        if american:
            variant_label=label
            if '-' in american:
                variant_label=((label+'; ') if label else '')+'source US variant of /'+(base or '')+'/'
            pron.append({'region':'us','ipa':american,'audio_path':None,'form_label':variant_label,'_context':label})
    # Audio inside the matching own header only, and only /hwd/ resources.
    for n in nodes:
        href=n.get('href','')
        if not href.startswith('sound://'):continue
        path=relative_audio(href)
        if path is None:continue
        region='uk' if '/bre/' in path else 'us' if '/ame/' in path else 'unspecified'
        label=pronunciation_context(n,header)
        candidates=[p for p in pron if p['region']==region and p.get('_context')==label and p['audio_path'] is None]
        if candidates:candidates[0]['audio_path']=path
        else:pron.append({'region':region,'ipa':None,'audio_path':path,'form_label':label})
    return meta,pron,forms

def extract_metadata(reviewed_db,mdx_path,output_db):
    output_db=Path(output_db);output_db.parent.mkdir(parents=True,exist_ok=True)
    if output_db.exists():output_db.unlink()
    src=ro(reviewed_db);src.row_factory=sqlite3.Row
    occurrence=defaultdict(list)
    for row in src.execute('select o.sense_id,o.record_index,o.record_key,o.source_json,s.unit_id,u.kind,u.headword from occurrences o join senses s on s.id=o.sense_id join units u on u.id=s.unit_id order by o.record_index,o.sense_id'):
        occurrence[row['record_index']].append(dict(row))
    out=sqlite3.connect(output_db)
    out.executescript('''
    CREATE TABLE groups(id TEXT PRIMARY KEY,unit_id TEXT NOT NULL,record_index INTEGER NOT NULL,record_key TEXT NOT NULL,locator TEXT NOT NULL,parent_headword TEXT,header_json TEXT NOT NULL);
    CREATE TABLE group_map(sense_id TEXT NOT NULL,group_id TEXT NOT NULL REFERENCES groups(id),record_index INTEGER NOT NULL,group_locator TEXT NOT NULL,definition_xpath TEXT NOT NULL,PRIMARY KEY(sense_id,group_id));
    CREATE TABLE pronunciations(group_id TEXT NOT NULL REFERENCES groups(id),region TEXT NOT NULL,ipa TEXT,audio_path TEXT,form_label TEXT);
    CREATE TABLE forms(group_id TEXT NOT NULL REFERENCES groups(id),text TEXT NOT NULL,label TEXT);
    CREATE TABLE source_inline_hints(sense_id TEXT NOT NULL,text_en TEXT,text_zh TEXT,source_locator TEXT NOT NULL,PRIMARY KEY(sense_id,source_locator));
    CREATE INDEX group_map_sense ON group_map(sense_id);
    CREATE INDEX groups_unit ON groups(unit_id);
    CREATE INDEX pronunciation_group ON pronunciations(group_id);
    CREATE INDEX forms_group ON forms(group_id);
    ''')
    mdx=MdictSource(mdx_path);stats=Counter();issues=[];existing=set()
    for nth,(index,rows) in enumerate(sorted(occurrence.items())):
        markup=mdx.text(index)
        tree=html.fragment_fromstring(markup,create_parent='div',parser=html.HTMLParser(no_network=True,recover=True));root=tree.getroottree()
        state={}
        for n in tree.iter():
            if not isinstance(n.tag,str):continue
            blocked,owner=state.get(n.getparent(),(False,None))
            blocked=blocked or bool(classes(n)&BLOCKED) or n.tag.lower() in {'script','style'}
            if classes(n)&{'entry','phrvbentry','runon'}:owner=n
            state[n]=(blocked,owner)
        path_cache={};owner_cache={}
        for row in rows:
            source=json.loads(row['source_json']);xpath=source.get('definition_xpath') or source.get('scope_xpath') or '/div'
            if source.get('definition_xpath') is None:stats['restored_scope_xpath_fallback']+=1
            if xpath not in path_cache:
                nodes=root.xpath(xpath)
                node=nodes[0] if nodes else None
                path_cache[xpath]=node
            node=path_cache[xpath]
            if node is None:
                issues.append({'sense_id':row['sense_id'],'record_index':index,'reason':'definition_xpath_missing','xpath':xpath});continue
            owner=state[node][1]
            if owner is None:owner=tree
            if owner not in owner_cache:
                header=source_header(owner,state)
                owner_cache[owner]=(safe_core_signature(owner),header)
            signature,header=owner_cache[owner]
            group_id=digest([row['unit_id'],signature])
            locator=root.getpath(owner)
            if group_id not in existing:
                meta,pron,forms=header_data(owner,header,state,row['kind']);meta['unit_headword']=row['headword'];meta['kind']=row['kind'];meta['source_group_digest']=signature
                out.execute('insert into groups values(?,?,?,?,?,?,?)',(group_id,row['unit_id'],index,row['record_key'],locator,meta['source_headword'],js(meta)))
                out.executemany('insert into pronunciations values(?,?,?,?,?)',[(group_id,p['region'],p['ipa'],p['audio_path'],p['form_label']) for p in pron])
                out.executemany('insert into forms values(?,?,?)',[(group_id,*f) for f in forms]);existing.add(group_id)
                stats['groups']+=1;stats['pronunciations']+=len(pron);stats['forms']+=len(forms)
                if row['kind']=='expression':stats['expression_groups_without_inherited_audio']+=1
            # Keep deterministic first source occurrence; duplicate pages map to
            # the same content-based group. Definition path keeps source order.
            out.execute('insert or ignore into group_map values(?,?,?,?,?)',(row['sense_id'],group_id,index,locator,xpath))
            stats['source_occurrences_mapped']+=1
            scope_path=source.get('scope_xpath')
            scope_nodes=root.xpath(scope_path) if scope_path else []
            if scope_nodes:
                scope=scope_nodes[0]
                for hint in scope.iter():
                    if 'hint' not in classes(hint) or state.get(hint,(True,None))[0]:continue
                    nearest=next((a for a in hint.iterancestors() if classes(a)&{'sense','subsense'}),None)
                    if nearest is not scope:continue
                    zh_nodes=[a for a in hint.iter() if classes(a)&{'hintcn','defcn'} or a.tag in {'explcn','expcn'}]
                    zh=' '.join(text_of(a) for a in zh_nodes) or None
                    en=text_of(hint,omit_classes={'warning','hintcn','defcn'},omit_tags={'explcn','expcn'}) or None
                    if en or zh:out.execute('insert or ignore into source_inline_hints values(?,?,?,?)',(row['sense_id'],en,zh,root.getpath(hint)))
        stats['records_read']+=1
        if nth%5000==0:out.commit();print(js({'stage':'metadata','records':nth,'groups':stats['groups']}),flush=True)
    for name in ['groups','group_map','pronunciations','forms','source_inline_hints']:stats[name]=out.execute('select count(*) from '+name).fetchone()[0]
    stats['unmapped_occurrences']=len(issues)
    stats['senses_without_mapping']=src.execute('select count(*) from senses').fetchone()[0]-out.execute('select count(distinct sense_id) from group_map').fetchone()[0]
    out.commit();out.execute('vacuum');out.close();mdx.close();src.close()
    result={'version':VERSION,'stats':dict(stats),'issues':issues,'metadata_sha256':sha(output_db)}
    output_db.with_suffix('.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    return result

def export_audio(metadata_db,mdd_path,audio_root,release=RELEASE):
    root=Path(audio_root);root.mkdir(parents=True,exist_ok=True)
    db=ro(metadata_db);paths=[r[0] for r in db.execute('select distinct audio_path from pronunciations where audio_path is not null order by audio_path')]
    mdd=MdictSource(mdd_path,media=True)
    index={key.replace('\\','/').lstrip('/'):i for i,(_,key) in enumerate(mdd.keys)}
    files=[];issues=[];stats=Counter()
    for nth,path in enumerate(paths):
        i=index.get(path)
        if i is None:issues.append({'path':path,'reason':'missing_in_mdd'});continue
        data=mdd.record(i)
        # Every resource must have ID3 or an MPEG frame sync; decode samples
        # separately. MdictSource checks containing blocks' checksums.
        if not (data.startswith(b'ID3') or (len(data)>1 and data[0]==255 and data[1]&224==224)):
            issues.append({'path':path,'reason':'invalid_mp3_header'});continue
        dest=root/path;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
        files.append({'path':path,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()});stats['audio_bytes']+=len(data)
        if nth%10000==0:print(js({'stage':'audio','exported':nth}),flush=True)
    stats.update({'requested_resources':len(paths),'exported_resources':len(files),'missing_or_invalid_resources':len(issues),'mdd_blocks_checked':len(mdd.validated_blocks)})
    manifest={'package_kind':'longman_headword_audio','schema_version':1,'release':release,'adapter_version':VERSION,'mdd':{'name':Path(mdd_path).name,'bytes':Path(mdd_path).stat().st_size,'sha256':sha(mdd_path)},'metadata_sha256':sha(metadata_db),'stats':dict(stats),'files':files,'issues':issues}
    (root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    zip_path=root.with_suffix('.zip')
    with zipfile.ZipFile(zip_path,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for p in sorted(root.rglob('*')):
            if p.is_file():
                info=zipfile.ZipInfo(str(p.relative_to(root)).replace('\\','/'),date_time=(2026,10,26,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o644<<16
                z.writestr(info,p.read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=6)
    summary={'manifest':str((root/'manifest.json').resolve()),'audio_root':str(root.resolve()),'archive':str(zip_path.resolve()),'archive_bytes':zip_path.stat().st_size,'archive_sha256':sha(zip_path),'installed_bytes':sum(p.stat().st_size for p in root.rglob('*') if p.is_file()),'stats':dict(stats),'issues':issues}
    (root.parent/'audio-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));mdd.close();db.close();return summary

def main():
    p=argparse.ArgumentParser();p.add_argument('--reviewed-db',required=True);p.add_argument('--mdx',required=True);p.add_argument('--mdd');p.add_argument('--output',required=True);p.add_argument('--metadata-only',action='store_true');p.add_argument('--reuse-metadata',action='store_true');a=p.parse_args()
    root=Path(a.output);root.mkdir(parents=True,exist_ok=True);metadata=root/'metadata.sqlite'
    if not a.reuse_metadata:print(js(extract_metadata(a.reviewed_db,a.mdx,metadata)),flush=True)
    if a.mdd and not a.metadata_only:print(js(export_audio(metadata,a.mdd,root/'headword-audio')),flush=True)
if __name__=='__main__':main()
