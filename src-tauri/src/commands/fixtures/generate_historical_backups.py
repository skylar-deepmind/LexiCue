"""Regenerate synthetic historical fixtures from immutable Git source revisions.

This extracts the producer's SQL table definitions and migration columns, then
exports controlled rows using exactly that revision's BackupData field list.
It does not run the old application, use user data, or claim schema 1..3 were
produced by a historical build. See README.md for the evidence boundary.
"""
import subprocess,sqlite3,re,json,pathlib,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[4]
OUT=pathlib.Path(__file__).resolve().parent
VERSIONS=[(4,'eb772ddf'),(5,'1daad927'),(6,'c2288b0b'),(7,'1307035e'),(8,'fc47ce5a590ca5453c0c73dc7f2b5834cfa3ab7c'),(9,'2e0c8ddd')]
def source(commit,path): return subprocess.check_output(['git','show',f'{commit}:{path}'],cwd=ROOT,text=True)
def literal(s): return s.replace('\\"','"').replace('\\n','\n')
def ddl(commit):
    s=source(commit,'src-tauri/src/db.rs')
    t=s[s.index('fn create_tables('):]
    core=literal(re.search(r'conn.execute_batch\(\s*"((?:[^"\\]|\\.)*)"',t,re.S)[1])
    c=sqlite3.connect(':memory:');c.row_factory=sqlite3.Row;c.executescript(core)
    # The tag's final migrated columns, taken directly from its source tuples.
    for table,col,definition in re.findall(r'\("(\w+)",\s*"(\w+)",\s*"([^"]+)"\)',s):
        cols={r[1] for r in c.execute(f'pragma table_info({table})')}
        if cols and col not in cols: c.execute(f'ALTER TABLE {table} ADD COLUMN {col} {definition}')
    for statement in re.findall(r'conn.execute\(\s*"(ALTER TABLE [^"]+)"',t,re.S):
        try:c.execute(statement)
        except sqlite3.OperationalError as e:
            if 'duplicate column' not in str(e):raise
    if 'tags' in source(commit,'src-tauri/src/commands/export.rs'):
        tags=source(commit,'src-tauri/src/commands/tags.rs')
        c.executescript(literal(re.search(r'pub fn create_tables.*?conn.execute_batch\(\s*"((?:[^"\\]|\\.)*)"',tags,re.S)[1]))
    if 'saved_records' in source(commit,'src-tauri/src/commands/export.rs'):
        saved=source(commit,'src-tauri/src/commands/saved.rs')
        c.executescript(literal(re.search(r'pub fn create_tables.*?conn.execute_batch\(\s*"((?:[^"\\]|\\.)*)"',saved,re.S)[1]))
        for name, in c.execute("select name from sqlite_master where type='trigger'").fetchall():c.execute('drop trigger '+name)
        c.executescript(re.search(r'CREATE TABLE IF NOT EXISTS sync_conflicts \([\s\S]*?\) STRICT;',s)[0])
    return c

def insert(c,table,row):
    cols={r[1] for r in c.execute(f'pragma table_info({table})')}
    if not cols:return
    keys=[k for k in row if k in cols]
    c.execute(f'insert into {table} ({",".join(keys)}) values ({",".join("?" for _ in keys)})',[row[k] for k in keys])

