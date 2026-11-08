//! The WebView can manage a pairing. Only the native authenticated channel can
//! enter the journal engine or supply a replica route.
use serde_json::Value;

#[cfg(target_vendor = "apple")]
mod apple;

#[cfg(target_vendor = "apple")]
pub(crate) use apple::with_restore_paused;
#[cfg(target_vendor = "apple")]
pub use apple::{initialize, receive_with_window_closed};

#[tauri::command]
pub async fn device_sync(action: String, confirmation_id: Option<String>) -> Result<Value, String> {
    #[cfg(target_vendor = "apple")]
    return tauri::async_runtime::spawn_blocking(move || {
        apple::command(&action, confirmation_id.as_deref())
    })
    .await
    .map_err(|_| "device_sync_unavailable".to_owned())?;
    #[cfg(not(target_vendor = "apple"))]
    {
        let _ = (action, confirmation_id);
        Ok(serde_json::json!({"state":"unsupported"}))
    }
}

/// Restore only a verified, locally generated pre-merge recovery point.
#[tauri::command]
pub async fn restore_device_merge_backup(
    state: tauri::State<'_, crate::db::DbState>,
    id: String,
) -> Result<crate::commands::export::RestoreResult, String> {
    #[cfg(target_vendor = "apple")]
    {
        let shared = state.conn.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let operation = uuid::Uuid::parse_str(&id).map_err(|_| "invalid backup id")?;
            let payload = apple::read_backup(operation)?;
            let db = shared.lock().map_err(|e| e.to_string())?;
            crate::commands::export::restore_with_safety_backup(&db, &payload)
        })
        .await
        .map_err(|_| "restore_status_unknown".to_owned())?
    }
    #[cfg(not(target_vendor = "apple"))]
    {
        let _ = (state, id);
        Err("device_sync_unavailable".into())
    }
}
