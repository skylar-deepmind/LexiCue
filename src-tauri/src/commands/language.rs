use lindera::dictionary::load_dictionary;
use lindera::mode::Mode;
use lindera::segmenter::Segmenter;
use serde::Serialize;
use std::borrow::Cow;
use std::sync::Mutex;
use std::sync::OnceLock;

#[derive(Serialize, Debug, PartialEq)]
pub struct JapaneseToken {
    pub surface: String,
    pub lemma: String,
    pub reading: Option<String>,
    pub part_of_speech: Option<String>,
    pub position: i32,
}

fn is_learning_relevant_pos(pos: &str) -> bool {
    !matches!(
        pos,
        "助詞" | "助動詞" | "記号" | "補助記号" | "空白"
    )
}

fn segmenter() -> &'static Mutex<Segmenter> {
    static SEGMENTER: OnceLock<Mutex<Segmenter>> = OnceLock::new();
    SEGMENTER.get_or_init(|| {
        let dictionary = load_dictionary("embedded://unidic")
            .expect("failed to load embedded unidic dictionary");
        Mutex::new(Segmenter::new(Mode::Normal, dictionary, None))
    })
}

fn tokenize_japanese_text(text: &str) -> Vec<JapaneseToken> {
    let segmenter = segmenter()
        .lock()
        .expect("japanese segmenter lock poisoned");
    let mut tokens = segmenter
        .segment(Cow::Borrowed(text))
        .expect("japanese segmentation failed");

    let mut result = Vec::new();
    for (position, token) in tokens.iter_mut().enumerate() {
        let surface = token.surface.to_string();
        if surface.trim().is_empty() {
            continue;
        }
        let details = token.details();
        let pos_major = details.first().copied().unwrap_or("*");
        if !is_learning_relevant_pos(pos_major) {
            continue;
        }
        let lemma = details
            .get(7)
            .copied()
            .unwrap_or(surface.as_str())
            .to_string();
        let reading = details.get(6).copied().filter(|value| *value != "*");
        let part_of_speech = details.first().copied().filter(|value| *value != "*");
        result.push(JapaneseToken {
            surface,
            lemma,
            reading: reading.map(str::to_string),
            part_of_speech: part_of_speech.map(str::to_string),
            position: position as i32,
        });
    }
    result
}

#[tauri::command]
pub fn tokenize_japanese(text: String) -> Result<Vec<JapaneseToken>, String> {
    Ok(tokenize_japanese_text(&text))
}

#[tauri::command]
pub fn tokenize_japanese_batch(texts: Vec<String>) -> Result<Vec<Vec<JapaneseToken>>, String> {
    Ok(texts.iter().map(|text| tokenize_japanese_text(text)).collect())
}

#[cfg(test)]
mod tests {
    use super::{tokenize_japanese, tokenize_japanese_batch};

    #[test]
    fn conjugates_to_base_form() {
        let tokens = tokenize_japanese("昨日、寿司を食べました。".to_string()).unwrap();
        let eaten = tokens.iter().find(|token| token.surface == "食べ").unwrap();
        assert_eq!(eaten.lemma, "食べる");
        assert!(eaten.reading.is_some());
    }

    #[test]
    fn filters_particles_and_symbols() {
        let tokens = tokenize_japanese("昨日、寿司を食べました。".to_string()).unwrap();
        let surfaces: Vec<&str> = tokens.iter().map(|t| t.surface.as_str()).collect();
        assert!(!surfaces.contains(&"を"), "particle を should be filtered");
        assert!(!surfaces.contains(&"、"), "symbol 、 should be filtered");
        assert!(!surfaces.contains(&"。"), "symbol 。 should be filtered");
    }

    #[test]
    fn keeps_content_words() {
        let tokens = tokenize_japanese("東京で映画を見ます。".to_string()).unwrap();
        let surfaces: Vec<&str> = tokens.iter().map(|t| t.surface.as_str()).collect();
        let lemmas: Vec<&str> = tokens.iter().map(|t| t.lemma.as_str()).collect();
        assert!(surfaces.contains(&"東京"), "should keep 東京 surface");
        assert!(lemmas.contains(&"映画"), "should keep 映画 lemma");
        assert!(lemmas.contains(&"見る"), "should keep 見る verb lemma");
    }

    #[test]
    fn handles_compound_and_conjugation() {
        let tokens =
            tokenize_japanese("彼女は日本語の勉強を始めました。".to_string()).unwrap();
        let surfaces: Vec<&str> = tokens.iter().map(|t| t.surface.as_str()).collect();
        let lemmas: Vec<&str> = tokens.iter().map(|t| t.lemma.as_str()).collect();
        assert!(lemmas.contains(&"彼女"), "should keep 彼女");
        assert!(surfaces.contains(&"日本") && surfaces.contains(&"語"), "日本語 should be 日本+語");
        assert!(lemmas.contains(&"勉強"), "should keep 勉強");
        assert!(lemmas.contains(&"始める"), "should keep 始める");
        assert!(!lemmas.contains(&"の"), "particle の should be filtered");
    }

    #[test]
    fn batch_matches_single_calls() {
        let texts = vec![
            "昨日、寿司を食べました。".to_string(),
            "東京で映画を見ます。".to_string(),
        ];
        let batch = tokenize_japanese_batch(texts.clone()).unwrap();
        assert_eq!(batch.len(), 2);
        for (index, tokens) in batch.iter().enumerate() {
            let single = tokenize_japanese(texts[index].clone()).unwrap();
            assert_eq!(tokens.len(), single.len());
            assert_eq!(tokens, &single);
        }
    }

    #[test]
    #[ignore = "timing measurement"]
    fn cached_dictionary_is_fast_across_calls() {
        let start = std::time::Instant::now();
        for _ in 0..100 {
            let _ = tokenize_japanese("昨日、寿司を食べました。".to_string()).unwrap();
        }
        let elapsed = start.elapsed();
        println!("100 tokenize_japanese calls: {elapsed:?}");
        assert!(
            elapsed.as_secs() < 5,
            "dictionary should be cached, took {elapsed:?}"
        );
    }
}
