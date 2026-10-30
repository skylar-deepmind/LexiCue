# Development checks

Run the same frontend and desktop checks used by CI before pushing:

```sh
npm ci
npm run lint
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

## Optional reading UI regressions

Start Vite, make Playwright and a Chromium browser available, and prepare a
local Longman text package with `scripts/prepare-longman-local.mjs` if running
checks that expect local definitions. The package and captured source material
are deliberately not versioned. `LEXICUE_PLAYWRIGHT_MODULE`,
`LEXICUE_UI_BROWSER_CHANNEL`, `LEXICUE_UI_URL` and
`LEXICUE_LONGMAN_PACKAGE_ROOT` can point to an existing local setup.

```sh
node scripts/ui-import-terminal-punctuation.mjs
node scripts/ui-clipboard-content.mjs
node scripts/ui-adaptive-reading-layout.mjs
node scripts/ui-recall-soft-marker.mjs
```

The harness launches production Rust command cores against disposable SQLite,
with controlled clipboard, file-picker and external-service responses. The
scripts cover default and midnight themes; they do not certify real network
services or native audio playback. Generated output is written under the
system temporary directory.

`cargo test` skips explicitly marked local-capture, live-network and platform
checks. Run those only with the documented local prerequisites; they are not
part of the portable passing-test count.

One-off native QA hosts, evaluation reports, screenshots, downloaded webpages,
media captures and source snapshots remain local under the ignore rules. The
application does not compile or register those hosts. Small portable regression
fixtures and synthetic unit tests remain versioned.
