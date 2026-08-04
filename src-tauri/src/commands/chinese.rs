use jieba_rs::Jieba;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::sync::OnceLock;

#[derive(Serialize, Debug, PartialEq)]
pub struct ChineseToken {
    pub surface: String,
    pub lemma: String,
    pub reading: Option<String>,
    pub part_of_speech: Option<String>,
    pub position: i32,
}

struct ChineseReadings {
    map: HashMap<String, String>,
}

fn load_readings() -> &'static ChineseReadings {
    static READINGS: OnceLock<ChineseReadings> = OnceLock::new();
    READINGS.get_or_init(|| {
        let mut decoder =
            flate2::read::GzDecoder::new(include_bytes!("../../resources/cc-cedict.tsv.gz").as_slice());
        let mut contents = String::new();
        decoder
            .read_to_string(&mut contents)
            .expect("failed to read cc-cedict.tsv.gz");
        let mut map = HashMap::new();
        for line in contents.lines() {
            let mut fields = line.splitn(3, '\t');
            let lemma = fields.next().unwrap_or_default().trim();
            let reading = fields.next().unwrap_or_default().trim();
            if lemma.is_empty() || reading.is_empty() {
                continue;
            }
            map.insert(lemma.to_string(), reading.to_string());
        }
        ChineseReadings { map }
    })
}

fn jieba() -> &'static Jieba {
    static JIEBA: OnceLock<Jieba> = OnceLock::new();
    JIEBA.get_or_init(Jieba::new)
}

fn is_han(c: char) -> bool {
    matches!(c, '\u{3400}'..='\u{4DBF}' | '\u{4E00}'..='\u{9FFF}' | '\u{F900}'..='\u{FAFF}')
}

fn is_content_token(word: &str) -> bool {
    word.chars()
        .any(|c| is_han(c) || c.is_ascii_alphanumeric())
}

pub struct ChineseTokenWithOffset {
    pub surface: String,
    pub position: i32,
    pub char_start: usize,
    pub char_end: usize,
    pub part_of_speech: Option<String>,
}

/// Tokenize Chinese text and return content tokens with absolute character
/// offsets, so callers can map a character position back to a token.
pub fn tokenize_chinese_with_offsets(text: &str) -> Vec<ChineseTokenWithOffset> {
    let tags = jieba().tag(text, true);

    let mut result = Vec::new();
    let mut offset = 0usize;
    let mut position = 0i32;
    for token in tags {
        let surface = token.word;
        let char_len = surface.chars().count();
        let start = offset;
        let end = offset + char_len;
        offset = end;
        let trimmed = surface.trim();
        if trimmed.is_empty() || !is_content_token(trimmed) {
            continue;
        }
        result.push(ChineseTokenWithOffset {
            surface: trimmed.to_string(),
            position,
            char_start: start,
            char_end: end,
            part_of_speech: Some(token.tag.to_string()),
        });
        position += 1;
    }
    result
}

#[tauri::command]
pub fn tokenize_chinese(text: String) -> Result<Vec<ChineseToken>, String> {
    let tokens = tokenize_chinese_with_offsets(&text);
    Ok(tokens
        .into_iter()
        .map(|token| {
            let reading = load_readings()
                .map
                .get(&token.surface)
                .cloned()
                .filter(|value| !value.is_empty());
            ChineseToken {
                surface: token.surface.clone(),
                lemma: token.surface,
                reading,
                part_of_speech: token.part_of_speech,
                position: token.position,
            }
        })
        .collect())
}

#[tauri::command]
pub fn tokenize_chinese_batch(texts: Vec<String>) -> Result<Vec<Vec<ChineseToken>>, String> {
    Ok(texts
        .iter()
        .map(|text| tokenize_chinese(text.clone()).unwrap_or_default())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn surfaces(tokens: &[ChineseToken]) -> Vec<&str> {
        tokens.iter().map(|token| token.surface.as_str()).collect()
    }

    #[test]
    fn segments_common_chinese_words() {
        let tokens = tokenize_chinese("我今天学习了中文。".to_string()).unwrap();
        let result = surfaces(&tokens);
        assert!(result.contains(&"我"), "should keep 我");
        assert!(result.contains(&"今天"), "should keep 今天");
        assert!(result.contains(&"学习"), "should keep 学习");
        assert!(result.contains(&"中文"), "should keep 中文");
    }

    #[test]
    fn attaches_pinyin_reading() {
        let tokens = tokenize_chinese("你好世界".to_string()).unwrap();
        let ni_hao = tokens.iter().find(|token| token.surface == "你好").unwrap();
        assert!(ni_hao.reading.is_some(), "should attach pinyin for 你好");
    }

    #[test]
    fn filters_punctuation_and_whitespace() {
        let tokens = tokenize_chinese("你好，世界！ ".to_string()).unwrap();
        assert!(
            !tokens.iter().any(|token| !is_content_token(&token.surface)),
            "punctuation should be filtered"
        );
        let result = surfaces(&tokens);
        assert_eq!(result, vec!["你好", "世界"]);
    }

    #[test]
    fn assigns_sequential_positions() {
        let tokens = tokenize_chinese("我爱中文".to_string()).unwrap();
        for (index, token) in tokens.iter().enumerate() {
            assert_eq!(token.position, index as i32);
        }
    }

    #[test]
    fn keeps_latin_and_digits() {
        let tokens = tokenize_chinese("我用Python写代码".to_string()).unwrap();
        assert!(tokens.iter().any(|token| token.surface == "Python"));
    }

    #[test]
    fn batch_matches_single_calls() {
        let texts = vec!["我今天学习了中文。".to_string(), "你好世界".to_string()];
        let batch = tokenize_chinese_batch(texts.clone()).unwrap();
        assert_eq!(batch.len(), 2);
        for (index, tokens) in batch.iter().enumerate() {
            let single = tokenize_chinese(texts[index].clone()).unwrap();
            assert_eq!(tokens.len(), single.len());
            assert_eq!(tokens, &single);
        }
    }
}
