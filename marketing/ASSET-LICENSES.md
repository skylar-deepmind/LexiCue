# Asset provenance

## Product and sample content

LexiCue logo and product components: this repository. Product code remains under the repository MIT license. Original marketing copy, three-sentence subtitle excerpt, demo definitions, animations, generated screenshots and synthesized UI sounds were created for this project. Dictionary entries in these demos are **original sample definitions**, not excerpts copied from third-party dictionaries. No personal library data is used.

## Music — required attribution

“Carefree” by Kevin MacLeod (incompetech.com)

Licensed under Creative Commons Attribution 4.0 International:
https://creativecommons.org/licenses/by/4.0/

Source and current license statement: https://incompetech.com/music/royalty-free/index.html?gt=&isrc=USUAN1400037

Official audio: https://incompetech.com/music/royalty-free/mp3-royaltyfree/Carefree.mp3

Changes: excerpts of 90 / 30 seconds, reduced volume, fades, and mixed original UI sounds. Put the attribution above in the platform description when publishing, including clean video versions. A brief credit also appears at the end of each video.

## Libraries and typography

- React, Lucide, Vite and application components retain their upstream licenses.
- Remotion 4.0.534: https://github.com/remotion-dev/remotion/blob/main/LICENSE.md — the free license applies to individual use. This dependency is not relicensed under MIT.
- Typography uses installed system fonts. No Apple font files are redistributed. The rendering machine and fonts are recorded in the delivery notes; exact glyph rendering requires the same fonts.

The marketing site does not load remote font services or music. Music is used only in the local video export.

## Product overview photography and feature details

The optical-glass photograph in `docs/media/keynote/context.webp` was generated for the LexiCue website.

The animated WebP files in `docs/media/keynote/motion/` record the application built from main commit `ef572e2da66c6d1ecb91360a6960cea746b4492c` importing a bilingual sample, looking up a word, entering listening mode, saving a sentence and retrieving it in another article. Each recording uses a fresh browser demo session and a visible pointer. All four interface languages have phone and desktop layouts in both themes.

The opt-in reading sample in `docs/media/keynote/quiet-morning.wav` speaks the original sentence “A quiet morning is a good time to read.” It was synthesized with en-US-JennyNeural, a voice supported by the app, and packaged as PCM for local playback.
