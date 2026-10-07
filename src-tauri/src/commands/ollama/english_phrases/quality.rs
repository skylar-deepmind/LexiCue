//! Source-grounded discovery and a small, independent lexical/context review.
//! Fixture annotations never participate in this module.
use super::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

#[derive(Clone, Deserialize)]
struct Entry {
    canonical: String,
    category: String,
    #[serde(default)]
    separable: bool,
    #[serde(default)]
    context_review: bool,
    #[serde(flatten)]
    metadata: english::ExpressionMetadata,
}
#[derive(Deserialize)]
struct Core {
    version: u32,
    entries: Vec<Entry>,
}
fn core() -> &'static Core {
    static CORE: OnceLock<Core> = OnceLock::new();
    CORE.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../../../resources/english-expression-core.json"
        ))
        .expect("checked editorial expression core")
    })
}
fn core_checksum() -> String {
    format!(
        "{:x}",
        Sha256::digest(include_bytes!(
            "../../../../resources/english-expression-core.json"
        ))
    )
}
fn entry(canonical: &str) -> Option<&'static Entry> {
    core().entries.iter().find(|e| e.canonical == canonical)
}

fn lexical_words(canonical: &str) -> (Vec<String>, bool) {
    let words: Vec<_> = canonical.split_whitespace().collect();
    let slots = words.iter().any(|w| {
        [
            "someone",
            "somebody",
            "something",
            "someone's",
            "somebody's",
            "one's",
        ]
        .contains(w)
    });
    let words = words
        .into_iter()
        .filter(|w| {
            ![
                "someone",
                "somebody",
                "something",
                "someone's",
                "somebody's",
                "one's",
            ]
            .contains(w)
        })
        .map(str::to_owned)
        .collect();
    (words, slots)
}
fn canonical_form(text: &str, category: &str) -> String {
    let normalized = normalized(text).replace('’', "'");
    let mut words: Vec<_> = normalized.split_whitespace().map(str::to_owned).collect();
    if words.first().is_some_and(|w| {
        ["i'm", "you're", "we're", "they're", "he's", "she's", "it's"].contains(&w.as_str())
    }) {
        words[0] = "be".into();
    }

    if words
        .first()
        .is_some_and(|w| ["am", "is", "are", "was", "were", "been"].contains(&w.as_str()))
        && !words
            .get(1)
            .is_some_and(|w| ["that", "it", "there", "this"].contains(&w.as_str()))
    {
        words[0] = "be".into();
    }
    if matches!(category, "phrasal_verb" | "collocation" | "idiom") && !words.is_empty() {
        // Reduce a verb only when its recorded analysis is unambiguous.
        let analyses = english::lemma_candidates(&words[0]);
        let verbs: HashSet<_> = analyses
            .iter()
            .filter(|(_, p)| p.as_deref().is_some_and(|p| p.starts_with('v')))
            .map(|(l, _)| l.clone())
            .collect();
        if verbs.len() == 1
            && !analyses.iter().any(|(_, p)| {
                p.as_deref()
                    .is_some_and(|p| p.starts_with('a') || p.starts_with('j'))
            })
        {
            words[0] = verbs.into_iter().next().unwrap();
        }
    }
    let value = words.join(" ");
    if value.starts_with("see you ")
        && words[2..]
            .iter()
            .all(|w| ["tomorrow", "later", "soon", "tonight"].contains(&w.as_str()))
    {
        return "see you".into();
    }

    if value.starts_with("make ")
        && value.ends_with(" day")
        && words.len() == 3
        && ["my", "your", "his", "her", "our", "their", "one's"].contains(&words[1].as_str())
    {
        return "make someone's day".into();
    }
    if value.starts_with("pull ")
        && value.ends_with(" leg")
        && words.len() == 3
        && ["my", "your", "his", "her", "our", "their", "one's"].contains(&words[1].as_str())
    {
        return "pull someone's leg".into();
    }
    if value == "give a heads up" {
        return "give someone a heads up".into();
    }
    value
}

