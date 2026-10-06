// Compatibility module for the existing analysis pipeline. Model operations
// are native Gemma operations; the old Ollama download API is no longer exposed.
pub use crate::commands::gemma::models::generation_guard;

pub fn is_loopback_service(base_url: &str) -> bool {
    reqwest::Url::parse(base_url).is_ok_and(|url| matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")))
}
