//! Explicitly isolated native dictionary acceptance builds. Dictionary commands
//! and the frontend remain unchanged; shared sync credentials stay out of QA.
pub fn dictionary_isolation(identifier: &str, enabled: bool) -> Result<bool, &'static str> {
    let isolated = matches!(
        identifier,
        "com.lexicue.qa.dictionary.macos" | "com.lexicue.qa.dictionary.ios"
    );
    if isolated != enabled {
        return Err("Dictionary QA feature and isolated application identifier must agree");
    }
    Ok(isolated)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn qa_cannot_start_with_a_production_identity_or_without_explicit_feature() {
        for id in ["com.lexicue.app", "com.skylar.lexicue.ios"] {
            assert!(dictionary_isolation(id, true).is_err());
            assert_eq!(dictionary_isolation(id, false), Ok(false));
        }
        for id in [
            "com.lexicue.qa.dictionary.macos",
            "com.lexicue.qa.dictionary.ios",
        ] {
            assert_eq!(dictionary_isolation(id, true), Ok(true));
            assert!(dictionary_isolation(id, false).is_err());
        }
        assert!(dictionary_isolation("com.lexicue.qa.dictionary.ios.other", true).is_err());
    }
}