def seed(c):
    insert(c,'folders',dict(id=1,name='Legacy folder',created_at=101))
    for n,lang,text,word in [(1,'en','Hello world. We take off.','Hello'),(2,'ja','昔の記録です。','昔'),(3,'de','Ein altes Wort.','Wort')]:
        insert(c,'files',dict(id=n,name=f'legacy-{lang}.txt',type='txt',content=text,content_hash=f'legacy-{lang}-hash',imported_at=100+n,language=lang,folder_id=1))
        insert(c,'segments',dict(id=n,file_id=n,index_num=0,en_text=text,zh_text=f'保留原句-{lang}'))
        insert(c,'words',dict(id=n,language=lang,lemma=word,status='learning',definition=f'保留个人备注-{lang}',reading='old-reading',part_of_speech='noun'))
        insert(c,'occurrences',dict(id=n,word_id=n,segment_id=n,original_form=word,position=0,hidden=1 if lang=='de' else 0,meaning_zh=f'保留语境-{lang}',meaning_edited=1))
        insert(c,'reviews',dict(word_id=n,due_at=500+n,stability=2.5,difficulty=3.5,reps=2))
        insert(c,'review_logs',dict(id=n,word_id=n,rating=3,reviewed_at=200+n,due_at_after=500+n))
    insert(c,'phrases',dict(id=1,language='en',text='take off',status='learning',definition='旧短语备注',source='manual'))
    insert(c,'phrase_occurrences',dict(id=1,phrase_id=1,segment_id=1,position=3,surface_text='take off',token_positions_json='[3,4]',meaning_zh='起飞',meaning_edited=1))
    insert(c,'phrase_reviews',dict(phrase_id=1,due_at=600,stability=3.5))
    insert(c,'phrase_review_logs',dict(id=1,phrase_id=1,rating=4,reviewed_at=300,due_at_after=600))
    insert(c,'phrase_dictionary_entries',dict(language='en',text='take off',translation='起飞',provider='historical-model',updated_at=250,other_senses_json='[{"meaning_zh":"脱下"}]',other_senses_edited=1))
    insert(c,'dictionary_entries',dict(language='ja',lemma='昔',provider='historical-cache',definitions_json='[{"definition":"过去"}]',fetched_at=150))
    insert(c,'dictionary_sources',dict(language='ja',provider='historical-cache',version='fixture',imported_at=150))
    insert(c,'file_phrase_analysis',dict(file_id=1,model='historical-model',completed_at=250))
    insert(c,'word_aliases',dict(word_id=1,alias='hello',alias_kind='surface'))
    insert(c,'tags',dict(id=1,name='Historical tag',name_key='historical tag',created_at=90))
    insert(c,'file_tags',dict(id=1,file_id=1,tag_id=1))
    insert(c,'legacy_tag_folders',dict(folder_id=1,tag_id=1))
    for n in (1,2,3):insert(c,'file_tag_state',dict(file_id=n))
    if c.execute("select 1 from sqlite_master where name='saved_records'").fetchone():
        dump=lambda obj:json.dumps(obj,ensure_ascii=False,separators=(',',':'))
        for n,expression,start,end in [(1,'Hello',0,5),(2,'take off',16,24)]:
            key=dump(['legacy-en-hash',0,start])
            record_id='saved-'+hashlib.sha256(dump([expression.lower(),key]).encode()).hexdigest()
            record=dict(record_id=record_id,expression=expression,normalized_expression=expression.lower(),source_key=key,sentence='Hello world. We take off.',sentence_translation='保留原句-en',source=dict(content_hash='legacy-en-hash',file_name='legacy-en.txt',segment_index=0,start_offset=start,end_offset=end,start_time=None,end_time=None),explanation='旧保存备注-'+expression,explanation_source='personal',origin='reader',legacy=None,saved_at=400,updated_at=401,revision='old-active-'+str(n),generation=0,deleted_at=None)
            before=dump(record)
            if n==2:record.update(deleted_at=402,updated_at=402,revision='old-deleted-2')
            insert(c,'saved_records',dict(id=n,record_id=record_id,normalized_expression=expression.lower(),source_key=key,snapshot_json=dump(record),saved_at=400,updated_at=record['updated_at'],revision=record['revision'],generation=0,deleted_at=record['deleted_at']))
            if n==2:
                request=dict(kind='remove',record_id=record_id,expected_revision='old-active-2')
                insert(c,'saved_actions',dict(operation_id='old-remove',request_json=dump(request),record_id=record_id,before_json=before,after_revision=record['revision'],changed=1,undone=0))
        insert(c,'product_migrations',dict(migration_key='saved-context-v1',completed_at=350,report_json=dump(dict(eligible_words=1,eligible_phrases=1,saved_contexts=2,missing_sources=0,history_only=[dict(kind='word',legacy_id=2,reason='non_english'),dict(kind='word',legacy_id=3,reason='non_english')]))))
    c.commit()

fixtures=[]
for version,rev in VERSIONS:
    commit=subprocess.check_output(['git','rev-parse',rev],cwd=ROOT,text=True).strip()
    c=ddl(commit)
    if version==8:
        sql='-- v0.4.5 '+commit+'\n-- Table DDL extracted from db.rs/tags.rs, including its column migrations.\n-- Synthetic data; no user database. Sync triggers/state intentionally absent.\n'
        sql+='\n\n'.join(r[0]+';' for r in c.execute("select sql from sqlite_master where type='table' and name != 'sqlite_sequence' order by name"))+'\n'
        (OUT/'v0_4_5_schema.sql').write_text(sql)
    seed(c)
    export=source(commit,'src-tauri/src/commands/export.rs')
    data=export[export.index('pub struct BackupData'):export.index('\nfn query_all')]
    fields=re.findall(r'pub (\w+):',data)
    payload={'schema_version':version,'exported_at':1234,'app_version':'historical-synthetic-fixture','data':{name:[dict(r) for r in c.execute('select * from '+('sync_conflicts' if name=='saved_conflicts' else name))] for name in fields}}
    fixtures.append({'producer_commit':commit,'version':version,'backup':payload})
    print(version,commit,len(json.dumps(payload)))
(OUT/'historical_backups.json').write_text(json.dumps(fixtures,ensure_ascii=False,indent=2)+'\n')
