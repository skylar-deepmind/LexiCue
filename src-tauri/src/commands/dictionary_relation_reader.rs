//! Indexed relation evidence for the spellings needed by the current archive.
use super::super::{
    longman::RelationCatalog,
    wiktionary_local::{Pack, R},
};
use super::pack_relations;
use rusqlite::OptionalExtension;
use std::sync::{Mutex, OnceLock};

pub(crate) struct RelationReader {
    exact: Mutex<Vec<Pack>>,
    sources: Mutex<Option<Vec<Pack>>>,
    full: OnceLock<RelationCatalog>,
}

impl RelationReader {
    pub(super) fn new(exact: Vec<Pack>, sources: Vec<Pack>) -> Self {
        Self {
            exact: Mutex::new(exact),
            sources: Mutex::new(Some(sources)),
            full: OnceLock::new(),
        }
    }

    pub(crate) fn cached(&self) -> Option<&RelationCatalog> {
        self.full.get()
    }

    pub(crate) fn full(&self) -> &RelationCatalog {
        if let Some(full) = self.cached() {
            return full;
        }
        let full = self.full.get_or_init(|| {
            let started = std::time::Instant::now();
            let packs = self
                .sources
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .take()
                .unwrap();
            let result = pack_relations(&packs, "wiktionary-pack-relations".into()).unwrap_or_else(
                |error| {
                    log::warn!("[dictionary] Could not build relation forms: {error}");
                    RelationCatalog::default()
                },
            );
            log::debug!(
                "[dictionary] Optional pack forms ready in {:?}",
                started.elapsed()
            );
            result
        });
        self.close_indexed_sources();
        full
    }

    pub(crate) fn close_indexed_sources(&self) {
        self.exact.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }

    /// Outer None means the surface is unknown. Inner None preserves the exact
    /// literal. A target needs an independent entry and unambiguous evidence
    /// across all active packs, including non-grammatical contradictions.
    pub(crate) fn spelling(&self, word: &str) -> R<Option<Option<String>>> {
        let packs = self.exact.lock().unwrap_or_else(|e| e.into_inner());
        if packs.is_empty() {
            return Err("dictionary_relations_materialized".into());
        }
        let mut known = false;
        let mut target = None;
        let mut grammar = false;
        for pack in packs.iter() {
            let surface = pack
                .conn
                .prepare_cached(
                    "SELECT s.id, EXISTS (SELECT 1 FROM entries e WHERE e.surface_id=s.id)
                FROM surfaces s WHERE s.word=?1",
                )
                .and_then(|mut stmt| {
                    stmt.query_row([word], |row| {
                        Ok((row.get::<_, i64>(0)?, row.get::<_, bool>(1)?))
                    })
                    .optional()
                })
                .map_err(|e| e.to_string())?;
            let Some((id, head)) = surface else { continue };
            known = true;
            if head {
                return Ok(Some(None));
            }
            let alias = pack
                .conn
                .prepare_cached(
                    "SELECT evidence.first, evidence.last, evidence.inflected, target.word
                FROM (SELECT min(e.surface_id) AS first, max(e.surface_id) AS last,
                             max(a.kind IN (1,3)) AS inflected
                      FROM aliases a CROSS JOIN entries e ON e.source_line=a.entry_line
                      WHERE a.surface_id=?1) evidence
                LEFT JOIN surfaces target ON target.id=evidence.first",
                )
                .and_then(|mut stmt| {
                    stmt.query_row([id], |row| {
                        Ok((
                            row.get::<_, Option<i64>>(0)?,
                            row.get::<_, Option<i64>>(1)?,
                            row.get::<_, Option<bool>>(2)?,
                            row.get::<_, Option<String>>(3)?,
                        ))
                    })
                })
                .map_err(|e| e.to_string())?;
            if let (Some(first), Some(last), Some(inflected), Some(spelling)) = alias {
                if first != last
                    || target
                        .as_ref()
                        .is_some_and(|previous| previous != &spelling)
                {
                    return Ok(Some(None));
                }
                target = Some(spelling);
                grammar |= inflected;
            }
        }
        if grammar {
            if let Some(target) = target {
                for pack in packs.iter() {
                    let is_head = pack.conn.prepare_cached(
                        "SELECT EXISTS (SELECT 1 FROM surfaces s JOIN entries e ON e.surface_id=s.id WHERE s.word=?1)",
                    ).and_then(|mut stmt| stmt.query_row([&target], |row| row.get(0))).map_err(|e| e.to_string())?;
                    if is_head {
                        return Ok(Some(Some(target)));
                    }
                }
            }
        }
        Ok(known.then_some(None))
    }

    pub(crate) fn reserves_ascii_case(&self, folded: &str) -> R<bool> {
        let packs = self.exact.lock().unwrap_or_else(|e| e.into_inner());
        if packs.is_empty() {
            return Err("dictionary_relations_materialized".into());
        }
        for pack in packs.iter() {
            let mut stmt = pack
                .conn
                .prepare_cached("SELECT word FROM surfaces WHERE folded=?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([folded], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            for word in rows {
                let word = word.map_err(|e| e.to_string())?;
                if word.chars().any(char::is_uppercase) && word.to_lowercase() == folded {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }
}
