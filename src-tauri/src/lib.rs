mod commands;
mod db;

use db::{init_db, DbState, DictionaryStatus};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            let app_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_dir)?;
            let conn = init_db(&app_dir.join("lexicue.db")).expect("Failed to initialize database");
            app.manage(DbState {
                conn: Mutex::new(conn),
            });

            let status = DictionaryStatus::default();
            app.manage(status.clone());

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }

            let app_handle = app.handle().clone();
            let dict_dir = app_dir.clone();
            let thread_status = status.clone();
            std::thread::spawn(move || {
                let result = (|| -> Result<(), String> {
                    let conn = init_db(&dict_dir.join("lexicue.db")).map_err(|e| e.to_string())?;
                    commands::dictionary::initialize_builtin_dictionary(&conn)?;
                    commands::dictionary::initialize_builtin_japanese_dictionary(&conn)?;
                    commands::dictionary::initialize_builtin_german_dictionary(&conn)?;
                    commands::dictionary::initialize_builtin_chinese_dictionary(&conn)?;
                    commands::dictionary::initialize_builtin_chinese_phrase_dictionary(&conn)?;
                    commands::dictionary::initialize_builtin_phrase_dictionary(&conn)?;
                    commands::dictionary::initialize_builtin_japanese_phrase_dictionary(&conn)?;
                    Ok(())
                })();
                match result {
                    Ok(()) => {
                        thread_status.set_ready();
                        let _ = app_handle.emit("dictionary-ready", true);
                    }
                    Err(e) => {
                        log::error!("dictionary init failed: {e}");
                        let _ = app_handle.emit("dictionary-ready", false);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::import::import_file,
            commands::import::check_duplicate,
            commands::export::export_all,
            commands::export::restore_all,
            commands::words::list_words,
            commands::words::word_detail,
            commands::words::update_word_status,
            commands::words::update_word_definition,
            commands::words::batch_update_status,
            commands::words::list_file_word_tokens,
            commands::words::get_file_segment_tokens,
            commands::phrases::list_phrases,
            commands::phrases::phrase_detail,
            commands::phrases::update_phrase_status,
            commands::phrases::update_phrase_definition,
            commands::phrases::batch_update_phrase_status,
            commands::phrases::create_manual_phrase,
            commands::phrases::get_file_phrases,
            commands::files::list_files,
            commands::files::delete_file,
            commands::files::get_file_segments,
            commands::reviews::get_due_cards,
            commands::reviews::submit_rating,
            commands::reviews::create_review_card,
            commands::reviews::get_due_phrase_cards,
            commands::reviews::submit_phrase_rating,
            commands::reviews::create_phrase_review_card,
            commands::dictionary::lookup_dictionary,
            commands::dictionary::lookup_phrase_dictionary,
            commands::dictionary::get_cached_dictionary,
            commands::dictionary::list_dictionary_sources,
            commands::dictionary::delete_dictionary_source,
            commands::dictionary::cache_dictionary_audio,
            commands::dictionary::read_dictionary_audio,
            commands::dictionary::import_dictionary_pack,
            commands::stats::get_learning_stats,
            commands::ollama::ai_status,
            commands::ollama::ai_models,
            commands::ollama::analyze_file_phrases,
            commands::ollama::cancel_phrase_analysis,
            commands::ollama::explain_text,
            commands::ollama::translate_segments,
            commands::ollama::cancel_translate_segments,
            commands::youtube::youtube_list_subs,
            commands::youtube::youtube_download_sub,
            commands::youtube::youtube_merge_subs,
            commands::youtube::youtube_cancel_job,
            commands::youtube::youtube_ytdlp_status,
            commands::language::tokenize_japanese,
            commands::language::tokenize_japanese_batch,
            commands::german::tokenize_german,
            commands::german::tokenize_german_batch,
            commands::chinese::tokenize_chinese,
            commands::chinese::tokenize_chinese_batch,
            commands::dictionary::dictionary_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
