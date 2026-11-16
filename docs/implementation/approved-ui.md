# Approved desktop and mobile reading surfaces

Source: [LexiCue Figma](https://www.figma.com/design/FsjOfhLGQ7Rs5Ig9pfCVpK), desktop `383:14757` / code layer `462:14758`, mobile `480:3` / code layer `539:3`. The delivered handoff source and its design measurements are the implementation reference. The React application renders real material and saved-record state; it does not embed the prototype, an iframe, a screenshot, or sample article content.

## Product mapping

- `/files`: actual reading desk members (opening a wall material places it back on the desk), stable content-identity covers, remembered source sentence, keyboard/touch carousel, clipboard import, file import, tag editing, and the real first saved expression in the pocket.
- Material library: real tags and counts, desktop horizontal projection wall, phone two-column layout derived from actual character counts; scroll/focus are retained per tag. The menu opens `/files?view=manage`, retaining bulk/tag/delete/recovery administration.
- Reading: the existing native reading, translation, dictionary, saved-record, recall and audio services. Entrance and reverse return use the real source sentence and element geometry (580 ms desk, 1320 ms wall). Cover contours come from actual loaded artwork pixels. Cross-origin thumbnails fall back to paper exposure when canvas access is denied. Reduced motion skips the flying desk elements and uses a 140 ms wall fade.
- Dictionary: one supplemental lookup action stays inside the current card. Local meanings remain visible during pending, no-new, error and additional-meaning results. Provider settings remain available in dictionary settings.
- `/saved`: native date histogram and pre-grouping date filters, searchable entries, real source snapshots, multi-context paging/swipe, inline personal explanation, remove/undo, exact sentence return and view restoration. `/saved?view=manage` retains the existing advanced grouped administration.
- Settings: preferences/data/tools/updates, combined dictionary books and online preference, five persisted speech voices with real preview and connection controls, backup, sync and update services.

Artwork in `public/design` comes from the supplied handoff: ten prints, wordmarks, projector photo, five voice portraits, map states and the book decoration. The map/book vectors were extracted from the handoff's own embedded source. Content identity allocates an existing print deterministically, so rename/backup/restore does not shuffle covers; YouTube uses its source thumbnail with a bundled fallback. No new custom-cover upload/database field is introduced.

## Data and compatibility

There is no schema migration. Import `tag_ids` is optional and empty input preserves the existing request hash. Valid tags and material commit in one transaction; duplicate imports never silently retag a file. Invalid tags roll back the material and operation receipt. Saved date filters apply before grouping and searching, while existing unfiltered callers retain their entry points. Native reading positions and saved-record revisions remain authoritative. Backups and device-sync schemas are unchanged.

The exact local headword now leads source aliases in dictionary overviews (`air` before the historical `air → be` relation); the related entries remain available and saved snapshots are unchanged.

## Verification entry points

- `npm run test:ui`: current approved surfaces, their persistence/failure paths, detailed import boundary regression, and the existing 10,000-record re-encounter regression.
- `node scripts/ui-mobile-reading.mjs`: large type, portrait/landscape, original geometry and scroll across half/full/closed drawers, supplemental no-new and reduced motion.
- `node scripts/ui-mobile-startup.mjs`: cold startup, inert/focus release, repeated navigation, theme persistence and reduced motion.
- `npm run test:ui:historical`: retained pre-redesign scripts for reference; selectors and shelf/dock geometry in those scripts describe the retired presentation and are not a current acceptance claim.
- Rust tests include tagged import atomicity, date boundaries/search, the exact-headword regression, existing backup/restore, saved-record conflicts/idempotence and device protocol tests.

Browser tests use real Rust command cores and disposable SQLite. File picker, clipboard, external provider and selected failure boundaries are controlled as stated in each script; this is not native UI or physical-device evidence. QA app configs in `scripts/qa` use isolated identities, do not open everyday learning data, and disable updater/shared sync credentials. Native per-device receipts and screenshots are retained outside the worktree. A QA installation is not the post-merge everyday installation.
