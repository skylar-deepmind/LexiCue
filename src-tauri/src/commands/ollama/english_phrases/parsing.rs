use super::{key, normalized, validate_candidate, Candidate, Interpretation, OtherSense, SegmentRow};
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
    let array = value.get(field).and_then(Value::as_array).or_else(|| {
        // Some JSON-only models use a generic wrapper despite the requested
        // schema. Item validation below still checks every required field.
        if field == "interpretations" {
            ["phrases", "results", "items"].iter()
                .find_map(|alias| value.get(*alias).and_then(Value::as_array))
        } else { None }
    });
    array.cloned()
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

pub(super) fn interpretations(response: &str, candidates: &[&Candidate]) -> Result<ParseOutcome<Interpretation>, String> {
    let raw = items(response, "interpretations")?;
    let mut output = ParseOutcome { items: Vec::new(), raw_count: raw.len(), skipped_count: 0, recovered_count: 0, missing_fields: BTreeSet::new() };
    let lookup: HashSet<String> = candidates.iter().map(|candidate| key(candidate.segment_index, &candidate.canonical, &candidate.token_positions)).collect();
    let mut seen = HashSet::new();
    for item in raw {
        let Some(mut object) = item.as_object().cloned() else { output.skipped_count += 1; continue; };
        missing_fields(&object, &["segment_index", "canonical", "token_positions", "supported", "meaning_en", "usage_en", "meaning_zh", "usage_zh"], &mut output.missing_fields);
        if object.get("supported") == Some(&Value::Bool(false)) {
            object.entry("meaning_en").or_insert_with(|| Value::String(String::new()));
            object.entry("usage_en").or_insert_with(|| Value::String(String::new()));
            object.entry("meaning_zh").or_insert_with(|| Value::String(String::new()));
            object.entry("usage_zh").or_insert_with(|| Value::String(String::new()));
        }
        if !object.contains_key("segment_index") {
            let canonical = object.get("canonical").and_then(Value::as_str);
            let positions = object.get("token_positions").and_then(Value::as_array)
                .and_then(|array| array.iter().map(|value| value.as_i64().and_then(|n| i32::try_from(n).ok())).collect::<Option<Vec<_>>>());
            let matches: Vec<_> = candidates.iter().filter(|candidate| {
                canonical.map(normalized).as_deref() == Some(candidate.canonical.as_str())
                    && positions.as_ref() == Some(&candidate.token_positions)
            }).collect();
            if matches.len() == 1 {
                object.insert("segment_index".into(), Value::from(matches[0].segment_index));
                output.recovered_count += 1;
            } else {
                output.skipped_count += 1;
                continue;
            }
        }
        // Optional enrichment must not invalidate a sound context meaning.
        // A sense ID is still checked against retrieved Collins senses later.
        let sense_id = object.get("collins_sense_id").and_then(|value| {
            value.as_i64().or_else(|| value.as_str().and_then(|text| text.parse::<i64>().ok()))
        });
        object.insert("collins_sense_id".into(), sense_id.map(Value::from).unwrap_or(Value::Null));
        let other_senses = object.get("other_senses").and_then(Value::as_array)
            .map(|values| values.iter().filter(|value| serde_json::from_value::<OtherSense>((*value).clone()).is_ok()).take(2).cloned().collect())
            .unwrap_or_default();
        object.insert("other_senses".into(), Value::Array(other_senses));
        let Some(interpretation) = decode::<Interpretation>(object) else { output.skipped_count += 1; continue; };
        let item_key = key(interpretation.segment_index, &interpretation.canonical, &interpretation.token_positions);
        if !lookup.contains(&item_key) || !seen.insert(item_key) || (interpretation.supported && (interpretation.meaning_en.trim().is_empty() || interpretation.usage_en.trim().is_empty() || interpretation.meaning_zh.trim().is_empty() || interpretation.usage_zh.trim().is_empty())) {
            output.skipped_count += 1;
            continue;
        }
        output.items.push(interpretation);
    }
    Ok(output)
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
    fn explanation_recovers_unique_index_and_rejects_ambiguous_or_missing_meaning() {
        let one = Candidate { segment_index: 4, canonical: "pick up".into(), token_positions: vec![1,3], category: "phrasal_verb".into() };
        let two = Candidate { segment_index: 5, ..one.clone() };
        let response = r#"{"interpretations":[{"canonical":"pick up","token_positions":[1,3],"supported":true,"meaning_en":"lift","usage_en":"separable","meaning_zh":"拾起","usage_zh":"可分离","other_senses":[]}]}"#;
        let unique = interpretations(response, &[&one]).unwrap();
        assert_eq!(unique.items.len(), 1);
        assert_eq!(unique.items[0].segment_index, 4);
        let ambiguous = interpretations(response, &[&one, &two]).unwrap();
        assert_eq!((ambiguous.items.len(), ambiguous.skipped_count), (0, 1));
        let missing_meaning = interpretations(r#"{"interpretations":[{"segment_index":4,"canonical":"pick up","token_positions":[1,3],"supported":true,"meaning_en":"lift","usage_en":"separable","usage_zh":"可分离"}]}"#, &[&one]).unwrap();
        assert_eq!((missing_meaning.items.len(), missing_meaning.skipped_count), (0, 1));
    }

    #[test]
    fn explanation_accepts_common_array_wrappers_only_when_items_are_valid() {
        let candidate = Candidate { segment_index: 4, canonical: "pick up".into(), token_positions: vec![1,3], category: "phrasal_verb".into() };
        let valid = r#"{"results":[{"segment_index":4,"canonical":"pick up","token_positions":[1,3],"supported":true,"meaning_en":"lift","usage_en":"separable","meaning_zh":"拾起","usage_zh":"可分离"}]}"#;
        assert_eq!(interpretations(valid, &[&candidate]).unwrap().items.len(), 1);
        let invalid = r#"{"phrases":[{"segment_index":4,"canonical":"pick up","token_positions":[1,3]}]}"#;
        assert_eq!(interpretations(invalid, &[&candidate]).unwrap().skipped_count, 1);
    }

    #[test]
    fn malformed_optional_enrichment_does_not_discard_context_meaning() {
        let candidate = Candidate { segment_index: 4, canonical: "pick up".into(), token_positions: vec![1,3], category: "phrasal_verb".into() };
        let response = r#"{"interpretations":[{"segment_index":4,"canonical":"pick up","token_positions":[1,3],"supported":true,"meaning_en":"lift","usage_en":"separable","meaning_zh":"捡起","usage_zh":"可分离","collins_sense_id":"unknown","other_senses":[{"meaning_en":"learn","example_en":"She picked up French."}]}]}"#;
        let parsed = interpretations(response, &[&candidate]).unwrap();
        assert_eq!(parsed.items.len(), 1);
        assert_eq!(parsed.items[0].collins_sense_id, None);
        assert!(parsed.items[0].other_senses.is_empty());
    }
}
