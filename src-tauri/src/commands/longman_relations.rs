//! Rebuildable, source-bound word-form graph shared by lookup, archive and recall.
//! No corpus-frequency ranking, stem guessing or reading-context judgment.
use super::{canonical, sentence_case_query, Match, R};
use regex::Regex;
use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::io::Read;

pub const RELATION_VERSION: &str = "longman-inflection-v1";

#[derive(Clone, Debug, Serialize)]
pub struct RelationCandidate {
    pub lemma: String,
    pub part_of_speech: Option<String>,
    pub relation: String,
    pub source: String,
    pub unit_id: String,
}

#[derive(Clone, Debug)]
struct Unit {
    id: String,
    pos: String,
    kind: String,
}

#[derive(Clone, Debug)]
struct ExpressionPattern {
    unit: String,
    sense: String,
    before: Vec<String>,
    tails: Vec<Vec<String>>,
    person: bool,
    thing: bool,
    examples: Vec<String>,
}

#[derive(Default)]
pub struct RelationCatalog {
    fingerprint: String,
    build_ms: f64,
    package_checksum: String,
    candidates: HashMap<String, Vec<RelationCandidate>>,
    identities: HashMap<String, String>,
    forms: HashMap<String, Vec<String>>,
    known: HashSet<String>,
    reserved_case: HashMap<String, BTreeSet<String>>,
    independent: HashSet<String>,
    expression_aliases: HashMap<String, Vec<(String, String, String)>>,
    phrasal_heads: HashMap<String, Vec<String>>,
    patterns: HashMap<String, Vec<ExpressionPattern>>,
    expression_heads: HashMap<String, String>,
    pub(super) redirect_units: HashSet<String>,
}

fn word(text: &str) -> bool {
    !text.is_empty() && text.len() <= 80 && text.bytes().all(|c| c.is_ascii_lowercase())
}
fn normalize_pos(pos: &str) -> &str {
    match pos {
        "adj" => "adjective",
        "adv" => "adverb",
        other => other,
    }
}
// Explicit TSV relations still need a regular morphological shape. Irregular
// forms require Longman's own form table or a pure grammatical reference.
fn regular_shape(surface: &str, lemma: &str, pos: &str) -> bool {
    if !word(surface) || !word(lemma) {
        return false;
    }
    let bytes = lemma.as_bytes();
    let consonant = |b: u8| b.is_ascii_lowercase() && !b"aeiou".contains(&b);
    let y_stem = lemma
        .strip_suffix('y')
        .filter(|stem| stem.as_bytes().last().is_some_and(|b| consonant(*b)));
    let doubled = bytes.len() >= 3
        && consonant(bytes[bytes.len() - 1])
        && !b"wxy".contains(&bytes[bytes.len() - 1])
        && b"aeiou".contains(&bytes[bytes.len() - 2])
        && consonant(bytes[bytes.len() - 3]);
    let plural = surface == format!("{lemma}s")
        || ((lemma.ends_with('s')
            || lemma.ends_with('x')
            || lemma.ends_with('z')
            || lemma.ends_with("ch")
            || lemma.ends_with("sh")
            || lemma.ends_with('o'))
            && surface == format!("{lemma}es"))
        || y_stem.is_some_and(|stem| surface == format!("{stem}ies"));
    match pos {
        "noun" => {
            plural
                || lemma
                    .strip_suffix("fe")
                    .or_else(|| lemma.strip_suffix('f'))
                    .is_some_and(|stem| surface == format!("{stem}ves"))
        }
        "verb" => {
            plural
                || surface == format!("{lemma}ed")
                || surface == format!("{lemma}ing")
                || (lemma.ends_with('e')
                    && (surface == format!("{lemma}d")
                        || surface == format!("{}ing", &lemma[..lemma.len() - 1])))
                || y_stem.is_some_and(|stem| surface == format!("{stem}ied"))
                || lemma
                    .strip_suffix("ie")
                    .is_some_and(|stem| surface == format!("{stem}ying"))
                || (doubled
                    && ["ed", "ing"].iter().any(|suffix| {
                        surface == format!("{lemma}{}{suffix}", bytes[bytes.len() - 1] as char)
                    }))
        }
        "adjective" | "adverb" => {
            ["er", "est"]
                .iter()
                .any(|suffix| surface == format!("{lemma}{suffix}"))
                || (lemma.ends_with('e')
                    && ["r", "st"]
                        .iter()
                        .any(|suffix| surface == format!("{lemma}{suffix}")))
                || y_stem.is_some_and(|stem| {
                    surface == format!("{stem}ier") || surface == format!("{stem}iest")
                })
                || (doubled
                    && ["er", "est"].iter().any(|suffix| {
                        surface == format!("{lemma}{}{suffix}", bytes[bytes.len() - 1] as char)
                    }))
        }
        _ => false,
    }
}
fn source_slot(label: &str) -> Option<&'static str> {
    match label {
        "plural" => Some("plural"),
        "past tense" | "past participle" | "past tense and past participle" => Some("past"),
        "present participle" => Some("present"),
        "third person singular" => Some("third"),
        "comparative" => Some("comparative"),
        "superlative" => Some("superlative"),
        _ => None,
    }
}
fn regular_slot<'a>(surface: &str, lemma: &str, pos: &str) -> Option<&'a str> {
    if !regular_shape(surface, lemma, pos) {
        return None;
    }
    Some(match pos {
        "noun" => "plural",
        "verb" if surface.ends_with("ing") => "present",
        "verb" if surface.ends_with("ed") => "past",
        "verb" => "third",
        _ if surface.ends_with("est") => "superlative",
        _ => "comparative",
    })
}
fn inflection_label(label: &str) -> bool {
    matches!(
        label,
        "plural"
            | "past tense"
            | "past participle"
            | "past tense and past participle"
            | "present participle"
            | "third person singular"
            | "comparative"
            | "superlative"
            | "verb form (source table)"
    )
}

