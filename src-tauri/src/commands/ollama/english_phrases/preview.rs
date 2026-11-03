use super::super::now_ms;
use super::pipeline::PreviewUpdate;
use super::{diagnostics, key, preview_phrase, PreviewPhrase, SegmentRow};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Mutex, OnceLock};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Snapshot {
    file_id: i64,
    run_id: String,
    sequence: usize,
    segment_indices: Vec<i32>,
    phrases: Vec<PreviewPhrase>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Event {
    file_id: i64,
    run_id: String,
    sequence: usize,
    operation: &'static str,
    batch_id: String,
    attempt_id: String,
    source: &'static str,
    segment_indices: Vec<i32>,
    phrases: Vec<PreviewPhrase>,
}
struct Record {
    snapshot: Snapshot,
    started: i64,
    ended: Option<i64>,
    total_segments: usize,
}
static RECORDS: OnceLock<Mutex<HashMap<(i64, String), Record>>> = OnceLock::new();
fn records() -> &'static Mutex<HashMap<(i64, String), Record>> {
    RECORDS.get_or_init(Default::default)
}
fn prune(entries: &mut HashMap<(i64, String), Record>, now: i64) {
    entries.retain(|_, r| r.ended.is_none_or(|ended| now - ended < 15 * 60 * 1000));
    let mut ended: Vec<_> = entries
        .iter()
        .filter_map(|(key, r)| r.ended.map(|time| (key.clone(), time)))
        .collect();
    ended.sort_by_key(|(_, time)| *time);
    for (key, _) in ended.iter().take(ended.len().saturating_sub(100)) {
        entries.remove(key);
    }
}
pub(super) fn start(file_id: i64, run_id: &str) {
    if let Ok(mut entries) = records().lock() {
        prune(&mut entries, now_ms());
        entries.insert(
            (file_id, run_id.into()),
            Record {
                snapshot: Snapshot {
                    file_id,
                    run_id: run_id.into(),
                    sequence: 0,
                    segment_indices: Vec::new(),
                    phrases: Vec::new(),
                },
                started: now_ms(),
                ended: None,
                total_segments: 0,
            },
        );
    }
}
pub(super) fn set_total(file_id: i64, run_id: &str, total: usize) {
    if let Ok(mut entries) = records().lock() {
        if let Some(record) = entries.get_mut(&(file_id, run_id.into())) {
            record.total_segments = total;
        }
    }
}
pub(super) fn counts(file_id: i64, run_id: &str) -> (usize, usize) {
    records()
        .lock()
        .ok()
        .and_then(|entries| {
            entries
                .get(&(file_id, run_id.into()))
                .map(|record| (record.snapshot.segment_indices.len(), record.total_segments))
        })
        .unwrap_or_default()
}
pub(super) fn finish(file_id: i64, run_id: &str) {
    if let Ok(mut entries) = records().lock() {
        if let Some(record) = entries.get_mut(&(file_id, run_id.into())) {
            record.ended = Some(now_ms());
        }
        prune(&mut entries, now_ms());
    }
}
pub(super) fn snapshot(file_id: i64, run_id: &str) -> Option<Snapshot> {
    let mut entries = records().lock().ok()?;
    prune(&mut entries, now_ms());
    entries
        .get(&(file_id, run_id.into()))
        .map(|record| record.snapshot.clone())
}
pub(super) fn publish(
    file_id: i64,
    run_id: &str,
    source: &[SegmentRow],
    update: PreviewUpdate,
) -> Option<(Event, usize)> {
    let mut entries = records().lock().ok()?;
    let record = entries.get_mut(&(file_id, run_id.into()))?;
    if record.ended.is_some() {
        return None;
    }
    record.snapshot.sequence += 1;
    let phrases: Vec<_> = update
        .items
        .iter()
        .filter_map(|item| {
            source
                .iter()
                .find(|s| s.index == item.candidate.segment_index)
                .map(|segment| preview_phrase(item, segment))
        })
        .collect();
    if !phrases.is_empty() && ["append", "commit"].contains(&update.operation) {
        diagnostics::preview(file_id, (now_ms() - record.started).max(0) as u128);
    }
    let indices: Vec<_> = source.iter().map(|s| s.index).collect();
    if update.operation == "commit" {
        let mut processed: BTreeSet<_> = record.snapshot.segment_indices.iter().copied().collect();
        processed.extend(&indices);
        record.snapshot.segment_indices = processed.into_iter().collect();
        let mut confirmed: BTreeMap<_, _> = record
            .snapshot
            .phrases
            .iter()
            .filter(|p| !indices.contains(&p.segment_index))
            .map(|p| {
                (
                    key(p.segment_index, &p.canonical, &p.token_positions),
                    p.clone(),
                )
            })
            .collect();
        confirmed.extend(phrases.iter().map(|p| {
            (
                key(p.segment_index, &p.canonical, &p.token_positions),
                p.clone(),
            )
        }));
        record.snapshot.phrases = confirmed.into_values().collect();
    }
    let count = record.snapshot.segment_indices.len();
    Some((
        Event {
            file_id,
            run_id: run_id.into(),
            sequence: record.snapshot.sequence,
            operation: update.operation,
            batch_id: update.batch_id.to_string(),
            attempt_id: update.attempt_id,
            source: update.origin,
            segment_indices: indices,
            phrases,
        },
        count,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshots_only_include_committed_batches_and_isolate_runs() {
        start(501, "snapshot");
        set_total(501, "snapshot", 1);
        let source = [SegmentRow {
            index: 0,
            text: "I picked it up.".into(),
        }];
        let item = super::super::Accepted {
            candidate: super::super::Candidate {
                segment_index: 0,
                canonical: "pick up".into(),
                token_positions: vec![1, 3],
                category: "phrasal_verb".into(),
            },
            surface: "picked up".into(),
            metadata: Default::default(),
        };
        let update = |operation, items| PreviewUpdate {
            operation,
            batch_id: 1,
            attempt_id: "a".into(),
            origin: "ai",
            items,
        };
        publish(
            501,
            "snapshot",
            &source,
            update("append", vec![item.clone()]),
        );
        assert!(snapshot(501, "snapshot").unwrap().phrases.is_empty());
        publish(501, "snapshot", &source, update("rollback", vec![]));
        publish(501, "snapshot", &source, update("commit", vec![item]));
        assert_eq!(snapshot(501, "snapshot").unwrap().segment_indices, [0]);
        assert_eq!(counts(501, "snapshot"), (1, 1));
        assert!(snapshot(501, "other").is_none());
        finish(501, "snapshot");
        assert!(publish(501, "snapshot", &source, update("append", vec![])).is_none());
        assert_eq!(snapshot(501, "snapshot").unwrap().phrases.len(), 1);
    }
    #[test]
    fn retention_does_not_evict_active_runs() {
        let snapshot = Snapshot {
            file_id: 1,
            run_id: "r".into(),
            sequence: 0,
            segment_indices: vec![],
            phrases: vec![],
        };
        let mut entries = HashMap::new();
        for i in 0..102 {
            entries.insert(
                (i, i.to_string()),
                Record {
                    snapshot: snapshot.clone(),
                    started: 0,
                    ended: Some(i),
                    total_segments: 0,
                },
            );
        }
        entries.insert(
            (999, "active".into()),
            Record {
                snapshot,
                started: 0,
                ended: None,
                total_segments: 0,
            },
        );
        prune(&mut entries, 1000);
        assert_eq!(entries.len(), 101);
        prune(&mut entries, 16 * 60 * 1000);
        assert_eq!(entries.len(), 1);
    }
}
