mod commands;
mod db;

use db::{init_db, DbState, DictionaryStatus};
use std::sync::{Arc, Mutex};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .max_file_size(2_000_000)
                    .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(3))
                    .build(),
            )?;

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            commands::gemma::runtime::initialize(app.handle())?;
            commands::youtube::init_subtitle_cache(app.handle());
            commands::longman::configure(app.handle());
            commands::cambridge::configure(app.handle());
            commands::free_dictionary::configure(app.handle());
            commands::tts::configure(app.handle());
            let app_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_dir)?;
            // Sync remains optional: a damaged or unavailable platform store
            // must not prevent access to local learning data. Sync commands
            // return the cached structured error for translated recovery UI.
            if let Err(error) = commands::sync::init_secret_store() {
                log::error!("secure credential store initialization failed: {error}");
            }
            let conn = init_db(&app_dir.join("lexicue.db")).expect("Failed to initialize database");
            commands::source_media::initialize(app.handle(), &conn)
                .map_err(std::io::Error::other)?;
            let db_state = DbState {
                conn: Arc::new(Mutex::new(conn)),
            };
            commands::files::resume_pending_delete_jobs(db_state.conn.clone());
            app.manage(db_state);

            let status = DictionaryStatus::default();
            app.manage(status.clone());

            commands::dictionary_init::start(app.handle().clone(), status);

            // Internal QA only: this hook is inactive in normal builds and
            // exposes no command or user setting. The probe validates every
            // transport target as a controlled loopback fixture.
            #[cfg(debug_assertions)]
            if option_env!("LEXICUE_PUBLIC_TRANSPORT_DIAGNOSTIC") == Some("1") {
                tauri::async_runtime::spawn(async {
                    let config = match option_env!("LEXICUE_PUBLIC_TRANSPORT_DIAGNOSTIC_CONFIG") {
                        Some(path) => tokio::fs::read(path).await.ok().and_then(|bytes| {
                            serde_json::from_slice::<serde_json::Value>(&bytes).ok()
                        }),
                        None => None,
                    };
                    let mut report = match config {
                        Some(config) => {
                            commands::cambridge::run_public_transport_diagnostic(config).await
                        }
                        None => serde_json::json!({"status":"qa_config_unavailable"}),
                    };
                    report["runtime"] = serde_json::json!("tauri_async_runtime_startup");
                    report["qa_compile_time_only"] = serde_json::json!(true);
                    let written = match (
                        option_env!("LEXICUE_PUBLIC_TRANSPORT_DIAGNOSTIC_REPORT"),
                        serde_json::to_vec_pretty(&report),
                    ) {
                        (Some(path), Ok(bytes)) => tokio::fs::write(path, bytes).await.is_ok(),
                        _ => false,
                    };
                    if written {
                        log::info!("Controlled public transport QA report completed");
                    } else {
                        log::warn!("Controlled public transport QA report unavailable");
                    }
                });
            }

            Ok(())
        })
        .manage(commands::example::ExampleState::default())
        .manage(commands::webpage::WebpageState::default())
        .invoke_handler(tauri::generate_handler![
            commands::webpage::fetch_import_webpage,
            commands::webpage::cancel_import_webpage,
            commands::example::begin_example_session,
            commands::example::end_example_session,
            commands::example::example_saved_for_selection,
            commands::example::mutate_example_saved_record,
            commands::example::undo_example_saved_mutation,
            commands::import::import_file,
            commands::import::check_duplicate,
            commands::source_media::source_media_status,
            commands::source_media::prepare_source_media,
            commands::source_media::resolve_source_media,
            commands::source_media::resolve_reading_media,
            commands::export::export_all,
            commands::export::restore_all,
            commands::saved::list_saved_records,
            commands::saved::list_saved_groups,
            commands::saved::saved_group_contexts,
            commands::saved::mutate_saved_record,
            commands::saved::undo_saved_mutation,
            commands::saved::saved_record_source,
            commands::saved::saved_migration_report,
            commands::saved::saved_record_conflicts,
            commands::saved::saved_for_selection,
            commands::recall::saved_recall_index,
            commands::recall::saved_recall_catalog,
            commands::recall::saved_recall_contexts,
            commands::materials::import_reading_material,
            commands::materials::fill_reading_translations,
            commands::materials::list_materials,
            commands::history::list_legacy_records,
            commands::history::legacy_record_detail,
            commands::materials::open_reading_material,
            commands::materials::lookup_reading_expression,
            commands::longman::lookup_longman_expression,
            commands::longman::longman_dictionary_status,
            commands::cambridge::lookup_cambridge_expression,
            commands::free_dictionary::lookup_free_dictionary_expression,
            commands::tts::resolve_tts_audio,
            commands::tts::cancel_tts,
            commands::tts::clear_tts_cache,
            commands::tts::invalidate_tts_cache,
            commands::sync::sync_status,
            commands::sync::sync_set_auto_sync,
            commands::sync::sync_set_diagnostic,
            commands::sync::sync_register,
            commands::sync::sync_login,
            commands::sync::sync_recover,
            commands::sync::sync_run,
            commands::sync::sync_logout,
            commands::sync::sync_disconnect,
            commands::sync::sync_devices,
            commands::sync::sync_revoke_device,
            commands::sync::sync_delete_account,
            commands::annotations::annotation_identities,
            commands::annotations::annotate_item,
            commands::annotations::undo_annotation,
            commands::annotations::annotation_operation,
            commands::words::list_words,
            commands::words::word_detail,
            commands::words::update_word_status,
            commands::words::update_word_definition,
            commands::words::batch_update_status,
            commands::words::set_occurrence_hidden,
            commands::words::list_file_word_tokens,
            commands::words::get_file_segment_tokens,
            commands::reader::get_file_reader_tokens,
            commands::frequency_baseline::get_frequency_baseline,
            commands::frequency_baseline::configure_frequency_baseline,
            commands::frequency_baseline::revoke_frequency_baseline,
            commands::frequency_baseline::get_frequency_baseline_preview,
            commands::frequency_baseline::submit_frequency_baseline_review,
            commands::phrases::list_phrases,
            commands::phrases::phrase_detail,
            commands::phrases::update_phrase_status,
            commands::phrases::update_phrase_definition,
            commands::phrases::batch_update_phrase_status,
            commands::phrases::set_phrase_occurrence_hidden,
            commands::words::update_word_occurrence_meaning,
            commands::words::delete_word_occurrence_meaning,
            commands::words::resolve_word_lemma,
            commands::phrases::update_phrase_occurrence_meaning,
            commands::phrases::update_phrase_occurrence_meaning_en,
            commands::phrases::create_manual_phrase,
            commands::phrases::get_file_phrases,
            commands::files::list_files,
            commands::files::get_file_info,
            commands::files::delete_file,
            commands::files::delete_file_start,
            commands::files::delete_file_status,
            commands::files::get_file_segments,
            commands::tags::list_tags,
            commands::tags::create_tag,
            commands::tags::rename_tag,
            commands::tags::delete_tag,
            commands::tags::set_file_tags,
            commands::reviews::get_due_cards,
            commands::reviews::submit_rating,
            commands::reviews::create_review_card,
            commands::reviews::get_due_phrase_cards,
            commands::reviews::submit_phrase_rating,
            commands::reviews::create_phrase_review_card,
            commands::dictionary::lookup_dictionary,
            commands::dictionary::lookup_local_dictionary,
            commands::dictionary::lookup_phrase_dictionary,
            commands::dictionary::update_phrase_other_senses,
            commands::dictionary::update_phrase_other_senses_en,
            commands::dictionary::get_cached_dictionary,
            commands::dictionary::list_dictionary_sources,
            commands::dictionary::delete_dictionary_source,
            commands::dictionary::import_dictionary_pack,
            commands::stats::get_learning_stats,
            commands::stats::get_storage_usage,
            commands::gemma::models::get_local_gemma_environment,
            commands::gemma::models::download_gemma_model,
            commands::gemma::models::delete_gemma_model,
            commands::gemma::models::get_local_gemma_activity,
            commands::gemma::models::cancel_gemma_model_download,
            commands::gemma::models::import_gemma_model,
            commands::gemma::runtime::gemma_runtime_status,
            commands::gemma::runtime::set_gemma_background,
            commands::ollama::ai_status,
            commands::ollama::ai_models,
            commands::ollama::analyze_file_phrases,
            commands::ollama::word_context::analyze_word_occurrence,
            commands::ollama::word_context::cancel_word_occurrence_analysis,
            commands::ollama::cancel_phrase_analysis,
            commands::ollama::get_analysis_diagnostic,
            commands::ollama::get_analysis_preview_snapshot,
            commands::ollama::get_analysis_raw_diagnostic,
            commands::ollama::translate_segments,
            commands::translation::translate_import_sentences,
            commands::translation::cancel_import_translation,
            commands::ollama::cancel_translate_segments,
            commands::youtube::youtube_list_subs,
            commands::youtube::downloads::youtube_prepare_subtitles,
            commands::youtube::downloads::youtube_clear_subtitle_cache,
            commands::youtube::youtube_download_sub,
            commands::youtube::youtube_merge_subs,
            commands::youtube::youtube_cancel_job,
            commands::youtube::youtube_ytdlp_status,
            commands::language::tokenize_japanese,
            commands::language::tokenize_japanese_batch,
            commands::german::tokenize_german,
            commands::german::tokenize_german_batch,
            commands::english::tokenize_english,
            commands::english::tokenize_english_batch,
            commands::english::lemmatize_english,
            commands::english::english_word_candidates,
            commands::english::migrate_english_lemmas_cmd,
            commands::chinese::tokenize_chinese,
            commands::chinese::tokenize_chinese_batch,
            commands::dictionary::dictionary_status,
            commands::dictionary_init::dictionary_init_status,
            commands::dictionary_init::retry_dictionary_init,
            commands::updater::check_github_release,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