impl RelationCatalog {
    /// Without a source graph there is no evidence for case or form aliases.
    pub fn literal_only(&self) -> bool {
        self.known.is_empty()
    }
    pub fn fingerprint(&self) -> &str {
        &self.fingerprint
    }
    #[cfg(test)]
    pub fn stats(&self) -> serde_json::Value {
        let bytes = include_bytes!("../../resources/english_wordforms.tsv.gz");
        serde_json::json!({"parser_version":RELATION_VERSION,"fingerprint":self.fingerprint,"build_ms":self.build_ms,
            "candidate_surfaces":self.candidates.len(),"candidate_relations":self.candidates.values().map(Vec::len).sum::<usize>(),
            "safe_nonliteral_relations":self.identities.iter().filter(|(surface,identity)|surface!=identity).count(),
            "phrasal_heads":self.phrasal_heads.len(),"source_expression_patterns":self.patterns.values().map(Vec::len).sum::<usize>(),
            "serialized_candidates_bytes":serde_json::to_vec(&self.candidates).map(|v|v.len()).unwrap_or(0),
            "bundled_wordforms_gzip_bytes":bytes.len(),"bundled_wordforms_sha256":format!("{:x}",Sha256::digest(bytes)),
            "package_database_sha256":self.package_checksum,"persistent_cache_bytes":0,"new_download_bytes":0})
    }
    /// Reserve source-attested exact casing when the recall index also contains
    /// its folded spelling. This is index metadata, never another saved alias.
    pub fn case_exclusions(&self, expressions: &[String]) -> Vec<String> {
        let mut excluded = BTreeSet::new();
        for expression in expressions {
            let folded = expression
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase();
            if let Some(spellings) = self.reserved_case.get(&folded) {
                for spelling in spellings {
                    excluded.insert(spelling.clone());
                    // Shouting a known independent proper head does not turn it
                    // into its lowercase homograph. Do not invent Title Case
                    // variants of abbreviations (US must not reserve Us).
                    excluded.insert(spelling.to_uppercase());
                }
            }
        }
        excluded.into_iter().collect()
    }
    pub fn case_sensitive_identity(&self, expression: &str) -> bool {
        let expression = expression.split_whitespace().collect::<Vec<_>>().join(" ");
        if !expression.chars().any(char::is_uppercase) {
            return false;
        }
        if self.known.contains(&expression) {
            return true;
        }
        let mut letters = expression.chars().filter(|c| c.is_alphabetic()).peekable();
        letters.peek().is_some()
            && letters.all(char::is_uppercase)
            && self.reserved_case.contains_key(&expression.to_lowercase())
    }
    fn rebuild_case_reservations(&mut self) {
        self.reserved_case.clear();
        for head in &self.known {
            if head.chars().any(char::is_uppercase) {
                self.reserved_case
                    .entry(head.to_lowercase())
                    .or_default()
                    .insert(head.clone());
            }
        }
    }
    pub fn identity(&self, surface: &str) -> String {
        // Saved original expressions are never URL- or HTML-decoded. Query
        // normalization is a separate boundary owned by the dictionary caller.
        let surface = surface.split_whitespace().collect::<Vec<_>>().join(" ");
        if let Some(identity) = self.identities.get(&surface) {
            return identity.clone();
        }
        if !self.known.contains(&surface) {
            if surface.split_whitespace().count() > 1 {
                let heads = self
                    .expression_matches(&surface)
                    .into_iter()
                    .filter_map(|m| self.expression_head(&m.unit))
                    .collect::<BTreeSet<_>>();
                if heads.len() == 1 {
                    return heads.into_iter().next().unwrap().to_string();
                }
            }
            if let Some(lower) = sentence_case_query(&surface) {
                if self.known.contains(&lower)
                    || self.candidates.contains_key(&lower)
                    || !self.expression_matches(&lower).is_empty()
                {
                    return self.identity(&lower);
                }
            }
        }
        surface
    }
    /// Includes the literal identity itself, and only aliases resolving uniquely
    /// to that identity under this exact dictionary release/parser version.
    pub fn safe_forms(&self, identity: &str) -> Vec<String> {
        let identity = self.identity(identity);
        let mut forms = self
            .forms
            .get(&identity)
            .cloned()
            .unwrap_or_else(|| vec![identity.clone()]);
        if identity.split_whitespace().count() > 1 && self.phrasal_heads.contains_key(&identity) {
            let originals = forms.clone();
            for original in originals {
                if let Some((first, tail)) = original.split_once(' ') {
                    for first_form in self.forms.get(first).into_iter().flatten() {
                        let form = format!("{first_form} {tail}");
                        if self.identity(&form) == identity {
                            forms.push(form);
                        }
                    }
                }
            }
            forms.sort();
            forms.dedup();
            forms.truncate(128);
        }
        forms
    }
    pub fn candidates(&self, surface: &str) -> &[RelationCandidate] {
        self.candidates
            .get(&canonical(surface))
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }
    pub(super) fn matches(&self, surface: &str) -> Vec<Match> {
        let mut units = BTreeSet::new();
        self.candidates(surface)
            .iter()
            .filter(|c| units.insert(c.unit_id.clone()))
            .take(32)
            .map(|c| Match {
                unit: c.unit_id.clone(),
                kind: "inflection".into(),
                restricted: vec![],
                group: None,
            })
            .collect()
    }
    fn expression_head(&self, unit: &str) -> Option<&str> {
        self.expression_heads.get(unit).map(String::as_str)
    }
    /// Only recorded whole-expression heads and source-declared object slots.
    /// The first verb must already have a unique identity in the same graph.
    pub(super) fn expression_matches(&self, query: &str) -> Vec<Match> {
        if let Some(aliases) = self.expression_aliases.get(query) {
            let mut found: BTreeMap<String, Vec<String>> = BTreeMap::new();
            for (_, unit, sense) in aliases {
                found.entry(unit.clone()).or_default().push(sense.clone());
            }
            return found
                .into_iter()
                .map(|(unit, restricted)| Match {
                    unit,
                    restricted,
                    kind: "expression_pattern".into(),
                    group: None,
                })
                .collect();
        }
        let words = query.split_whitespace().collect::<Vec<_>>();
        if words.len() < 2 || words.len() > 12 {
            return vec![];
        }
        let verb = self
            .identities
            .get(words[0])
            .map(String::as_str)
            .unwrap_or(words[0]);
        if !word(verb) {
            return vec![];
        }
        let mut normalized = words.clone();
        normalized[0] = verb;
        // A contiguous inflection is valid only for a recorded phrasal head.
        if let Some(ids) = self.phrasal_heads.get(&normalized.join(" ")) {
            if words[0] != verb {
                return ids
                    .iter()
                    .map(|unit| Match {
                        unit: unit.clone(),
                        restricted: vec![],
                        kind: "expression_pattern".into(),
                        group: None,
                    })
                    .collect();
            }
        }
        if words.len() < 3 {
            return vec![];
        }
        let mut found: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        let mut confirmed: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for pattern in self.patterns.get(verb).into_iter().flatten() {
            for tail in &pattern.tails {
                let before = pattern
                    .before
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>();
                let tail = tail.iter().map(String::as_str).collect::<Vec<_>>();
                if tail.is_empty()
                    || words.len() <= before.len() + tail.len()
                    || !normalized.starts_with(&before)
                    || !normalized.ends_with(&tail)
                {
                    continue;
                }
                let object = &words[before.len()..words.len() - tail.len()];
                if object.len() > 6 {
                    continue;
                }
                let first = object[0];
                let persons = ["me", "him", "her", "us", "you", "someone", "somebody"];
                if (["it", "this", "that", "something"].contains(&first) && !pattern.thing)
                    || (persons.contains(&first) && !pattern.person)
                    || (pattern.person
                        && !pattern.thing
                        && !persons.contains(&first)
                        && first != "them"
                        && !first.chars().next().is_some_and(char::is_uppercase))
                {
                    continue;
                }
                let phrase = normalized.join(" ").to_lowercase();
                let attested =
                    Regex::new(&format!(r"(?:^|\W){}(?:$|\W)", regex::escape(&phrase))).unwrap();
                let source_attested = pattern
                    .examples
                    .iter()
                    .any(|example| attested.is_match(example));
                let safe_pronoun = object.len() == 1
                    && [
                        "me",
                        "him",
                        "her",
                        "us",
                        "you",
                        "them",
                        "it",
                        "this",
                        "that",
                        "someone",
                        "somebody",
                        "something",
                    ]
                    .contains(&first);
                // A source-declared slot is not permission to consume arbitrary
                // clauses/prepositions ("look at what is up"). Admit a simple
                // object pronoun or a complete source-attested expression only.
                if !safe_pronoun && !source_attested {
                    continue;
                }
                found
                    .entry(pattern.unit.clone())
                    .or_default()
                    .insert(pattern.sense.clone());
                if source_attested {
                    confirmed
                        .entry(pattern.unit.clone())
                        .or_default()
                        .insert(pattern.sense.clone());
                }
            }
        }
        found
            .into_iter()
            .map(|(unit, senses)| {
                let restricted = confirmed
                    .remove(&unit)
                    .unwrap_or(senses)
                    .into_iter()
                    .collect();
                Match {
                    unit,
                    restricted,
                    kind: "expression_pattern".into(),
                    group: None,
                }
            })
            .collect()
    }
    pub(super) fn relation_note(&self, surface: &str, unit: &str) -> Option<String> {
        let candidates = self
            .candidates(surface)
            .iter()
            .filter(|c| c.unit_id == unit)
            .collect::<Vec<_>>();
        let first = candidates.first()?;
        let labels = candidates
            .iter()
            .map(|c| c.relation.as_str())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>()
            .join("; ");
        Some(format!(
            "Source inflection: {surface} → {} ({labels}).",
            first.lemma
        ))
    }
    pub(super) fn has_independent(&self, surface: &str) -> bool {
        self.independent.contains(surface)
    }
    pub(super) fn empty(fingerprint: String) -> Self {
        Self {
            fingerprint,
            ..Self::default()
        }
    }
    #[cfg(test)]
    pub fn test_fixture(fingerprint: &str, identities: &[(&str, &str)]) -> Self {
        let mut out = Self::empty(fingerprint.into());
        for (surface, identity) in identities {
            out.known.insert((*surface).into());
            out.known.insert((*identity).into());
            out.identities.insert((*surface).into(), (*identity).into());
        }
        out.rebuild_forms();
        out.rebuild_case_reservations();
        out
    }
    fn add(&mut self, surface: &str, lemma: &str, unit: &Unit, label: &str, source: &str) {
        if !word(surface) || !word(lemma) || surface == lemma || unit.kind != "word" {
            return;
        }
        let row = RelationCandidate {
            lemma: lemma.into(),
            part_of_speech: (!unit.pos.is_empty()).then(|| unit.pos.clone()),
            relation: label.into(),
            source: source.into(),
            unit_id: unit.id.clone(),
        };
        let candidates = self.candidates.entry(surface.into()).or_default();
        if !candidates.iter().any(|c| {
            c.unit_id == row.unit_id && c.relation == row.relation && c.source == row.source
        }) {
            candidates.push(row);
        }
    }
    fn resolve(&self, surface: &str, stack: &mut Vec<String>) -> Option<String> {
        if stack.len() >= 6 || stack.iter().any(|p| p == surface) {
            return None;
        }
        if self.independent.contains(surface) {
            // A literal ambiguous root (saw/see, found/find, better/good/well)
            // is not a confirmed lexical-family identity. Incoming forms must
            // not collapse into that same string or expand its reminders.
            if !stack.is_empty() && self.candidates.get(surface).is_some_and(|c| !c.is_empty()) {
                return None;
            }
            return Some(surface.into());
        }
        let Some(candidates) = self.candidates.get(surface) else {
            return Some(surface.into());
        };
        // Excessive alternatives fail closed; they never authorize a subset.
        if candidates.len() > 64 {
            return None;
        }
        stack.push(surface.into());
        let mut identities = BTreeSet::new();
        for candidate in candidates {
            match self.resolve(&candidate.lemma, stack) {
                Some(identity) => {
                    identities.insert(identity);
                }
                None => {
                    stack.pop();
                    return None;
                }
            }
        }
        stack.pop();
        if identities.len() == 1 {
            identities.into_iter().next()
        } else {
            None
        }
    }
    fn rebuild_forms(&mut self) {
        let mut map: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for (surface, identity) in &self.identities {
            map.entry(identity.clone())
                .or_default()
                .extend([surface.clone(), identity.clone()]);
        }
        self.forms = map
            .into_iter()
            .map(|(k, v)| (k, v.into_iter().collect()))
            .collect();
    }
    pub(super) fn build(
        conn: &Connection,
        release: &str,
        package_fingerprint: &str,
        has_forms: bool,
    ) -> R<Self> {
        let started = std::time::Instant::now();
        let bytes = include_bytes!("../../resources/english_wordforms.tsv.gz");
        let fingerprint = format!(
            "{RELATION_VERSION}:{release}:{package_fingerprint}:{:x}",
            Sha256::digest(bytes)
        );
        let mut out = Self::empty(fingerprint);
        out.package_checksum = package_fingerprint.into();
        let mut units: HashMap<String, Vec<Unit>> = HashMap::new();
        let mut source_slots: HashMap<(String, String, String), HashSet<String>> = HashMap::new();
        let mut statements = conn
            .prepare("SELECT id,headword,COALESCE(pos,''),kind FROM units")
            .map_err(|e| e.to_string())?;
        let rows = statements
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(1)?,
                    Unit {
                        id: r.get(0)?,
                        pos: r.get(2)?,
                        kind: r.get(3)?,
                    },
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (head, unit) = row.map_err(|e| e.to_string())?;
            out.known.insert(head.clone());
            units.entry(head).or_default().push(unit);
        }
        if conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name='lookup'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0
        {
            let mut statement=conn.prepare("SELECT DISTINCT query_text FROM lookup WHERE reason IN ('exact_source_headword','source_record_article_form','source_explicit_header_variant')").map_err(|e|e.to_string())?;
            for row in statement
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?
            {
                out.known.insert(row.map_err(|e| e.to_string())?);
            }
        }
        let redirect = Regex::new(r"^(?:(?:the|a) )?(plural|past tense and past participle|past tense|past participle|present participle|third person singular|comparative|superlative)(?: form)? of ['‘]?([a-z]+)(?:[0-9]+)?['’]?[.]?$").unwrap();
        // Every non-reference sense is an independent lexical conflict, including
        // expression subentries such as books. One pure reference cannot hide it.
        let mut senses = conn
            .prepare("SELECT unit_id,definition_en FROM senses WHERE eligible=1")
            .map_err(|e| e.to_string())?;
        let mut definitions: HashMap<String, Vec<String>> = HashMap::new();
        for row in senses
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                ))
            })
            .map_err(|e| e.to_string())?
        {
            let (id, text) = row.map_err(|e| e.to_string())?;
            definitions.entry(id).or_default().push(text);
        }
        // A regular noun plural also needs countability in Longman. The
        // supplemental TSV has no usage qualifiers; it cannot authorize
        // nonstandard plurals of uncountable information/furniture/homework.
        let mut countable_units = HashSet::new();
        if conn
            .query_row(
                "SELECT count(*) FROM pragma_table_info('senses') WHERE name='grammar_json'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0
        {
            let mut statement = conn
                .prepare("SELECT unit_id,grammar_json FROM senses WHERE eligible=1")
                .map_err(|e| e.to_string())?;
            for row in statement
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    ))
                })
                .map_err(|e| e.to_string())?
            {
                let (unit, grammar) = row.map_err(|e| e.to_string())?;
                if grammar
                    .split(|c: char| !c.is_ascii_alphabetic())
                    .any(|part| part == "countable")
                {
                    countable_units.insert(unit);
                }
            }
        }
        for (head, list) in &units {
            for unit in list {
                let defs = definitions.get(&unit.id);
                let pure = defs.is_some_and(|d| {
                    !d.is_empty() && d.iter().all(|t| redirect.is_match(t.trim()))
                });
                if pure {
                    out.redirect_units.insert(unit.id.clone());
                } else {
                    out.independent.insert(head.clone());
                }
                for text in defs.into_iter().flatten() {
                    if let Some(capture) = redirect.captures(text.trim()) {
                        let label = &capture[1];
                        let lemma = &capture[2];
                        let pos = if label == "plural" {
                            "noun"
                        } else if label.contains("participle")
                            || label.contains("tense")
                            || label == "third person singular"
                        {
                            "verb"
                        } else {
                            ""
                        };
                        if let Some(targets) = units.get(lemma) {
                            for target in targets.iter().filter(|u| pos.is_empty() || u.pos == pos)
                            {
                                out.add(head, lemma, target, label, "longman_pure_reference");
                                if let Some(slot) = source_slot(label) {
                                    source_slots
                                        .entry((lemma.into(), target.pos.clone(), slot.into()))
                                        .or_default()
                                        .insert(head.clone());
                                }
                            }
                        }
                    }
                }
            }
        }
        if has_forms {
            let mut stmt=conn.prepare("SELECT f.text,f.label,u.headword,u.id,COALESCE(u.pos,''),u.kind FROM forms f JOIN groups g ON g.id=f.group_id JOIN units u ON u.id=g.unit_id").map_err(|e|e.to_string())?;
            for row in stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        Unit {
                            id: r.get(3)?,
                            pos: r.get(4)?,
                            kind: r.get(5)?,
                        },
                    ))
                })
                .map_err(|e| e.to_string())?
            {
                let (surface, label, lemma, unit) = row.map_err(|e| e.to_string())?;
                if inflection_label(&label) {
                    out.add(&surface, &lemma, &unit, &label, "longman_source_forms");
                    if let Some(slot) =
                        source_slot(&label).or_else(|| regular_slot(&surface, &lemma, &unit.pos))
                    {
                        source_slots
                            .entry((lemma.clone(), unit.pos.clone(), slot.into()))
                            .or_default()
                            .insert(surface.clone());
                    }
                }
            }
        }
        // The bundled CC BY-SA Wiktionary forms contain explicit relation/POS
        // records. Only dictionary-confirmed target word/POS pairs are admitted.
        // Headword/derivation rows and frequency fields are deliberately ignored.
        let mut text = String::new();
        flate2::read::GzDecoder::new(bytes.as_slice())
            .read_to_string(&mut text)
            .map_err(|e| e.to_string())?;
        for line in text.lines() {
            let fields = line.split('\t').collect::<Vec<_>>();
            if fields.len() < 4 || fields[3] != "inflection" {
                continue;
            }
            let (surface, lemma, pos) = (fields[0], fields[1], normalize_pos(fields[2]));
            let Some(slot) = regular_slot(surface, lemma, pos) else {
                continue;
            };
            // The TSV discards qualifiers such as archaic/nonstandard. A regular
            // shape (taked, buyed, childs, gooder) cannot overrule the dictionary's
            // recorded paradigm for that same morphological slot.
            if source_slots
                .get(&(lemma.into(), pos.into(), slot.into()))
                .is_some_and(|forms| !forms.contains(surface))
            {
                continue;
            }
            if let Some(targets) = units.get(lemma) {
                for target in targets
                    .iter()
                    .filter(|u| u.pos == pos && (pos != "noun" || countable_units.contains(&u.id)))
                {
                    out.add(
                        surface,
                        lemma,
                        target,
                        "inflection",
                        "wiktionary_bundled_wordforms",
                    );
                }
            }
        }
        for candidates in out.candidates.values_mut() {
            candidates.sort_by(|a, b| {
                (&a.lemma, &a.unit_id, &a.source, &a.relation).cmp(&(
                    &b.lemma,
                    &b.unit_id,
                    &b.source,
                    &b.relation,
                ))
            });
        }
        for surface in out.candidates.keys().cloned().collect::<Vec<_>>() {
            if let Some(identity) = out.resolve(&surface, &mut vec![]) {
                out.identities.insert(surface, identity);
            }
        }
        for (head, list) in &units {
            for unit in list.iter().filter(|unit| unit.kind == "phrasal_verb") {
                out.phrasal_heads
                    .entry(head.clone())
                    .or_default()
                    .push(unit.id.clone());
                out.expression_heads.insert(unit.id.clone(), head.clone());
            }
        }
        let table_exists = |table: &str| {
            conn.query_row(
                "SELECT count(*) FROM sqlite_master WHERE name=?1",
                [table],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0)
                > 0
        };
        if table_exists("query_senses") {
            let mut stmt=conn.prepare("SELECT q.query_text,u.headword,u.id,s.id FROM query_senses q JOIN senses s ON s.id=q.sense_id JOIN units u ON u.id=s.unit_id WHERE u.kind='phrasal_verb'").map_err(|e|e.to_string())?;
            for row in stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                })
                .map_err(|e| e.to_string())?
            {
                let (query, head, unit, sense) = row.map_err(|e| e.to_string())?;
                out.expression_aliases
                    .entry(query)
                    .or_default()
                    .push((head, unit, sense));
            }
            for (query, aliases) in &out.expression_aliases {
                let heads = aliases
                    .iter()
                    .map(|(head, _, _)| head)
                    .collect::<BTreeSet<_>>();
                if heads.len() == 1 && !out.known.contains(query) {
                    out.identities
                        .insert(query.clone(), (*heads.into_iter().next().unwrap()).clone());
                }
            }
        }
        if table_exists("examples") {
            let mut stmt=conn.prepare("SELECT u.id,u.headword,s.id,s.pattern FROM senses s JOIN units u ON u.id=s.unit_id WHERE u.kind='phrasal_verb' AND s.pattern LIKE '%↔%'").map_err(|e|e.to_string())?;
            let slot = Regex::new(r"(?:somebody/something|something/somebody|somebody|something)")
                .unwrap();
            for row in stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                })
                .map_err(|e| e.to_string())?
            {
                let (unit, _headword, sense, pattern) = row.map_err(|e| e.to_string())?;
                let Some((before, after)) = pattern.split_once('↔') else {
                    continue;
                };
                if !slot.is_match(before) {
                    continue;
                }
                let fixed = slot
                    .replace_all(before, "")
                    .split_whitespace()
                    .map(str::to_string)
                    .collect::<Vec<_>>();
                let Some(verb) = fixed.first().cloned() else {
                    continue;
                };
                let mut examples = conn
                    .prepare("SELECT english FROM examples WHERE sense_id=?1")
                    .map_err(|e| e.to_string())?;
                let examples = examples
                    .query_map([&sense], |r| {
                        Ok(r.get::<_, Option<String>>(0)?
                            .unwrap_or_default()
                            .to_lowercase())
                    })
                    .map_err(|e| e.to_string())?
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(|e| e.to_string())?;
                let tails = after
                    .trim()
                    .split('/')
                    .map(|tail| tail.split_whitespace().map(str::to_string).collect())
                    .collect();
                out.patterns
                    .entry(verb)
                    .or_default()
                    .push(ExpressionPattern {
                        unit,
                        sense,
                        before: fixed,
                        tails,
                        person: before.contains("somebody"),
                        thing: before.contains("something"),
                        examples,
                    });
            }
        }
        out.rebuild_forms();
        out.rebuild_case_reservations();
        out.build_ms = started.elapsed().as_secs_f64() * 1000.;
        log::debug!(
            "Word-form graph built in {:.1} ms: {} surfaces, {} safe identities",
            out.build_ms,
            out.candidates.len(),
            out.identities.len()
        );
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tsv_candidates_need_regular_shape_and_never_use_frequency() {
        for (surface, lemma, pos) in [
            ("books", "book", "noun"),
            ("studies", "study", "noun"),
            ("changed", "change", "verb"),
            ("running", "run", "verb"),
            ("tying", "tie", "verb"),
            ("axes", "axe", "noun"),
            ("happier", "happy", "adjective"),
        ] {
            assert!(regular_shape(surface, lemma, pos), "{surface} → {lemma}");
        }
        for (surface, lemma, pos) in [
            ("went", "wend", "verb"),
            ("went", "go", "verb"),
            ("children", "child", "noun"),
            ("bought", "buy", "verb"),
            ("happiness", "happy", "noun"),
            ("action", "act", "noun"),
            ("takeoff", "take off", "verb"),
        ] {
            assert!(!regular_shape(surface, lemma, pos), "{surface} → {lemma}");
        }
    }
    #[test]
    fn source_graph_keeps_conflicts_cycles_case_and_raw_punctuation() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE units(id TEXT,headword TEXT,pos TEXT,kind TEXT); CREATE TABLE senses(id TEXT,unit_id TEXT,definition_en TEXT,eligible INTEGER); CREATE TABLE groups(id TEXT,unit_id TEXT); CREATE TABLE forms(group_id TEXT,text TEXT,label TEXT);
            INSERT INTO units VALUES('c','child','noun','word'),('cc','children',NULL,'word'),('g','go','verb','word'),('w','went','verb','word'),('ss','saw','noun','word'),('s','see','verb','word'),('l','leaf','noun','word'),('v','leave','verb','word'),('aa','alpha','noun','word'),('bb','beta','noun','word'),('p','Paris','noun','word');
            INSERT INTO senses VALUES('c','c','a young person',1),('cc','cc','the plural of child',1),('g','g','to move',1),('w','w','the past tense of go',1),('ss','ss','a cutting tool',1),('s','s','to perceive',1),('l','l','part of a plant',1),('v','v','to depart',1),('aa','aa','the plural of beta',1),('bb','bb','the plural of alpha',1),('p','p','a city',1);
            INSERT INTO groups VALUES('sc','c'),('sg','g'),('ss','s'),('sl','l'),('sv','v'),('sx','ss');
            INSERT INTO forms VALUES('sc','children','plural'),('sg','went','past tense'),('ss','saw','past tense'),('sl','leaves','plural'),('sv','leaves','third person singular'),('sx','saws','plural');").unwrap();
        let catalog = RelationCatalog::build(&conn, "test-release", "test-checksum", true).unwrap();
        assert_eq!(catalog.identity("children"), "child");
        assert_eq!(catalog.identity("Went"), "go");
        assert_eq!(catalog.identity("saw"), "saw");
        assert_eq!(catalog.identity("saws"), "saws");
        assert!(!catalog.safe_forms("saw").contains(&"saws".into()));
        assert_eq!(catalog.identity("leaves"), "leaves");
        assert_eq!(catalog.identity("alpha"), "alpha");
        assert_eq!(catalog.identity("beta"), "beta");
        assert!(catalog.case_sensitive_identity("Paris"));
        assert!(catalog.case_sensitive_identity("PARIS"));
        assert_eq!(
            catalog.case_exclusions(&["paris".into()]),
            vec!["PARIS".to_string(), "Paris".to_string()]
        );
        assert!(!catalog.case_sensitive_identity("Went"));
        assert!(!catalog.case_sensitive_identity("Child"));
        assert!(!catalog.safe_forms("see").contains(&"saw".into()));
        assert!(catalog.safe_forms("saw").contains(&"saw".into()));
        for raw in [
            "US",
            "us",
            "take%20off",
            "rock &amp; roll",
            "take-off",
            "take off",
            "happy",
            "happiness",
        ] {
            assert_eq!(catalog.identity(raw), raw);
        }
        assert_ne!(
            catalog.fingerprint(),
            RelationCatalog::empty("other-version".into()).fingerprint()
        );
    }
}
