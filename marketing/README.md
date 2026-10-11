# LexiCue marketing studio

An interactive product experience, a four-language illustrated manual, real product components, and the existing README/video studio. Production app behavior, native commands and persisted stores are not changed.

## Local preview

```sh
npm ci # repository root: dependencies of the reused product components
cd marketing
npm ci
npm run dev
```

Open http://127.0.0.1:4180/?lang=zh (`en`, `ja`, `de` also work). The homepage uses six original sample files, an additional sample import and an isolated stateful experience. The frame-based video scenes retain their original three-sentence excerpt. `adapter.ts` replaces native I/O, dictionary requests, preferences, and speech only in this build. Unknown native calls fail closed. No model inference, download, sync, account or personal database access occurs.

## Build and regenerate

Requires Node.js 22.12+ (Node 24 used for this delivery), Chrome and FFmpeg with H.264/AAC/GIF encoders.

```sh
npm run build
# Serve the repository on 127.0.0.1:4190 in a separate terminal.
npm run assets:guide
npm run build # incorporates the captured image dimensions
npm run check
npm test
npm run test:ui
npm run test:states
npm run test:home
npm run test:contrast
```

`build` writes only the website entry points, localized `guide/<chapter>/` pages, `_marketing`, icon and sitemap in `../docs`. Existing technical Markdown documents remain intact. GitHub Pages can continue serving the repository's `docs/` directory. The language-independent static HTML is present before JavaScript loads, with real language-specific metadata and alternate URLs.

`assets:guide` captures 32 clean fallback posters from the isolated manual demo and records intrinsic image dimensions. It adds no numbered annotations. `assets` produces the original WebP screenshots and social images. To refresh the four looping README GIFs, first export the final horizontal video, then run `npm run assets:readme-gifs`. It crops the file/tag overview, lookup, phrase and review actions from the clean horizontal MP4, omits video captions and saves the shared clips under `docs/media/demo/`, referenced by all four README locales. Each GIF stays under 3 MiB. `copy` in `src/catalogue.mjs` is the shared source of truth for the README, static page, website and Chinese video scripts. Run the generator after changing it. App UI translations continue to come from the product locale files.

## Video exports

Download the attribution-required official track, then render locally:

```sh
mkdir -p public/audio
curl -fL 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Carefree.mp3' -o public/audio/carefree.mp3
python3 scripts/audio.py
npm run build
node scripts/stills.mjs
npm run render
```

Outputs are in `../output/marketing/`: 90-second 1920×1080 and 30-second 1080×1920 MP4s, clean MP4s, SRTs, covers and audio mixes. All video variants are 30 fps, H.264 yuv420p and AAC. `LEXICUE_RENDER_ONLY=Horizontal` or `Vertical` limits export to one layout. `LEXICUE_CHROME` can override the browser executable path; on macOS the default is Google Chrome. Preview and screenshot tests use the installed `chrome` channel. `LEXICUE_MARKETING_URL` overrides the preview URL for checks/assets.

Scene timing depends on the frame, not wall time. Capturing `?capture=1&scene=lookup&lang=zh&theme=midnight&frame=165&portrait=1` renders a fixed state. Video/README scenes retain their frame-based renderer. The manual now animates the current `Sandbox` through real sample actions using its own in-memory state and external play/pause/replay controls. Neither changes real learning records. The sample insights animate example data; they are not a claim about measured learning outcomes. AI samples are not speed benchmarks; sync is explicitly a process illustration.

`node scripts/refresh-scenes.mjs` can update selected scenes without rendering unchanged scenes, when both timelines and the layout are unchanged. Set `LEXICUE_REFRESH_SCENES=lookup,review` to choose scene IDs. It checks the delivery manifest's timelines before updating all four final videos and their raw picture masters. Use full `render` after changing timing or layout. After sound edits, run `python3 scripts/audio.py` and `node scripts/remix.mjs`. Sound is normalized to a -20 LUFS target, with fades and peak control. Final export converts the renderer's full-range pictures to standard limited-range yuv420p for broad player compatibility.

