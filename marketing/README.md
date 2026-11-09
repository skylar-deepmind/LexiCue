# LexiCue marketing sources

The four README files, homepage and eight guide chapters describe the current English reading workspace in `main`: import material, understand on demand, save context and recall on re-encounter. The published download version is stated separately; a successful site build does not publish an installer or deploy GitHub Pages.

## Content and generated files

- `src/catalogue.mjs` contains the shared English, Simplified Chinese, Japanese and German product copy. English is the learning language; these four choices are interface languages.
- `scripts/readmes.mjs` generates the four root README files. Their illustrations use current screenshots rather than the old vocabulary/review GIFs.
- `src/main.tsx`, `src/CurrentWorkspace.tsx` and `src/current-copy.mjs` render the homepage and its six-scene screenshot gallery. It shows Materials, Reading, Lookup, Saved, Re-encounter and Settings. It does not run the retired interactive sample or connect to native services.
- `src/manual-content.mjs` is the four-language guide source. `manual-render.mjs` renders the same sections for React and static HTML. Existing chapter URLs remain valid; the old vocabulary/review/insights URLs now explain saved contexts, re-encounters, reading position and history.
- `npm run build` generates `../docs/` homepage and guide entry points, `_marketing/` assets and the sitemap. Technical Markdown documents are preserved. Static HTML includes the current feature descriptions and public-release distinction before JavaScript loads.

Current screenshots live at:

```text
docs/media/current/{en,zh,ja,de}/{scene}-{ocean,midnight}-{desktop,mobile}.webp
```

Scenes are `materials`, `reading`, `lookup`, `saved`, `recall` and `settings`. Desktop images are 1280×850; mobile images are 390×844. The website selects the matching interface language, theme and viewport, and opens that same image when enlarged. Social previews use the current reading screenshot.

The images were captured from the current product frontend using original English sample materials. Native IPC uses the existing `scripts/ui-reading-support.mjs` fixtures and a temporary SQLite test bridge; no personal learning database is read. Chinese translations and personal notes are sample learning content and remain Chinese when the interface language changes. This is browser emulation of desktop and mobile layouts, not a physical-device or live-sync acceptance test.

## Capture current screenshots

Start a dedicated product frontend and the disposable reading test bridge used by `scripts/ui-reading-support.mjs`. Set `LEXICUE_READING_BRIDGE_INFO` to its info JSON (it must declare `temporary: true`) and `LEXICUE_UI_URL` to that frontend’s local URL, then run:

```sh
node marketing/scripts/current-assets.mjs
```

The generator uses original sample materials and writes compressed screenshots plus a manifest recording the source revision, dimensions and isolation scope. It requires Ego Browser, the product test bridge, root dependencies and marketing dependencies. It refuses a non-disposable bridge or remote frontend. `LEXICUE_ASSET_LOCALES`, `LEXICUE_ASSET_THEMES`, `LEXICUE_ASSET_DEVICES` and `LEXICUE_ASSET_SCENES` can select a refresh subset. `LEXICUE_EGO_SPACE` and `LEXICUE_EGO_PAGE` reuse an existing browser task; serialize capture and QA.

## Regenerate and verify

Install the root and marketing dependencies from their respective lockfiles when missing:

```sh
npm ci
npm --prefix marketing ci
node marketing/scripts/readmes.mjs
npm --prefix marketing run build
npm --prefix marketing run check
npm --prefix marketing test
```

Serve the repository in a separate terminal and check the built site:

```sh
python3 -m http.server 4190 --bind 127.0.0.1
npm --prefix marketing run test:ui
```

`test:ui` uses Ego Browser for homepage and guide acceptance. It checks all four interface languages, ocean/midnight, 390/768/1440px widths, keyboard scene switching, matching image links, focus, contrast, direct feature links, guide image enlargement and static content without JavaScript. Reports and desktop/mobile screenshots are written to `output/marketing/qa/current-site/`. `test:home` and `test:manual` limit the run to the corresponding surface. `LEXICUE_STATIC_URL` overrides the default `http://127.0.0.1:4190/docs/`.

When a browser task already owns an Ego TaskSpace, pass `LEXICUE_EGO_SPACE` and `LEXICUE_EGO_PAGE` to reuse it; serialize browser runs. `LEXICUE_QA_LOCALES`, `LEXICUE_QA_THEMES` and `LEXICUE_QA_WIDTHS` can limit a diagnostic run. The default command automatically divides the matrix into short locale/theme/width rounds in one task space. A standalone run creates that space once and closes it after all rounds pass. Native permissions, speech, file dialogs and device sync require their separate product acceptance checks.

The content check validates translated structure, current-format claims, release wording, screenshot paths, generated links and TypeScript. Existing demo-model tests remain regression coverage for the archived renderer; they are not evidence for current native product behavior.

## Archived videos and scenes

`Sandbox.tsx`, `Scene.tsx`, `DocumentPlayer.tsx`, the demo model and existing video/asset scripts are retained for older film projects. Their vocabulary status, scheduled review, statistics and baseline flows describe an earlier product. They are not mounted by the current homepage, and the old `capture`/`doc-capture` query routes are no longer public page modes.

Do not regenerate current guide or README illustrations with the archived `assets:guide`, `assets`, or README GIF commands. Capture current product components with isolated sample data instead. Video exports and old media remain untouched by this documentation update. Archived rendering commands and asset provenance are documented in the corresponding script sources and [asset licenses](ASSET-LICENSES.md).

## Publication

Commit the generated README files, current screenshots, website sources and `docs/` output together. GitHub Pages serves `docs/`; pushing a review branch or passing local checks does not establish that the public website has changed. Deploy and installer-release status must be verified separately.
