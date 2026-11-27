//! Portable attachment identities and durable, bounded transfer of local files.
use super::source_media::{self as media, Manifest, YoutubeSource};
use crate::db::DbState;
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, State};

const CHUNK: usize = 256 * 1024;
const ROUND_BYTES: usize = 4 * 1024 * 1024;
const COVER_BYTES: usize = 512 * 1024;
const PAGE: usize = 64;
const MAX_DOCUMENT_BYTES: u64 = 64 * 1024 * 1024;

type Result<T> = std::result::Result<T, String>;

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

pub(crate) fn migrate(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS library_audio_state(
            source_key TEXT PRIMARY KEY, revision INTEGER NOT NULL,
            deleted INTEGER NOT NULL CHECK(deleted IN (0,1))
        ) STRICT;
        CREATE TABLE IF NOT EXISTS library_youtube_artwork(
            video_id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, data BLOB NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS library_document_originals(
            sha256 TEXT PRIMARY KEY, bytes INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS library_attachment_clock(
            id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT NULL
        ) STRICT;
        INSERT OR IGNORE INTO library_attachment_clock VALUES(1,0);
        CREATE TRIGGER IF NOT EXISTS library_attachment_original_added AFTER INSERT ON library_document_originals
        BEGIN UPDATE library_attachment_clock SET generation=generation+1; END;
        CREATE TRIGGER IF NOT EXISTS library_attachment_audio_added AFTER INSERT ON source_media
        WHEN new.status='ready' BEGIN
          UPDATE library_attachment_clock SET generation=generation+1;
        END;
        CREATE TRIGGER IF NOT EXISTS library_attachment_audio_changed
        AFTER UPDATE OF status,asset_id ON source_media
        WHEN new.status IS NOT old.status OR new.asset_id IS NOT old.asset_id BEGIN
          UPDATE library_attachment_clock SET generation=generation+1;
        END;
        CREATE TRIGGER IF NOT EXISTS library_attachment_artwork_added
        AFTER INSERT ON library_youtube_artwork BEGIN
          UPDATE library_attachment_clock SET generation=generation+1;
        END;
        CREATE TRIGGER IF NOT EXISTS library_attachment_artwork_changed
        AFTER UPDATE OF sha256 ON library_youtube_artwork
        WHEN new.sha256<>old.sha256 BEGIN
          UPDATE library_attachment_clock SET generation=generation+1;
        END;
        CREATE TRIGGER IF NOT EXISTS library_attachment_audio_state_added
        AFTER INSERT ON library_audio_state BEGIN
          UPDATE library_attachment_clock SET generation=generation+1;
        END;
        CREATE TRIGGER IF NOT EXISTS library_attachment_audio_state_changed
        AFTER UPDATE OF revision,deleted ON library_audio_state BEGIN
          UPDATE library_attachment_clock SET generation=generation+1;
        END;",
    )
}

pub(crate) fn generation(db: &Connection) -> Result<i64> {
    db.query_row(
        "SELECT generation FROM library_attachment_clock WHERE id=1",
        [],
        |r| r.get(0),
    )
    .map_err(err)
}

pub(crate) fn audio_removed(db: &Connection, key: &str) -> Result<bool> {
    db.query_row(
        "SELECT coalesce((SELECT deleted FROM library_audio_state WHERE source_key=?),0)",
        [key],
        |r| r.get(0),
    )
    .map_err(err)
}

#[tauri::command]
pub fn set_library_audio_deleted(state: State<DbState>, file_id: i64, deleted: bool) -> Result<()> {
    let db = state.conn.lock().map_err(err)?;
    let key: String = db
        .query_row(
            "SELECT media_identity FROM files WHERE id=? AND media_identity IS NOT NULL",
            [file_id],
            |row| row.get(0),
        )
        .map_err(|_| "media_unavailable")?;
    set_audio_deleted(&db, &key, deleted)
}

fn set_audio_deleted(db: &Connection, key: &str, deleted: bool) -> Result<()> {
    if !media::valid_hash(key) {
        return Err("invalid audio identity".into());
    }
    db.execute(
        "INSERT INTO library_audio_state(source_key,revision,deleted) VALUES(?,1,?)
         ON CONFLICT(source_key) DO UPDATE SET revision=revision+1,deleted=excluded.deleted
         WHERE deleted<>excluded.deleted",
        params![key, deleted],
    )
    .map_err(err)?;
    Ok(())
}

pub(crate) fn store_cover(db: &Connection, video: &str, bytes: &[u8]) -> Result<()> {
    if !super::youtube::is_valid_video_id(video) || !valid_cover(bytes) {
        return Err("invalid artwork".into());
    }
    let hash = media::digest(bytes);
    db.execute(
        "INSERT INTO library_youtube_artwork VALUES(?,?,?)
         ON CONFLICT(video_id) DO UPDATE SET sha256=excluded.sha256,data=excluded.data
         WHERE excluded.sha256<sha256",
        params![video, hash, bytes],
    )
    .map_err(err)?;
    Ok(())
}

fn valid_cover(bytes: &[u8]) -> bool {
    if bytes.len() > COVER_BYTES
        || !bytes.starts_with(&[0xff, 0xd8])
        || !bytes.ends_with(&[0xff, 0xd9])
    {
        return false;
    }
    let mut reader =
        image::ImageReader::with_format(std::io::Cursor::new(bytes), image::ImageFormat::Jpeg);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(1024);
    limits.max_image_height = Some(1024);
    limits.max_alloc = Some(8 * 1024 * 1024);
    reader.limits(limits);
    reader.decode().is_ok()
}

#[tauri::command]
pub fn material_youtube_artwork(state: State<DbState>, video_id: String) -> Result<Option<String>> {
    if !super::youtube::is_valid_video_id(&video_id) {
        return Err("invalid video identity".into());
    }
    let db = state.conn.lock().map_err(err)?;
    let data: Option<Vec<u8>> = db
        .query_row(
            "SELECT data FROM library_youtube_artwork WHERE video_id=?",
            [video_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    Ok(data.map(|bytes| format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes))))
}

pub(super) struct Original {
    staging: media::Temp,
    bytes: u64,
    hash: String,
    path: PathBuf,
}

fn original_stage(dir: &Path, id: &str) -> Result<PathBuf> {
    let id = uuid::Uuid::parse_str(id).map_err(|_| "material_invalid_document")?;
    Ok(dir.join(format!(".part-original-{id}")))
}

fn original_path(dir: &Path, hash: &str) -> PathBuf {
    dir.join(format!("{hash}.original"))
}

fn put_original(db: &Connection, hash: &str, bytes: u64) -> Result<()> {
    db.execute(
        "INSERT OR IGNORE INTO library_document_originals VALUES(?,?)",
        params![hash, bytes],
    )
    .map(|_| ())
    .map_err(err)
}

impl Original {
    pub(super) fn staged(
        app: &AppHandle,
        input: &super::materials::MaterialInput,
    ) -> Result<Option<Self>> {
        let Some(document) = &input.document else {
            return Ok(None);
        };
        let dir = media::root(app)?;
        let Ok(staging) = original_stage(&dir, &input.operation_id) else {
            return Ok(None);
        };
        let path = staging.join("input");
        if !path.try_exists().map_err(err)? {
            return Ok(None);
        }
        let staging = media::Temp(staging);
        let file = fs::symlink_metadata(&path).map_err(err)?;
        if document.origin.is_some()
            || !file.is_file()
            || !(1..=MAX_DOCUMENT_BYTES).contains(&file.len())
            || media::file_digest(&path)? != document.source_sha256
        {
            return Err("material_original_changed".into());
        }
        Ok(Some(Self {
            staging,
            bytes: file.len(),
            hash: document.source_sha256.clone(),
            path: original_path(&dir, &document.source_sha256),
        }))
    }

    pub(super) fn install(&self, db: &Connection) -> Result<()> {
        let path = self.staging.0.join("input");
        File::open(&path)
            .and_then(|file| file.sync_all())
            .map_err(err)?;
        fs::rename(path, &self.path).map_err(err)?;
        sync_parent(&self.path)?;
        put_original(db, &self.hash, self.bytes)
    }
}

fn sync_parent(path: &Path) -> Result<()> {
    #[cfg(unix)]
    File::open(path.parent().ok_or("invalid attachment path")?)
        .and_then(|dir| dir.sync_all())
        .map_err(err)?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

#[tauri::command]
pub async fn upload_library_original(
    app: AppHandle,
    operation_id: String,
    offset: u64,
    chunk: String,
) -> Result<()> {
    let staging = original_stage(&media::root(&app)?, &operation_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        super::local_material_audio::write_chunk(&staging, offset, &chunk)
            .map_err(|_| "material_original_changed".into())
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub fn discard_library_original(app: AppHandle, operation_id: String) -> Result<()> {
    let staging = original_stage(&media::root(&app)?, &operation_id)?;
    match fs::remove_dir_all(staging) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(err(e)),
        _ => Ok(()),
    }
}

#[cfg(target_vendor = "apple")]
pub(crate) mod backup;
#[cfg(target_vendor = "apple")]
pub(crate) mod exchange;

#[cfg(all(test, target_os = "macos", not(feature = "apple-store")))]
mod tests;
