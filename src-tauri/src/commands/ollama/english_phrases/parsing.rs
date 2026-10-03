use super::{key, normalized, validate_candidate, Candidate, SegmentRow};
use crate::commands::ollama::parse_ai_json;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value};
use std::collections::{BTreeSet, HashSet};

pub(super) struct ParseOutcome<T> {
    pub items: Vec<T>,
    pub raw_count: usize,
    pub skipped_count: usize,
    pub recovered_count: usize,
    pub missing_fields: BTreeSet<String>,
}

fn items(response: &str, field: &str) -> Result<Vec<Value>, String> {
    if response.trim().is_empty() { return Err("empty_response".into()); }
    let value: Value = parse_ai_json(response).map_err(|_| "invalid_json".to_string())?;
    value.get(field).and_then(Value::as_array).cloned()
        .ok_or_else(|| format!("missing_{field}_array"))
}

fn missing_fields(object: &Map<String, Value>, required: &[&str], found: &mut BTreeSet<String>) {
    for field in required {
        if !object.contains_key(*field) { found.insert((*field).to_string()); }
    }
}

fn decode<T: DeserializeOwned>(object: Map<String, Value>) -> Option<T> {
    serde_json::from_value(Value::Object(object)).ok()
}

pub(super) fn candidates(response: &str, segments: &[SegmentRow]) -> Result<ParseOutcome<Candidate>, String> {
    let raw = items(response, "phrases")?;
    let mut output = ParseOutcome { items: Vec::new(), raw_count: raw.len(), skipped_count: 0, recovered_count: 0, missing_fields: BTreeSet::new() };
    let mut seen = HashSet::new();
    for item in raw {
        let Some(mut object) = item.as_object().cloned() else { output.skipped_count += 1; continue; };
        missing_fields(&object, &["segment_index", "canonical", "token_positions", "category"], &mut output.missing_fields);
        let missing_index = !object.contains_key("segment_index");
        if missing_index {
            let matches: Vec<Candidate> = segments.iter().filter_map(|segment| {
                object.insert("segment_index".into(), Value::from(segment.index));
                let candidate: Candidate = decode(object.clone())?;
                validate_candidate(&candidate, segment).map(|_| candidate)
            }).collect();
            if matches.len() == 1 {
                object.insert("segment_index".into(), Value::from(matches[0].segment_index));
                output.recovered_count += 1;
            } else {
                output.skipped_count += 1;
                continue;
            }
        }
        let Some(mut candidate) = decode::<Candidate>(object) else { output.skipped_count += 1; continue; };
        let valid = segments.iter().any(|segment| validate_candidate(&candidate, segment).is_some());
        if !valid { output.skipped_count += 1; continue; }
        candidate.canonical = normalized(&candidate.canonical);
        if seen.insert(key(candidate.segment_index, &candidate.canonical, &candidate.token_positions)) {
            output.items.push(candidate);
        } else {
            output.skipped_count += 1;
        }
    }
    Ok(output)
}

/// Scan only complete objects in the root phrases array. Final parsing remains
/// authoritative; unsupported prefixes (including Markdown) simply defer preview.
pub(super) struct IncrementalCandidates<'a> {
    segments: &'a [SegmentRow], text: String, cursor: usize, stack: Vec<u8>,
    string_start: Option<usize>, escaped: bool, root_key: String, last: u8,
    phrases: bool, item_start: Option<usize>, seen: HashSet<String>, disabled: bool,
}