/// Return every verified occurrence, never the first possible gapped path.
/// Slots permit exactly one pronoun/possessive; free gaps require a curated rule.
fn locate(
    canonical: &str,
    category: &str,
    segment: &SegmentRow,
    quote: Option<&str>,
) -> Vec<Accepted> {
    let canonical = normalized(canonical);
    let (mut words, slots) = lexical_words(&canonical);
    if canonical == "what is up" {
        words = vec!["what".into(), "up".into()];
    }
    if words.len() < 2
        || words.len() > 8
        || canonical.len() > 100
        || !CATEGORIES.contains(&category)
    {
        return Vec::new();
    }
    let tokens = english::tokenize_english_text(&segment.text);
    let spans = english::tokenize_english_spans(&segment.text);
    let separable = entry(&canonical).is_some_and(|e| e.separable);
    let mut paths: Vec<Vec<i32>> = vec![Vec::new()];
    for (step, word) in words.iter().enumerate() {
        let mut next = Vec::new();
        for path in &paths {
            for (surface, pos) in &tokens {
                let raw = segment
                    .text
                    .split_whitespace()
                    .nth(*pos as usize)
                    .unwrap_or("")
                    .trim_matches(|c: char| !c.is_alphabetic() && c != '\'')
                    .to_lowercase()
                    .replace('’', "'");
                let copula = word == "be"
                    && [
                        "i'm", "you're", "we're", "they're", "he's", "she's", "it's", "that's",
                        "there's", "here's",
                    ]
                    .contains(&raw.as_str());
                if !english::surface_matches_lemma(surface, word) && raw != *word && !copula {
                    continue;
                }

                if let Some(prev) = path.last() {
                    if pos <= prev {
                        continue;
                    }
                    let gap = pos - prev - 1;
                    if gap > 0 {
                        if slots && step == 1 {
                            if gap != 1 {
                                continue;
                            }
                            let raw = segment
                                .text
                                .split_whitespace()
                                .nth((prev + 1) as usize)
                                .unwrap_or("")
                                .trim_matches(|c: char| !c.is_alphabetic())
                                .to_lowercase();
                            if ![
                                "me", "you", "him", "her", "us", "them", "it", "my", "your", "his",
                                "our", "their",
                            ]
                            .contains(&raw.as_str())
                            {
                                continue;
                            }
                        } else if !(separable && step == 1 && gap <= 6) {
                            continue;
                        }
                        // A gap cannot cross punctuation or a coordinated clause.
                        let between = segment
                            .text
                            .split_whitespace()
                            .skip((prev + 1) as usize)
                            .take(gap as usize)
                            .collect::<Vec<_>>();
                        if between.iter().any(|w| {
                            w.contains([',', ';', '.', ':', '!', '?'])
                                || ["and", "but", "or", "because", "then", "while"]
                                    .contains(&w.to_lowercase().as_str())
                                || (separable
                                    && english::surface_matches_lemma(
                                        &w.trim_matches(|c: char| !c.is_alphabetic())
                                            .to_lowercase(),
                                        &words[0],
                                    ))
                        }) {
                            continue;
                        }
                    }
                }
                let mut new = path.clone();
                new.push(*pos);
                next.push(new);
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
    let quote = quote.map(normalized);
    paths
        .into_iter()
        .filter_map(|positions| {
            let first = spans.iter().find(|s| s.position == positions[0])?;
            let last_position = *positions.last()?;
            let last = spans.iter().find(|s| s.position == last_position)?;
            // Convert UTF-16 offsets back to a source slice without losing Unicode.
            let enclosed = String::from_utf16_lossy(
                &segment
                    .text
                    .encode_utf16()
                    .skip(first.start)
                    .take(last.end - first.start)
                    .collect::<Vec<_>>(),
            );
            if let Some(q) = &quote {
                if !normalized(&segment.text).contains(q) || !q.contains(&normalized(&enclosed)) {
                    return None;
                }
            }
            let surface = positions
                .iter()
                .filter_map(|p| spans.iter().find(|span| span.position == *p))
                .map(|span| {
                    String::from_utf16_lossy(
                        &segment
                            .text
                            .encode_utf16()
                            .skip(span.start)
                            .take(span.end - span.start)
                            .collect::<Vec<_>>(),
                    )
                })
                .collect::<Vec<_>>()
                .join(" ");
            Some(Accepted {
                candidate: Candidate {
                    segment_index: segment.index,
                    canonical: canonical.clone(),
                    token_positions: positions,
                    category: category.into(),
                },
                surface,
                metadata: entry(&canonical)
                    .map(|e| e.metadata.clone())
                    .unwrap_or_default(),
            })
        })
        .collect()
}
fn eligible(item: &Accepted, segment: &SegmentRow) -> bool {
    if entry(&item.candidate.canonical).is_some() {
        return true;
    }
    let (words, _) = lexical_words(&item.candidate.canonical);
    let closed = |w: &str| {
        "i you he she we they me him her us them my your his our their it its this that these those the a an of to in on at by for with from as and or but if is am are was were be been being do does did have has had can could will would may might must should not no any some each other zero one two three four five six seven eight nine ten".split_whitespace().any(|s|s==w)
    };
    let lexical_support = words
        .iter()
        .enumerate()
        .filter(|(index, word)| {
            ["do", "have"].contains(&word.as_str())
                && words.get(index + 1).is_some_and(|next| {
                    !closed(next)
                        && english::lemma_candidates(next)
                            .iter()
                            .any(|(_, pos)| pos.as_deref().is_some_and(|p| p.starts_with('n')))
                })
        })
        .count();
    let content = words.iter().filter(|w| !closed(w)).count() + lexical_support;
    let last = *item.candidate.token_positions.last().unwrap();
    let raw: Vec<_> = segment.text.split_whitespace().collect();
    let closed_clause = raw
        .get(last as usize)
        .is_some_and(|w| w.contains(['.', '?', '!', ',', ';', ':', '"', '”']));
    if words.len() == 2
        && ["i", "you", "he", "she", "we", "they"].contains(&words[0].as_str())
        && !closed_clause
        && english::lemma_candidates(&words[1])
            .iter()
            .any(|(_, p)| p.as_deref().is_some_and(|p| p.starts_with('v')))
    {
        return false;
    }
    if content == 0 && !closed_clause {
        return false;
    }
    if item.candidate.category == "collocation" && content < 2 {
        return false;
    }
    let next = raw
        .get(last as usize + 1)
        .map(|w| w.trim_matches(|c: char| !c.is_alphabetic()).to_lowercase());
    let is_verb = |w: &str| {
        english::lemma_candidates(w)
            .iter()
            .any(|(_, p)| p.as_deref().is_some_and(|p| p.starts_with('v')))
    };
    // A final infinitival marker or a head cut off before its complement is
    // grammar, not the proposed complete lexical expression.
    if words.last().is_some_and(|w| w == "to") && next.as_deref().is_some_and(is_verb) {
        return false;
    }
    if next.as_deref() == Some("to") && words.last().is_some_and(|w| is_verb(w)) {
        return false;
    }
    true
}
fn remove_fragments(items: &mut Vec<Accepted>, segments: &[SegmentRow]) {
    let established: Vec<_> = items
        .iter()
        .filter(|i| entry(&i.candidate.canonical).is_some())
        .map(|i| {
            (
                i.candidate.segment_index,
                i.candidate.token_positions.clone(),
            )
        })
        .collect();
    items.retain(|i| {
        let Some(s) = segments
            .iter()
            .find(|s| s.index == i.candidate.segment_index)
        else {
            return false;
        };
        if !eligible(i, s) {
            return false;
        }
        if entry(&i.candidate.canonical).is_some() {
            return true;
        }
        !established.iter().any(|(index, pos)| {
            *index == i.candidate.segment_index
                && pos.len() > i.candidate.token_positions.len()
                && pos.iter().any(|p| i.candidate.token_positions.contains(p))
        })
    });
}

#[derive(Deserialize)]
struct Discovery {
    kind: String,
    // Keep classification before free text in the native JSON grammar.
    text: String,
}
fn discovery_schema(_segment_index: i32) -> Value {
    json!({"type":"object","properties":{"kind":{"type":"string","enum":["phrasal_verb","idiom","fixed_expression","collocation","none"]},"text":{"type":"string"}},"required":["kind","text"],"additionalProperties":false})
}
fn discovery_prompt(segment: &SegmentRow, context: &[SegmentRow], known: &[Accepted]) -> String {
    let known: std::collections::BTreeSet<_> = known
        .iter()
        .filter(|i| {
            entry(&i.candidate.canonical).is_some()
                && i.candidate
                    .token_positions
                    .windows(2)
                    .all(|w| w[1] == w[0] + 1)
        })
        .map(|i| i.candidate.canonical.as_str())
        .collect();
    let known = known.into_iter().collect::<Vec<_>>().join(", ");
    format!(
        r#"Find ONE additional reusable multi-word English expression in TARGET: a phrasal verb, idiom, conversational formula (including slang), strong useful collocation or technical term. Choose the most useful complete expression. text is its complete dictionary headword. kind is phrasal_verb, idiom, fixed_expression, collocation or none.
Already located: {known}. Do not repeat those headwords. A larger different expression is welcome. Exclude ordinary grammar fragments, temporary objects and proper names. Keep complete articles/prepositions. Examples: picked it up -> pick up; heavy rain; no cap (honestly). Do not treat a missing bottle cap as slang. Examples are not TARGET.
Return JSON only, with kind first and text. If none is suitable: {{"kind":"none","text":""}}. Do not output subtitle or token numbers. CONTEXT is read-only; extract only TARGET.
CONTEXT: {}
TARGET: {}"#,
        context_text(segment, context),
        segment.text
    )
}

#[derive(Clone, Deserialize)]
struct Profile {
    kind: String,
    meaning: String,
}
#[derive(Deserialize)]
struct Annotation {
    category: String,
    register: String,
    caution: String,
}
pub(super) fn profile_schema() -> Value {
    json!({"type":"object","properties":{"kind":{"type":"string","enum":["phrasal_verb","idiom","fixed_expression","collocation","none"]},"meaning":{"type":"string"}},"required":["kind","meaning"],"additionalProperties":false})
}
pub(super) fn profile_prompt(canonical: &str) -> String {
    format!(
        r#"Act as an English learner's dictionary for ONE proposed headword. An established phrasal verb, idiom, conversational/slang formula, useful collocation or technical term is valid. Proper names, ordinary grammar fragments, arbitrary temporary verb+object combinations and color/number+noun descriptions are kind=none. Examples: have a go=fixed_expression; heavy rain=collocation; spill the tea=idiom; read the report=none. Return JSON kind and one short conventional meaning (max 15 words). For none, meaning="". HEADWORD: {canonical}"#
    )
}

pub(super) fn sense_pair(canonical: &str) -> Option<(&'static str, &'static str, &'static str)> {
    match canonical {
        "see you" => Some((
            "farewell",
            "visual",
            "farewell = saying goodbye before a future meeting; visual = visually seeing someone",
        )),
        "no cap" => Some((
            "honestly",
            "lid",
            "honestly = not lying or exaggerating; lid = a physical cap or lid is missing",
        )),
        "spill the tea" => Some((
            "gossip",
            "drink",
            "gossip = tell private news; drink = spill a liquid drink",
        )),
        "throw shade" => Some((
            "criticism",
            "shadow",
            "criticism = express indirect contempt; shadow = an object creates physical shade",
        )),
        "take the piss" => Some((
            "mocking",
            "urine",
            "mocking = mock or joke about someone; urine = literally mention urine",
        )),
        "break the ice" => Some((
            "comfort",
            "frozen",
            "comfort = make people comfortable together; frozen = physically break frozen water",
        )),
        _ => None,
    }
}
fn context_text(segment: &SegmentRow, segments: &[SegmentRow]) -> String {
    // Most subtitles already contain their own context. Short utterances retain
    // adjacent turns without making E2B solve several independent sentences.
    if segment.text.split_whitespace().count() > 8 {
        return String::new();
    }
    segments
        .iter()
        .filter(|s| (s.index - segment.index).abs() == 1)
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join(" ")
}
pub(super) fn sense_prompt(
    item: &Accepted,
    segment: &SegmentRow,
    segments: &[SegmentRow],
    options: &str,
    field: &str,
) -> String {
    let output = if field == "meaning" {
        "Return JSON with meaning equal to one label."
    } else {
        "Return JSON with integer meaning_index equal to the selected number."
    };
    format!("What does '{}' mean in this sentence? Choose the label/number for its actual meaning. {output}\nCHOICES: {options}\nSENTENCE: {}\nNEARBY CONTEXT: {}",item.candidate.canonical,segment.text,context_text(segment,segments))
}
fn phrasal_shape(item: &Accepted, segment: &SegmentRow) -> bool {
    let (words, _) = lexical_words(&item.candidate.canonical);
    let particles="up down in out on off over back away around through into about after for with to at upon without across by along together";
    if !(2..=3).contains(&words.len())
        || words[0] == "be"
        || !particles.split_whitespace().any(|p| p == words[1])
    {
        return false;
    }
    if words.len() == 3
        && !"to of for with on at into from"
            .split_whitespace()
            .any(|p| p == words[2])
    {
        return false;
    }
    if !english::lemma_candidates(&words[0])
        .iter()
        .any(|(_, p)| p.as_deref().is_some_and(|p| p.starts_with('v')))
    {
        return false;
    }
    let pos = item.candidate.token_positions[0] as usize;
    let tokens: Vec<_> = segment.text.split_whitespace().collect();
    if pos > 0
        && ["is", "am", "are", "was", "were", "be", "been"]
            .contains(&tokens[pos - 1].to_lowercase().as_str())
    {
        let raw = tokens[pos]
            .trim_matches(|c: char| !c.is_alphabetic())
            .to_lowercase();
        if raw == words[0]
            && ![
                "set", "put", "cut", "hit", "read", "let", "shut", "hurt", "bet", "spread",
                "split", "cast", "cost",
            ]
            .contains(&raw.as_str())
        {
            return false;
        }
    }
    true
}
fn annotation_schema(phrasal_ok: bool) -> Value {
    let categories: Vec<_> = CATEGORIES
        .iter()
        .copied()
        .filter(|c| phrasal_ok || *c != "phrasal_verb")
        .chain(std::iter::once("none"))
        .collect();
    json!({"type":"object","properties":{"category":{"type":"string","enum":categories},"register":{"type":"string","enum":["neutral","informal","slang","unknown"]},"caution":{"type":"string","enum":["none","offensive"]}},"required":["category","register","caution"],"additionalProperties":false})
}
fn complete_response(value: &Value, schema: &Value) -> bool {
    let properties = &schema["properties"];
    if properties.get("text").is_some() {
        return serde_json::from_value::<Discovery>(value.clone())
            .is_ok_and(|d| CATEGORIES.contains(&d.kind.as_str()) || d.kind == "none");
    }
    if properties.get("kind").is_some() {
        let Ok(p) = serde_json::from_value::<Profile>(value.clone()) else {
            return false;
        };
        return (CATEGORIES.contains(&p.kind.as_str()) || p.kind == "none")
            && (p.kind == "none" || !p.meaning.trim().is_empty())
            && p.meaning.len() <= 250;
    }
    if let Some(options) = properties
        .get("meaning")
        .and_then(|p| p.get("enum"))
        .and_then(Value::as_array)
    {
        return value.get("meaning").is_some_and(|v| options.contains(v));
    }
    if let Some(options) = properties
        .get("meaning_index")
        .and_then(|p| p.get("enum"))
        .and_then(Value::as_array)
    {
        return value
            .get("meaning_index")
            .is_some_and(|v| options.contains(v));
    }
    let Ok(a) = serde_json::from_value::<Annotation>(value.clone()) else {
        return false;
    };
    properties["category"]["enum"]
        .as_array()
        .is_some_and(|options| options.contains(&Value::from(a.category.clone())))
        && ["neutral", "informal", "slang", "unknown"].contains(&a.register.as_str())
        && ["none", "offensive"].contains(&a.caution.as_str())
}

fn request_prompt(config: &AiConfig, prompt: String, schema: &Value) -> String {
    // OpenAI-compatible endpoints use json_object rather than native schema
    // decoding. They need the exact fields/enums in the prompt as well.
    if config.is_gemma() {
        prompt
    } else {
        format!("{prompt}\nRequired output JSON schema: {schema}")
    }
}

async fn ask(
    p: &pipeline::Pipeline<'_>,
    session: &streaming::Session,
    prompt: String,
    schema: Value,
    batch: usize,
    activity: &impl Fn(),
) -> Result<Value, String> {
    let file_id = p.checkpoints.file_id;
    let prompt = request_prompt(p.config, prompt, &schema);
    let key = cache::fingerprint(
        p.config,
        "quality",
        &json!({"prompt":prompt,"schema":schema,"core_version":core().version,"core_checksum":core_checksum()}),
    );
    if let Some(value) = p.checkpoints.read("extraction", &key) {
        if complete_response(&value, &schema) {
            diagnostics::cache_hit(file_id, "extraction");
            return Ok(value);
        }
    }
    for attempt in 0..2 {
        if p.token.cancelled() {
            return Err(CANCELLED_MESSAGE.into());
        }
        diagnostics::begin_request(file_id, "extraction", &prompt, attempt > 0);
        let started = Instant::now();
        let response = streaming::chat(
            p.client,
            p.config,
            p.token,
            p.notifier,
            prompt.clone(),
            schema.clone(),
            file_id,
            session,
            |_| {},
            activity,
        )
        .await;
        let response = match response {
            Ok(r) => r,
            Err(f) => {
                record_request_failure(
                    file_id,
                    "extraction",
                    batch,
                    &f,
                    started.elapsed().as_millis(),
                );
                return Err(BatchFailure {
                    code: if p.token.cancelled() {
                        "CANCELLED"
                    } else if f.kind == "CONTEXT_LIMIT" {
                        "CONTEXT_LIMIT"
                    } else if f.kind == "OUTPUT_TRUNCATED" {
                        "OUTPUT_TRUNCATED"
                    } else if f.kind.starts_with("STREAM_") {
                        "STREAM_INTERRUPTED"
                    } else {
                        "REQUEST_FAILED"
                    },
                    stage: "提取",
                    batch,
                    local_error: (f.kind == "LOCAL_RUNTIME_ERROR").then(|| {
                        f.message
                            .split(':')
                            .next()
                            .unwrap_or("ERR_MODEL_LOAD")
                            .into()
                    }),
                }
                .as_error());
            }
        };
        diagnostics::response_usage(file_id, "extraction", Some(&response));
        if response.finish_reason.as_deref() != Some("length") {
            if let Ok(value) = super::super::parse_ai_json(&response.content) {
                if complete_response(&value, &schema) {
                    if schema["properties"].get("text").is_none() {
                        p.checkpoints.write("extraction", &key, &value);
                    }
                    return Ok(value);
                }
            }
        }
        record_batch(
            file_id,
            "extraction",
            batch,
            "INVALID_JSON",
            Some(&response),
            started.elapsed().as_millis(),
            0,
            0,
            Vec::new(),
            Some(&response.content),
        );
    }
    Err(format!(
        "INVALID_JSON: 提取第 {batch} 批未完成；旧分析已保留"
    ))
}

pub(super) async fn run(
    p: &pipeline::Pipeline<'_>,
    segments: &[SegmentRow],
    preview: &pipeline::PreviewCallback<'_>,
) -> Result<Vec<Accepted>, String> {
    let session = streaming::Session::default();
    let builtin = {
        let conn = p.checkpoints.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT text,category FROM builtin_phrase_dictionary WHERE text LIKE '% %'")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    let mut all: Vec<Accepted> = Vec::new();
    for (batch, segment) in segments.iter().enumerate() {
        let source = std::slice::from_ref(segment);
        let attempt_id = uuid::Uuid::new_v4().to_string();
        let emit = |operation, items| {
            preview(
                source,
                pipeline::PreviewUpdate {
                    operation,
                    batch_id: batch + 1,
                    attempt_id: attempt_id.clone(),
                    origin: "ai",
                    items,
                },
            )
        };
        emit("begin", Vec::new());
        let mut local = Vec::new();
        for e in &core().entries {
            local.extend(locate(&e.canonical, &e.category, segment, None));
        }
        for (canonical, category) in &builtin {
            if entry(&normalized(canonical)).is_some() {
                continue;
            }
            let category = category
                .as_deref()
                .filter(|c| CATEGORIES.contains(c))
                .unwrap_or("fixed_expression");
            let form = canonical_form(canonical, category);
            let mut items = locate(&form, category, segment, None);
            for item in &mut items {
                item.metadata.evidence_kind = "builtin_candidate".into();
                item.metadata.source = "builtin_phrase_dictionary".into();
            }
            local.extend(items);
        }
        let prompt = discovery_prompt(segment, segments, &local);
        let schema = discovery_schema(segment.index);
        let value = ask(
            p,
            &session,
            prompt.clone(),
            schema.clone(),
            batch + 1,
            &|| emit("activity", Vec::new()),
        )
        .await?;
        let discovered: Discovery = serde_json::from_value(value.clone()).map_err(|_| {
            format!(
                "INVALID_JSON: 提取第 {} 批字段不完整；旧分析已保留",
                batch + 1
            )
        })?;
        let mut skipped = 0;
        for d in std::iter::once(discovered).filter(|d| d.kind != "none") {
            let canonical = canonical_form(&d.text, &d.kind);
            let found = locate(&canonical, &d.kind, segment, None);
            if found.is_empty() {
                skipped += 1;
            }
            local.extend(found);
        }
        // Cache structural successes only. Unlocatable suggestions are not a reliable empty result.
        if skipped == 0 {
            let prompt = request_prompt(p.config, prompt, &schema);
            let key = cache::fingerprint(
                p.config,
                "quality",
                &json!({"prompt":prompt,"schema":schema,"core_version":core().version,"core_checksum":core_checksum()}),
            );
            p.checkpoints.write("extraction", &key, &value);
        }
        dedup(&mut local);
        remove_fragments(&mut local, source);
        record_batch(
            p.checkpoints.file_id,
            "extraction",
            batch + 1,
            "OK",
            None,
            0,
            local.len(),
            skipped,
            Vec::new(),
            None,
        );
        let trusted: Vec<_> = local
            .iter()
            .filter(|i| entry(&i.candidate.canonical).is_some_and(|e| !e.context_review))
            .cloned()
            .collect();
        emit("commit", trusted);
        all.extend(local);
    }
    // Expand recognized expressions to all compatible source occurrences, then
    // review EACH uncertain context. Discovery omissions cannot erase repetitions.
    let expressions: HashSet<_> = all
        .iter()
        .map(|i| (i.candidate.canonical.clone(), i.candidate.category.clone()))
        .collect();
    for (canonical, category) in expressions {
        for segment in segments {
            all.extend(locate(&canonical, &category, segment, None));
        }
    }
    dedup(&mut all);
    remove_fragments(&mut all, segments);
    let mut accepted = Vec::new();
    let mut uncertain = Vec::new();
    for item in all {
        if entry(&item.candidate.canonical).is_some_and(|e| !e.context_review) {
            accepted.push(item);
        } else {
            uncertain.push((uncertain.len(), item));
        }
    }

    let mut profiles: HashMap<String, Profile> = HashMap::new();
    let mut annotations: HashMap<(String, i32, Vec<i32>), (String, english::ExpressionMetadata)> =
        HashMap::new();
    let mut request_number = segments.len();
    for (_, mut item) in uncertain.iter().cloned() {
        let segment = segments
            .iter()
            .find(|s| s.index == item.candidate.segment_index)
            .unwrap();
        let activity = || {
            preview(
                std::slice::from_ref(segment),
                pipeline::PreviewUpdate {
                    operation: "activity",
                    batch_id: request_number + 1,
                    attempt_id: "meaning".into(),
                    origin: "ai",
                    items: Vec::new(),
                },
            )
        };
        if let Some(e) = entry(&item.candidate.canonical) {
            if let Some((lexical, literal, options)) = sense_pair(&item.candidate.canonical) {
                let schema = json!({"type":"object","properties":{"meaning":{"type":"string","enum":[lexical,literal]}},"required":["meaning"],"additionalProperties":false});
                let value = ask(
                    p,
                    &session,
                    sense_prompt(&item, segment, segments, options, "meaning"),
                    schema,
                    request_number + 1,
                    &activity,
                )
                .await?;
                if value["meaning"] != lexical {
                    request_number += 1;
                    continue;
                }
            }
            item.candidate.category = e.category.clone();
            item.metadata = e.metadata.clone();
            accepted.push(item);
            request_number += 1;
            continue;
        }
        let profile = if let Some(profile) = profiles.get(&item.candidate.canonical) {
            profile.clone()
        } else {
            let value = ask(
                p,
                &session,
                profile_prompt(&item.candidate.canonical),
                profile_schema(),
                request_number + 1,
                &activity,
            )
            .await?;
            let profile: Profile = serde_json::from_value(value).unwrap();
            profiles.insert(item.candidate.canonical.clone(), profile.clone());
            profile
        };
        if profile.kind == "none" {
            request_number += 1;
            continue;
        }
        item.candidate.category = profile.kind;
        let annotation_key = (
            item.candidate.canonical.clone(),
            item.candidate.segment_index,
            item.candidate.token_positions.clone(),
        );
        if let Some((category, metadata)) = annotations.get(&annotation_key) {
            item.candidate.category = category.clone();
            item.metadata = metadata.clone();
        } else {
            let schema = annotation_schema(phrasal_shape(&item, segment));
            let categories = schema["properties"]["category"]["enum"].to_string();
            let prompt=format!("Classify the candidate IN THIS SENTENCE using its dictionary meaning. Use category=none if the words are an ordinary fragment or just literal physical objects/actions, rather than this expression. category must be one of {categories}; idioms have a figurative conventional meaning; phrasal verbs require a verb plus particle/preposition. Use none for ordinary grammar or a temporary noun phrase. register must be neutral, informal, slang or unknown. Informal does not automatically mean slang. Do not infer register from a casual speaker. caution must be none or offensive, only for offensive wording. Return JSON category, register, caution.
EXPRESSION: {}
SELECTED MEANING: {}
SENTENCE: {}",item.candidate.canonical,profile.meaning,segment.text);
            let value = ask(p, &session, prompt, schema, request_number + 1, &activity).await?;
            let a: Annotation = serde_json::from_value(value).unwrap();
            if a.category == "none" {
                request_number += 1;
                continue;
            }
            item.candidate.category = a.category;
            item.metadata = english::ExpressionMetadata {
                register_tags: if ["informal", "slang"].contains(&a.register.as_str()) {
                    vec![a.register]
                } else {
                    Vec::new()
                },
                cautions: if a.caution == "offensive" {
                    vec![a.caution]
                } else {
                    Vec::new()
                },
                evidence_kind: "model".into(),
                source: p.config.model.clone(),
                context_meaning_en: None,
                ..Default::default()
            };
            annotations.insert(
                annotation_key,
                (item.candidate.category.clone(), item.metadata.clone()),
            );
        }
        accepted.push(item);
        request_number += 1;
    }
    if p.token.cancelled() {
        return Err(CANCELLED_MESSAGE.into());
    }
    dedup(&mut accepted);
    // A particle can belong to a larger established expression (e.g. heads up).
    // Do not keep a shorter gapped verb+particle assembled across that unit.
    let complete = accepted.clone();
    accepted.retain(|item| {
        !item
            .candidate
            .token_positions
            .windows(2)
            .any(|w| w[1] > w[0] + 1)
            || !complete.iter().any(|other| {
                other.candidate.segment_index == item.candidate.segment_index
                    && other.candidate.token_positions.len() > item.candidate.token_positions.len()
                    && item
                        .candidate
                        .token_positions
                        .iter()
                        .all(|p| other.candidate.token_positions.contains(p))
            })
    });
    preview(
        segments,
        pipeline::PreviewUpdate {
            operation: "commit",
            batch_id: segments.len() + uncertain.len() + 1,
            attempt_id: uuid::Uuid::new_v4().to_string(),
            origin: "ai",
            items: accepted.clone(),
        },
    );
    Ok(accepted)
}
fn dedup(items: &mut Vec<Accepted>) {
    // Prefer a unique verified dictionary form over an inflected model spelling
    // covering exactly the same lexical tokens. Do not pick among ambiguity.
    let mut verified: HashMap<(i32, Vec<i32>), HashSet<String>> = HashMap::new();
    for item in items
        .iter()
        .filter(|i| entry(&i.candidate.canonical).is_some())
    {
        verified
            .entry((
                item.candidate.segment_index,
                item.candidate.token_positions.clone(),
            ))
            .or_default()
            .insert(item.candidate.canonical.clone());
    }
    for item in items
        .iter_mut()
        .filter(|i| entry(&i.candidate.canonical).is_none())
    {
        if let Some(forms) = verified
            .get(&(
                item.candidate.segment_index,
                item.candidate.token_positions.clone(),
            ))
            .filter(|forms| forms.len() == 1)
        {
            let form = forms.iter().next().unwrap();
            let e = entry(form).unwrap();
            item.candidate.canonical = form.clone();
            item.candidate.category = e.category.clone();
            item.metadata = e.metadata.clone();
        }
    }

    items.sort_by(|a, b| {
        (
            a.candidate.segment_index,
            &a.candidate.token_positions,
            &a.candidate.canonical,
        )
            .cmp(&(
                b.candidate.segment_index,
                &b.candidate.token_positions,
                &b.candidate.canonical,
            ))
    });
    items.dedup_by(|a, b| {
        key(
            a.candidate.segment_index,
            &a.candidate.canonical,
            &a.candidate.token_positions,
        ) == key(
            b.candidate.segment_index,
            &b.candidate.canonical,
            &b.candidate.token_positions,
        )
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn segment(text: &str) -> SegmentRow {
        SegmentRow {
            index: 0,
            text: text.into(),
        }
    }
    #[test]
    fn source_positions_use_adjacent_listen_not_repeated_words() {
        let s = segment("We need to listen and listen and listen to English.");
        let found = locate("listen to", "fixed_expression", &s, None);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].candidate.token_positions, vec![7, 8]);
    }
    #[test]
    fn only_verified_particle_gaps_or_explicit_pronoun_slots_are_allowed() {
        assert_eq!(
            locate(
                "pick up",
                "phrasal_verb",
                &segment("I picked the small notebook up."),
                None
            )[0]
            .candidate
            .token_positions,
            vec![1, 5]
        );
        assert!(locate(
            "forget any plans",
            "phrasal_verb",
            &segment("Forget any complex language learning plans."),
            None
        )
        .is_empty());
        assert_eq!(
            locate(
                "pull someone's leg",
                "idiom",
                &segment("She was pulling his leg."),
                None
            )[0]
            .candidate
            .token_positions,
            vec![2, 4]
        );
        assert!(locate(
            "pull someone's leg",
            "idiom",
            &segment("She was pulling his injured leg."),
            None
        )
        .is_empty());
        assert!(locate(
            "pick up",
            "phrasal_verb",
            &segment("Pick an apple and look up."),
            None
        )
        .is_empty());
    }
    #[test]
    fn separable_occurrences_do_not_pair_across_another_head_verb() {
        let items = locate(
            "pick up",
            "phrasal_verb",
            &segment("Pick it up then pick that up."),
            None,
        );
        let positions: Vec<_> = items
            .iter()
            .map(|i| i.candidate.token_positions.clone())
            .collect();
        assert_eq!(positions, vec![vec![0, 2], vec![4, 6]]);
    }
    #[test]
    fn all_occurrences_and_unicode_spans_are_preserved() {
        assert_eq!(
            locate(
                "a lot of",
                "fixed_expression",
                &segment("🙂 A lot of birds and a lot of trees."),
                None
            )
            .len(),
            2
        );
        assert!(locate(
            "break the ice",
            "idiom",
            &segment("We break the ice."),
            Some("invented words")
        )
        .is_empty());
        assert_eq!(
            locate(
                "what is up",
                "fixed_expression",
                &segment("What's up?"),
                None
            )[0]
            .candidate
            .token_positions,
            vec![0, 1]
        );
    }
    #[test]
    fn core_labels_and_separability_are_independent_of_type() {
        assert!(!entry("listen to").unwrap().separable);
        assert_eq!(entry("have a go").unwrap().category, "fixed_expression");
        assert_eq!(
            entry("take the piss").unwrap().metadata.cautions,
            vec!["offensive"]
        );
        assert!(entry("spill the tea")
            .unwrap()
            .metadata
            .register_tags
            .contains(&"informal".into()));
        assert!(!entry("spill the tea")
            .unwrap()
            .metadata
            .register_tags
            .contains(&"slang".into()));
    }
    #[tokio::test]
    async fn unknown_expression_review_rejects_fragments_and_cache_avoids_repeat_calls() {
        use super::super::tests::mock_deepseek;
        let replies = [
            (r#"{"kind":"collocation","text":"read a book"}"#, "stop"),
            (r#"{"kind":"none","meaning":""}"#, "stop"),
        ];
        let (config, server) = mock_deepseek(&replies);
        let dir = tempfile::tempdir().unwrap();
        let conn =
            std::sync::Mutex::new(crate::db::init_db(&dir.path().join("test.sqlite")).unwrap());
        conn.lock().unwrap().execute("INSERT INTO files(id,name,type,content,content_hash,imported_at) VALUES(1,'a','txt','text','h',1)",[]).unwrap();
        let client = ai_client(std::time::Duration::from_secs(5), &config.base_url).unwrap();
        let token = CancellationToken::default();
        let pipeline = pipeline::Pipeline {
            client: &client,
            config: &config,
            token: &token,
            notifier: None,
            checkpoints: cache::Checkpoints {
                conn: &conn,
                file_id: 1,
                force: false,
            },
        };
        let source = [segment("I read a book.")];
        for pass in 0..2 {
            let result = pipeline.run_events(&source, |_, _| {}).await;
            let count: i64 = conn
                .lock()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM phrase_analysis_cache", [], |r| {
                    r.get(0)
                })
                .unwrap();
            assert!(
                result.as_ref().is_ok_and(|v| v.is_empty()),
                "pass={pass}, cache={count}, error={:?}",
                result.err()
            );
        }
        assert_eq!(server.join().unwrap().len(), 2);
    }
    #[tokio::test]
    async fn incomplete_context_review_never_becomes_a_successful_empty_result() {
        use super::super::tests::mock_deepseek;
        let (config, server) = mock_deepseek(&[
            (r#"{"kind":"idiom","text":"spill the tea"}"#, "stop"),
            (r#"{}"#, "stop"),
            (r#"{}"#, "stop"),
        ]);
        let dir = tempfile::tempdir().unwrap();
        let conn =
            std::sync::Mutex::new(crate::db::init_db(&dir.path().join("test.sqlite")).unwrap());
        let client = ai_client(std::time::Duration::from_secs(5), &config.base_url).unwrap();
        let token = CancellationToken::default();
        let pipeline = pipeline::Pipeline {
            client: &client,
            config: &config,
            token: &token,
            notifier: None,
            checkpoints: cache::Checkpoints {
                conn: &conn,
                file_id: 1,
                force: true,
            },
        };
        assert!(pipeline
            .run_events(&[segment("Please spill the tea.")], |_, _| {})
            .await
            .err()
            .unwrap()
            .starts_with("INVALID_JSON"));
        assert_eq!(server.join().unwrap().len(), 3);
    }
    #[tokio::test]
    async fn lexical_profile_is_shared_but_usage_is_reviewed_per_occurrence() {
        use super::super::tests::mock_deepseek;
        let (config, server) = mock_deepseek(&[
            (r#"{"kind":"idiom","text":"under the weather"}"#, "stop"),
            (r#"{"kind":"none","text":""}"#, "stop"),
            (r#"{"kind":"idiom","meaning":"feeling ill"}"#, "stop"),
            (
                r#"{"category":"idiom","register":"informal","caution":"none"}"#,
                "stop",
            ),
            (
                r#"{"category":"none","register":"unknown","caution":"none"}"#,
                "stop",
            ),
        ]);
        let dir = tempfile::tempdir().unwrap();
        let conn =
            std::sync::Mutex::new(crate::db::init_db(&dir.path().join("usage.sqlite")).unwrap());
        let client = ai_client(std::time::Duration::from_secs(5), &config.base_url).unwrap();
        let token = CancellationToken::default();
        let pipeline = pipeline::Pipeline {
            client: &client,
            config: &config,
            token: &token,
            notifier: None,
            checkpoints: cache::Checkpoints {
                conn: &conn,
                file_id: 1,
                force: true,
            },
        };
        let source = [
            segment("He feels under the weather today."),
            SegmentRow {
                index: 1,
                text: "They stood under the weather chart.".into(),
            },
        ];
        let items = pipeline.run_events(&source, |_, _| {}).await.unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].candidate.segment_index, 0);
        assert_eq!(server.join().unwrap().len(), 5);
    }
    #[test]
    fn grammar_floor_preserves_formulas_and_lexical_support_verbs() {
        let arbitrary = segment("I do it because the task is useful.");
        let candidate = locate("i do", "fixed_expression", &arbitrary, None)
            .pop()
            .unwrap();
        assert!(!eligible(&candidate, &arbitrary));
        let vow = segment("I do.");
        let candidate = locate("i do", "fixed_expression", &vow, None)
            .pop()
            .unwrap();
        assert!(eligible(&candidate, &vow));
        let s = segment("She does homework after dinner.");
        let candidate = locate("do homework", "collocation", &s, None)
            .pop()
            .unwrap();
        assert!(eligible(&candidate, &s));
        let s = segment("Send it to the wrong group.");
        let candidate = locate("to the", "fixed_expression", &s, None)
            .pop()
            .unwrap();
        assert!(!eligible(&candidate, &s));
        assert!(locate(
            "ghost",
            "fixed_expression",
            &segment("They ghosted me."),
            None
        )
        .is_empty());
    }
    #[test]
    fn contractions_keep_original_surface_and_verified_spans() {
        let s = segment("What's up?");
        let found = locate("what is up", "fixed_expression", &s, None);
        assert_eq!(found[0].surface, "What's up");
        let s = segment("She's down for a movie.");
        let found = locate("be down for", "phrasal_verb", &s, Some("She's down for"));
        assert_eq!(found[0].surface, "She's down for");
        assert_eq!(found[0].candidate.token_positions, vec![0, 1, 2]);
    }
    #[test]
    fn dictionary_and_discovery_use_the_same_farewell_headword() {
        let s = segment("The teacher says see you tomorrow.");
        let form = canonical_form("see you tomorrow", "fixed_expression");
        let mut items = locate(&form, "fixed_expression", &s, None);
        items.extend(locate("see you", "fixed_expression", &s, None));
        dedup(&mut items);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].candidate.token_positions, vec![3, 4]);
    }
    #[test]
    fn json_object_endpoints_get_fields_without_changing_gemma_inputs() {
        let mut config = AiConfig {
            provider: "gemma".into(),
            base_url: "".into(),
            model: "test".into(),
            api_key: None,
        };
        let schema = discovery_schema(17);
        assert_eq!(
            request_prompt(&config, "extract".into(), &schema),
            "extract"
        );
        config.provider = "openai".into();
        let prompt = request_prompt(&config, "extract".into(), &schema);
        assert!(prompt.contains("kind"));
        assert!(prompt.contains("text"));
        assert!(prompt.contains("phrasal_verb"));
    }
}
