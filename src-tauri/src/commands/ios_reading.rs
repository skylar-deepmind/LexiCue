//! iOS owns the complete utterance queue so WebKit suspension cannot stop the next sentence.
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

// Voice and network preferences are consumed by the iOS-only playback queue.
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadingRequest {
    pub id: String,
    pub texts: Vec<String>,
    pub start_index: usize,
    pub rate: f32,
    pub accent: String,
    pub voice: String,
    pub online_enabled: bool,
    pub allow_device_fallback: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingProgress {
    pub id: String,
    pub index: usize,
    pub status: String,
    pub source: String,
}
#[tauri::command]
pub async fn ios_reading_start(app: AppHandle, request: ReadingRequest) -> Result<(), String> {
    if request.id.is_empty()
        || request.id.len() > 100
        || request.start_index >= request.texts.len()
        || request.texts.len() > 20000
        || request.texts.iter().map(String::len).sum::<usize>() > 4_000_000
        || request
            .texts
            .iter()
            .any(|s| s.trim().is_empty() || s.chars().count() > 1000)
        || ![0.75, 1.0, 1.25, 1.5].contains(&request.rate)
        || !["us", "gb"].contains(&request.accent.as_str())
    {
        return Err("invalid_input".into());
    }
    #[cfg(target_os = "ios")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let handle = app.clone();
        app.run_on_main_thread(move || {
            let _ = tx.send(crate::ios_reading::start(handle, request));
        })
        .map_err(|_| "device_failed")?;
        return rx.await.map_err(|_| "device_failed")?;
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        Err("unsupported_platform".into())
    }
}
#[tauri::command]
pub async fn ios_reading_control(
    app: AppHandle,
    id: String,
    action: String,
) -> Result<Option<ReadingProgress>, String> {
    if !["pause", "resume", "stop", "state"].contains(&action.as_str()) {
        return Err("invalid_input".into());
    }
    #[cfg(target_os = "ios")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(crate::ios_reading::control(&id, &action));
        })
        .map_err(|_| "device_failed")?;
        return rx.await.map_err(|_| "device_failed".to_string());
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, id);
        Ok(None)
    }
}
