use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::sync::OnceLock;

#[derive(Serialize, Debug, PartialEq)]
pub struct GermanToken {
    pub surface: String,
    pub lemma: String,
    pub part_of_speech: Option<String>,
    pub position: i32,
}

struct GermanWordforms {
    map: HashMap<String, (String, Option<String>)>,
}

fn load_wordforms() -> &'static GermanWordforms {
    static WORDFORMS: OnceLock<GermanWordforms> = OnceLock::new();
    WORDFORMS.get_or_init(|| {
        let mut decoder = flate2::read::GzDecoder::new(
            include_bytes!("../../resources/german_wordforms.tsv.gz").as_slice(),
        );
        let mut contents = String::new();
        decoder
            .read_to_string(&mut contents)
            .expect("failed to read german_wordforms.tsv.gz");
        let mut map = HashMap::new();
        for line in contents.lines() {
            let mut fields = line.splitn(3, '\t');
            let surface = fields.next().unwrap_or_default().trim();
            let lemma = fields.next().unwrap_or_default().trim();
            let pos = fields.next().unwrap_or_default().trim();
            if surface.is_empty() || lemma.is_empty() {
                continue;
            }
            map.insert(
                surface.to_string(),
                (
                    lemma.to_string(),
                    (!pos.is_empty()).then(|| pos.to_string()),
                ),
            );
        }
        GermanWordforms { map }
    })
}

fn is_latin_letter(c: char) -> bool {
    c.is_alphabetic() && (c as u32) < 0x024F
}

fn tokenize_german_text(text: &str) -> Vec<(String, i32)> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut position = 0i32;
    for c in text.chars() {
        if is_latin_letter(c) || (c == '-' && !current.is_empty()) {
            current.push(c);
        } else {
            if !current.is_empty() {
                tokens.push((std::mem::take(&mut current), position));
                position += 1;
            }
        }
    }
    if !current.is_empty() {
        tokens.push((current, position));
    }
    tokens
}

fn lemma_of(surface: &str, wordforms: &GermanWordforms) -> (String, Option<String>) {
    let lower = surface.to_lowercase();
    match wordforms.map.get(&lower) {
        Some((lemma, pos)) => (lemma.clone(), pos.clone()),
        None => (surface.to_string(), None),
    }
}

#[tauri::command]
pub fn tokenize_german(text: String) -> Result<Vec<GermanToken>, String> {
    let wordforms = load_wordforms();
    let tokens = tokenize_german_text(&text);
    let result = tokens
        .into_iter()
        .map(|(surface, position)| {
            let (lemma, part_of_speech) = lemma_of(&surface, wordforms);
            GermanToken {
                surface,
                lemma,
                part_of_speech,
                position,
            }
        })
        .collect();
    Ok(result)
}

#[tauri::command]
pub fn tokenize_german_batch(texts: Vec<String>) -> Result<Vec<Vec<GermanToken>>, String> {
    let wordforms = load_wordforms();
    Ok(texts
        .iter()
        .map(|text| {
            tokenize_german_text(text)
                .into_iter()
                .map(|(surface, position)| {
                    let (lemma, part_of_speech) = lemma_of(&surface, wordforms);
                    GermanToken {
                        surface,
                        lemma,
                        part_of_speech,
                        position,
                    }
                })
                .collect()
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_german_umlauts_and_eszett() {
        let tokens = tokenize_german_text("Über die Straße für uns");
        let surfaces: Vec<&str> = tokens.iter().map(|(s, _)| s.as_str()).collect();
        assert_eq!(surfaces, vec!["Über", "die", "Straße", "für", "uns"]);
    }

    #[test]
    fn maps_inflected_forms_to_lemmas() {
        let wordforms = load_wordforms();
        assert_eq!(lemma_of("ging", wordforms).0, "gehen");
        assert_eq!(lemma_of("gegangen", wordforms).0, "gehen");
        assert_eq!(lemma_of("geht", wordforms).0, "gehen");
        assert_eq!(lemma_of("Hauses", wordforms).0, "Haus");
        assert_eq!(lemma_of("häuser", wordforms).0, "Haus");
        assert_eq!(lemma_of("Haus", wordforms).0, "Haus");
        assert_eq!(lemma_of("der", wordforms).0, "der");
        assert_eq!(lemma_of("Der", wordforms).0, "der");
        assert_eq!(lemma_of("für", wordforms).0, "für");
    }

    #[test]
    fn preserves_case_of_unknown_words() {
        let wordforms = load_wordforms();
        assert_eq!(lemma_of("Berlin", wordforms).0, "Berlin");
        assert_eq!(lemma_of("xyzunbekannt", wordforms).0, "xyzunbekannt");
    }

    #[test]
    fn filters_punctuation() {
        let tokens = tokenize_german_text("Hallo, wie geht's dir?");
        let surfaces: Vec<&str> = tokens.iter().map(|(s, _)| s.as_str()).collect();
        assert_eq!(surfaces, vec!["Hallo", "wie", "geht", "s", "dir"]);
        let positions: Vec<i32> = tokens.iter().map(|(_, p)| *p).collect();
        assert_eq!(positions, vec![0, 1, 2, 3, 4]);
    }

    #[test]
    fn batch_matches_single_calls() {
        let texts = vec!["Über die Straße gehen wir.".to_string(), "Er ging nach Hause.".to_string()];
        let batch = tokenize_german_batch(texts.clone()).unwrap();
        assert_eq!(batch.len(), 2);
        for (index, tokens) in batch.iter().enumerate() {
            let single = tokenize_german(texts[index].clone()).unwrap();
            assert_eq!(tokens.len(), single.len());
            assert_eq!(tokens, &single);
        }
    }
}
