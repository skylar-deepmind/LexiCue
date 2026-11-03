//! Onboarding uses the production material/saved cores in a separate in-memory
//! database. No example row, receipt or sync event can enter the user's library.
use super::{import::SegmentInput, materials, saved};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tauri::State;

struct Session {
    id: String,
    conn: Connection,
    file_id: i64,
}
#[derive(Default)]
struct Sessions {
    open: HashMap<String, Session>,
    closed: HashSet<String>,
}
#[derive(Clone, Default)]
pub struct ExampleState(Arc<Mutex<Sessions>>);
#[derive(Serialize)]
pub struct ExampleMaterial {
    pub session_id: String,
    pub data: materials::ReadingMaterial,
}
fn valid(id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| "example_invalid_session".into())
}
impl ExampleState {
    pub fn begin(&self, owner: &str, id: &str) -> Result<ExampleMaterial, String> {
        valid(id)?;
        let mut state = self.0.lock().map_err(|e| e.to_string())?;
        if state.closed.contains(id) {
            return Err("example_session_ended".into());
        }
        if state.open.get(owner).map(|s| s.id.as_str()) != Some(id) {
            let conn =
                crate::db::init_db(std::path::Path::new(":memory:")).map_err(|e| e.to_string())?;
            let sentences = [
                "Curiosity helps us notice small changes.",
                "A small habit can make a big difference.",
                "We can learn something new every day.",
            ];
            let segments = sentences
                .iter()
                .enumerate()
                .map(|(index, text)| SegmentInput {
                    index: index as i32,
                    en_text: (*text).into(),
                    zh_text: None,
                    start_time: Some(format!("00:00:{:02}.000", index * 4 + 1)),
                    end_time: Some(format!("00:00:{:02}.000", index * 4 + 4)),
                })
                .collect();
            let content = sentences
                .iter()
                .enumerate()
                .map(|(index, text)| {
                    format!(
                        "{}\n00:00:{:02},000 --> 00:00:{:02},000\n{text}\n",
                        index + 1,
                        index * 4 + 1,
                        index * 4 + 4
                    )
                })
                .collect::<Vec<_>>()
                .join("\n");
            let imported = materials::import_material(
                &conn,
                &materials::MaterialInput {
                    document: None,
                    normalized_kind: None,
                    source: None,
                    operation_id: id.into(),
                    name: "English example.srt".into(),
                    content,
                    segments,
                },
            )?;
            // Replacing a window's session discards all prior example state.
            if let Some(previous) = state.open.insert(
                owner.into(),
                Session {
                    id: id.into(),
                    conn,
                    file_id: imported.file_id,
                },
            ) {
                state.closed.insert(previous.id);
            }
        }
        let session = &state.open[owner];
        Ok(ExampleMaterial {
            session_id: id.into(),
            data: materials::open(&session.conn, session.file_id)?,
        })
    }
    pub fn with<T>(
        &self,
        owner: &str,
        id: &str,
        read: impl FnOnce(&Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        valid(id)?;
        let state = self.0.lock().map_err(|e| e.to_string())?;
        let session = state
            .open
            .get(owner)
            .filter(|s| s.id == id)
            .ok_or("example_session_ended")?;
        read(&session.conn)
    }
    pub fn end(&self, owner: &str, id: &str) -> Result<(), String> {
        valid(id)?;
        let mut state = self.0.lock().map_err(|e| e.to_string())?;
        state.closed.insert(id.into());
        if state.open.get(owner).map(|s| s.id.as_str()) == Some(id) {
            state.open.remove(owner);
        }
        Ok(())
    }
}
#[tauri::command]
pub async fn begin_example_session(
    state: State<'_, ExampleState>,
    window: tauri::Window,
    session_id: String,
) -> Result<ExampleMaterial, String> {
    let shared = state.inner().clone();
    let owner = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || shared.begin(&owner, &session_id))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn end_example_session(
    state: State<'_, ExampleState>,
    window: tauri::Window,
    session_id: String,
) -> Result<(), String> {
    // Mark the token closed while handling this IPC, before any later replay
    // can enqueue initialization. A delayed begin must never replace that replay.
    // This only drops the tiny in-memory session; there is no user DB or disk IO.
    state.end(window.label(), &session_id)
}
#[tauri::command]
pub async fn example_saved_for_selection(
    state: State<'_, ExampleState>,
    window: tauri::Window,
    session_id: String,
    input: saved::SaveInput,
) -> Result<Option<saved::SavedRecord>, String> {
    let shared = state.inner().clone();
    let owner = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        shared.with(&owner, &session_id, |c| saved::selection(c, &input))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn mutate_example_saved_record(
    state: State<'_, ExampleState>,
    window: tauri::Window,
    session_id: String,
    operation_id: String,
    mutation: saved::Mutation,
) -> Result<saved::MutationResult, String> {
    let shared = state.inner().clone();
    let owner = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        shared.with(&owner, &session_id, |c| {
            saved::mutate(c, &operation_id, &mutation)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn undo_example_saved_mutation(
    state: State<'_, ExampleState>,
    window: tauri::Window,
    session_id: String,
    operation_id: String,
) -> Result<saved::SavedRecord, String> {
    let shared = state.inner().clone();
    let owner = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        shared.with(&owner, &session_id, |c| saved::undo(c, &operation_id))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn actual_sample_save_dedup_undo_and_cleanup_never_touch_real_library() {
        let temp = tempfile::tempdir().unwrap();
        let real = crate::db::init_db(&temp.path().join("real.db")).unwrap();
        let before = serde_json::to_value(super::super::export::backup_payload(&real).unwrap())
            .unwrap()["data"]
            .clone();
        let state = ExampleState::default();
        let id = uuid::Uuid::new_v4().to_string();
        let demo = state.begin("main", &id).unwrap();
        assert_eq!(demo.data.segments.len(), 3);
        state
            .with("main", &id, |c| {
                assert!(saved::list(c, "", 10, 0)?.is_empty());
                Ok(())
            })
            .unwrap();
        let input = || saved::SaveInput {
            segment_id: demo.data.segments[0].id,
            expression: "Curiosity".into(),
            start_offset: 0,
            end_offset: 9,
            explanation: Some("好奇心".into()),
            explanation_source: "dictionary".into(),
            dictionary_snapshot: None,
            dictionary_reference: None,
        };
        let first = state
            .with("main", &id, |c| {
                saved::mutate(c, "first", &saved::Mutation::Save { input: input() })
            })
            .unwrap();
        for i in 0..10 {
            assert!(
                !state
                    .with("main", &id, |c| saved::mutate(
                        c,
                        &format!("repeat-{i}"),
                        &saved::Mutation::Save { input: input() }
                    ))
                    .unwrap()
                    .changed
            );
        }
        let undone = state
            .with("main", &id, |c| saved::undo(c, &first.operation_id))
            .unwrap();
        assert!(undone.deleted_at.is_some());
        assert_eq!(
            serde_json::to_value(super::super::export::backup_payload(&real).unwrap()).unwrap()
                ["data"],
            before
        );
        state.end("main", &id).unwrap();
        assert!(state
            .with("main", &id, |c| saved::selection(c, &input()))
            .is_err());
        assert!(state.begin("main", &id).is_err());
        let next = uuid::Uuid::new_v4().to_string();
        state.begin("main", &next).unwrap();
        state
            .with("main", &next, |c| {
                assert!(saved::list(c, "", 10, 0)?.is_empty());
                Ok(())
            })
            .unwrap();
    }
    #[test]
    fn skip_before_a_delayed_begin_cannot_replace_the_next_example() {
        let state = ExampleState::default();
        let delayed = uuid::Uuid::new_v4().to_string();
        let replay = uuid::Uuid::new_v4().to_string();
        state.end("main", &delayed).unwrap();
        state.begin("main", &replay).unwrap();
        assert!(state.begin("main", &delayed).is_err());
        state
            .with("main", &replay, |c| {
                assert!(saved::list(c, "", 10, 0)?.is_empty());
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn stale_and_other_window_tokens_cannot_mutate_a_replayed_session() {
        let state = ExampleState::default();
        let old = uuid::Uuid::new_v4().to_string();
        let new = uuid::Uuid::new_v4().to_string();
        state.begin("main", &old).unwrap();
        state.begin("main", &new).unwrap();
        assert!(state.begin("main", &old).is_err());
        state.end("main", &old).unwrap();
        assert!(state.with("main", &old, |_| Ok(())).is_err());
        assert!(state.with("other", &new, |_| Ok(())).is_err());
        assert!(state.with("main", &new, |_| Ok(())).is_ok());
    }
}
