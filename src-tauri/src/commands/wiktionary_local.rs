//! Indexed, read-only v2 packs. No network, legacy dictionary or library DB fallback.
use flate2::{Decompress, FlushDecompress, Status};
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::OnceLock;
use unicode_normalization::UnicodeNormalization;

pub const RELEASE: &str = "enwiktionary-20261001-lexicue-v2";
pub const ADAPTER: &str = "wiktionary-local-v2.0.0";
pub const ATTRIBUTION: &str = "English Wiktionary contributors";
pub const MODIFICATIONS: &str = "Selected English senses, verified ordinary examples and source metadata; compacted and split into coverage packs. Translations, quotations and audio omitted.";
pub type R<T> = Result<T, String>;
const MAX_BODY: u64 = 8 * 1024 * 1024;
pub fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}
pub fn normalize(word: &str) -> String {
    word.nfc()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
/// Unicode casefold is pinned to the extraction toolchain, including expansions.
pub fn fold(word: &str) -> String {
    static TABLE: OnceLock<BTreeMap<String, String>> = OnceLock::new();
    let table = TABLE.get_or_init(|| {
        serde_json::from_str(include_str!("../../resources/dictionaries/casefold.json")).unwrap()
    });
    normalize(word)
        .chars()
        .map(|c| {
            table
                .get(&c.to_string())
                .cloned()
                .unwrap_or_else(|| c.to_string())
        })
        .collect()
}
pub fn decode(blob: &[u8]) -> R<Value> {
    let mut decoder = Decompress::new(true);
    let mut raw = Vec::new();
    let mut buffer = [0u8; 65536];
    loop {
        let before_in = decoder.total_in();
        let before_out = decoder.total_out();
        let status = decoder
            .decompress(
                &blob[before_in as usize..],
                &mut buffer,
                FlushDecompress::None,
            )
            .map_err(|_| "dictionary_body_invalid")?;
        let written = (decoder.total_out() - before_out) as usize;
        raw.extend_from_slice(&buffer[..written]);
        if raw.len() as u64 > MAX_BODY {
            return Err("dictionary_body_invalid".into());
        }
        if status == Status::StreamEnd {
            if decoder.total_in() != blob.len() as u64 {
                return Err("dictionary_body_invalid".into());
            }
            break;
        }
        if before_in == decoder.total_in() && before_out == decoder.total_out() {
            return Err("dictionary_body_invalid".into());
        }
    }
    serde_json::from_slice(&raw).map_err(|_| "dictionary_body_invalid".into())
}
pub fn labels(raw: &Value) -> Vec<Value> {
    let mut result = Vec::new();
    if let Some(map) = raw.as_object() {
        for (kind, values) in map {
            if let Some(values) = values.as_array() {
                for value in values {
                    if let Some(value) = value.as_str().filter(|s| !s.trim().is_empty()) {
                        result.push(json!({"kind":match kind.as_str(){"tags"=>"source_tag","topics"=>"source_topic",_=>"source_label"},"text":value}));
                    }
                }
            }
        }
    }
    result
}
fn part_of_speech(raw: &str) -> &str {
    match raw {
        "noun" | "name" => "noun",
        "verb" => "verb",
        "adj" => "adjective",
        "adv" => "adverb",
        "pron" => "pronoun",
        "det" | "article" => "determiner",
        "prep" | "prep_phrase" => "preposition",
        "conj" => "conjunction",
        "intj" => "interjection",
        "aux" => "auxiliary",
        "num" => "numeral",
        "particle" | "prefix" | "suffix" | "symbol" => raw,
        "abbrev" => "abbreviation",
        _ => "other",
    }
}
fn pronunciations(raw: &Value) -> Vec<Value> {
    raw.as_array()
        .into_iter()
        .flatten()
        .filter(|p| p["notation"] == "ipa")
        .map(|p| {
            let tags = p["labels"]["tags"].as_array().cloned().unwrap_or_default();
            let region = if tags.iter().any(|t| t == "US" || t == "General-American") {
                "us"
            } else if tags
                .iter()
                .any(|t| t == "UK" || t == "Received-Pronunciation")
            {
                "uk"
            } else {
                "unspecified"
            };
            let accepted: &[&str] = match region {
                "us" => &["US", "General-American", "Canada"],
                "uk" => &["UK", "Received-Pronunciation"],
                _ => &[],
            };
            let qualifiers = labels(&p["labels"])
                .iter()
                .map(|label| text(label, "text").to_string())
                .filter(|label| !accepted.contains(&label.as_str()))
                .collect::<BTreeSet<_>>();
            let qualifier = if qualifiers.is_empty() {
                Value::Null
            } else {
                json!(qualifiers.into_iter().collect::<Vec<_>>().join(", "))
            };
            json!({"region":region,"ipa":p["text"],"audio":null,"form_label":qualifier})
        })
        .collect()
}
pub struct Pack {
    pub conn: Connection,
    pub id: String,
}
impl Pack {
    pub fn open(path: &Path, id: &str) -> R<Self> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;")
            .map_err(|e| e.to_string())?;
        if conn
            .query_row("PRAGMA application_id", [], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?
            != 1280857155
            || conn
                .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .map_err(|e| e.to_string())?
                != 2
        {
            return Err("dictionary_version_invalid".into());
        }
        for (key, expected) in [
            ("release", RELEASE),
            ("adapter_version", ADAPTER),
            ("pack_id", id),
            ("language", "en"),
            ("provider", "wiktionary"),
            ("payload_codec", "zlib-json-v1"),
        ] {
            let raw: String = conn
                .query_row("SELECT value FROM metadata WHERE key=?1", [key], |r| {
                    r.get(0)
                })
                .map_err(|e| e.to_string())?;
            if serde_json::from_str::<Value>(&raw).map_err(|e| e.to_string())? != expected {
                return Err("dictionary_version_invalid".into());
            }
        }
        Ok(Self {
            conn,
            id: id.into(),
        })
    }
    fn surfaces(&self, query: &str, folded: bool) -> R<Vec<(i64, String)>> {
        let column = if folded { "folded" } else { "word" };
        let query = if folded {
            fold(query)
        } else {
            normalize(query)
        };
        let mut statement=self.conn.prepare(&format!("SELECT id,word FROM surfaces s WHERE {column}=?1 AND (EXISTS(SELECT 1 FROM entries e WHERE e.surface_id=s.id) OR EXISTS(SELECT 1 FROM aliases a WHERE a.surface_id=s.id)) ORDER BY word")).map_err(|e|e.to_string())?;
        let result = statement
            .query_map([query], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?;
        Ok(result)
    }
}
pub fn empty(query: &str, context: Option<&str>, error: Option<&str>) -> Value {
    json!({"schema_version":1,"query":{"text":query,"language":"en","context":context},"status":if error.is_some(){"unavailable"}else{"not_found"},"default_entry_id":null,"entries":[],"notices":error.map(|e|vec![json!({"code":"local_pack_unavailable","text":e,"entry_id":null})]).unwrap_or_default()})
}
pub fn query(packs: &[Pack], query: &str, context: Option<&str>) -> R<Value> {
    if query.chars().count() > 256 || query.trim().is_empty() {
        return Ok(empty(query, context, None));
    }
    let exact = packs
        .iter()
        .map(|p| p.surfaces(query, false))
        .collect::<R<Vec<_>>>()?;
    let folded = exact.iter().all(Vec::is_empty);
    let surfaces = if folded {
        packs
            .iter()
            .map(|p| p.surfaces(query, true))
            .collect::<R<Vec<_>>>()?
    } else {
        exact
    };
    let mut records: BTreeMap<i64, Value> = BTreeMap::new();
    let mut bodies: BTreeMap<i64, BTreeMap<i64, Value>> = BTreeMap::new();
    for (pack, surfaces) in packs.iter().zip(surfaces) {
        for (surface, matched) in surfaces {
            let mut statement=pack.conn.prepare("SELECT source_line FROM entries WHERE surface_id=?1 UNION SELECT entry_line FROM aliases WHERE surface_id=?1 ORDER BY 1").map_err(|e|e.to_string())?;
            let lines = statement
                .query_map([surface], |r| r.get::<_, i64>(0))
                .map_err(|e| e.to_string())?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| e.to_string())?;
            for line in lines {
                let (head,pos,blob,page,revision,hash):(String,String,Vec<u8>,i64,i64,Vec<u8>)=pack.conn.query_row("SELECT s.word,e.pos,e.body,p.page_id,p.revision,p.wikitext_sha256 FROM entries e JOIN surfaces s ON s.id=e.surface_id JOIN pages p ON p.surface_id=s.id WHERE e.source_line=?1",[line],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).map_err(|e|e.to_string())?;
                let body = decode(&blob)?;
                let id = format!("wiktionary:{RELEASE}:r{line}");
                let entry=records.entry(line).or_insert_with(|| {
                let url=format!("https://en.wiktionary.org/wiki/{}",percent_encoding::utf8_percent_encode(&head.replace(' ',"_"),percent_encoding::NON_ALPHANUMERIC));
                let source=json!({"provider":"wiktionary","dataset":"English Wiktionary","edition":null,"release":RELEASE,"adapter_version":ADAPTER,"delivery":"local","entry_key":id,"locator":format!("/records/{line}"),"entry_url":url,"retrieved_at":null,"content_hash":hash.iter().map(|b|format!("{b:02x}")).collect::<String>(),"source_revision":revision.to_string(),"source_page":page.to_string(),"license":{"name":"CC BY-SA 4.0","url":"https://creativecommons.org/licenses/by-sa/4.0/"},"attribution":ATTRIBUTION,"modifications":MODIFICATIONS});
                let forms=body["forms"].as_array().into_iter().flatten().map(|f|json!({"text":f["form"],"label":labels(&f["labels"]).iter().filter_map(|l|l["text"].as_str()).collect::<Vec<_>>().join(", ")})).collect::<Vec<_>>();
                json!({"id":id,"headword":head,"kind":if head.contains(' '){"expression"}else{"word"},"expression_type":null,"origin":"headword","parent_headword":null,"source":source,"match":{"type":if folded{"casefold_candidate"}else if head==matched{"exact"}else{"source_relation"},"pattern":null,"note":null,"sense_ids":[]},"groups":[{"id":format!("{id}:g"),"part_of_speech":part_of_speech(&pos),"source_part_of_speech":pos,"pronunciations":pronunciations(&body["pronunciations"]),"forms":forms,"labels":labels(&body["labels"]),"senses":[],"notes":[]}],"notes":[],"related_expressions":[]})
            });
                if !folded && head == matched {
                    entry["match"]["type"] = json!("exact");
                }
                if head != matched {
                    let mut statement=pack.conn.prepare("SELECT l.body FROM aliases a JOIN origins o ON o.id=a.origin_id JOIN labels l ON l.id=o.labels_id WHERE a.surface_id=?1 AND a.entry_line=?2").map_err(|e|e.to_string())?;
                    let raw = statement
                        .query_map(rusqlite::params![surface, line], |r| r.get::<_, String>(0))
                        .map_err(|e| e.to_string())?
                        .collect::<rusqlite::Result<Vec<_>>>()
                        .map_err(|e| e.to_string())?;
                    let mut qualifiers = BTreeSet::new();
                    for raw in raw {
                        let value: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
                        for label in labels(&value) {
                            qualifiers.insert(text(&label, "text").to_string());
                        }
                    }
                    if !qualifiers.is_empty() {
                        let note = format!(
                            "{matched} → {head}: {}",
                            qualifiers.into_iter().collect::<Vec<_>>().join(", ")
                        );
                        let mut notes = entry["match"]["note"]
                            .as_str()
                            .map(|s| s.split(" · ").map(str::to_string).collect::<BTreeSet<_>>())
                            .unwrap_or_default();
                        notes.insert(note);
                        entry["match"]["note"] =
                            json!(notes.into_iter().collect::<Vec<_>>().join(" · "));
                    }
                }
                let target = bodies.entry(line).or_default();
                for sense in body["senses"].as_array().ok_or("dictionary_body_invalid")? {
                    let ordinal = sense["ordinal"].as_i64().ok_or("dictionary_body_invalid")?;
                    if let Some(old) = target.insert(ordinal, sense.clone()) {
                        if old != *sense {
                            return Err("dictionary_sense_conflict".into());
                        }
                    }
                }
            }
        }
    }
    for (line, senses) in bodies {
        let entry = records.get_mut(&line).unwrap();
        let id = text(entry, "id").to_string();
        entry["groups"][0]["senses"]=json!(senses.into_iter().map(|(ordinal,sense)|{
            let sid=format!("{id}:s{ordinal}");
            let ancestors=sense["ancestors"].as_array().into_iter().flatten().enumerate().map(|(index,parent)|json!({"source_path":format!("/records/{line}/senses/{ordinal}/ancestors/{index}"),"meaning":{"en":parent["definition"],"zh":null},"labels":labels(&parent["labels"])})).collect::<Vec<_>>();
            let examples=sense["examples"].as_array().into_iter().flatten().map(|example|json!({"id":format!("{sid}:x{}",example["ordinal"]),"english":example["text"],"chinese":null,"audio":null})).collect::<Vec<_>>();
            json!({"id":sid,"source_path":format!("/records/{line}/senses/{ordinal}"),"content_kind":"definition","ancestors":ancestors,"meaning":{"en":sense["definition"],"zh":null},"labels":labels(&sense["labels"]),"patterns":[],"examples":examples,"notes":[]})
        }).collect::<Vec<_>>());
    }
    let entries = records.into_values().collect::<Vec<_>>();
    if entries.is_empty() {
        return Ok(empty(query, context, None));
    }
    let mut result = empty(query, context, None);
    result["status"] = json!(if folded { "partial" } else { "found" });
    result["default_entry_id"] = entries[0]["id"].clone();
    result["entries"] = json!(entries);
    if folded {
        result["notices"] = json!([{"code":"local_casefold_candidates","text":"Case-insensitive candidates; check the original headword.","entry_id":null}]);
    }
    Ok(result)
}
/// Saved excerpts remain valid after a pack is removed. This checks provenance,
/// not installation state, and deliberately leaves the online validator alone.
pub fn valid_source(source: &Value, headword: &str) -> bool {
    let id = text(source, "entry_key");
    let line = id
        .strip_prefix(&format!("wiktionary:{RELEASE}:r"))
        .and_then(|s| s.parse::<u64>().ok());
    source["provider"] == "wiktionary"
        && source["dataset"] == "English Wiktionary"
        && source["adapter_version"] == ADAPTER
        && source["release"] == RELEASE
        && source["edition"].is_null()
        && source["retrieved_at"].is_null()
        && line.is_some_and(|n| n > 0 && source["locator"] == format!("/records/{n}"))
        && ["access_channel", "service_url", "received_at"]
            .iter()
            .all(|k| source.get(k).is_none())
        && text(source, "content_hash").len() == 64
        && text(source, "content_hash")
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        && ["source_revision", "source_page"]
            .iter()
            .all(|k| text(source, k).parse::<u64>().is_ok_and(|n| n > 0))
        && source["license"]
            == json!({"name":"CC BY-SA 4.0","url":"https://creativecommons.org/licenses/by-sa/4.0/"})
        && source["attribution"] == ATTRIBUTION
        && source["modifications"] == MODIFICATIONS
        && super::free_dictionary::source_identity(text(source, "entry_url"), headword)
}
pub fn valid_sense(source: &Value, sense: &Value) -> bool {
    let id = text(source, "entry_key");
    let locator = text(source, "locator");
    let path = text(sense, "source_path");
    let ordinal = path
        .strip_prefix(&format!("{locator}/senses/"))
        .and_then(|s| s.parse::<u64>().ok());
    if ordinal.is_none()
        || sense["id"] != format!("{id}:s{}", ordinal.unwrap())
        || sense["content_kind"] != "definition"
        || sense["meaning"]["zh"] != Value::Null
        || text(&sense["meaning"], "en").trim().is_empty()
    {
        return false;
    }
    let Some(parents) = sense["ancestors"].as_array() else {
        return false;
    };
    parents.len() <= 32
        && parents.iter().enumerate().all(|(i, p)| {
            p["source_path"] == format!("{path}/ancestors/{i}")
                && p["meaning"]["zh"].is_null()
                && !text(&p["meaning"], "en").trim().is_empty()
                && p["labels"].is_array()
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn daily() -> Pack {
        Pack::open(
            &Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("resources/dictionaries/daily/dictionary.sqlite3"),
            "daily",
        )
        .unwrap()
    }
    #[test]
    fn pronunciations_keep_other_regions_and_usage_qualifiers_explicit() {
        let items = pronunciations(
            &json!([{"notation":"ipa","text":"/a/","labels":{"tags":["Australia"]}},{"notation":"ipa","text":"/b/","labels":{"tags":["US","Canada"]}},{"notation":"ipa","text":"/c/","labels":{"tags":["UK","rare"]}}]),
        );
        assert_eq!(items[0]["form_label"], "Australia");
        assert_eq!(items[0]["region"], "unspecified");
        assert!(items[1]["form_label"].is_null());
        assert_eq!(items[1]["region"], "us");
        assert_eq!(items[2]["form_label"], "rare");
    }
    #[test]
    fn typescript_fixture_is_the_actual_rust_projection() {
        let expected: Value = serde_json::from_str(include_str!(
            "../../../src/lib/__tests__/fixtures/wiktionary-local-v2.json"
        ))
        .unwrap();
        assert_eq!(
            query(
                &[daily()],
                "soliloquy",
                Some("An original reading sentence.")
            )
            .unwrap(),
            expected
        );
    }
    fn schema() -> jsonschema::JSONSchema {
        jsonschema::JSONSchema::options()
            .with_draft(jsonschema::Draft::Draft202012)
            .compile(
                &serde_json::from_str(include_str!(
                    "../../../docs/implementation/dictionary-result-v1.schema.json"
                ))
                .unwrap(),
            )
            .unwrap()
    }
    #[test]
    fn real_adapter_preserves_source_scope_case_and_misses() {
        let p = daily();
        let validator = schema();
        for word in [
            "US",
            "us",
            "RNA",
            "pneumonia",
            "soliloquy",
            "record",
            "taking off",
            "chickenpox",
            "colour",
            "photosynthesis",
            "monologue",
            "The",
        ] {
            let result = query(std::slice::from_ref(&p), word, None).unwrap();
            if let Err(errors) = validator.validate(&result) {
                panic!(
                    "{word}: {:?}",
                    errors.map(|e| e.to_string()).collect::<Vec<_>>()
                );
            };
        }
        let upper = query(std::slice::from_ref(&p), "US", None).unwrap();
        let lower = query(std::slice::from_ref(&p), "us", None).unwrap();
        assert_ne!(upper["default_entry_id"], lower["default_entry_id"]);
        assert!(upper["entries"]
            .as_array()
            .unwrap()
            .iter()
            .all(|e| e["headword"] != "us"));
        for missing in [
            "pay attention to",
            "work from home",
            "one-man show",
            "xyzzy not a source phrase",
        ] {
            assert_eq!(
                query(std::slice::from_ref(&p), missing, None).unwrap()["status"],
                "not_found"
            );
        }
        assert_eq!(fold("Straße ﬃ Σς"), "strasse ffi σσ");
    }
    #[test]
    #[ignore = "Writes an explicitly requested fixture from the actual bundled pack"]
    fn export_local_dictionary_fixture() {
        let p = daily();
        let result = query(&[p], "soliloquy", Some("An original reading sentence.")).unwrap();
        let out = std::env::var("LEXICUE_LOCAL_FIXTURE_OUTPUT").expect("Set output path");
        std::fs::write(out, serde_json::to_vec_pretty(&result).unwrap()).unwrap();
    }
    #[test]
    fn daily_real_queries_keep_identity_and_context() {
        let p = Pack::open(
            &Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("resources/dictionaries/daily/dictionary.sqlite3"),
            "daily",
        )
        .unwrap();
        for q in [
            "pneumonia",
            "soliloquy",
            "chickenpox",
            "RNA",
            "went",
            "taking off",
        ] {
            let result = query(std::slice::from_ref(&p), q, Some("reading sentence")).unwrap();
            assert!(!result["entries"].as_array().unwrap().is_empty(), "{q}");
            for e in result["entries"].as_array().unwrap() {
                assert!(valid_source(&e["source"], text(e, "headword")));
                for s in e["groups"][0]["senses"].as_array().unwrap() {
                    assert!(valid_sense(&e["source"], s));
                }
            }
        }
    }
    #[test]
    fn decode_rejects_trailing_and_incomplete() {
        use std::io::Write;
        let mut encoder =
            flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(b"{}").unwrap();
        let blob = encoder.finish().unwrap();
        assert!(decode(&blob).is_ok());
        assert!(decode(&blob[..blob.len() - 1]).is_err());
        let mut trailing = blob;
        trailing.push(0);
        assert!(decode(&trailing).is_err());
    }
}
