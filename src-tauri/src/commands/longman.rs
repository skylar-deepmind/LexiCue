//! Read the frozen, reviewed Longman package directly. No user-data lock or subprocess.
use regex::Regex;
use rusqlite::{params_from_iter, types::ValueRef, Connection, OpenFlags};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
#[path = "longman_relations.rs"]
mod relations;
pub use relations::RelationCatalog;
use std::time::Instant;
use tauri::Manager;
use unicode_normalization::UnicodeNormalization;

type R<T> = Result<T, String>;
fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
fn clean(text: &str) -> Option<String> {
    let t = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}
fn cv(v: &Value) -> Value {
    v.as_str()
        .and_then(clean)
        .map(Value::String)
        .unwrap_or(Value::Null)
}
fn arr(v: &Value) -> Vec<Value> {
    if let Some(a) = v.as_array() {
        a.clone()
    } else if let Some(t) = v.as_str() {
        serde_json::from_str(t).unwrap_or_default()
    } else {
        vec![]
    }
}
fn obj(v: &Value) -> Value {
    v.as_str()
        .and_then(|t| serde_json::from_str(t).ok())
        .unwrap_or_else(|| json!({}))
}
fn canonical(text: &str) -> String {
    if text.is_ascii() && !text.contains(['%', '&']) {
        return clean(text).unwrap_or_default();
    }
    let decoded = percent_encoding::percent_decode_str(text).decode_utf8_lossy();
    static ENTITIES: OnceLock<Regex> = OnceLock::new();
    let re = ENTITIES.get_or_init(|| {
        Regex::new(r"&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp|hellip);").unwrap()
    });
    let unescaped = re.replace_all(&decoded, |c: &regex::Captures| match &c[1] {
        "amp" => "&".into(),
        "lt" => "<".into(),
        "gt" => ">".into(),
        "quot" => "\"".into(),
        "apos" => "'".into(),
        "nbsp" => " ".into(),
        "hellip" => "…".into(),
        t => {
            let n = if t.starts_with("#x") {
                u32::from_str_radix(&t[2..], 16).ok()
            } else {
                t[1..].parse().ok()
            };
            n.and_then(char::from_u32)
                .map(|x| x.to_string())
                .unwrap_or_else(|| c[0].into())
        }
    });
    clean(&unescaped.nfkc().collect::<String>()).unwrap_or_default()
}
fn safe_path(root: &Path, relative: &str) -> R<PathBuf> {
    let p = Path::new(relative);
    if p.as_os_str().is_empty() || p.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("Unsafe dictionary resource path".into());
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let path = root.join(p).canonicalize().map_err(|e| e.to_string())?;
    if !path.starts_with(&root) {
        return Err("Dictionary resource escapes package".into());
    }
    Ok(path)
}
fn sha_file(path: &Path) -> R<String> {
    use std::io::Read;
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut b = [0u8; 1024 * 64];
    loop {
        let n = f.read(&mut b).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&b[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}
fn inventory(m: &Value) -> Vec<Value> {
    if let Some(o) = m["files"].as_object() {
        o.iter()
            .map(|(k, v)| {
                let mut x = if v.is_object() {
                    v.clone()
                } else {
                    json!({"sha256":v})
                };
                x["path"] = json!(k);
                x
            })
            .collect()
    } else {
        arr(&m["files"])
    }
}
fn empty(text: &str, context: Option<&str>, error: Option<&str>) -> Value {
    json!({"schema_version":1,"query":{"text":text,"language":"en","context":context.and_then(clean)},"status":if error.is_some(){"unavailable"}else{"not_found"},"default_entry_id":null,"entries":[],"notices":error.map(|e|vec![json!({"code":"package_unavailable","text":e,"entry_id":null})]).unwrap_or_default()})
}
/// Reading selections retain sentence capitalization. Only retry a failed title-case
/// selection; abbreviations and any source-supported exact spelling keep priority.
fn sentence_case_query(query: &str) -> Option<String> {
    let mut chars = query.chars();
    let first = chars.next()?;
    let tail = chars.collect::<String>();
    if !first.is_uppercase()
        || tail.chars().any(char::is_uppercase)
        || !tail.chars().any(char::is_lowercase)
    {
        return None;
    }
    Some(first.to_lowercase().collect::<String>() + &tail)
}
fn source_key(text: &str) -> Vec<(String, u64)> {
    Regex::new(r"(\d+|\D+)")
        .unwrap()
        .find_iter(text)
        .map(|m| {
            let t = m.as_str();
            if t.as_bytes()[0].is_ascii_digit() {
                (String::new(), t.parse().unwrap_or(0))
            } else {
                (t.into(), 0)
            }
        })
        .collect()
}
#[derive(Clone)]
struct Match {
    unit: String,
    kind: String,
    restricted: Vec<String>,
    group: Option<String>,
}
struct Package {
    conn: Connection,
    release: String,
    root: PathBuf,
    tables: HashSet<String>,
    initialization_ms: f64,
    relations: Arc<RelationCatalog>,
}
impl Package {
    fn open(root: &Path) -> R<Self> {
        let start = Instant::now();
        let root = root
            .canonicalize()
            .map_err(|e| format!("Longman package is not installed: {e}"))?;
        let m: Value = serde_json::from_slice(
            &std::fs::read(root.join("manifest.json")).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        if m["schema_version"] != 1 {
            return Err("Unsupported Longman runtime schema".into());
        }
        let release = s(&m, "data_release").to_string();
        if release.is_empty() {
            return Err("Longman package release is missing".into());
        }
        let database = m["runtime_database"]
            .as_str()
            .or(m["database"].as_str())
            .unwrap_or("runtime.sqlite");
        let db = safe_path(&root, database)?;
        let item = inventory(&m)
            .into_iter()
            .find(|v| s(v, "path") == database)
            .ok_or("Runtime database inventory is missing")?;
        let meta = std::fs::metadata(&db).map_err(|e| e.to_string())?;
        if item["bytes"].as_u64().is_some_and(|n| n != meta.len()) {
            return Err("Runtime database length mismatch".into());
        }
        if s(&item, "sha256").len() != 64 || sha_file(&db)? != s(&item, "sha256") {
            return Err("Runtime database checksum mismatch".into());
        }
        let conn = Connection::open_with_flags(
            db,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;")
            .map_err(|e| e.to_string())?;
        let tables: HashSet<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
            .map_err(|e| e.to_string())?
            .query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<_>>()
            .map_err(|e| e.to_string())?;
        for t in [
            "units",
            "senses",
            "lookup",
            "occurrences",
            "group_map",
            "groups",
            "examples",
            "notes",
            "note_examples",
            "sense_notes",
            "constructions",
            "sense_constructions",
            "sense_construction_examples",
            "construction_occurrences",
            "metadata",
        ] {
            if !tables.contains(t) {
                return Err(format!("Runtime table missing: {t}"));
            }
        }
        let db_release: String = conn
            .query_row(
                "SELECT value FROM metadata WHERE key='data_release'",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let db_schema: String = conn
            .query_row(
                "SELECT value FROM metadata WHERE key='schema_version'",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if db_release != release || db_schema != "1" {
            return Err("Runtime metadata does not match package release/schema".into());
        }
        let integrity: String = conn
            .query_row("PRAGMA quick_check", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if integrity != "ok" {
            return Err("Runtime database integrity failure".into());
        }
        let relations = Arc::new(RelationCatalog::build(
            &conn,
            &release,
            s(&item, "sha256"),
            tables.contains("forms"),
        )?);
        let mut p = Self {
            conn,
            release,
            root,
            tables,
            initialization_ms: 0.,
            relations,
        };
        p.initialization_ms = start.elapsed().as_secs_f64() * 1000.;
        Ok(p)
    }
    fn rows(&self, sql: &str, params: &[&str]) -> R<Vec<Value>> {
        let mut statement = self.conn.prepare_cached(sql).map_err(|e| e.to_string())?;
        let names = statement
            .column_names()
            .iter()
            .map(|x| x.to_string())
            .collect::<Vec<_>>();
        let rs = statement
            .query_map(params_from_iter(params), |row| {
                let mut map = Map::new();
                for (i, k) in names.iter().enumerate() {
                    let v = match row.get_ref(i)? {
                        ValueRef::Null => Value::Null,
                        ValueRef::Integer(i) => json!(i),
                        ValueRef::Real(f) => json!(f),
                        ValueRef::Text(t) => json!(String::from_utf8_lossy(t)),
                        ValueRef::Blob(_) => Value::Null,
                    };
                    map.insert(k.clone(), v);
                }
                Ok(Value::Object(map))
            })
            .map_err(|e| e.to_string())?;
        rs.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())
    }
    fn ident(&self, kind: &str, raw: &str, scope: Option<&str>) -> String {
        format!(
            "longman:{}:{kind}:{}{raw}",
            self.release,
            scope.map(|x| format!("{x}:")).unwrap_or_default()
        )
    }
    fn source(&self, key: &str, locator: &str) -> Value {
        json!({"provider":"longman","dataset":"LDOCE6EC","edition":"6","release":self.release,"adapter_version":"1.0.0","delivery":"local","entry_key":key,"locator":clean(locator),"entry_url":null,"retrieved_at":null})
    }
    fn match_type(&self, reason: &str, query: &str, headword: &str) -> R<String> {
        if [
            "sense_restricted_query_see_reviewed_query_senses",
            "reviewed_source_expression_pattern",
        ]
        .contains(&reason)
        {
            return Ok("expression_pattern".into());
        }
        if reason == "source_verified_reference_expansion" {
            let defs=self.rows("SELECT s.definition_en FROM senses s JOIN units u ON u.id=s.unit_id WHERE u.headword=?",&[query])?.iter().map(|r|s(r,"definition_en")).collect::<Vec<_>>().join(" ");
            if Regex::new(
                r"(?i)past (?:tense|participle)|participle of|plural of|comparative|superlative",
            )
            .unwrap()
            .is_match(&defs)
            {
                return Ok("inflection".into());
            }
            if Regex::new(r"(?i)(?:American|British|variant|spelling).*?of|spelling of")
                .unwrap()
                .is_match(&defs)
            {
                return Ok("spelling_variant".into());
            }
            return Ok("reference".into());
        }
        Ok(if query == headword
            || [
                "exact_source_headword",
                "source_record_article_form",
                "source_explicit_header_variant",
            ]
            .contains(&reason)
        {
            "exact"
        } else {
            "reference"
        }
        .into())
    }
    fn lookup(&self, query: &str) -> R<Vec<Match>> {
        if self.tables.contains("query_senses") {
            let rows=self.rows("SELECT q.*,s.unit_id FROM query_senses q JOIN senses s ON s.id=q.sense_id WHERE q.query_text=?",&[query])?;
            if !rows.is_empty() {
                let mut matches: Vec<Match> = vec![];
                for r in rows {
                    if let Some(m) = matches.iter_mut().find(|m| m.unit == s(&r, "unit_id")) {
                        m.restricted.push(s(&r, "sense_id").into())
                    } else {
                        matches.push(Match {
                            unit: s(&r, "unit_id").into(),
                            kind: "expression_pattern".into(),
                            restricted: vec![s(&r, "sense_id").into()],
                            group: None,
                        })
                    }
                }
                return Ok(matches);
            }
        }
        let rows=self.rows("SELECT l.*,u.headword FROM lookup l JOIN units u ON u.id=l.unit_id WHERE l.query_text=?",&[query])?;
        let mut found = rows
            .iter()
            .map(|r| {
                Ok(Match {
                    unit: s(r, "unit_id").into(),
                    kind: self.match_type(s(r, "reason"), query, s(r, "headword"))?,
                    restricted: vec![],
                    group: None,
                })
            })
            .collect::<R<Vec<_>>>()?;
        // An exact standalone entry never prevents expansion of evidenced forms.
        // All consumers use this same graph; a candidate is not a saved identity.
        for candidate in self.relations.matches(query) {
            if !found.iter().any(|m| m.unit == candidate.unit) {
                found.push(candidate);
            }
        }
        if self.tables.contains("forms") {
            for r in self.rows("SELECT DISTINCT g.unit_id,f.group_id,f.label FROM forms f JOIN groups g ON g.id=f.group_id WHERE f.text=?",&[query])? {
                if s(&r,"label").contains("variant") && !found.iter().any(|m| m.unit==s(&r,"unit_id")) {
                    found.push(Match {unit:s(&r,"unit_id").into(),kind:"spelling_variant".into(),restricted:vec![],group:Some(s(&r,"group_id").into())});
                }
            }
        }
        if found.is_empty()
            && self.tables.contains("aliases")
            && self.tables.contains("source_records")
        {
            for r in self.rows("SELECT DISTINCT l.unit_id FROM aliases a JOIN source_records sr ON sr.record_index=a.target_record JOIN lookup l ON l.query_text=sr.record_key WHERE a.source_key=?",&[query])? {
                found.push(Match {unit:s(&r,"unit_id").into(),kind:"reference".into(),restricted:vec![],group:None});
            }
        }
        if found.is_empty() {
            self.expression_matches(query)
        } else {
            Ok(found)
        }
    }
    fn expression_matches(&self, query: &str) -> R<Vec<Match>> {
        Ok(self.relations.expression_matches(query))
    }
    fn example(&self, row: &Value, scope: &str) -> Value {
        json!({"id":self.ident("example",s(row,"id"),Some(scope)),"english":cv(&row["english"]),"chinese":cv(&row["chinese"]),"audio":null})
    }
    fn note(&self, row: &Value, scope: &str) -> R<Value> {
        let en = arr(&row["english_json"]);
        let zh = arr(&row["chinese_json"]);
        let heading = clean(s(row, "heading"));
        let mut pieces: Vec<String> = heading.iter().cloned().collect();
        pieces.extend(en.iter().filter_map(Value::as_str).map(str::to_string));
        let mut en_text = clean(&pieces.join("\n"));
        if en.is_empty() && zh.is_empty() {
            en_text = clean(s(row, "original_text")).or(en_text)
        }
        let examples = self
            .rows(
                "SELECT * FROM note_examples WHERE note_id=? ORDER BY rowid",
                &[s(row, "id")],
            )?
            .iter()
            .filter(|r| clean(s(r, "english")).is_some())
            .map(|r| self.example(r, &format!("{scope}:note:{}", s(row, "id"))))
            .collect::<Vec<_>>();
        Ok(
            json!({"id":self.ident("note",s(row,"id"),Some(scope)),"kind":if heading.as_ref().is_some_and(|h|h.to_lowercase().contains("grammar")){"grammar"}else{"usage"},"content":{"en":en_text,"zh":clean(&zh.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("\n"))},"examples":examples}),
        )
    }
    fn labels(row: &Value) -> Vec<Value> {
        let mut out = vec![];
        for (field, kind) in [
            ("grammar_json", "grammar"),
            ("register_json", "register"),
            ("geography_json", "region"),
        ] {
            for value in arr(&row[field]) {
                if let Some(text) = value.as_str().and_then(clean) {
                    let x = json!({"kind":kind,"text":text});
                    if !out.contains(&x) {
                        out.push(x)
                    }
                }
            }
        }
        out
    }
    fn sense(&self, row: &Value, gid: &str, headword: &str) -> R<Value> {
        let sid = s(row, "id");
        let scope = format!("{gid}:{sid}");
        let mut patterns = vec![];
        for c in self.rows("SELECT c.* FROM constructions c JOIN sense_constructions sc ON sc.construction_id=c.id WHERE sc.sense_id=? ORDER BY c.rowid",&[sid])?{let cid=s(&c,"id");let en=clean(&arr(&c["gloss_en_json"]).iter().filter_map(Value::as_str).collect::<Vec<_>>().join("; "));let zh=clean(&arr(&c["explanation_zh_json"]).iter().filter_map(Value::as_str).collect::<Vec<_>>().join("；"));let examples=self.rows("SELECT * FROM sense_construction_examples WHERE sense_id=? AND construction_id=? ORDER BY rowid",&[sid,cid])?.iter().filter(|r|clean(s(r,"english")).is_some()).map(|r|self.example(r,&format!("{scope}:pattern:{cid}"))).collect::<Vec<_>>();let mut labels=vec![];for m in arr(&row["scoped_metadata_json"]){if s(&m,"target_id")==cid{for (key,kind) in [("geography","region"),("register","register")]{for v in arr(&m[key]){if let Some(text)=v.as_str().and_then(clean){labels.push(json!({"kind":kind,"text":text}))}}}}}patterns.push(json!({"id":self.ident("pattern",cid,Some(&scope)),"text":c["pattern"],"explanation":if en.is_some()||zh.is_some(){json!({"en":en,"zh":zh})}else{Value::Null},"labels":labels,"examples":examples,"notes":[]}));}
        let pattern = s(row, "pattern");
        if !pattern.is_empty()
            && pattern != headword
            && !patterns.iter().any(|p| s(p, "text") == pattern)
        {
            patterns.insert(0,json!({"id":self.ident("pattern",sid,Some(&scope)),"text":pattern,"explanation":null,"labels":[],"examples":[],"notes":[]}));
        }
        let nested = patterns
            .iter()
            .flat_map(|p| arr(&p["examples"]))
            .map(|x| (x["english"].clone(), x["chinese"].clone()))
            .collect::<Vec<_>>();
        let examples = self
            .rows(
                "SELECT * FROM examples WHERE sense_id=? ORDER BY rowid",
                &[sid],
            )?
            .iter()
            .filter(|r| {
                clean(s(r, "english")).is_some()
                    && !nested.contains(&(cv(&r["english"]), cv(&r["chinese"])))
            })
            .map(|r| self.example(r, &scope))
            .collect::<Vec<_>>();
        let mut notes=self.rows("SELECT n.* FROM notes n JOIN sense_notes sn ON sn.note_id=n.id WHERE sn.sense_id=? ORDER BY n.rowid",&[sid])?.iter().map(|n|self.note(n,&scope)).collect::<R<Vec<_>>>()?;
        if self.tables.contains("inline_hints") {
            for h in self.rows("SELECT * FROM inline_hints WHERE sense_id=?", &[sid])? {
                if clean(s(&h, "text_en")).is_some() || clean(s(&h, "text_zh")).is_some() {
                    notes.push(json!({"id":self.ident("hint",sid,Some(&scope)),"kind":"usage","content":{"en":cv(&h["text_en"]),"zh":cv(&h["text_zh"])},"examples":[]}))
                }
            }
        }
        let full = arr(&row["full_forms_json"]);
        if !full.is_empty() {
            notes.push(json!({"id":self.ident("fullform",sid,Some(&scope)),"kind":"usage","content":{"en":format!("Full form: {}",full.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("; ")),"zh":null},"examples":[]}));
        }
        let mut pieces = vec![];
        for m in arr(&row["scoped_metadata_json"])
            .into_iter()
            .chain(arr(&row["usage_annotations_json"]))
        {
            if let Some(t) = m.as_str() {
                pieces.push(t.to_string());
                continue;
            }
            let subject = ["expression", "variant", "pattern"]
                .iter()
                .find_map(|k| m[*k].as_str().and_then(clean));
            let mut labels: Vec<String> = vec![];
            for key in [
                "label",
                "geography",
                "register",
                "text",
                "text_en",
                "text_zh",
                "limits",
            ] {
                if let Some(a) = m[key].as_array() {
                    labels.extend(a.iter().map(|v| {
                        v.as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| v.to_string())
                    }))
                } else if let Some(t) = m[key].as_str() {
                    if !t.is_empty() {
                        labels.push(t.into())
                    }
                }
            }
            let relationship = clean(s(&m, "relationship"));
            if let Some(subject) = subject {
                pieces.push(format!(
                    "{subject}{}{}",
                    if labels.is_empty() {
                        String::new()
                    } else {
                        format!(": {}", labels.join("; "))
                    },
                    relationship.map(|r| format!(" ({r})")).unwrap_or_default()
                ))
            } else if !labels.is_empty() {
                pieces.push(labels.join("; "))
            }
        }
        if !pieces.is_empty() {
            notes.push(json!({"id":self.ident("metadata",sid,Some(&scope)),"kind":"usage","content":{"en":pieces.join("\n"),"zh":null},"examples":[]}));
        }
        Ok(
            json!({"id":self.ident("sense",sid,Some(gid)),"meaning":{"en":cv(&row["definition_en"]),"zh":if row["bilingual_candidate"].as_i64()==Some(0){Value::Null}else{cv(&row["definition_zh"])}},"labels":Self::labels(row),"patterns":patterns,"examples":examples,"notes":notes}),
        )
    }
    fn related_query(&self, target: &Value, containing: &str) -> R<Option<String>> {
        let label = canonical(s(target, "label"));
        if !label.is_empty()
            && !self
                .rows("SELECT 1 FROM lookup WHERE query_text=? LIMIT 1", &[&label])?
                .is_empty()
        {
            return Ok(Some(label));
        }
        let original = canonical(s(target, "target"));
        let base = original.split('#').next().unwrap_or("").trim();
        if !base.is_empty() {
            return Ok(Some(base.into()));
        }
        let containing = canonical(containing);
        if !containing.is_empty()
            && !self
                .rows(
                    "SELECT 1 FROM lookup WHERE query_text=? LIMIT 1",
                    &[&containing],
                )?
                .is_empty()
        {
            return Ok(Some(containing));
        }
        Ok(None)
    }
    fn unit_entry(&self, m: &Match, query: &str) -> R<Option<Value>> {
        let units = self.rows("SELECT * FROM units WHERE id=?", &[&m.unit])?;
        let Some(unit) = units.first() else {
            return Ok(None);
        };
        let headword = s(unit, "headword");
        let explicit=!query.is_empty()&&query!=headword&&!self.rows("SELECT 1 FROM lookup WHERE query_text=? AND unit_id=? AND reason='source_explicit_header_variant'",&[query,&m.unit])?.is_empty();
        let variant = if explicit {
            Some(format!("{:x}", Sha256::digest(query.as_bytes())))
        } else {
            None
        };
        let kind = if explicit {
            "expression_pattern"
        } else {
            &m.kind
        };
        let mut senses = self.rows(
            "SELECT * FROM senses WHERE unit_id=? ORDER BY rowid",
            &[&m.unit],
        )?;
        if !m.restricted.is_empty() {
            senses.retain(|r| m.restricted.iter().any(|id| id == s(r, "id")))
        }
        if senses.is_empty() {
            return Ok(None);
        }
        let mut grouped: Vec<(Value, Vec<Value>)> = vec![];
        for sense in &senses {
            for group in self.rows("SELECT DISTINCT g.* FROM group_map gm JOIN groups g ON g.id=gm.group_id WHERE gm.sense_id=? ORDER BY g.record_index,g.locator",&[s(sense,"id")])?{let gid=s(&group,"id");if m.group.as_ref().is_some_and(|x|x!=gid){continue}if let Some((_,ss))=grouped.iter_mut().find(|(g,_)|s(g,"id")==gid){ss.push(sense.clone())}else{grouped.push((group,vec![sense.clone()]))}}
        }
        grouped.sort_by(|(a, _), (b, _)| {
            a["record_index"]
                .as_i64()
                .cmp(&b["record_index"].as_i64())
                .then_with(|| source_key(s(a, "locator")).cmp(&source_key(s(b, "locator"))))
        });
        let mut groups = vec![];
        for (gr, ss) in &grouped {
            let gid = s(gr, "id");
            let header = obj(&gr["header_json"]);
            let inherited =
                s(unit, "kind") == "expression" && s(&header, "source_headword") != headword;
            let pos = if inherited {
                None
            } else {
                header["pos"]
                    .as_str()
                    .or(unit["pos"].as_str())
                    .and_then(clean)
            };
            let normalized = pos.as_deref().map(|p| match p {
                "phrasal verb" => "verb",
                "number" => "numeral",
                "auxiliary verb" => "auxiliary",
                "modal verb" => "modal",
                "exclamation" => "interjection",
                p => p,
            });
            let allowed = [
                "noun",
                "verb",
                "adjective",
                "adverb",
                "pronoun",
                "determiner",
                "preposition",
                "conjunction",
                "interjection",
                "auxiliary",
                "modal",
                "numeral",
                "particle",
                "prefix",
                "suffix",
                "abbreviation",
                "symbol",
                "other",
            ];
            let normalized = normalized.map(|p| if allowed.contains(&p) { p } else { "other" });
            let mut ordered = vec![];
            for sense in ss {
                let locs = self.rows(
                    "SELECT source_json FROM occurrences WHERE sense_id=? AND record_index=?",
                    &[s(sense, "id"), &gr["record_index"].to_string()],
                )?;
                let xpath = locs
                    .first()
                    .map(|r| obj(&r["source_json"]))
                    .map(|o| s(&o, "definition_xpath").to_string())
                    .filter(|x| !x.is_empty());
                let xpath = if let Some(x) = xpath {
                    x
                } else {
                    self.rows(
                        "SELECT definition_xpath FROM group_map WHERE sense_id=? AND group_id=?",
                        &[s(sense, "id"), gid],
                    )?
                    .first()
                    .map(|r| s(r, "definition_xpath").to_string())
                    .unwrap_or_default()
                };
                ordered.push((source_key(&xpath), sense));
            }
            ordered.sort_by(|a, b| a.0.cmp(&b.0));
            let mut pronunciations = vec![];
            if self.tables.contains("pronunciations") && !explicit {
                for p in self.rows(
                    "SELECT * FROM pronunciations WHERE group_id=? ORDER BY rowid",
                    &[gid],
                )? {
                    let p = json!({"region":p["region"],"ipa":cv(&p["ipa"]),"audio":null,"form_label":cv(&p["form_label"])});
                    if !p["ipa"].is_null() && !pronunciations.contains(&p) {
                        pronunciations.push(p)
                    }
                }
            }
            let forms = if self.tables.contains("forms") && !explicit {
                self.rows("SELECT * FROM forms WHERE group_id=? ORDER BY rowid",&[gid])?.iter().map(|f|json!({"text":f["text"],"label":if s(f,"label").is_empty(){"source form"}else{s(f,"label")}})).collect::<Vec<_>>()
            } else {
                vec![]
            };
            let mut labels = vec![];
            if !inherited {
                for l in arr(&header["labels"]) {
                    let kind = match s(&l, "class") {
                        "gram" => "grammar",
                        "geo" => "region",
                        "registerlab" => "register",
                        "level" => "level",
                        "freq" => "frequency",
                        _ => continue,
                    };
                    if let Some(t) = clean(s(&l, "text")) {
                        labels.push(json!({"kind":kind,"text":t}))
                    }
                }
            }
            groups.push(json!({"id":self.ident("group",gid,variant.as_deref()),"part_of_speech":normalized,"source_part_of_speech":pos,"pronunciations":pronunciations,"forms":forms,"labels":labels,"senses":ordered.iter().map(|(_,r)|self.sense(r,gid,headword)).collect::<R<Vec<_>>>()?,"notes":[]}));
        }
        if groups.is_empty() {
            return Ok(None);
        }
        let first = &grouped[0].0;
        let expression = s(unit, "kind") != "word" || explicit;
        let parent = if expression {
            clean(s(first, "parent_headword")).or_else(|| clean(s(first, "record_key")))
        } else {
            None
        };
        let all_sids = groups
            .iter()
            .flat_map(|g| arr(&g["senses"]))
            .map(|x| x["id"].clone())
            .collect::<Vec<_>>();
        let pattern = senses.iter().find_map(|x| clean(s(x, "pattern")));
        let mut entry = json!({"id":self.ident("entry",&m.unit,variant.as_deref()),"headword":if explicit{query}else{headword},"kind":if expression{"expression"}else{"word"},"expression_type":if s(unit,"kind")=="phrasal_verb"{json!("phrasal_verb")}else{Value::Null},"origin":if expression{"subentry"}else{"headword"},"parent_headword":parent,"source":self.source(s(first,"record_key"),&format!("record:{}:{}",first["record_index"],s(first,"locator"))),"match":{"type":kind,"pattern":if explicit{json!(query)}else if kind=="expression_pattern"{json!(pattern)}else{Value::Null},"note":if explicit{json!("Source header explicitly records this expression variant.")}else{Value::Null},"sense_ids":if !m.restricted.is_empty()||m.group.is_some()||kind=="expression_pattern"{all_sids}else{vec![]}},"groups":groups,"notes":[],"related_expressions":[]});
        let mut related = vec![];
        for g in arr(&entry["groups"]) {
            for sense in arr(&g["senses"]) {
                let raw = s(&sense, "id").rsplit(':').next().unwrap_or("");
                if let Some(raw) = senses.iter().find(|x| s(x, "id") == raw) {
                    for rel in arr(&raw["relations_json"]) {
                        for target in arr(&rel["targets"]) {
                            let text =
                                clean(s(&target, "label")).or_else(|| clean(s(&rel, "text")));
                            let query = self.related_query(&target, s(first, "record_key"))?;
                            if let (Some(text), Some(query)) = (text, query) {
                                let item = json!({"text":text,"expression_type":null,"scope_id":sense["id"],"target_query":query});
                                if !related.contains(&item) {
                                    related.push(item)
                                }
                            }
                        }
                    }
                }
            }
        }
        entry["related_expressions"] = json!(related);
        Ok(Some(entry))
    }
    fn construction_entries(&self, query: &str) -> R<Vec<Value>> {
        let mut entries = vec![];
        for row in self.rows(
            "SELECT * FROM constructions WHERE lookup_key=? ORDER BY rowid",
            &[&canonical(query).to_lowercase()],
        )? {
            if canonical(s(&row, "pattern")) != canonical(query) {
                continue;
            }
            let en = clean(
                &arr(&row["gloss_en_json"])
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join("; "),
            );
            let zh = clean(
                &arr(&row["explanation_zh_json"])
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join("；"),
            );
            if en.is_none() && zh.is_none() {
                continue;
            }
            let cid = s(&row, "id");
            let locs=self.rows("SELECT * FROM construction_occurrences WHERE construction_id=? ORDER BY record_index,source_xpath",&[cid])?;
            if locs.is_empty() || clean(s(&row, "parent_headword")).is_none() {
                continue;
            }
            let loc = &locs[0];
            let scope = format!("construction:{cid}");
            let mut examples=self.rows("SELECT DISTINCT id,english,chinese FROM sense_construction_examples WHERE construction_id=? ORDER BY rowid",&[cid])?;
            if self.tables.contains("construction_examples") {
                examples.extend(self.rows(
                    "SELECT * FROM construction_examples WHERE construction_id=? ORDER BY rowid",
                    &[cid],
                )?)
            }
            let mut seen = HashSet::new();
            let examples = examples
                .iter()
                .filter(|x| {
                    clean(s(x, "english")).is_some()
                        && seen.insert((s(x, "english"), s(x, "chinese")))
                })
                .map(|x| self.example(x, &scope))
                .collect::<Vec<_>>();
            let sense = json!({"id":self.ident("construction_sense",cid,None),"meaning":{"en":en,"zh":zh},"labels":[],"patterns":[],"examples":examples,"notes":[]});
            entries.push(json!({"id":self.ident("construction_entry",cid,None),"headword":row["pattern"],"kind":"expression","expression_type":if s(&row,"kind")=="collocation"{json!("collocation")}else{Value::Null},"origin":if s(&row,"context_kind")=="usage_note"{"note"}else{"construction"},"parent_headword":row["parent_headword"],"source":self.source(s(&row,"parent_headword"),&format!("record:{}:{}",loc["record_index"],s(loc,"source_xpath"))),"match":{"type":"exact","pattern":null,"note":null,"sense_ids":[]},"groups":[{"id":self.ident("construction_group",cid,None),"part_of_speech":null,"source_part_of_speech":null,"pronunciations":[],"forms":[],"labels":[],"senses":[sense],"notes":[]}],"notes":[],"related_expressions":[]}));
        }
        Ok(entries)
    }
    fn query_inner(&self, text: &str, context: Option<&str>) -> R<Value> {
        if clean(text).is_none() {
            return Err("Query text must be nonempty".into());
        }
        if text.len() > 4096 {
            return Err("Query text is too long".into());
        }
        let query = canonical(text);
        let matched = self.lookup(&query)?;
        let mut entries = vec![];
        let mut seen = HashSet::new();
        for m in matched {
            if let Some(mut entry) = self.unit_entry(&m, &query)? {
                if m.kind == "inflection" {
                    if let Some(note) = self.relations.relation_note(&query, &m.unit) {
                        entry["match"]["note"] = json!(note);
                    }
                }
                if seen.insert(s(&entry, "id").to_string()) {
                    entries.push(entry)
                }
            }
        }
        // A grammatical redirect is a relationship hint, not another meaning.
        // Preserve it in the target match note and notice, while keeping every
        // independent exact entry (including mixed reference/lexical entries).
        let is_redirect_entry = |entry: &Value| {
            self.relations
                .redirect_units
                .contains(s(entry, "id").rsplit(':').next().unwrap_or(""))
        };
        let has_expansion = entries.iter().any(|entry| {
            s(&entry["match"], "type") == "inflection"
                && s(entry, "headword") != query
                && !is_redirect_entry(entry)
        });
        if has_expansion {
            entries.retain(|entry| !is_redirect_entry(entry));
        }
        if entries.is_empty() {
            entries = self.construction_entries(&query)?
        }
        let mut result = empty(text, context, None);
        if entries.is_empty() {
            if let Some(lowercase) = sentence_case_query(&query) {
                let mut normalized = self.query_inner(&lowercase, context)?;
                normalized["query"]["text"] = json!(text);
                if let Some(entries) = normalized["entries"].as_array_mut() {
                    for entry in entries {
                        let note =
                            format!("Sentence capitalization normalized: {query} → {lowercase}.");
                        let previous = clean(s(&entry["match"], "note"));
                        entry["match"]["note"] =
                            json!(previous.map(|old| format!("{old} {note}")).unwrap_or(note));
                    }
                }
                return Ok(normalized);
            }
            return Ok(result);
        }
        fn rank(e: &Value) -> (bool, bool, bool) {
            let ss = arr(&e["groups"])
                .iter()
                .flat_map(|g| arr(&g["senses"]))
                .collect::<Vec<_>>();
            (
                !ss.iter().any(|x| !x["meaning"]["zh"].is_null()),
                !["inflection", "spelling_variant"].contains(&s(&e["match"], "type")),
                s(&e["match"], "type") == "exact"
                    && ss.len() == 1
                    && ss[0]["meaning"]["zh"].is_null(),
            )
        }
        let independent = self.relations.has_independent(&query);
        entries.sort_by_key(|entry| {
            let previous = rank(entry);
            (
                previous.0,
                if independent {
                    s(&entry["match"], "type") != "exact"
                } else {
                    previous.1
                },
                previous.2,
            )
        });
        result["default_entry_id"] = entries[0]["id"].clone();
        result["status"] = json!(if arr(&entries[0]["groups"])
            .iter()
            .flat_map(|g| arr(&g["senses"]))
            .any(|x| !x["meaning"]["zh"].is_null())
        {
            "found"
        } else {
            "partial"
        });
        let mut notices = vec![];
        let candidates = self.relations.candidates(&query);
        if !candidates.is_empty() {
            let heads = candidates
                .iter()
                .map(|c| c.lemma.as_str())
                .collect::<BTreeSet<_>>();
            let labels = candidates
                .iter()
                .filter_map(|c| match c.relation.as_str() {
                    "plural" => Some("复数"),
                    "past tense" => Some("过去式"),
                    "past participle" => Some("过去分词"),
                    "past tense and past participle" => Some("过去式和过去分词"),
                    "present participle" => Some("现在分词"),
                    "third person singular" => Some("第三人称单数"),
                    "comparative" => Some("比较级"),
                    "superlative" => Some("最高级"),
                    _ => None,
                })
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>()
                .join("、");
            if self.relations.identity(&query) != query {
                notices.push(json!({"code":"inflection_relation","text":format!("{} → {}{}",query,self.relations.identity(&query),if labels.is_empty(){String::new()}else{format!("（{labels}）")}),"entry_id":null}));
            } else if has_expansion {
                notices.push(json!({"code":"inflection_candidates","text":format!("相关原词：{}。词典保留不同词头；记下时按原写法归档。",heads.into_iter().collect::<Vec<_>>().join("、")),"entry_id":null}));
            }
        }
        if !has_expansion && entries.iter().all(is_redirect_entry) {
            result["status"] = json!("partial");
            notices.push(json!({"code":"unexpanded_inflection","text":"已找到词形说明，原词的完整释义暂不可用。","entry_id":null}));
        }
        for entry in &entries {
            let senses = arr(&entry["groups"])
                .iter()
                .flat_map(|g| arr(&g["senses"]))
                .collect::<Vec<_>>();
            let english = senses
                .iter()
                .filter(|s| s["meaning"]["zh"].is_null())
                .count();
            if english > 0 {
                notices.push(json!({"code":"english_only_senses","text":format!("{english} 个意思仅英文，原来源未提供可用中文。"),"entry_id":entry["id"]}));
            }
            let raw = senses
                .iter()
                .map(|x| s(x, "id").rsplit(':').next().unwrap_or(""))
                .collect::<HashSet<_>>();
            let mut dated = false;
            for sid in raw {
                for row in self.rows("SELECT flags_json FROM senses WHERE id=?", &[sid])? {
                    if arr(&row["flags_json"])
                        .iter()
                        .any(|v| v == "dated_encyclopedic_reference")
                    {
                        dated = true
                    }
                }
            }
            if dated {
                notices.push(json!({"code":"dated_reference","text":"包含原词典的年代性百科资料，人物身份、日期或背景信息可能已过时。","entry_id":entry["id"]}))
            }
        }
        result["entries"] = json!(entries);
        result["notices"] = json!(notices);
        Ok(result)
    }
    fn query(&self, text: &str, context: Option<&str>) -> Value {
        self.query_inner(text, context)
            .unwrap_or_else(|e| empty(text, context, Some(&format!("Runtime query failed: {e}"))))
    }
}

#[derive(Default)]
struct Runtime {
    root: Option<PathBuf>,
    fingerprint: String,
    package: Option<Package>,
    error: Option<String>,
}
static RUNTIME: OnceLock<Mutex<Runtime>> = OnceLock::new();
fn runtime() -> &'static Mutex<Runtime> {
    RUNTIME.get_or_init(|| Mutex::new(Runtime::default()))
}
/// Only text and IPA are used. Sibling recording packs are deliberately ignored.
fn package_layout(root: &Path) -> PathBuf {
    if root.join("text-v1").is_dir() {
        root.join("text-v1")
    } else {
        root.to_path_buf()
    }
}
fn configured_root(rt: &Runtime) -> PathBuf {
    #[cfg(debug_assertions)]
    {
        if let Some(root) = std::env::var_os("LEXICUE_LONGMAN_PACKAGE_ROOT") {
            return package_layout(Path::new(&root));
        }
        // A packaged debug experience uses its own resources. A developer's
        // symlink must never become a dependency of a distributed .app.
        if let Some(root) = rt
            .root
            .as_ref()
            .filter(|root| root.join("manifest.json").is_file())
        {
            return root.clone();
        }
        let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/longman.local");
        if dev.exists() {
            return package_layout(&dev);
        }
    }
    rt.root
        .clone()
        .unwrap_or_else(|| package_layout(Path::new("missing-longman-package")))
}
fn fingerprint(root: &Path) -> String {
    let mut value = format!("{:?}", root);
    for path in [root.join("manifest.json"), root.join("runtime.sqlite")] {
        if let Ok(m) = std::fs::metadata(path) {
            value.push_str(&format!("{}:{:?}", m.len(), m.modified().ok()));
        }
    }
    value
}
fn with_runtime<T>(f: impl FnOnce(&Runtime) -> T) -> T {
    let mut rt = runtime().lock().unwrap_or_else(|e| e.into_inner());
    let root = configured_root(&rt);
    let fp = fingerprint(&root);
    if fp != rt.fingerprint {
        rt.fingerprint = fp;
        rt.package = None;
        rt.error = None;
        match Package::open(&root) {
            Ok(p) => rt.package = Some(p),
            Err(e) => rt.error = Some(e),
        }
    }
    f(&rt)
}
/// Initialize only the location. Expensive integrity validation happens on the blocking worker.
pub fn configure(app: &tauri::AppHandle) {
    let data = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("dictionaries/longman"));
    let resource = app
        .path()
        .resource_dir()
        .ok()
        .map(|p| p.join("dictionaries/longman"));
    let root = data
        .as_ref()
        .filter(|p| p.join("text-v1/manifest.json").is_file() || p.join("manifest.json").is_file())
        .cloned()
        .or(resource.filter(|p| p.exists()))
        .or(data);
    if let Some(root) = root {
        runtime().lock().unwrap_or_else(|e| e.into_inner()).root = Some(package_layout(&root));
    }
}
pub fn query_configured(expression: &str, context: Option<&str>) -> Value {
    with_runtime(|r| match &r.package {
        Some(p) => p.query(expression, context),
        None => empty(
            expression,
            context,
            r.error
                .as_deref()
                .or(Some("Longman package is unavailable")),
        ),
    })
}
/// Immutable, rebuildable graph. No user snapshot can grant an alias here.
pub fn relation_catalog_configured() -> Arc<RelationCatalog> {
    with_runtime(|r| {
        r.package
            .as_ref()
            .map(|p| p.relations.clone())
            .unwrap_or_else(|| {
                Arc::new(RelationCatalog::empty(format!(
                    "{}:unavailable:{}",
                    relations::RELATION_VERSION,
                    r.fingerprint
                )))
            })
    })
}
pub fn status_configured() -> Value {
    with_runtime(|r| match &r.package {
        Some(p) => {
            json!({"state":"ready","release":p.release,"error":null,"audio_available":false,"audio_error":null,"package_root":p.root.to_string_lossy(),"initialization_ms":p.initialization_ms})
        }
        None => {
            json!({"state":"unavailable","release":null,"error":r.error,"audio_available":false,"audio_error":null,"package_root":null,"initialization_ms":null})
        }
    })
}
#[tauri::command]
pub async fn lookup_longman_expression(expression: String, context: Option<String>) -> R<Value> {
    tauri::async_runtime::spawn_blocking(move || query_configured(&expression, context.as_deref()))
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn longman_dictionary_status() -> R<Value> {
    tauri::async_runtime::spawn_blocking(status_configured)
        .await
        .map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn canonical_preserves_case_and_source_punctuation() {
        assert_eq!(canonical("  US  "), "US");
        assert_eq!(canonical("us"), "us");
        assert_eq!(canonical("look%20it%20up"), "look it up");
        assert_eq!(canonical("…"), "...");
        assert_eq!(canonical("rock &amp; roll"), "rock & roll");
    }
    #[test]
    fn sentence_case_retry_excludes_abbreviations_and_internal_capitals() {
        for (original, lower) in [
            ("Curiosity", "curiosity"),
            ("We", "we"),
            ("Look it up", "look it up"),
            ("Record", "record"),
        ] {
            assert_eq!(sentence_case_query(original).as_deref(), Some(lower));
        }
        for original in [
            "US",
            "UK",
            "I",
            "us",
            "iPhone",
            "McDonald",
            "Look It Up",
            "NASA",
        ] {
            assert_eq!(sentence_case_query(original), None);
        }
    }
    #[test]
    fn package_paths_reject_traversal_and_symlink_escape() {
        let d = tempfile::tempdir().unwrap();
        assert!(safe_path(d.path(), "../secret").is_err());
        assert!(safe_path(d.path(), "/etc/passwd").is_err());
        assert!(safe_path(d.path(), "hwd/../secret").is_err());
        #[cfg(unix)]
        {
            let outside = tempfile::tempdir().unwrap();
            std::fs::write(outside.path().join("secret"), "outside").unwrap();
            std::os::unix::fs::symlink(outside.path(), d.path().join("escape")).unwrap();
            assert!(safe_path(d.path(), "escape/secret").is_err());
        }
    }
    #[test]
    fn missing_and_invalid_packages_are_unavailable() {
        let d = tempfile::tempdir().unwrap();
        assert!(Package::open(d.path()).is_err());
        std::fs::write(d.path().join("manifest.json"), r#"{"schema_version":999}"#).unwrap();
        assert!(Package::open(d.path()).err().unwrap().contains("schema"));
    }
    #[test]
    fn damaged_runtime_inventory_is_rejected_before_queries() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("runtime.sqlite"), "damaged package").unwrap();
        let manifest = json!({"schema_version":1,"data_release":"test-v1","runtime_database":"runtime.sqlite","files":[{"path":"runtime.sqlite","sha256":"0000000000000000000000000000000000000000000000000000000000000000"}]});
        std::fs::write(
            d.path().join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        assert!(Package::open(d.path()).err().unwrap().contains("checksum"));
        let mut manifest = manifest;
        manifest["runtime_database"] = json!("../runtime.sqlite");
        std::fs::write(
            d.path().join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        assert!(Package::open(d.path()).err().unwrap().contains("Unsafe"));
    }
    /// Opt-in real-data contract test. Output feeds the independent Python schema/source comparison.
    #[test]
    #[ignore]
    fn longman_real_package_export() {
        let root =
            PathBuf::from(std::env::var("LEXICUE_LONGMAN_PACKAGE_ROOT").expect("set package root"));
        let text = package_layout(&root);
        let p = Package::open(&text).unwrap();
        let inputs: Value = serde_json::from_slice(
            &std::fs::read(std::env::var("LEXICUE_LONGMAN_QUERY_INPUT").expect("set input JSON"))
                .unwrap(),
        )
        .unwrap();
        let start = Instant::now();
        let out = inputs
            .as_array()
            .unwrap()
            .iter()
            .map(|v| {
                let start = Instant::now();
                let r = p.query(v.as_str().unwrap(), None);
                json!({"result":r,"elapsed_ms":start.elapsed().as_secs_f64()*1000.})
            })
            .collect::<Vec<_>>();
        let result = json!({"status":status_for(&p),"total_query_ms":start.elapsed().as_secs_f64()*1000.,"queries":out});
        std::fs::write(
            std::env::var("LEXICUE_LONGMAN_QUERY_OUTPUT").expect("set output JSON"),
            serde_json::to_vec_pretty(&result).unwrap(),
        )
        .unwrap();
    }
    #[test]
    #[ignore]
    fn longman_real_package_text_without_recordings() {
        let root =
            PathBuf::from(std::env::var("LEXICUE_LONGMAN_PACKAGE_ROOT").expect("set package root"));
        let p = Package::open(&package_layout(&root)).unwrap();
        let result = p.query("record", Some("a record of our visit"));
        assert_eq!(result["status"], "found");
        assert!(!arr(&result["notices"])
            .iter()
            .any(|n| s(n, "code").contains("audio")));
        let pronunciations = arr(&result["entries"])
            .iter()
            .flat_map(|e| arr(&e["groups"]))
            .flat_map(|g| arr(&g["pronunciations"]))
            .collect::<Vec<_>>();
        assert_eq!(
            pronunciations.len(),
            4,
            "noun/verb each retain their UK/US IPA"
        );
        assert!(pronunciations
            .iter()
            .all(|p| p["audio"].is_null() && !s(p, "ipa").is_empty()));
        assert_eq!(p.query("look it up", None)["status"], "found");
        assert!(!arr(&result["entries"])
            .iter()
            .flat_map(|e| arr(&e["groups"]))
            .flat_map(|g| arr(&g["senses"]))
            .flat_map(|s| arr(&s["examples"]))
            .collect::<Vec<_>>()
            .is_empty());
    }
    #[test]
    #[ignore]
    fn longman_real_package_sentence_capitalization() {
        let root =
            PathBuf::from(std::env::var("LEXICUE_LONGMAN_PACKAGE_ROOT").expect("set package root"));
        let text = package_layout(&root);
        let p = Package::open(&text).unwrap();
        for (original, lowercase) in [
            ("Curiosity", "curiosity"),
            ("We", "we"),
            ("Look it up", "look it up"),
            ("Record", "record"),
        ] {
            let context = format!("{original} appears at the beginning of this sentence.");
            let mut actual = p.query(original, Some(&context));
            let expected = p.query(lowercase, Some(&context));
            assert_eq!(actual["query"]["text"], original);
            assert_eq!(actual["query"]["context"], context);
            assert_ne!(actual["status"], "not_found");
            assert_ne!(actual["status"], "unavailable");
            for (entry, expected_entry) in actual["entries"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .zip(expected["entries"].as_array().unwrap())
            {
                assert!(s(&entry["match"], "note").contains("Sentence capitalization normalized"));
                entry["match"]["note"] = expected_entry["match"]["note"].clone();
            }
            actual["query"]["text"] = json!(lowercase);
            assert_eq!(
                actual, expected,
                "casing retry preserves all source content and applicable senses"
            );
        }
        let upper = p.query("US", None);
        let lower = p.query("us", None);
        assert_eq!(upper["status"], "partial");
        assert_eq!(lower["status"], "found");
        assert_ne!(upper["default_entry_id"], lower["default_entry_id"]);
        for result in [upper, lower, p.query("London", None)] {
            assert!(
                !arr(&result["entries"])
                    .iter()
                    .any(|e| s(&e["match"], "note").contains("Sentence capitalization normalized")),
                "exact source matches take priority"
            );
        }
    }
    #[test]
    #[ignore = "Opt-in real package word-form contract and evidence export"]
    fn longman_real_inflection_contract() {
        let root =
            PathBuf::from(std::env::var("LEXICUE_LONGMAN_PACKAGE_ROOT").expect("set package root"));
        let p = Package::open(&package_layout(&root)).unwrap();
        let schema: Value = serde_json::from_str(include_str!(
            "../../../docs/implementation/dictionary-result-v1.schema.json"
        ))
        .unwrap();
        let validator = jsonschema::JSONSchema::options()
            .with_draft(jsonschema::Draft::Draft202012)
            .compile(&schema)
            .unwrap();
        let mut rows = vec![];
        for query in [
            "children",
            "women",
            "mice",
            "went",
            "gone",
            "bought",
            "books",
            "running",
            "studied",
            "changed",
            "saw",
            "left",
            "found",
            "leaves",
            "axes",
            "better",
            "studies",
            "walked",
            "cats",
            "dogs",
            "taked",
            "buyed",
            "goed",
            "runned",
            "childs",
            "gooder",
            "informations",
            "furnitures",
            "homeworks",
            "happinesses",
            "news",
            "business",
            "glass",
            "series",
            "species",
            "US",
            "us",
            "happiness",
            "happy",
            "take off",
            "takeoff",
            "take-off",
            "look it up",
            "looked it up",
            "looked the word up",
            "Looked the word up",
            "looked up",
            "a red car",
            "look it upon",
            "look at what is up",
            "look what is up",
            "looked at what is up",
            "look the red car up",
            "look it right up",
            "sawed",
            "sawn",
            "saws",
            "founded",
            "founding",
            "bettered",
            "bettering",
            "May",
            "MAY",
            "may",
            "Go",
            "Went",
        ] {
            let start = Instant::now();
            let result = p.query(query, None);
            if let Err(errors) = validator.validate(&result) {
                panic!(
                    "{query}: {:?}",
                    errors.map(|e| e.to_string()).collect::<Vec<_>>()
                );
            }
            let entries = arr(&result["entries"]);
            let ids = entries.iter().map(|e| s(e, "id")).collect::<HashSet<_>>();
            if !entries.is_empty() {
                assert!(
                    ids.contains(s(&result, "default_entry_id")),
                    "{query} default identity"
                );
            }
            let mut semantic_ids = HashSet::new();
            for entry in &entries {
                assert_eq!(entry["source"]["release"], p.release);
                let mut senses = HashSet::new();
                for group in arr(&entry["groups"]) {
                    assert!(
                        semantic_ids.insert(s(&group, "id").to_string()),
                        "{query} group ID"
                    );
                    for sense in arr(&group["senses"]) {
                        assert!(
                            senses.insert(s(&sense, "id").to_string()),
                            "{query} sense ID"
                        );
                        assert!(
                            sense["meaning"]["en"].is_string()
                                || sense["meaning"]["zh"].is_string()
                        );
                        for example in arr(&sense["examples"]) {
                            assert!(example["english"].is_string());
                            assert!(example["audio"].is_null());
                        }
                    }
                }
                for restricted in arr(&entry["match"]["sense_ids"]) {
                    assert!(senses.contains(restricted.as_str().unwrap()));
                }
            }
            let heads = entries
                .iter()
                .map(|e| s(e, "headword").to_string())
                .collect::<BTreeSet<_>>();
            let expected = match query {
                "children" => Some(("child", "child")),
                "women" => Some(("woman", "woman")),
                "mice" => Some(("mouse", "mouse")),
                "went" => Some(("go", "go")),
                "bought" => Some(("buy", "buy")),
                "studies" => Some(("study", "study")),
                "walked" => Some(("walk", "walk")),
                "cats" => Some(("cat", "cat")),
                _ => None,
            };
            if let Some((lemma, identity)) = expected {
                assert!(heads.contains(lemma), "{query}: {heads:?}");
                assert_eq!(p.relations.identity(query), identity);
                assert!(
                    entries
                        .iter()
                        .filter(|e| s(e, "headword") == lemma)
                        .flat_map(|e| arr(&e["groups"]))
                        .flat_map(|g| arr(&g["senses"]))
                        .any(|s| !arr(&s["examples"]).is_empty()),
                    "{query} complete examples"
                );
                assert!(p.relations.safe_forms(lemma).contains(&query.to_string()));
            }
            for (surface, own, lemma) in [
                ("books", "books", "book"),
                ("running", "running", "run"),
                ("studied", "studied", "study"),
                ("changed", "changed", "change"),
                ("saw", "saw", "see"),
                ("left", "left", "leave"),
                ("found", "found", "find"),
                ("gone", "gone", "go"),
            ] {
                if query == surface {
                    assert!(heads.contains(own) && heads.contains(lemma));
                    assert_eq!(p.relations.identity(query), query);
                    assert!(!p.relations.safe_forms(lemma).contains(&query.to_string()));
                }
            }
            if [
                "dogs",
                "taked",
                "buyed",
                "goed",
                "runned",
                "childs",
                "gooder",
                "informations",
                "furnitures",
                "homeworks",
                "happinesses",
            ]
            .contains(&query)
            {
                assert_eq!(p.relations.identity(query), query);
            }
            if [
                "sawed",
                "sawn",
                "saws",
                "founded",
                "founding",
                "bettered",
                "bettering",
            ]
            .contains(&query)
            {
                assert_eq!(p.relations.identity(query), query);
            }
            if ["leaves", "axes", "better"].contains(&query) {
                assert_eq!(p.relations.identity(query), query);
            }
            if query == "axes" {
                assert!(heads.contains("axe") && heads.contains("axis"));
            }
            if query == "leaves" {
                assert!(heads.contains("leaf") && heads.contains("leave"));
            }
            if query == "better" {
                assert!(
                    heads.contains("better") && heads.contains("good") && heads.contains("well")
                );
            }
            if [
                "news",
                "business",
                "glass",
                "series",
                "species",
                "US",
                "us",
                "happiness",
                "happy",
                "take off",
                "takeoff",
                "take-off",
            ]
            .contains(&query)
            {
                assert_eq!(p.relations.identity(query), query);
            }
            if [
                "look it up",
                "looked it up",
                "looked the word up",
                "Looked the word up",
                "looked up",
            ]
            .contains(&query)
            {
                assert!(heads.contains("look up"), "{query}: {heads:?}");
                assert_eq!(p.relations.identity(query), "look up");
            }
            if [
                "a red car",
                "look it upon",
                "look at what is up",
                "look what is up",
                "looked at what is up",
                "look the red car up",
                "look it right up",
            ]
            .contains(&query)
            {
                assert!(entries.is_empty());
                assert_eq!(p.relations.identity(query), query);
            }
            rows.push(json!({"query":query,"heads":heads,"identity":p.relations.identity(query),"safe_forms":p.relations.safe_forms(&p.relations.identity(query)),"candidates":p.relations.candidates(query),"elapsed_ms":start.elapsed().as_secs_f64()*1000.,"result":result}));
        }
        for query in ["take%20off", "rock &amp; roll", "US/us", "look-it-up"] {
            assert_eq!(p.relations.identity(query), query);
        }
        for root in ["saw", "found", "better"] {
            assert_eq!(
                p.relations.safe_forms(root),
                vec![root.to_string()],
                "ambiguous literal root cannot grant family aliases"
            );
        }
        let exclusions =
            p.relations
                .case_exclusions(&["may".into(), "us".into(), "went".into(), "go".into()]);
        assert!(
            exclusions.contains(&"May".into())
                && exclusions.contains(&"MAY".into())
                && exclusions.contains(&"US".into())
        );
        assert!(
            !exclusions.contains(&"Us".into())
                && !exclusions.contains(&"Go".into())
                && !exclusions.contains(&"Went".into())
        );
        assert!(p.relations.case_sensitive_identity("MAY"));
        assert!(!p.relations.case_sensitive_identity("Went"));
        let report = json!({"passed":true,"schema_validated":true,"runtime":"production Rust Package::query / frozen Longman SQLite","status":status_for(&p),"relation_fingerprint":p.relations.fingerprint(),"catalog":p.relations.stats(),"wordform_source":"existing english_wordforms.tsv.gz / ENGLISH-LICENSE.txt; only explicit regular inflections with matching Longman lemma POS/countability and no source paradigm conflict; irregular relations require Longman forms or pure references","queries":rows});
        if let Ok(output) = std::env::var("LEXICUE_INFLECTION_EVIDENCE") {
            std::fs::write(output, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
        }
    }
    fn status_for(p: &Package) -> Value {
        json!({"release":p.release,"initialization_ms":p.initialization_ms,"audio_available":false})
    }
}
