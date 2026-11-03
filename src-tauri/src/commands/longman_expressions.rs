//! Bounded, source-pattern matching. Candidate readings never grant saved aliases.
use super::{Match, RelationCatalog, R};
use rusqlite::Connection;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::Arc;

const MAX_WORDS: usize = 24;
const MAX_OBJECT: usize = 10;
const MAX_VARIANTS: usize = 24;
const MAX_STATES: usize = 256;

#[derive(Clone, Debug, PartialEq)]
enum Token {
    Fixed(Vec<String>),
    Object { person: bool, thing: bool },
    Reflexive,
    Possessive,
}
#[derive(Clone, Debug)]
struct Pattern {
    unit: String,
    sense: String,
    tokens: Vec<Token>,
    postposed: Option<usize>,
    proposal: bool,
    examples: Arc<Vec<Vec<String>>>,
}
#[derive(Default)]
pub(super) struct ExpressionIndex {
    by_verb: HashMap<String, Vec<Pattern>>,
    nounlike: HashSet<String>,
    verb_only: HashSet<String>,
}
fn atom(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 80
        && s.chars()
            .all(|c| c.is_ascii_alphabetic() || ['\'', '’', '-'].contains(&c))
}
fn reflexive(s: &str) -> bool {
    matches!(
        s,
        "myself"
            | "yourself"
            | "himself"
            | "herself"
            | "itself"
            | "ourselves"
            | "yourselves"
            | "themselves"
            | "oneself"
    )
}
fn possessive(s: &str) -> bool {
    matches!(
        s,
        "my" | "your" | "his" | "her" | "its" | "our" | "their" | "one's" | "one’s"
    )
}
fn pronoun(s: &str) -> Option<(bool, bool)> {
    match s {
        "me" | "him" | "her" | "us" | "you" | "someone" | "somebody" | "anybody" | "anyone"
        | "nobody" | "everyone" | "myself" | "yourself" | "himself" | "herself" | "ourselves"
        | "yourselves" => Some((true, false)),
        "it" | "this" | "that" | "something" | "anything" | "nothing" | "everything" | "itself" => {
            Some((false, true))
        }
        "them" | "these" | "those" | "themselves" => Some((true, true)),
        _ => None,
    }
}
fn particle(s: &str) -> bool {
    matches!(
        s,
        "up" | "down"
            | "in"
            | "out"
            | "on"
            | "off"
            | "away"
            | "back"
            | "over"
            | "through"
            | "around"
            | "round"
            | "along"
            | "apart"
            | "aside"
            | "together"
    )
}
fn token(s: &str) -> Option<Token> {
    let parts = s.split('/').collect::<Vec<_>>();
    if parts
        .iter()
        .all(|s| matches!(*s, "somebody" | "someone" | "something"))
    {
        return Some(Token::Object {
            person: parts.iter().any(|s| *s != "something"),
            thing: parts.contains(&"something"),
        });
    }
    if s == "yourself" {
        return Some(Token::Reflexive);
    }
    if matches!(
        s,
        "your" | "somebody's" | "somebody’s" | "someone's" | "someone’s"
    ) {
        return Some(Token::Possessive);
    }
    if parts.len() > 4 || !parts.iter().all(|s| atom(s)) {
        return None;
    }
    Some(Token::Fixed(parts.iter().map(|s| s.to_string()).collect()))
}
/// Parentheses are source-declared optional groups, not arbitrary deletions.
fn variants(text: &str) -> Vec<(Vec<Token>, Option<usize>)> {
    fn expand(text: &str, depth: usize) -> Vec<String> {
        if depth > 3 {
            return vec![];
        }
        if let Some(start) = text.find('(') {
            let Some(end) = text[start + 1..].find(')').map(|n| n + start + 1) else {
                return vec![];
            };
            if text[start + 1..end].contains('(') {
                return vec![];
            }
            let mut result = vec![];
            for replacement in ["", &text[start + 1..end]] {
                let next = format!("{} {} {}", &text[..start], replacement, &text[end + 1..]);
                result.extend(expand(&next, depth + 1));
            }
            result.truncate(MAX_VARIANTS);
            result
        } else if text.contains(')') {
            vec![]
        } else {
            vec![text.to_string()]
        }
    }
    let mut out = vec![];
    for text in expand(text, 0) {
        let raw = text
            .split_whitespace()
            .filter(|s| *s != "↔")
            .collect::<Vec<_>>();
        if raw.is_empty() || raw.len() > MAX_WORDS {
            continue;
        }
        if let Some(tokens) = raw.iter().map(|s| token(s)).collect::<Option<Vec<_>>>() {
            if tokens
                .iter()
                .filter(|t| matches!(t, Token::Object { .. }))
                .count()
                > 3
            {
                continue;
            }
            if !out.iter().any(|(t, _)| t == &tokens) {
                out.push((tokens.clone(), None));
            }
            // An explicit arrow allows the particle before a noun object too.
            // Plain V + object + particle also witnesses a separable head.
            for i in 1..tokens.len().saturating_sub(1) {
                if matches!(tokens[i], Token::Object { .. })
                    && matches!(&tokens[i+1],Token::Fixed(xs) if xs.iter().all(|s|particle(s)))
                    && (text.contains('↔') || tokens.len() == 3)
                {
                    let mut moved = tokens.clone();
                    moved.swap(i, i + 1);
                    if !out.iter().any(|(t, _)| t == &moved) {
                        out.push((moved, Some(i + 1)));
                    }
                }
            }
        }
    }
    out.truncate(MAX_VARIANTS);
    out
}
impl ExpressionIndex {
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.by_verb.values().map(Vec::len).sum()
    }
    pub fn load(conn: &Connection) -> R<Self> {
        let mut out = Self::default();
        let mut verbs = HashSet::new();
        let mut stmt = conn
            .prepare("SELECT headword,COALESCE(pos,'') FROM units WHERE kind='word'")
            .map_err(|e| e.to_string())?;
        for r in stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
        {
            let (head, pos) = r.map_err(|e| e.to_string())?;
            if matches!(pos.as_str(), "noun" | "adjective" | "numeral") {
                out.nounlike.insert(head.clone());
            }
            if pos == "verb" {
                verbs.insert(head);
            }
        }
        out.verb_only = verbs.difference(&out.nounlike).cloned().collect();
        let has_examples = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name='examples'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;
        let has_pattern = conn
            .query_row(
                "SELECT count(*) FROM pragma_table_info('senses') WHERE name='pattern'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;
        if !has_pattern {
            return Ok(out);
        }
        let mut stmt=conn.prepare("SELECT u.id,u.headword,s.id,COALESCE(s.pattern,'') FROM senses s JOIN units u ON u.id=s.unit_id WHERE u.kind='phrasal_verb' AND s.eligible=1 ORDER BY u.id,s.id").map_err(|e|e.to_string())?;
        let mut rows = vec![];
        for r in stmt
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
            rows.push(r.map_err(|e| e.to_string())?);
        }
        let mut source_examples: HashMap<String, Vec<Vec<String>>> = HashMap::new();
        if has_examples {
            let mut e=conn.prepare("SELECT e.sense_id,e.english FROM examples e JOIN senses s ON s.id=e.sense_id JOIN units u ON u.id=s.unit_id WHERE u.kind='phrasal_verb' AND s.eligible=1").map_err(|e|e.to_string())?;
            for row in e
                .query_map([], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
                })
                .map_err(|e| e.to_string())?
            {
                let (sense, text) = row.map_err(|e| e.to_string())?;
                if let Some(text) = text {
                    source_examples.entry(sense).or_default().push(
                        text.split(|c: char| {
                            !c.is_alphabetic() && c != '\'' && c != '’' && c != '-'
                        })
                        .filter(|s| !s.is_empty())
                        .map(str::to_lowercase)
                        .collect(),
                    );
                }
            }
        }
        let source_examples = source_examples
            .into_iter()
            .map(|(id, examples)| (id, Arc::new(examples)))
            .collect::<HashMap<_, _>>();
        let empty_examples = Arc::new(vec![]);
        let mut separable = HashSet::new();
        for (unit, head, sense, source) in &rows {
            let Some(verb) = head.split_whitespace().next() else {
                continue;
            };
            for (tokens, postposed) in variants(source) {
                if !matches!(tokens.first(),Some(Token::Fixed(v)) if v.iter().any(|s|s==verb)) {
                    continue;
                }
                let examples = source_examples
                    .get(sense)
                    .cloned()
                    .unwrap_or_else(|| empty_examples.clone());
                if matches!(tokens.get(1), Some(Token::Object { .. }))
                    && matches!(tokens.get(2),Some(Token::Fixed(v)) if v.iter().any(|s|particle(s)))
                {
                    separable.insert(unit.clone());
                }
                out.by_verb.entry(verb.into()).or_default().push(Pattern {
                    unit: unit.clone(),
                    sense: sense.clone(),
                    tokens,
                    postposed,
                    proposal: false,
                    examples,
                });
            }
        }
        // A separable unit may have another sense recorded only by its bare
        // head. Retain it as a proposal, never a source-confirmed object alias.
        for (unit, head, sense, source) in rows {
            let words = head.split_whitespace().collect::<Vec<_>>();
            if source == head && words.len() == 2 && particle(words[1]) && separable.contains(&unit)
            {
                out.by_verb
                    .entry(words[0].into())
                    .or_default()
                    .push(Pattern {
                        unit,
                        sense,
                        tokens: vec![
                            Token::Fixed(vec![words[0].into()]),
                            Token::Object {
                                person: true,
                                thing: true,
                            },
                            Token::Fixed(vec![words[1].into()]),
                        ],
                        postposed: None,
                        proposal: true,
                        examples: empty_examples.clone(),
                    });
            }
        }
        Ok(out)
    }
    /// True means source-confirmed; false is a syntactically possible noun
    /// phrase that is useful for lookup but cannot silently merge saved data.
    fn object(
        &self,
        words: &[&str],
        person: bool,
        thing: bool,
        postposed: bool,
        catalog: &RelationCatalog,
    ) -> Option<bool> {
        if words.is_empty()
            || words.len() > MAX_OBJECT
            || !words
                .iter()
                .all(|s| atom(s) || s.chars().all(|c| c.is_ascii_digit()))
        {
            return None;
        }
        let lower = words.iter().map(|s| s.to_lowercase()).collect::<Vec<_>>();
        if words.len() == 1 {
            if let Some((p, t)) = pronoun(&lower[0]) {
                let weak = matches!(
                    lower[0].as_str(),
                    "me" | "him" | "her" | "us" | "you" | "it" | "them"
                ) || reflexive(&lower[0]);
                return (!(postposed && weak) && ((p && person) || (t && thing))).then_some(true);
            }
        }
        // Coordinated object pronouns/noun phrases, e.g. "Mary and me".
        if let Some(i) = lower.iter().position(|s| s == "and" || s == "or") {
            if i == 0 || i + 1 == words.len() {
                return None;
            }
            self.object(&words[..i], person, thing, postposed, catalog)?;
            self.object(&words[i + 1..], person, thing, postposed, catalog)?;
            return Some(false);
        }
        // Quantified objects are complete noun phrases, not extra verb parts.
        if words.len() == 3
            && matches!(lower[0].as_str(), "all" | "both" | "some" | "any" | "none")
            && lower[1] == "of"
            && pronoun(&lower[2]).is_some()
        {
            return Some(false);
        }
        let forbidden = [
            "i", "we", "he", "she", "they", "who", "whom", "whose", "which", "what", "when",
            "where", "whether", "why", "how", "is", "are", "was", "were", "am", "be", "been",
            "being", "will", "would", "could", "should", "must", "shall", "might", "has", "have",
            "had", "do", "does", "did", "because", "if", "although", "that’s",
        ];
        if lower.iter().any(|s| forbidden.contains(&s.as_str())) {
            return None;
        }
        if words.len() > 1
            && lower.iter().any(|s| {
                pronoun(s).is_some()
                    && !matches!(s.as_str(), "this" | "that" | "these" | "those" | "her")
            })
        {
            return None;
        }
        if [
            "at", "in", "on", "to", "from", "for", "with", "by", "of", "as", "into", "onto",
            "after", "before", "about", "without", "through", "around", "up", "down", "out", "off",
            "just", "not", "never", "already", "also",
        ]
        .contains(&lower[0].as_str())
        {
            return None;
        }
        let last = lower.last().unwrap();
        if [
            "of", "with", "in", "on", "at", "to", "from", "for", "by", "as", "and", "or",
        ]
        .contains(&last.as_str())
            || possessive(last)
            || ["a", "an", "the", "some", "any", "every", "each"].contains(&last.as_str())
        {
            return None;
        }
        // Reject finite clauses; allow adjectival participles inside a noun phrase.
        for (i, s) in lower.iter().enumerate() {
            let candidates = catalog.candidates(s);
            let noun = candidates
                .iter()
                .any(|c| c.part_of_speech.as_deref() == Some("noun"))
                || self.nounlike.contains(s);
            let verb = candidates
                .iter()
                .any(|c| c.part_of_speech.as_deref() == Some("verb"))
                || self.verb_only.contains(s);
            let participle = candidates.iter().any(|c| c.relation.contains("participle"))
                || s.ends_with("ing")
                || s.ends_with("ed");
            if verb && !noun && !(i + 1 < words.len() && participle) {
                return None;
            }
        }
        Some(false)
    }
    fn matches_pattern(
        &self,
        p: &Pattern,
        words: &[&str],
        catalog: &RelationCatalog,
    ) -> Option<bool> {
        fn walk(
            index: &ExpressionIndex,
            p: &Pattern,
            words: &[&str],
            catalog: &RelationCatalog,
            t: usize,
            w: usize,
            budget: &mut usize,
        ) -> Option<bool> {
            if *budget == 0 {
                return None;
            }
            *budget -= 1;
            if t == p.tokens.len() {
                return (w == words.len()).then_some(true);
            }
            if w >= words.len() {
                return None;
            }
            match &p.tokens[t] {
                Token::Fixed(choices) => {
                    if choices.iter().any(|s| s == words[w]) {
                        walk(index, p, words, catalog, t + 1, w + 1, budget)
                    } else if choices.iter().all(|s| particle(s))
                        && matches!(words[w], "right" | "straight")
                        && words
                            .get(w + 1)
                            .is_some_and(|next| choices.iter().any(|s| s == next))
                    {
                        // A particle modifier is a separate, uncertain reading;
                        // it is not swallowed into the direct object.
                        walk(index, p, words, catalog, t + 1, w + 2, budget).map(|_| false)
                    } else {
                        None
                    }
                }
                Token::Reflexive => {
                    if reflexive(&words[w].to_lowercase()) {
                        walk(index, p, words, catalog, t + 1, w + 1, budget)
                    } else {
                        None
                    }
                }
                Token::Possessive => {
                    if possessive(&words[w].to_lowercase()) {
                        walk(index, p, words, catalog, t + 1, w + 1, budget).map(|_| false)
                    } else {
                        None
                    }
                }
                Token::Object { person, thing } => {
                    let mut possible = None;
                    for end in w + 1..=words.len().min(w + MAX_OBJECT) {
                        if let Some(certain) = index.object(
                            &words[w..end],
                            *person,
                            *thing,
                            p.postposed == Some(t),
                            catalog,
                        ) {
                            if let Some(rest) = walk(index, p, words, catalog, t + 1, end, budget) {
                                if certain && rest {
                                    return Some(true);
                                }
                                possible = Some(false);
                            }
                        }
                    }
                    possible
                }
            }
        }
        let mut budget = MAX_STATES;
        let certain = walk(self, p, words, catalog, 0, 0, &mut budget)?;
        let lower = words.iter().map(|s| s.to_lowercase()).collect::<Vec<_>>();
        let attested = p.examples.iter().any(|e| {
            e.windows(lower.len()).any(|w| {
                w[1..] == lower[1..]
                    && (w[0] == lower[0]
                        || catalog.candidates(&w[0]).iter().any(|c| {
                            c.part_of_speech.as_deref() == Some("verb") && c.lemma == lower[0]
                        }))
            })
        });
        Some(!p.proposal && (certain || attested))
    }
    pub fn matches(&self, query: &str, catalog: &RelationCatalog) -> Vec<Match> {
        let words = query.split_whitespace().collect::<Vec<_>>();
        if words.len() < 2 || words.len() > MAX_WORDS {
            return vec![];
        }
        let verbs = catalog.expression_verbs(words[0]);
        // Prefer an explicit argument structure even when the noun phrase is
        // uncertain. Bare-head fallback senses can otherwise leak unrelated
        // intransitive meanings into a valid transitive construction.
        type MatchedSenses = (BTreeSet<String>, BTreeSet<String>, BTreeSet<String>);
        let mut found: BTreeMap<String, MatchedSenses> = BTreeMap::new();
        for verb in verbs.into_iter().take(16) {
            let mut normalized = words.clone();
            normalized[0] = &verb;
            for p in self.by_verb.get(&verb).into_iter().flatten() {
                if let Some(certain) = self.matches_pattern(p, &normalized, catalog) {
                    let (explicit, fallback, confirmed) = found.entry(p.unit.clone()).or_default();
                    if p.proposal {
                        fallback.insert(p.sense.clone());
                    } else {
                        explicit.insert(p.sense.clone());
                    }
                    if certain {
                        confirmed.insert(p.sense.clone());
                    }
                }
            }
        }
        found
            .into_iter()
            .take(32)
            .map(|(unit, (explicit, fallback, confirmed))| Match {
                unit,
                kind: if confirmed.is_empty() {
                    "expression_candidate"
                } else {
                    "expression_pattern"
                }
                .into(),
                restricted: if !confirmed.is_empty() {
                    confirmed
                } else if !explicit.is_empty() {
                    explicit
                } else {
                    fallback
                }
                .into_iter()
                .collect(),
                group: None,
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::OnceLock;
    fn catalog() -> &'static RelationCatalog {
        static C: OnceLock<RelationCatalog> = OnceLock::new();
        C.get_or_init(||{
            let c=Connection::open_in_memory().unwrap();
            c.execute_batch("CREATE TABLE units(id TEXT,headword TEXT,pos TEXT,kind TEXT); CREATE TABLE senses(id TEXT,unit_id TEXT,definition_en TEXT,eligible INTEGER,pattern TEXT); CREATE TABLE groups(id TEXT,unit_id TEXT); CREATE TABLE forms(group_id TEXT,text TEXT,label TEXT); CREATE TABLE examples(sense_id TEXT,english TEXT);
            INSERT INTO units VALUES ('wear','wear','verb','word'),('wore','wore','verb','word'),('look','look','verb','word'),('take','take','verb','word'),('pick','pick','verb','word'),('turn','turn','verb','word'),('put','put','verb','word'),('see','see','verb','word'),('saw','saw','verb','word'),('lie','lie','verb','word'),('go','go','verb','word'),('word','word','noun','word'),('car','car','noun','word'),('coat','coat','noun','word'),('radio','radio','noun','word'),('new','new','adjective','word');
            INSERT INTO groups VALUES('wear','wear'),('look','look'),('take','take'),('pick','pick'),('turn','turn'),('see','see'),('saw','saw');
            INSERT INTO forms VALUES('wear','wore','past tense'),('wear','worn','past participle'),('look','looked','past tense'),('take','took','past tense'),('pick','picked','past tense'),('turn','turned','past tense'),('see','saw','past tense');
            INSERT INTO senses VALUES('wear-root','wear','to have clothes on',1,NULL),('wore-root','wore','the past tense of wear',1,NULL),('look-root','look','to see',1,NULL),('take-root','take','to carry',1,NULL),('pick-root','pick','to choose',1,NULL),('turn-root','turn','to rotate',1,NULL),('see-root','see','to perceive',1,NULL),('saw-root','saw','to cut with a tool',1,NULL);
            INSERT INTO units VALUES('wo','wear out','phrasal verb','phrasal_verb'),('lu','look up','phrasal verb','phrasal_verb'),('to','take off','phrasal verb','phrasal_verb'),('pu','pick up','phrasal verb','phrasal_verb'),('tn','turn on','phrasal verb','phrasal_verb'),('puw','put up with','phrasal verb','phrasal_verb'),('pdt','put down to','phrasal verb','phrasal_verb'),('so','saw off','phrasal verb','phrasal_verb'),('se','see off','phrasal verb','phrasal_verb'),('ld','lie down','phrasal verb','phrasal_verb'),('tuw','take up with','phrasal verb','phrasal_verb');
            INSERT INTO senses VALUES('tired','wo','to make someone tired',1,'wear somebody out'),('damage','wo','to become damaged',1,'wear out'),('search','lu','to find information',1,'look something ↔ up'),('clothes','to','remove clothing',1,'take something ↔ off'),('imitate','to','to imitate',1,'take somebody ↔ off'),('lift','pu','to lift',1,'pick somebody/something ↔ up'),('stand','pu','to stand again',1,'pick yourself up'),('switch','tn','to activate',1,'turn something ↔ on'),('interest','tn','to interest someone',1,'turn somebody on'),('tolerate','puw','to tolerate',1,'put up with somebody/something'),('attribute','pdt','to attribute',1,'put something down to something'),('cut','so','to cut away',1,'saw something ↔ off'),('farewell','se','to say goodbye',1,'see somebody/something ↔ off'),('rest','ld','to rest',1,'lie down'),('discuss','tuw','to discuss with someone',1,'take something ↔ up with somebody');
            INSERT INTO examples VALUES('search','Please look the word up.'),('tired','The journey wore us out.');").unwrap();
            RelationCatalog::build(&c,"test","test",true).unwrap()
        })
    }
    fn heads(q: &str) -> BTreeSet<String> {
        let c = catalog();
        c.expression_matches(q)
            .into_iter()
            .filter_map(|m| c.expression_head(&m.unit).map(str::to_string))
            .collect()
    }
    #[test]
    fn objects_and_irregular_verbs_use_all_source_patterns() {
        for (q, head, sense) in [
            ("wore me out", "wear out", "tired"),
            ("worn us out", "wear out", "tired"),
            ("wear her out", "wear out", "tired"),
            ("picked myself up", "pick up", "stand"),
            ("took it off", "take off", "clothes"),
            ("took him off", "take off", "imitate"),
            ("turned it on", "turn on", "switch"),
            ("turned me on", "turn on", "interest"),
            ("looked up something", "look up", "search"),
            ("picked up someone", "pick up", "lift"),
        ] {
            assert!(heads(q).contains(head), "{q}");
            assert!(
                catalog()
                    .expression_matches(q)
                    .iter()
                    .any(|m| m.restricted.contains(&sense.into())),
                "{q} sense"
            );
            assert_eq!(catalog().identity(q), head, "{q}");
        }
        assert!(!catalog()
            .expression_matches("wore me out")
            .iter()
            .any(|m| m.restricted.contains(&"damage".into())));
    }
    #[test]
    fn noun_phrases_and_multiple_slots_remain_lookup_proposals() {
        for (q, head) in [
            ("looked the new word up", "look up"),
            ("look the red car up", "look up"),
            ("took my warm coat off", "take off"),
            ("wear my whole team out", "wear out"),
            ("put the failure down to bad luck", "put down to"),
            ("put up with the noise", "put up with"),
            ("took up the issue with him", "take up with"),
            ("pick Mary and me up", "pick up"),
            ("Picked Mary up", "pick up"),
            ("look it right up", "look up"),
        ] {
            assert!(heads(q).contains(head), "{q}: {:?}", heads(q));
            assert_eq!(
                catalog().identity(q),
                q,
                "{q} must not rewrite saved identity"
            );
        }
        assert_eq!(catalog().identity("looked the word up"), "look up");
        assert_eq!(catalog().identity("looked up"), "look up");
        assert_eq!(catalog().identity("Wore me out"), "wear out");
        assert!(!catalog()
            .expression_matches("wear my whole team out")
            .iter()
            .any(|m| m.restricted.contains(&"damage".into())));
    }
    #[test]
    fn independent_and_inflected_verbs_keep_distinct_prototypes() {
        assert_eq!(
            heads("saw them off"),
            BTreeSet::from(["saw off".into(), "see off".into()])
        );
        assert_eq!(catalog().identity("saw them off"), "saw them off");
        assert_eq!(heads("saw him off"), BTreeSet::from(["see off".into()]));
    }
    #[test]
    fn clauses_and_illegal_particle_positions_do_not_become_objects() {
        for q in [
            "look at what is up",
            "look what is up",
            "looked at what is up",
            "look it upon",
            "look it extremely up",
            "wear he is out",
            "turn on it",
            "put me with up",
            "lie it down",
            "look the boy goes up",
            "wore this because of work out",
        ] {
            assert!(heads(q).is_empty(), "{q}: {:?}", heads(q));
            assert_eq!(catalog().identity(q), q);
        }
        assert!(heads(&format!("wear {} out", vec!["word"; 25].join(" "))).is_empty());
    }
    #[test]
    fn optional_groups_and_literal_alternatives_are_bounded() {
        let p = variants("take something off (something)");
        assert!(p.iter().any(|(t, _)| t.len() == 3));
        assert!(p.iter().any(|(t, _)| t.len() == 4));
        assert!(!variants("bandy something ↔ about/around").is_empty());
        assert!(variants("look (a (nested) object) up").is_empty());
        assert!(variants("do something (a) (b) (c) (d)").is_empty());
    }
}
