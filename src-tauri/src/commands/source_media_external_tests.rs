//! Opt-in bounded public YouTube network probe. No user cookies or stored files.
use super::*;
use crate::commands::{import::SegmentInput, materials};

#[tokio::test]
#[ignore = "opt-in public 19-second YouTube English subtitle/audio download; isolated files"]
async fn fresh_public_english_subtitle_audio_pipeline() {
    let output = PathBuf::from(
        std::env::var("LEXICUE_EXTERNAL_EVIDENCE").expect("explicit evidence directory"),
    );
    std::fs::create_dir_all(&output).unwrap();
    let mut report = serde_json::json!({"video_id":"jNQXAC9IVRw","method":"production native metadata/subtitle/source/audio/ffmpeg/probe/resolve cores; no browser cookies or UI claim","passed":false,"steps":[]});
    let started = std::time::Instant::now();
    let result: Result<(),String> = async {
        if youtube::ytdlp_path().is_none(){return Err("missing_tool".into());}
        let session=BrowserSession::default();
        let job=youtube::register_download_job(None,997_001);
        let _guard=youtube::JobGuard{job_id:997_001};
        let metadata=youtube::fetch_ytdlp_json(Some(&job),"https://www.youtube.com/watch?v=jNQXAC9IVRw",&session,Duration::from_secs(30)).await?;
        report["steps"].as_array_mut().unwrap().push(serde_json::json!({"metadata":true}));
        let duration=metadata["duration"].as_f64().ok_or("missing_duration")?;
        if !(1.0..=60.0).contains(&duration){return Err("public_probe_duration_out_of_budget".into());}
        let mut tracks=Vec::new();
        for(group,automatic)in[("subtitles",false),("automatic_captions",true)] {
            if let Some(map)=metadata[group].as_object(){
                for(lang,entries)in map {
                    let track=youtube::downloads::metadata_track(lang,automatic,entries);
                    if track.language.starts_with("en") && matches!(track.source,SubtitleSource::Manual|SubtitleSource::Original){tracks.push(track);}
                }
            }
        }
        let track=tracks.into_iter().next().ok_or("no_original_english_subtitles")?;
        let subtitle=youtube::downloads::native_track(&job,"jNQXAC9IVRw",&track,&session,"primary",Duration::from_secs(60)).await.map_err(|e|format!("subtitle_{}",e.code))?;
        let source=checked_source_from_subtitles("jNQXAC9IVRw",&track,&subtitle.content,&metadata)?;
        report["steps"].as_array_mut().unwrap().push(serde_json::json!({"english_subtitles":true,"kind":source.subtitle_kind,"cues":source.cues.len(),"has_confirmed_audio":source.audio.is_some()}));
        if source.audio.is_none(){return Err("media_unconfirmed_track".into());}
        let dir=tempfile::tempdir().map_err(|e|e.to_string())?;
        let conn=crate::db::init_db(&dir.path().join("probe.db")).map_err(|e|e.to_string())?;
        let cues=youtube::parse_srt(&subtitle.content);
        let input=materials::MaterialInput{operation_id:"fresh-public-probe".into(),name:"Public English QA.srt".into(),content:subtitle.content.clone(),segments:cues.iter().enumerate().map(|(index,c)|SegmentInput{index:index as i32,en_text:c.text.clone(),zh_text:None,start_time:Some(format!("{:02}:{:02}:{:02}.{:03}", c.start_ms/3_600_000,c.start_ms/60_000%60,c.start_ms/1000%60,c.start_ms%1000)),end_time:Some(format!("{:02}:{:02}:{:02}.{:03}", c.end_ms/3_600_000,c.end_ms/60_000%60,c.end_ms/1000%60,c.end_ms%1000))}).collect(),source:Some(source.clone()),document:None,normalized_kind:None};
        let imported=materials::import_material(&conn,&input)?;
        let opened=materials::open(&conn,imported.file_id)?;
        let reference=segment_reference(&conn,opened.segments[0].id)?.ok_or("missing_imported_source")?;
        let media_dir=dir.path().join("audio");std::fs::create_dir(&media_dir).map_err(|e|e.to_string())?;
        let manifest=download(&media_dir,&reference,&job,session).await?;
        conn.execute("INSERT INTO source_media(source_key,source_json,status,asset_id,manifest_json,updated_at) VALUES(?1,?2,'ready',?3,?4,1)",params![source.key,serde_json::to_string(&source).unwrap(),manifest.sha256,serde_json::to_string(&manifest).unwrap()]).map_err(|e|e.to_string())?;
        let playback=resolve(&conn,&media_dir,&reference)?;
        assert_eq!(playback.asset_id,manifest.sha256);
        assert!(playback.end_ms>playback.start_ms);
        // Retain only public downloaded bytes plus aggregate evidence for root's native UI.
        std::fs::copy(&playback.path,output.join("public-youtube-audio.m4a")).map_err(|e|e.to_string())?;
        std::fs::write(output.join("public-youtube-source.json"),serde_json::to_vec_pretty(&source).unwrap()).map_err(|e|e.to_string())?;
        report["steps"].as_array_mut().unwrap().push(serde_json::json!({"real_import":true,"audio_download_normalize_probe_resolve":true,"audio_bytes":manifest.bytes,"duration_ms":manifest.duration_ms,"codec":manifest.codec,"sha256":manifest.sha256}));
        Ok(())
    }.await;
    report["elapsed_ms"] = serde_json::json!(started.elapsed().as_millis());
    if let Err(error) = &result {
        report["error"] = serde_json::json!(error);
    } else {
        report["passed"] = serde_json::json!(true);
    }
    std::fs::write(
        output.join("fresh-youtube-pipeline.json"),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
    assert!(
        result.is_ok(),
        "real public English subtitle/audio pipeline failed; see isolated evidence JSON"
    );
}
