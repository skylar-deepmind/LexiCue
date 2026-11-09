# LexiCue marketing sources

The website’s Workspace is a working browser demo of the current application. It reuses the product’s desktop/mobile components and styles with isolated temporary data. The user guide, download page and support page are separate destinations. README and guide screenshots illustrate the same current interface.

Public downloads and current source features are stated separately. Building the website does not publish an installer or deploy GitHub Pages.

## Website and live application

- `src/main.tsx` renders four-purpose navigation: Workspace, User guide, Download and Support. Workspace contains the live app and a compact download/reset row, without a separate marketing hero, screenshot gallery or feature list.
- `src/CurrentWorkspace.tsx` embeds `_demo/index.html`. The desktop preview is centered at a maximum 1120 px width with a 16:10 aspect ratio and a 400 px minimum height; phones retain the available viewport height. The product’s own responsive layout and internal scrolling apply. Changing the website language or theme updates the existing iframe; it does not recreate the demo session.
- `demo/entry.tsx`, `demo/runtime.ts` and the browser adapters reuse the current product App, routes, stores and CSS. `vite.demo.config.mjs` changes the native boundary and static-host routing for the browser build; production application source stays unchanged.
- Demo materials, saved contexts, tags and preferences use an isolated current-tab namespace. Refreshing the same tab preserves the demo. Reset demo restores the initial materials and saved contexts after confirmation, without clearing website preferences or personal application data.
- The demo uses original English sample materials, existing Chinese translations and original sample dictionary definitions. Every clickable English token in the three built-in materials has a concise bilingual dictionary entry, with word class, pronunciation and inflection information. Unknown words from user-imported text remain explicitly uncovered. The real UI handles reading, lookup, saving, notes, material organization and supported browser imports. Device pairing, operating-system operations and installer updates do not connect to native services. Unavailable browser operations report their limits through the existing product controls.

The iframe accepts same-origin messages from its parent:

```js
{ type: 'lexicue-demo-preferences', locale: 'zh', theme: 'ocean' }
{ type: 'lexicue-demo-reset' }
```

It sends `lexicue-demo-ready` to the parent when ready. The outer site checks both the sender window and origin, and retains the iframe across preference changes.

## Content and generated pages

`src/catalogue.mjs` holds English, Simplified Chinese, Japanese and German product descriptions. English is the learning language; the four choices are interface languages. `scripts/readmes.mjs` generates the four root README files, whose feature links open the appropriate guide chapters and whose workspace link opens the live app.

`src/manual-content.mjs` is the four-language guide source. `manual-render.mjs` renders the same sections for React and static HTML. Existing chapter URLs remain valid; vocabulary/review/insights now explain saved contexts, re-encounters, reading position and legacy records. Older `#feature-*` links redirect to the corresponding guide.

`npm run build` generates 44 localized workspace, download, support and guide pages plus their static navigation and metadata. It then invokes `scripts/build-demo.mjs`, which creates `docs/_demo/index.html`, real application assets and local document-parser resources. The outer site uses `docs/_marketing/`. Technical Markdown documents remain intact. Without JavaScript the guide and download/support pages remain readable; Workspace offers guidance to enable JavaScript or open the guide.

## Regenerate and verify

Install the root and marketing dependencies from their lockfiles when missing, then generate and check:

```sh
npm ci
npm --prefix marketing ci
node marketing/scripts/readmes.mjs
npm --prefix marketing run build
npm --prefix marketing run check
npm --prefix marketing test
node --test marketing/demo/*.test.mjs
```

Serve the repository in a separate terminal to preview the actual static output:

```sh
python3 -m http.server 4190 --bind 127.0.0.1
npm --prefix marketing run test:ui
```

`test:ui` uses Ego Browser and automatically splits the matrix into short locale/theme/width rounds in one TaskSpace. It checks the real application opening a material, keyboard lookup and saving, preservation of the same iframe and saved state through language/theme changes, demo reset, separate download/support routes, legacy links, guide enlargement and no-JavaScript content. Reports and desktop/mobile evidence are written to `output/marketing/qa/live-site/`. `test:home` and `test:manual` limit the run to the corresponding surfaces.

`LEXICUE_STATIC_URL` overrides `http://127.0.0.1:4190/docs/`. `LEXICUE_QA_LOCALES`, `LEXICUE_QA_THEMES`, `LEXICUE_QA_WIDTHS` and `LEXICUE_QA_HEIGHT` select diagnostic cases, including short or landscape viewports. `LEXICUE_EGO_SPACE` and `LEXICUE_EGO_PAGE` reuse an existing browser task; serialize browser runs. A standalone run creates one TaskSpace and closes it after all rounds pass.

Browser emulation verifies website behavior, not native file dialogs, physical devices, real pairing or installer publication. Demo-engine tests cover the temporary data boundary. Older demo-model tests remain regression coverage for the archived film renderer.

## Guide and README illustrations

Current screenshots live at:

```text
docs/media/current/{en,zh,ja,de}/{scene}-{ocean,midnight}-{desktop,mobile}.webp
```

Scenes are `materials`, `reading`, `lookup`, `saved`, `recall` and `settings`. Desktop images are 1280×850; mobile images are 390×844. Guide illustrations select the matching language, theme and viewport. Social previews use the reading screenshot. They are documentation illustrations, not a substitute for the live Workspace.

To refresh illustrations, start a dedicated product frontend and the disposable reading test bridge from `scripts/ui-reading-support.mjs`. Set `LEXICUE_READING_BRIDGE_INFO` to its info JSON (`temporary: true`) and `LEXICUE_UI_URL` to that frontend’s local URL, then run:

```sh
node marketing/scripts/current-assets.mjs
```

The generator requires Ego Browser, the product test bridge and both dependency sets. It writes compressed images plus a manifest recording revision, dimensions and isolation scope. It refuses non-disposable bridges and remote frontends. `LEXICUE_ASSET_LOCALES`, `LEXICUE_ASSET_THEMES`, `LEXICUE_ASSET_DEVICES` and `LEXICUE_ASSET_SCENES` select a refresh subset. Existing TaskSpace/Page variables are also supported.

## Archived films and publication

`Sandbox.tsx`, `Scene.tsx`, `DocumentPlayer.tsx` and the older film/asset scripts remain available for historical video projects. Their vocabulary states, scheduled reviews, statistics and baseline flows describe an earlier product. They do not power the current Workspace. Do not regenerate current illustrations with archived GIF/guide capture commands. See [asset licenses](ASSET-LICENSES.md) for provenance.

Commit the generated README files, website/demo sources and `docs/` output together. GitHub Pages serves `docs/`. Pushing a review branch and passing checks do not establish that the public site or installer release has changed; verify deployment separately.