impl<'a> IncrementalCandidates<'a> {
    pub fn new(segments: &'a [SegmentRow]) -> Self {
        Self { segments, text: String::new(), cursor: 0, stack: Vec::new(), string_start: None,
            escaped: false, root_key: String::new(), last: 0, phrases: false,
            item_start: None, seen: HashSet::new(), disabled: false }
    }
    pub fn push(&mut self, fragment: &str) -> Vec<Candidate> {
        self.text.push_str(fragment);
        let mut output = Vec::new();
        while !self.disabled && self.cursor < self.text.len() {
            let index = self.cursor;
            let byte = self.text.as_bytes()[index];
            self.cursor += 1;
            if let Some(start) = self.string_start {
                if self.escaped { self.escaped = false; }
                else if byte == b'\\' { self.escaped = true; }
                else if byte == b'"' {
                    self.string_start = None;
                    if self.stack == [b'{'] {
                        self.root_key = serde_json::from_str::<String>(&self.text[start..=index]).unwrap_or_default();
                    }
                    self.last = byte;
                }
                continue;
            }
            if byte.is_ascii_whitespace() { continue; }
            if self.stack.is_empty() && self.last == 0 && byte != b'{' { self.disabled = true; break; }
            match byte {
                b'"' => self.string_start = Some(index),
                b'[' => {
                    if self.stack == [b'{'] && self.root_key == "phrases" && self.last == b':' { self.phrases = true; }
                    self.stack.push(byte);
                }
                b'{' => {
                    if self.phrases && self.stack == [b'{', b'['] { self.item_start = Some(index); }
                    self.stack.push(byte);
                }
                b'}' | b']' => {
                    if self.stack.pop() != Some(if byte == b'}' { b'{' } else { b'[' }) { self.disabled = true; break; }
                    if byte == b'}' && self.phrases && self.stack == [b'{', b'['] {
                        if let Some(start) = self.item_start.take() {
                            let wrapped = format!("{{\"phrases\":[{}]}}", &self.text[start..=index]);
                            if let Ok(parsed) = candidates(&wrapped, self.segments) {
                                for candidate in parsed.items {
                                    if self.seen.insert(key(candidate.segment_index, &candidate.canonical, &candidate.token_positions)) { output.push(candidate); }
                                }
                            }
                        }
                    }
                    if byte == b']' && self.stack == [b'{'] { self.phrases = false; }
                }
                _ => {}
            }
            self.last = byte;
        }
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(index: i32, text: &str) -> SegmentRow {
        SegmentRow { index, text: text.into() }
    }

    #[test]
    fn missing_segment_index_is_recovered_only_by_unique_exact_tokens() {
        let response = r#"{"phrases":[{"canonical":"blow up","token_positions":[7,8],"category":"phrasal_verb"}]}"#;
        let unique = candidates(response, &[segment(12, "Like, you know, my channel kind of blew up.")]).unwrap();
        assert_eq!(unique.items.len(), 1);
        assert_eq!(unique.items[0].segment_index, 12);
        assert_eq!(unique.recovered_count, 1);
        let repeated = candidates(response, &[segment(12, "Like, you know, my channel kind of blew up."), segment(13, "Like, you know, my channel kind of blew up.")]).unwrap();
        assert!(repeated.items.is_empty());
        assert_eq!(repeated.skipped_count, 1);
    }

    #[test]
    fn malformed_item_does_not_discard_valid_neighbors() {
        let response = r#"{"phrases":[{"canonical":"pick up","token_positions":[1,3],"category":"phrasal_verb"},{"segment_index":4,"canonical":"look up","category":"phrasal_verb"}]}"#;
        let parsed = candidates(response, &[segment(4, "I picked it up.")]).unwrap();
        assert_eq!(parsed.items.len(), 1);
        assert_eq!(parsed.skipped_count, 1);
        assert!(parsed.missing_fields.contains("token_positions"));
    }

    #[test]
    fn empty_and_broken_json_are_distinct_from_a_valid_empty_array() {
        assert_eq!(candidates("", &[]).err().as_deref(), Some("empty_response"));
        assert_eq!(candidates("{", &[]).err().as_deref(), Some("invalid_json"));
        let empty = candidates(r#"{"phrases":[]}"#, &[]).unwrap();
        assert_eq!((empty.raw_count, empty.skipped_count), (0, 0));
    }

    #[test]
    fn incremental_objects_share_final_validation_and_wait_for_closing_brace() {
        let source = [segment(4, "I'd picked it up, then picked it up.")];
        let first = r#"{"segment_index":4,"canonical":" PICK UP ","token_positions":[1,3],"category":"phrasal_verb","ignored":"🎬 \" } ]"}"#;
        let second = r#"{"segment_index":4,"canonical":"pick up","token_positions":[5,7],"category":"phrasal_verb"}"#;
        let raw = format!("{{\"phrases\":[{first},{first},{second},{{\"canonical\":\"wrong word\"}}]}}");
        let mut parser = IncrementalCandidates::new(&source);
        let mut items = Vec::new();
        for (i,c) in raw.char_indices() {
            let new = parser.push(&c.to_string());
            if i < first.len() + 11 { assert!(new.is_empty()); }
            items.extend(new);
        }
        let final_items = candidates(&raw,&source).unwrap().items;
        assert_eq!(items.len(),2);
        assert_eq!(serde_json::to_value(items).unwrap(),serde_json::to_value(final_items).unwrap());
        let mut fenced = IncrementalCandidates::new(&source);
        assert!(fenced.push(&format!("```json\n{raw}\n```")).is_empty());
        assert_eq!(candidates(&format!("```json\n{raw}\n```"),&source).unwrap().items.len(),2);
    }

}