For final static-path checks, serve the repository locally and run `node scripts/production.mjs` (`LEXICUE_STATIC_URL` overrides the default `http://127.0.0.1:4190/docs/`). The compatibility entries `scripts/qa.mjs` and `scripts/production.mjs` both run the current experience/manual checks; one `npm run test:ui` run is enough. Run `node scripts/verify-videos.mjs` to check all final MP4s and generate full-duration contact sheets. `node scripts/delivery.mjs` generates the local delivery index, publishing copy, original SRT and provenance manifest.

## Publishing

This workflow never pushes Git commits, deploys, or uploads a video. Publish the changed `docs/` and README files yourself. Use the chapter list and attribution in the local delivery's `PUBLISHING.md` for Bilibili or other platforms. See [asset licenses](ASSET-LICENSES.md) before publishing.

Large videos, audio mixes and frame intermediates are ignored by Git. `public/audio`, renderer caches, generated CSS and dependency folders are also ignored. Lightweight website/README assets and source remain tracked.

Current renders use macOS system fonts (PingFang SC and Hiragino among others). To match them exactly, use the same installed fonts. Other platforms will use their system sans-serif fallback.

## Interactive experience

The homepage keeps five product modules in a fixed 695px window. `HomePosition.ts` restores current-tab page and inner scroll positions. Navbar language changes update both the website and sample; the sample’s own language/theme settings remain independent until the next navbar language selection. Homepage tips, lookup drawers, review records, backups and reset are managed separately from documentation.

`DemoSession` uses current-tab storage. `migrateSession` upgrades the earlier sample filenames to SRT while retaining file IDs, tags, status, selected module and review position. Corrupt snapshots reset safely. Builds write the seven original, timed SRT files into `samples/` and `docs/media/samples/`. All current sample files use SRT; old extensions occur only in compatibility code and tests.

Run `test:ui`, `test:home`, `test:contrast`, `test:states`, `test:drawers` and `test:locales` for affected homepage behavior. `Scene` retains the existing video/GIF composition defaults; the homepage does not mount it.

## Standard product documentation

`src/manual-content.mjs` is the shared four-language source for the installed-product guide. Stable chapter and section IDs power translated routes and links. `manual-render.mjs` renders the same complete text, steps and figures for React and static no-JavaScript pages. `ManualPage` adds a native, keyboard-accessible screenshot lightbox. Guide pages have no sample app, automatic animation or sample-session writes.

English routes use `/guide/<chapter>/`; other languages use `/<locale>/guide/<chapter>/`. A repository preview prefixes them with `/docs/`. Navbar language links retain the chapter and section. Public navigation includes online experience, user guide, download and author support on every page.

The guide covers all nine installed settings; the online sample keeps its four selected settings. `ManualCapture.tsx` and `capture-adapter.ts` provide an isolated screenshot route. Installed settings and file/tag screenshots use actual product components; lookup/review/statistics screenshots use the existing component adapter. Native writes and connections are blocked. The capture renders both ocean and midnight with fixed sample data, without numbered overlays. No user library is accessed.

```sh
npm run build
npm run assets:guide
npm run build
npm run check
npm test
npm run test:manual
```

The screenshot generator uses Chrome and Sharp and updates `src/guide-image-sizes.json`. Set `LEXICUE_GUIDE_CHAPTERS=settings` for a limited refresh. `test:manual` checks all four languages at 390/768/1440px in ocean/midnight, static content, anchors, image enlargement, support/navigation links and sample-state preservation. Its report is saved to `../output/marketing/qa/manual/report.json`.

## SRT-only publicity updates

All import claims use SRT. YouTube is a separate subtitle source, not a file format. Keep `catalogue.mjs`, README generation, documentation, sample filenames, published images and video descriptions consistent.

```sh
node scripts/readmes.mjs
npm run build
npm run assets:import
LEXICUE_REFRESH_SCENES=import node scripts/refresh-scenes.mjs
node scripts/verify-videos.mjs
node scripts/delivery.mjs
```

`assets:import` changes only the four import illustrations. The scene refresh replaces the affected sequence in all four horizontal/vertical MP4 variants while retaining audio, durations and other scenes. Do not run the full assets command for this correction: the lookup/phrase/review GIFs and video covers do not need changes. Full renders remain available when the timeline or layout changes.

## 宣传视频改版预览（独立于官网）

