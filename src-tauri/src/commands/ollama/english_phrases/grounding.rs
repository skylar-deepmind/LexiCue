//! A new constrained retry, never an offset repair of an invalid response.
use super::{extraction_schema, normalized, validate_candidate, Candidate, SegmentRow};
use crate::commands::{english, ollama::parse_ai_json};
use serde_json::{json, Value};

pub(super) fn retry_schema(response: &str, segments: &[SegmentRow]) -> Value {
    let mut choices = Vec::new();
    if let Ok(value) = parse_ai_json::<Value>(response) {
        if let Some(items) = value.get("phrases").and_then(Value::as_array) {
            for item in items.iter().take(32) {
                let Ok(mut candidate) = serde_json::from_value::<Candidate>(item.clone()) else {
                    continue;
                };
                let Some(segment) = segments.iter().find(|s| s.index == candidate.segment_index)
                else {
                    continue;
                };
                candidate.canonical = normalized(&candidate.canonical);
                let words: Vec<_> = candidate.canonical.split_whitespace().collect();
                if !(2..=8).contains(&words.len()) {
                    continue;
                }
                let tokens = english::tokenize_english_text(&segment.text);
                let mut paths = vec![Vec::new()];
                for word in words {
                    let mut next = Vec::new();
                    for positions in &paths {
                        for (surface, position) in &tokens {
                            if !english::surface_matches_lemma(surface, word) {
                                continue;
                            }
                            if positions.last().is_some_and(|last| {
                                position <= last
                                    || (candidate.category != "phrasal_verb"
                                        && *position != last + 1)
                            }) {
                                continue;
                            }
                            let mut path = positions.clone();
                            path.push(*position);
                            next.push(path);
                            if next.len() >= 64 {
                                break;
                            }
                        }
                        if next.len() >= 64 {
                            break;
                        }
                    }
                    paths = next;
                }
                for positions in paths {
                    candidate.token_positions = positions;
                    if validate_candidate(&candidate, segment).is_some() {
                        let choice = json!({"type":"object","properties":{
                            "segment_index":{"const":candidate.segment_index},
                            // LiteRT's tokenizer can fail committing forced
                            // multiword strings. Keep text generated and validate
                            // it against the source again; constrain the offsets.
                            "canonical":{"type":"string"},
                            "category":{"const":candidate.category},
                            "token_positions":{"const":candidate.token_positions}
                        },"required":["segment_index","canonical","category","token_positions"],"additionalProperties":false});
                        if !choices.contains(&choice) {
                            choices.push(choice);
                        }
                    }
                }
            }
        }
    }
    let mut schema = extraction_schema();
    if choices.is_empty() {
        schema["properties"]["phrases"]["maxItems"] = json!(0);
    } else {
        schema["properties"]["phrases"]["items"] = json!({"anyOf":choices});
        schema["properties"]["phrases"]["maxItems"] = json!(choices.len());
    }
    schema
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_words_offer_only_source_verified_choices_on_a_new_request() {
        let source = [SegmentRow {
            index: 1,
            text: "We need to listen and listen and listen to hundreds of hours of English.".into(),
        }];
        let invalid = r#"{"phrases":[{"canonical":"listen to","category":"phrasal_verb","segment_index":1,"token_positions":[2,8]}]}"#;
        assert!(super::super::parsing::candidates(invalid, &source)
            .unwrap()
            .items
            .is_empty());
        let schema = retry_schema(invalid, &source);
        let choices = schema["properties"]["phrases"]["items"]["anyOf"]
            .as_array()
            .unwrap();
        assert_eq!(choices.len(), 3);
        for (choice, start) in choices.iter().zip([3, 5, 7]) {
            assert_eq!(
                choice["properties"]["token_positions"]["const"],
                json!([start, 8])
            );
        }
    }

    #[test]
    fn hallucinations_and_discontinuous_collocations_cannot_enter_retry_choices() {
        let source = [SegmentRow {
            index: 0,
            text: "We break up the ice.".into(),
        }];
        for (canonical, category) in [("invent words", "idiom"), ("break the ice", "collocation")] {
            let response = json!({"phrases":[{"segment_index":0,"canonical":canonical,"category":category,"token_positions":[0,1]}]}).to_string();
            assert_eq!(
                retry_schema(&response, &source)["properties"]["phrases"]["maxItems"],
                0
            );
        }
    }
}
