# Isolated native acceptance and external-service checks

## macOS and iPhone dictionary acceptance

Use `dictionary-native-qa` with the matching config below to install alongside
the regular app. The feature refuses production identifiers; the QA identifiers
also refuse to launch without the feature. Both platforms retain the normal
frontend, native dictionary IPC, downloads, SQLite, import and saved-record code.
Only the updater and shared device-sync credential/runtime initialization are
disabled. Do not enable any `VITE_SLICE_*` fixture flags.

```sh
npm run tauri -- build --bundles app --features dictionary-native-qa --config scripts/qa/dictionary-macos.json --no-sign --ci
npm run ios:prepare -- --ci --skip-targets-install --config scripts/qa/dictionary-ios.json
npm run tauri -- ios build --features dictionary-native-qa --config scripts/qa/dictionary-ios.json --archive-only --export-method debugging --ci
node --test scripts/ios-project.test.mjs
```

iOS signing requires a locally configured development team/profile for the QA
identifier. Keep team overrides, device identifiers and provisioning material
outside Git. Repeating `ios:prepare` is supported; it preserves Rust arguments
and replaces managed plist values without duplicating them.

Run the build with the project's task lock and budget monitoring. Keep build
outputs task-local. Do not copy model weights or launch against the regular
app's database. An unsigned/ad hoc macOS app and a development-signed iPhone
app establish local acceptance, not App Store/notarization or release readiness.
QA disables some startup code, so its footprint is not an exact shipping estimate.

Record actual native UI evidence for:

- Fresh launch: only Everyday & General is included; no optional DB copies.
- Download progress, cancellation, retry and successful installation.
- Native file picker installation, wrong/corrupt archive rejection and recovery.
- Base coverage (`pneumonia`, `soliloquy`) and optional coverage (`ichthyology`).
- Offline/local lookup, saved excerpts, optional-pack removal and app restart.
- Both Ocean and Midnight themes, including loading, disabled and failure states.
- Bundle bytes and app-data bytes separately; staging cleanup after completion,
  cancellation, failure and removal. Exclude intentionally copied input ZIPs.

The dictionary picker uses scoped access on iOS. Its default copy mode otherwise
leaves another archive in `tmp/<app-id>-Inbox`, outside the installer's staging.
Verify an archive from outside the QA container and check that installation and
rejection leave no new Inbox ZIP while the selected original remains untouched.
Do not use `devicectl copy to --remove-existing-content true` for input cleanup:
on this Xcode version it reset the entire QA appDataContainer despite a Documents
destination. Use Files to remove only the known test input, and measure recoverable
Trash separately. Never count such a harness reset as an app restart result.

An unreachable app-specific HTTP(S) proxy tests native request failure on macOS;
label it as controlled transport failure, not a globally disconnected Mac.
For iPhone offline acceptance, record and restore the original radio settings.
Do not count cached online definitions as fresh local-pack results. Save an
explicit Wiktionary excerpt before removal and compare its snapshot afterward.
Installed-pack state must affect new local lookups while the frozen excerpt,
original sentence, user explanation and license attribution remain readable.

Audit old-library dictionary/cache residue separately on a disposable copy. Fresh
install size and successful pack removal do not prove old caches were reclaimed.
Never remove user dictionaries, non-English archival records or learning history
as part of a generic cache cleanup.

These tools use real SQLite/native Rust service code. They do not control the
application UI or establish that WKWebView playback, file pickers or IPC were
exercised. Network probes use synthetic English or the public 19-second video
`jNQXAC9IVRw`, without browser cookies. Private database contents, captured DBs,
downloaded audio and service responses must remain local and untracked.

## Real legacy database capture and upgrade

`copy-legacy-db.py --source <one-explicit-db> --output <new-private-temp-folder>`
never opens the source with SQLite. It reads the DB/WAL/SHM group, checks all
present files' SHA-256 before/copy/after, and retries at most three times if the
group changes. It opens only the private capture, then uses SQLite backup to
produce `legacy-consistent.db`. Its metadata report includes integrity, FK,
original schema columns, counts and language aggregates; no record text.

The current real `com.lexicue.app` DB and its actual pre-v31 migration backup
were captured this way. The latter has no saved-context/migration tables;
this is an actual user-library snapshot, not generated historical DDL. Its
precise old-app binary/source version has not been proven. Private standalone
copies and capture manifests are retained in the authorized preservation
folder, outside Git. Never launch an old app on a source or unknown new schema.

To audit only an explicitly provided standalone temporary copy:

```sh
LEXICUE_V31_TEST_DB=/tmp/private-capture/legacy-consistent.db cargo test --lib --locked commands::saved::tests::audit_temporary_legacy_copy -- --ignored --exact --nocapture
```

For Cargo's `--exact`, use the full test name
`commands::saved::tests::audit_temporary_legacy_copy`. The test duplicates the
standalone input into a disposable directory before upgrading it, compares every
original column in the ten legacy learning tables, checks migration idempotence
and FKs, then compares every portable export table after restore. Only local
`saved_records.id` is excluded from portable identity comparison.

## Fresh public upstreams

```sh
LEXICUE_EXTERNAL_EVIDENCE=/tmp/mac-external cargo test --lib --locked fresh_native_translation_and_cache_probe -- --ignored --nocapture
LEXICUE_EXTERNAL_EVIDENCE=/tmp/mac-external cargo test --lib --locked fresh_public_english_subtitle_audio_pipeline -- --ignored --nocapture
```

Translation uses a newly generated synthetic sentence and empty temporary cache,
then rereads with an unreachable endpoint to prove a cache-only result. The
YouTube probe follows actual metadata → original English captions → source
validation → material import → audio download → AAC remux/probe → checksum-
validated resolve. Each probe writes explicit passed/failed JSON and fails its
test when the real service fails. Network failures are not skipped as successes.

The public AAC and source JSON may be reused only in an isolated QA app as a
**previously downloaded cache asset**, never described as fresh UI downloading.
Prefer the normal UI download path. For cached replay, the target's imported
source key must match the recorded `YoutubeSource.key`; place the verified AAC
at `<isolated app_data_dir>/source-media/<manifest.sha256>.m4a`, and bind its
`source_media` row with the exact source JSON, `asset_id`, `manifest_json` and
`status='ready'`. A different subtitle/audio identity must not borrow this cache.
The production `resolve` path rechecks its SHA and timing before returning it.

## Bounded interruption/storage checks

`cargo test --lib --locked commands::export::reliability_tests` uses disposable
DBs only. A child runs actual replacement statements and is killed immediately
before or after COMMIT. The reopened DB must be exactly the old or new snapshot,
with an independently readable safety copy. This tests process interruption,
not physical power loss. `max_page_count` induces real SQLITE_FULL without filling
the machine's filesystem. A 5,000-sentence backup/restore is a bounded sanity
check; it is not a general performance claim.

The two source-sensitive archive/recall unit tests use a scoped thread-local
`cfg(test)` relation catalog, preserving actual production wrapper behavior and
the separate missing-dictionary tests. The existing genuine-package integration
tests remain opt-in; no private Longman package is required by the default suite.
