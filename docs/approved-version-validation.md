# Approved reading workspace integration

This integrates the application behavior confirmed on 2026-11-03 from the
`codex/translation-reading-anchor` snapshot (`fb2c39cf`). Production UI and
backend sources are retained; only Rust formatting and a local type alias were
adjusted for the strict CI checks. The default build uses these same screens;
isolated preview flags control fixture seeding, QA and profile isolation.

The confirmed flow includes material import and a horizontal paper deck,
English reading with on-demand lookup, source-backed phrasal-verb matching
across inserted objects, contextual saves and recall, compact voice actions,
smooth playback following with manual-scroll recovery, lookup pause/resume,
and translation disclosure that preserves the visible original. Existing data
backup, historical viewing/export and restore protection remain available.

## Scope

- Includes application sources, local dictionary/API adapters, portable tests,
  fonts and licenses, reproducible QA harnesses and build/release gates.
- Preserves the default branch's current sponsor links.
- Leaves promotional-video experiments, design exports, captured webpages,
  raw acceptance frames, local database copies and packaged apps outside the
  commit. Those remain available in the original local worktrees/backups.
- Does not publish installers or change signing/notarization requirements.

## Validation

- Frontend: 604 tests across 72 files; TypeScript, lint and production build.
- Desktop library: 383 passing tests; 37 explicitly ignored platform/network
  or local-capture checks. No claims are made for those skipped integrations.
- Default/ocean, sage and midnight native disclosure checks: 82 assertions,
  33 measured transitions, maximum original-text displacement 1 CSS pixel.
- Native follow/idle-recovery/lookup-resume regression: 63 assertions.
- The confirmed macOS candidate was built and its signature and Gemma ABI 1
  dependency loading verified before this consolidation.

Run the portable release checks with `npm run check:release:tests`; run
`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` and strict Clippy
as described in [development-testing.md](development-testing.md).
