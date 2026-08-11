use serde::Deserialize;

const GITHUB_API: &str = "https://api.github.com/repos/skylar-deepmind/LexiCue/releases/latest";
const RELEASE_URL: &str = "https://github.com/skylar-deepmind/LexiCue/releases/latest";

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    published_at: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestRelease {
    pub version: String,
    pub url: String,
    pub published_at: Option<String>,
}

#[tauri::command]
pub async fn check_github_release() -> Result<Option<LatestRelease>, String> {
    let client = reqwest::Client::builder()
        .user_agent("LexiCue")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(GITHUB_API).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("GitHub API error: {}", response.status()));
    }

    let release: GithubRelease = response.json().await.map_err(|e| e.to_string())?;
    Ok(Some(LatestRelease {
        version: release.tag_name.trim_start_matches('v').to_string(),
        url: RELEASE_URL.to_string(),
        published_at: release.published_at,
    }))
}