运行 `npm --prefix marketing run preview:video`，然后通过现有静态服务器打开 `/output/marketing/video-preview/`。预览提供 76 秒横版与 28 秒竖版、播放／暂停／重播、分镜跳转和配乐试听。它不会更新 `docs/` 或覆盖既有 MP4。

- `src/video-revision.mjs`：独立分镜、中文字幕和作者介绍。横版作者片尾为 68–76 秒，竖版为 24–28 秒。
- `src/video-snapshot.mjs`：按帧确定样例状态，查词、标签和评分结果均可重播。
- `scripts/video-fixture.mjs`：从已确认的 `Sandbox.tsx` 生成只读的 `generated/VideoSandbox.tsx`，阻止存储与原视图效果；不要直接编辑生成文件。源码结构变化时，适配器会报错提示更新。
- `src/RevisedVideo.tsx`：新版横竖构图、按实际控件位置计算的点击光标、查词抽屉／底部弹层及作者片尾。
- `src/video-revision-entry.tsx`：正式 Remotion 合成入口（RevisedHorizontal / RevisedVertical）；当前正式视频的合成入口。旧 `video.tsx` 及其导出流程保持原样。
- `public/author/skylar-github.png`：作者明确要求加入的公开 GitHub 头像；来源 https://avatars.githubusercontent.com/u/173658591?s=512&v=4，主页 https://github.com/skylar-deepmind。作者介绍使用已确认的「Skylar · LexiCue 作者｜欢迎关注我的 GitHub，发现更多开源项目」。不使用关注数或其他项目的宣传数据。

浏览器检查：`npm --prefix marketing run test:video-preview`，通过 Chrome 验证两个画幅、所有分镜、SRT 口径、五项导航、抽屉方向、点击目标、头像链接和不同尺寸的预览控制；截图和报告写入 `output/marketing/video-preview/`。构建预览会重建该目录，请在构建之后运行检查。

预览配乐沿用现有的 Carefree（Kevin MacLeod，CC BY 4.0），来源与署名见既有 `output/marketing/ASSET-LICENSES.md`。预览音轨仅含配乐，不沿用旧时间轴的点击音效。正式导出时需按新点击时点重建轻音效、更新字幕与发布说明，再做完整音画检查。

本轮视频视觉调整：语言与主题位于倒数第二段（横版 60–68 秒，竖版 20–24 秒），按 ocean → sage → amber → twilight → midnight 展示；此前所有分镜保持 ocean。彩色切换使用按帧插值，语义主题变量直接从产品与宣传样式生成到 `generated/video-theme-tokens.mjs`。

片尾使用白色与 midnight 两层相同内容，由 `closingBoundary()` 按帧计算遮罩：从全白进入半白半黑，约 1.5 秒后分界线缓慢波动，直到结束。横版左右分色，竖版上下分色；两个遮罩层使文字在两种背景下均保持对应的主题颜色。预览已确认并导出新版成片；原成片与网站保持现状。

## 新版正式视频交付

最终节奏为横版 76 秒、竖版 28 秒。主要缩短开场、文件整理和统计的停留，保留横版 8 秒主题展示／8 秒作者片尾，以及竖版 4 秒主题展示／4 秒作者片尾。

在仓库执行以下命令重新导出（需 Chrome、FFmpeg 与 Python 3）：

```sh
npm --prefix marketing run preview:video
npm --prefix marketing run render:video-final
npm --prefix marketing run check:video-final
npm --prefix marketing run deliver:video-final
```

成品写入 `output/marketing/video-final/`，不会覆盖官网、README 或之前的 90／30 秒视频。两个画幅各有中文字幕版、去除底部讲解字幕版、SRT 和封面；`masters/` 保存本地高质量原始渲染与混合音轨。正式视频入口为该目录的 `index.html`，投稿文案、章节时间与配乐署名见 `PUBLISHING.md`，验证报告见 `qa/verification.json`。

`video-final.mjs` 从当前分镜计算音效时间，将合成点击音按实际操作点对齐并重新混音。所有视频为 30 fps、H.264、yuv420p、AAC 48 kHz 双声道；验证包括精确帧数、音画时长、完整解码与全片联系表。旧 `render.mjs` 仍导出原分镜，请使用上述新版入口。
