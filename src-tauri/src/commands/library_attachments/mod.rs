//! Portable attachment identities and durable, bounded transfer of local files.
use super::source_media as media;
#[cfg(target_vendor = "apple")]
use super::source_media::{Manifest, YoutubeSource};
use crate::db::DbState;
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
#[cfg(target_vendor = "apple")]
use serde::{Deserialize, Serialize};
#[cfg(target_vendor = "apple")]
use std::{
    fs::OpenOptions,
    io::{Read, Seek, SeekFrom, Write},
};
use std::{
    fs::{self, File},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, State};
use tauri::{Emitter, Manager};

#[cfg(target_vendor = "apple")]
const CHUNK: usize = 256 * 1024;
#[cfg(target_vendor = "apple")]
const ROUND_BYTES: usize = 4 * 1024 * 1024;
#[cfg(target_vendor = "apple")]
const COVER_BYTES: usize = 512 * 1024;
#[cfg(target_vendor = "apple")]
const PAGE: usize = 64;
const MAX_DOCUMENT_BYTES: u64 = 64 * 1024 * 1024;

type Result<T> = std::result::Result<T, String>;

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

pub(crate) fn migrate(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch(
        "DROP TABLE IF EXISTS library_audio_state;
        DROP TABLE IF EXISTS library_audio_removed_on;
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
        CREATE TABLE IF NOT EXISTS library_attachment_cleanup(
            kind TEXT NOT NULL, identity TEXT NOT NULL, PRIMARY KEY(kind,identity)
        ) STRICT;
        CREATE TRIGGER IF NOT EXISTS library_material_attachments_deleted
        AFTER DELETE ON files BEGIN
            INSERT OR IGNORE INTO library_attachment_cleanup
              SELECT 'audio',old.media_identity WHERE old.media_identity IS NOT NULL;
            INSERT OR IGNORE INTO library_attachment_cleanup
              SELECT 'cover',json_extract(old.media_source,'$.video_id')
              WHERE json_valid(old.media_source) AND json_extract(old.media_source,'$.provider')='youtube'
                AND json_extract(old.media_source,'$.video_id') IS NOT NULL;
            INSERT OR IGNORE INTO library_attachment_cleanup
              SELECT 'document',json_extract(old.document_source,'$.source_sha256')
              WHERE json_valid(old.document_source) AND json_extract(old.document_source,'$.origin') IS NULL
                AND json_extract(old.document_source,'$.source_sha256') IS NOT NULL;
        END;",
    )
}

#[cfg(target_vendor = "apple")]
pub(crate) fn generation(db: &Connection) -> Result<i64> {
    db.query_row(
        "SELECT generation FROM library_attachment_clock WHERE id=1",
        [],
        |r| r.get(0),
    )
    .map_err(err)
}

pub(crate) fn cleanup_after_commit(app: &AppHandle, db: &Connection) {
    let result = media::root(app).and_then(|dir| {
        let covers = app
            .path()
            .app_cache_dir()
            .map_err(err)?
            .join("youtube-covers-v1");
        cleanup_deleted(db, &dir, &covers)
    });
    match result {
        Ok(true) => {
            let _ = app.emit("device-sync-attachments", ());
        }
        Ok(false) => {}
        Err(error) => log::warn!("Could not clean up deleted material attachments: {error}"),
    }
}

fn remove_attachment(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => sync_parent(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(err(error)),
    }
}

fn cleanup_partial(dir: &Path, key: &str) -> Result<()> {
    let prefix = format!(".lan-{key}-");
    for entry in fs::read_dir(dir).map_err(err)? {
        let entry = entry.map_err(err)?;
        if entry.file_name().to_string_lossy().starts_with(&prefix) {
            remove_attachment(&entry.path())?;
        }
    }
    Ok(())
}

