use super::*;

pub(super) struct PreviewUpdate {
    pub operation: &'static str,
    pub batch_id: usize,
    pub attempt_id: String,
    pub origin: &'static str,
    pub items: Vec<Accepted>,
}
pub(super) type PreviewCallback<'a> = dyn Fn(&[SegmentRow], PreviewUpdate) + Send + Sync + 'a;

pub(super) struct Pipeline<'a> {
    pub client: &'a Client,
    pub config: &'a AiConfig,
    pub token: &'a CancellationToken,
    pub notifier: Option<&'a RetryNotifier>,
    pub checkpoints: cache::Checkpoints<'a>,
}
#[cfg(test)]
pub(super) fn accepted(source: &[SegmentRow], candidates: &[Candidate]) -> Vec<Accepted> {
    candidates
        .iter()
        .filter_map(|candidate| {
            let segment = source.iter().find(|s| s.index == candidate.segment_index)?;
            Some(Accepted {
                candidate: candidate.clone(),
                surface: validate_candidate(candidate, segment)?,
                metadata: Default::default(),
            })
        })
        .collect()
}
#[cfg(test)]
impl Pipeline<'_> {
    fn extraction_key(&self, source: &[SegmentRow]) -> String {
        cache::fingerprint(
            self.config,
            "extraction",
            &serde_json::json!({"prompt":extraction_prompt(source),"schema":extraction_schema()}),
        )
    }
    async fn extract(
        &self,
        source: &[SegmentRow],
        batch: usize,
        retry: bool,
        session: &streaming::Session,
        preview: &PreviewCallback<'_>,
    ) -> Result<ParseOutcome<Candidate>, String> {
        if self.token.cancelled() {
            return Err(CANCELLED_MESSAGE.into());
        }
        let file_id = self.checkpoints.file_id;
        let cache_key = self.extraction_key(source);
        if let Some(value) = self.checkpoints.read("extraction", &cache_key) {
            if let Ok(outcome) = parsing::candidates(&value.to_string(), source) {
                if outcome.skipped_count == 0 {
                    diagnostics::cache_hit(file_id, "extraction");
                    preview(
                        source,
                        PreviewUpdate {
                            operation: "commit",
                            batch_id: batch,
                            attempt_id: uuid::Uuid::new_v4().to_string(),
                            origin: "cache",
                            items: accepted(source, &outcome.items),
                        },
                    );
                    return Ok(outcome);
                }
            }
        }
        let split_checkpoint = source.len() > 1
            && self.checkpoints.read("extraction_split", &cache_key)
                == Some(serde_json::Value::Bool(true));
        let outcome = if split_checkpoint {
            self.extract_halves(source, batch, session, preview).await?
        } else {
            match request_extraction_streaming(
                self.client,
                self.config,
                self.token,
                self.notifier,
                file_id,
                batch,
                source,
                retry,
                session,
                preview,
            )
            .await
            {
                Ok(outcome) => outcome,
                Err(error) if matches!(error.code, "OUTPUT_TRUNCATED" | "CONTEXT_LIMIT") && source.len() > 1 => {
                    diagnostics::split(file_id, "extraction");
                    self.checkpoints.write(
                        "extraction_split",
                        &cache_key,
                        &serde_json::Value::Bool(true),
                    );
                    self.extract_halves(source, batch, session, preview).await?
                }
                Err(error) => return Err(error.as_error()),
            }
        };
        if outcome.skipped_count == 0 {
            self.checkpoints.write(
                "extraction",
                &cache_key,
                &serde_json::json!({"phrases":outcome.items}),
            );
        }
        Ok(outcome)
    }
    async fn extract_halves(
        &self,
        source: &[SegmentRow],
        batch: usize,
        session: &streaming::Session,
        preview: &PreviewCallback<'_>,
    ) -> Result<ParseOutcome<Candidate>, String> {
        let middle = source.len() / 2;
        let mut combined = ParseOutcome {
            items: Vec::new(),
            raw_count: 0,
            skipped_count: 0,
            recovered_count: 0,
            missing_fields: Default::default(),
        };
        for (part, slice) in [&source[..middle], &source[middle..]]
            .into_iter()
            .enumerate()
        {
            let outcome = Box::pin(self.extract(
                slice,
                batch.saturating_mul(100).saturating_add(part + 1),
                false,
                session,
                preview,
            ))
            .await?;
            combined.items.extend(outcome.items);
            combined.raw_count += outcome.raw_count;
            combined.skipped_count += outcome.skipped_count;
            combined.recovered_count += outcome.recovered_count;
            combined.missing_fields.extend(outcome.missing_fields);
        }
        Ok(combined)
    }
    pub async fn run_legacy_events(
        &self,
        segments: &[SegmentRow],
        preview: impl Fn(&[SegmentRow], PreviewUpdate) + Send + Sync,
    ) -> Result<Vec<Accepted>, String> {
        let session = streaming::Session::default();
        let ranges = extraction_ranges(self.config, segments);
        let mut candidates = Vec::new();
        for (number, (start, end)) in ranges.iter().enumerate() {
            candidates.extend(
                self.extract(
                    &segments[*start..*end],
                    number + 1,
                    true,
                    &session,
                    &preview,
                )
                .await?
                .items,
            );
        }
        if self.token.cancelled() {
            return Err(CANCELLED_MESSAGE.into());
        }
        candidates.sort_by(|a, b| {
            (a.segment_index, &a.token_positions, &a.canonical).cmp(&(
                b.segment_index,
                &b.token_positions,
                &b.canonical,
            ))
        });
        candidates.dedup_by(|a, b| {
            key(a.segment_index, &a.canonical, &a.token_positions)
                == key(b.segment_index, &b.canonical, &b.token_positions)
        });
        Ok(accepted(segments, &candidates))
    }
    #[cfg(test)]
    pub async fn run(
        &self,
        segments: &[SegmentRow],
        preview: impl Fn(&[SegmentRow], &[Accepted], &str) + Send + Sync,
    ) -> Result<Vec<Accepted>, String> {
        self.run_legacy_events(segments, |source, update| {
            if update.operation == "commit" {
                preview(source, &update.items, update.origin);
            }
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::mock_deepseek;
    use super::*;
    use std::sync::Mutex;

    const EXTRACTION: &str = r#"{"phrases":[{"segment_index":1,"canonical":"pick up","token_positions":[1,3],"category":"phrasal_verb"}]}"#;

    fn database(id: i64) -> (tempfile::TempDir, Mutex<Connection>) {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::init_db(&dir.path().join("pipeline.sqlite")).unwrap();
        conn.execute("INSERT INTO files(id,name,type,content,content_hash,imported_at) VALUES(?1,'a','txt','text','h',1)", [id]).unwrap();
        (dir, Mutex::new(conn))
    }
    fn segments() -> Vec<SegmentRow> {
        vec![SegmentRow {
            index: 1,
            text: "I picked it up.".into(),
        }]
    }

    #[tokio::test]
    async fn cache_and_force_only_request_extraction_and_publish_preview() {
        let (_dir, conn) = database(101);
        let (config, server) = mock_deepseek(&[
            (EXTRACTION, "stop"),
            (EXTRACTION, "stop"),
            (EXTRACTION, "stop"),
        ]);
        let client = ai_client(std::time::Duration::from_secs(5), &config.base_url).unwrap();
        let token = CancellationToken::default();
        let mut pipeline = Pipeline {
            client: &client,
            config: &config,
            token: &token,
            notifier: None,
            checkpoints: cache::Checkpoints {
                conn: &conn,
                file_id: 101,
                force: false,
            },
        };
        let origins = Mutex::new(Vec::new());
        let preview = |_: &[SegmentRow], items: &[Accepted], origin: &str| {
            assert_eq!(items[0].surface, "picked up");
            origins.lock().unwrap().push(origin.to_owned());
        };
        diagnostics::start(101, &config.provider, &config.model);
        assert_eq!(pipeline.run(&segments(), &preview).await.unwrap().len(), 1);
        let usage = diagnostics::summary(101).unwrap();
        assert_eq!(usage.extraction.prompt_tokens, Some(10));
        assert_eq!(usage.explanation.requests, 0);
        assert_eq!(usage.explanation.completion_tokens, Some(0));
        diagnostics::start(101, &config.provider, &config.model);
        pipeline.run(&segments(), &preview).await.unwrap();
        assert_eq!(diagnostics::summary(101).unwrap().extraction.requests, 0);
        pipeline.checkpoints.force = true;
        pipeline.run(&segments(), &preview).await.unwrap();
        assert_eq!(*origins.lock().unwrap(), ["ai", "cache", "ai"]);
        let visual_usage = diagnostics::summary(101).unwrap().extraction;
        diagnostics::start(101, &config.provider, &config.model);
        pipeline.run(&segments(), |_, _, _| {}).await.unwrap();
        let plain_usage = diagnostics::summary(101).unwrap().extraction;
        assert_eq!(
            (visual_usage.prompt_tokens, visual_usage.completion_tokens),
            (plain_usage.prompt_tokens, plain_usage.completion_tokens)
        );
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 3);
        assert_eq!(requests[0]["messages"], requests[2]["messages"]);
        assert!(requests.iter().all(|r| r["messages"][1]["content"]
            .as_str()
            .unwrap()
            .contains("token_positions")));
    }

    #[tokio::test]
    async fn interrupted_split_recovers_children_and_publishes_before_failure() {
        let (dir, conn) = database(102);
        let second = EXTRACTION.replace("\"segment_index\":1", "\"segment_index\":2");
        let (config, server) = mock_deepseek(&[
            ("{", "length"),
            (EXTRACTION, "stop"),
            ("{}", "stop"),
            (&second, "stop"),
        ]);
        let client = ai_client(std::time::Duration::from_secs(5), &config.base_url).unwrap();
        let token = CancellationToken::default();
        let mut source = segments();
        source.push(SegmentRow {
            index: 2,
            text: "She picked it up.".into(),
        });
        let events = Mutex::new(Vec::new());
        let preview = |s: &[SegmentRow], _: &[Accepted], origin: &str| {
            events.lock().unwrap().push((s[0].index, origin.to_owned()));
        };
        {
            let pipeline = Pipeline {
                client: &client,
                config: &config,
                token: &token,
                notifier: None,
                checkpoints: cache::Checkpoints {
                    conn: &conn,
                    file_id: 102,
                    force: false,
                },
            };
            assert!(pipeline.run(&source, &preview).await.is_err());
            assert_eq!(*events.lock().unwrap(), [(1, "ai".into())]);
        }
        drop(conn);
        let reopened = Mutex::new(crate::db::init_db(&dir.path().join("pipeline.sqlite")).unwrap());
        let pipeline = Pipeline {
            client: &client,
            config: &config,
            token: &token,
            notifier: None,
            checkpoints: cache::Checkpoints {
                conn: &reopened,
                file_id: 102,
                force: false,
            },
        };
        assert_eq!(pipeline.run(&source, &preview).await.unwrap().len(), 2);
        assert_eq!(
            *events.lock().unwrap(),
            [(1, "ai".into()), (1, "cache".into()), (2, "ai".into())]
        );
        assert_eq!(server.join().unwrap().len(), 4);
    }

    #[tokio::test]
    async fn empty_batches_and_cancellation_never_need_explanations() {
        let (_dir, conn) = database(103);
        let (config, server) = mock_deepseek(&[(r#"{"phrases":[]}"#, "stop")]);
        let client = ai_client(std::time::Duration::from_secs(5), &config.base_url).unwrap();
        let token = CancellationToken::default();
        let pipeline = Pipeline {
            client: &client,
            config: &config,
            token: &token,
            notifier: None,
            checkpoints: cache::Checkpoints {
                conn: &conn,
                file_id: 103,
                force: false,
            },
        };
        let count = Mutex::new(0);
        assert!(pipeline
            .run(&segments(), |source, items, _| {
                assert!(items.is_empty());
                *count.lock().unwrap() += source.len();
            })
            .await
            .unwrap()
            .is_empty());
        assert_eq!(*count.lock().unwrap(), 1);
        token.cancel();
        assert!(pipeline
            .run(&segments(), |_, _, _| panic!("cancelled run published"))
            .await
            .is_err());
        assert_eq!(server.join().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn invalid_structured_checkpoint_is_revalidated_before_preview() {
        let (_dir, conn) = database(104);
        let (config, server) = mock_deepseek(&[(EXTRACTION, "stop")]);
        let client = ai_client(std::time::Duration::from_secs(5), &config.base_url).unwrap();
        let token = CancellationToken::default();
        let pipeline = Pipeline {
            client: &client,
            config: &config,
            token: &token,
            notifier: None,
            checkpoints: cache::Checkpoints {
                conn: &conn,
                file_id: 104,
                force: false,
            },
        };
        pipeline.checkpoints.write("extraction", &pipeline.extraction_key(&segments()), &serde_json::json!({"phrases":[{"segment_index":1,"canonical":"pick up","category":"phrasal_verb","token_positions":[0,2]}]}));
        assert_eq!(
            pipeline
                .run(&segments(), |_, items, source| {
                    assert_eq!(source, "ai");
                    assert_eq!(items.len(), 1);
                })
                .await
                .unwrap()
                .len(),
            1
        );
        assert_eq!(server.join().unwrap().len(), 1);
    }

    #[test]
    fn preview_ranges_use_original_positions_and_utf16() {
        let source = SegmentRow {
            index: 1,
            text: "🎬 I picked it up, then picked it up.".into(),
        };
        let candidate = Candidate {
            segment_index: 1,
            canonical: "pick up".into(),
            token_positions: vec![6, 8],
            category: "phrasal_verb".into(),
        };
        let items = accepted(&[source.clone()], &[candidate]);
        let preview = preview_phrase(&items[0], &source);
        let utf16: Vec<_> = source.text.encode_utf16().collect();
        let selected: Vec<_> = preview
            .ranges
            .iter()
            .map(|r| String::from_utf16(&utf16[r.start..r.end]).unwrap())
            .collect();
        assert_eq!(selected, ["picked", "up"]);
        assert_eq!(preview.ranges[0].start, 24);
        let text = "I'd pick it up.";
        let spans = english::tokenize_english_spans(text);
        assert_eq!((spans[0].start, spans[0].end, spans[0].position), (0, 3, 0));
        assert_eq!(spans.len(), english::tokenize_english_text(text).len());
    }
    #[tokio::test]
    async fn live_candidate_is_published_before_completion_then_committed_with_same_usage() {
        use super::super::streaming::tests::{ending, mock, sse, Reply};
        let (_dir, conn) = database(605);
        let (release, gate) = std::sync::mpsc::channel();
        let prefix = sse(EXTRACTION.trim_end_matches("]}"));
        let mut reply = Reply::stream(format!("{prefix}{}{}", sse("]}"), ending("stop")));
        reply.pause = Some((prefix.len(), gate));
        let (config, server) = mock(vec![reply]);
        let client = ai_client(std::time::Duration::from_secs(5), &config.base_url).unwrap();
        let token = CancellationToken::default();
        let pipeline = Pipeline {
            client: &client,
            config: &config,
            token: &token,
            notifier: None,
            checkpoints: cache::Checkpoints {
                conn: &conn,
                file_id: 605,
                force: false,
            },
        };
        diagnostics::start(605, "openai", "fixture");
        let events = Mutex::new(Vec::new());
        let result = pipeline
            .run_legacy_events(&segments(), |_, update| {
                if update.operation == "append" {
                    assert_eq!(update.items.len(), 1);
                    release.send(()).unwrap();
                }
                events.lock().unwrap().push(update.operation);
            })
            .await
            .unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(
            *events.lock().unwrap(),
            ["begin", "activity", "append", "commit"]
        );
        let usage = diagnostics::summary(605).unwrap();
        assert_eq!(usage.extraction.requests, 1);
        assert_eq!(usage.stream_requests, 1);
        assert_eq!(
            (
                usage.extraction.prompt_tokens,
                usage.extraction.completion_tokens
            ),
            (Some(10), Some(20))
        );
        assert!(!usage.usage_incomplete);
        assert_eq!(usage.explanation.requests, 0);
        assert_eq!(server.join().unwrap().len(), 1);
        diagnostics::start(605, "openai", "fixture");
        pipeline
            .run_legacy_events(&segments(), |_, update| {
                assert_eq!(update.operation, "commit")
            })
            .await
            .unwrap();
        assert_eq!(diagnostics::summary(605).unwrap().extraction.requests, 0);
    }
    #[tokio::test]
    async fn interrupted_or_cancelled_stream_rolls_back_without_cache_or_automatic_resend() {
        use super::super::streaming::tests::{ending, mock, sse, Reply};
        for (id, cancel) in [(606, false), (607, true)] {
            let (_dir, conn) = database(id);
            let (release, gate) = std::sync::mpsc::channel();
            let prefix = sse(EXTRACTION.trim_end_matches("]}"));
            let mut reply = Reply::stream(prefix.clone());
            reply.incomplete = true;
            if cancel {
                reply.pause = Some((prefix.len(), gate));
            } else {
                drop(gate);
            }
            let resume = Reply::stream(format!("{}{}", sse(EXTRACTION), ending("stop")));
            let (config, server) = mock(vec![reply, resume]);
            let client = ai_client(std::time::Duration::from_secs(5), &config.base_url).unwrap();
            let token = CancellationToken::default();
            diagnostics::start(id, "openai", "fixture");
            let pipeline = Pipeline {
                client: &client,
                config: &config,
                token: &token,
                notifier: None,
                checkpoints: cache::Checkpoints {
                    conn: &conn,
                    file_id: id,
                    force: false,
                },
            };
            let events = Mutex::new(Vec::new());
            let result = pipeline
                .run_legacy_events(&segments(), |_, update| {
                    if update.operation == "append" && cancel {
                        token.cancel();
                        release.send(()).unwrap();
                    }
                    events.lock().unwrap().push(update.operation);
                })
                .await;
            assert!(result.err().unwrap().contains(if cancel {
                "ERR_CANCELLED"
            } else {
                "STREAM_INTERRUPTED"
            }));
            assert!(events.lock().unwrap().ends_with(&["append", "rollback"]));
            let usage = diagnostics::summary(id).unwrap();
            assert_eq!(usage.extraction.requests, 1);
            assert!(usage.usage_incomplete);
            assert!(usage.extraction.completion_tokens.is_none());
            assert!(pipeline
                .checkpoints
                .read("extraction", &pipeline.extraction_key(&segments()))
                .is_none());
            let resume_token = CancellationToken::default();
            let resumed = Pipeline {
                token: &resume_token,
                ..pipeline
            };
            assert_eq!(
                resumed
                    .run_legacy_events(&segments(), |_, _| {})
                    .await
                    .unwrap()
                    .len(),
                1
            );
            assert_eq!(server.join().unwrap().len(), 2);
        }
    }
    #[tokio::test]
    async fn streamed_parent_rolls_back_before_split_and_successful_child_resumes_from_cache() {
        use super::super::streaming::tests::{ending, mock, sse, Reply};
        let (_dir, conn) = database(608);
        let second = EXTRACTION.replace("\"segment_index\":1", "\"segment_index\":2");
        let response =
            |raw: &str, reason: &str| Reply::stream(format!("{}{}", sse(raw), ending(reason)));
        let (config, server) = mock(vec![
            response(EXTRACTION, "length"),
            response(EXTRACTION, "stop"),
            response("{}", "stop"),
            response(&second, "stop"),
        ]);
        let client = ai_client(std::time::Duration::from_secs(5), &config.base_url).unwrap();
        let token = CancellationToken::default();
        let pipeline = Pipeline {
            client: &client,
            config: &config,
            token: &token,
            notifier: None,
            checkpoints: cache::Checkpoints {
                conn: &conn,
                file_id: 608,
                force: false,
            },
        };
        let mut source = segments();
        source.push(SegmentRow {
            index: 2,
            text: "She picked it up.".into(),
        });
        let events = Mutex::new(Vec::new());
        let callback = |_: &[SegmentRow], update: PreviewUpdate| {
            events
                .lock()
                .unwrap()
                .push((update.batch_id, update.operation, update.origin))
        };
        assert!(pipeline.run_legacy_events(&source, &callback).await.is_err());
        let first = events.lock().unwrap().clone();
        assert!(
            first
                .iter()
                .position(|e| *e == (1, "rollback", "ai"))
                .unwrap()
                < first
                    .iter()
                    .position(|e| *e == (101, "begin", "ai"))
                    .unwrap()
        );
        assert!(first.contains(&(101, "commit", "ai")));
        assert!(!first.contains(&(1, "commit", "ai")));
        assert!(first.contains(&(102, "rollback", "ai")));
        events.lock().unwrap().clear();
        assert_eq!(
            pipeline.run_legacy_events(&source, &callback).await.unwrap().len(),
            2
        );
        assert!(events.lock().unwrap().contains(&(101, "commit", "cache")));
        assert_eq!(server.join().unwrap().len(), 4);
    }
    #[tokio::test]
    async fn complete_invalid_stream_retries_with_new_attempt_and_rolls_back_previous_candidate() {
        use super::super::streaming::tests::{ending, mock, sse, Reply};
        let (_dir, conn) = database(609);
        let prefix = EXTRACTION.trim_end_matches("]}");
        let (config, server) = mock(vec![
            Reply::stream(format!("{}{}", sse(prefix), ending("stop"))),
            Reply::stream(format!("{}{}", sse(EXTRACTION), ending("stop"))),
        ]);
        let client = ai_client(std::time::Duration::from_secs(5), &config.base_url).unwrap();
        let token = CancellationToken::default();
        let pipeline = Pipeline {
            client: &client,
            config: &config,
            token: &token,
            notifier: None,
            checkpoints: cache::Checkpoints {
                conn: &conn,
                file_id: 609,
                force: false,
            },
        };
        let events = Mutex::new(Vec::new());
        assert_eq!(
            pipeline
                .run_legacy_events(&segments(), |_, update| events
                    .lock()
                    .unwrap()
                    .push((update.attempt_id, update.operation)))
                .await
                .unwrap()
                .len(),
            1
        );
        let events = events.lock().unwrap();
        let rolled = events.iter().find(|e| e.1 == "rollback").unwrap();
        let committed = events.iter().find(|e| e.1 == "commit").unwrap();
        assert_ne!(rolled.0, committed.0);
        assert!(events.iter().any(|e| e.0 == rolled.0 && e.1 == "append"));
        assert_eq!(server.join().unwrap().len(), 2);
    }
}

impl Pipeline<'_> {
    pub async fn run_events(&self, segments: &[SegmentRow], preview: impl Fn(&[SegmentRow], PreviewUpdate) + Send + Sync) -> Result<Vec<Accepted>, String> {
        quality::run(self, segments, &preview).await
    }
}