fn cleanup_deleted(db: &Connection, dir: &Path, covers: &Path) -> Result<bool> {
    let mut query = db
        .prepare("SELECT kind,identity FROM library_attachment_cleanup")
        .map_err(err)?;
    let pending = query
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    let changed = !pending.is_empty();
    for (kind, key) in pending {
        // Recheck under the same write lock used by imports and LAN transfers.
        // A restore, conflict copy or new import may have reattached the bytes.
        let tx = rusqlite::Transaction::new_unchecked(db, TransactionBehavior::Immediate)
            .map_err(err)?;
        match kind.as_str() {
            "audio" if media::valid_hash(&key) => cleanup_audio(&tx, dir, &key)?,
            "cover" if super::youtube::is_valid_video_id(&key) => {
                if !cover_attached(&tx, &key)? {
                    tx.execute(
                        "DELETE FROM library_youtube_artwork WHERE video_id=?",
                        [&key],
                    )
                    .map_err(err)?;
                    remove_attachment(&covers.join(format!("{key}.jpg")))?;
                }
            }
            "document" if media::valid_hash(&key) => {
                if !document_attached(&tx, &key)? {
                    tx.execute(
                        "DELETE FROM library_document_originals WHERE sha256=?",
                        [&key],
                    )
                    .map_err(err)?;
                    remove_attachment(&original_path(dir, &key))?;
                    cleanup_partial(dir, &key)?;
                }
            }
            _ => {}
        }
        tx.execute(
            "DELETE FROM library_attachment_cleanup WHERE kind=? AND identity=?",
            params![kind, key],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
    }
    Ok(changed)
}

fn cleanup_audio(db: &Connection, dir: &Path, key: &str) -> Result<()> {
    let attached: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM files WHERE media_identity=?)",
            [key],
            |row| row.get(0),
        )
        .map_err(err)?;
    if attached {
        return Ok(());
    }
    let asset = media::bound_hash(db, key)?;
    db.execute("DELETE FROM source_media WHERE source_key=?", [key])
        .map_err(err)?;
    if let Some(asset) = asset.filter(|asset| media::valid_hash(asset)) {
        let used: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM source_media WHERE asset_id=?)",
                [&asset],
                |row| row.get(0),
            )
            .map_err(err)?;
        if !used {
            for extension in ["m4a", "wav"] {
                remove_attachment(&dir.join(format!("{asset}.{extension}")))?;
            }
        }
    }
    cleanup_partial(dir, key)
}

fn cover_attached(db: &Connection, video: &str) -> Result<bool> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM files
         WHERE json_valid(media_source) AND json_extract(media_source,'$.provider')='youtube'
           AND json_extract(media_source,'$.video_id')=?)",
        [video],
        |row| row.get(0),
    )
    .map_err(err)
}

fn document_attached(db: &Connection, hash: &str) -> Result<bool> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM files
         WHERE json_valid(document_source) AND json_extract(document_source,'$.source_sha256')=?
           AND json_extract(document_source,'$.origin') IS NULL)",
        [hash],
        |row| row.get(0),
    )
    .map_err(err)
}

#[cfg(target_vendor = "apple")]
pub(crate) fn store_cover(db: &Connection, video: &str, bytes: &[u8]) -> Result<()> {
    if !super::youtube::is_valid_video_id(video) || !valid_cover(bytes) {
        return Err("invalid artwork".into());
    }
    let hash = media::digest(bytes);
    db.execute(
        "INSERT INTO library_youtube_artwork
         SELECT ?1,?2,?3 WHERE EXISTS(SELECT 1 FROM files WHERE json_valid(media_source)
           AND json_extract(media_source,'$.provider')='youtube'
           AND json_extract(media_source,'$.video_id')=?1)
         ON CONFLICT(video_id) DO UPDATE SET sha256=excluded.sha256,data=excluded.data
         WHERE excluded.sha256<sha256",
        params![video, hash, bytes],
    )
    .map_err(err)?;
    Ok(())
}

#[cfg(target_vendor = "apple")]
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
