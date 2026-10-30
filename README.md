<p align="center"><img src="docs/lexicue-icon.png" width="88" alt="LexiCue"></p>
<h1 align="center">LexiCue</h1>
<p align="center"><strong>Read what you love. Remember the words.</strong></p>
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.de.md">Deutsch</a></p>

<p align="center">
  <a href="https://github.com/skylar-deepmind/LexiCue/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/skylar-deepmind/LexiCue?style=flat-square&color=2563eb"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-2563eb?style=flat-square"></a>
  <a href="https://github.com/skylar-deepmind/LexiCue/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/skylar-deepmind/LexiCue/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/skylar-deepmind/LexiCue/releases/latest"><img alt="macOS, Windows, Android" src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Android-526177?style=flat-square"></a>
  <a href="https://skylar-deepmind.github.io/LexiCue/#feature-languages"><img alt="English, Japanese, German, Chinese" src="https://img.shields.io/badge/languages-EN%20%7C%20JA%20%7C%20DE%20%7C%20ZH-526177?style=flat-square"></a>
</p>

<p align="center"><a href="https://github.com/skylar-deepmind/LexiCue/releases/latest"><strong>Download free</strong></a> · <a href="https://skylar-deepmind.github.io/LexiCue/">See it in action</a> · <a href="DISTRIBUTION.md">Installation guide</a></p>

[![Bring your own content](docs/media/demo/hero.gif)](https://skylar-deepmind.github.io/LexiCue/#feature-import)

## Learn from your own content

Import English documents and subtitles you enjoy. Look up words in their original sentences, collect vocabulary and remember it through review.

## A simple learning loop

1. **Import** — Bring content you enjoy.
2. **Read & understand** — Look up words in context.
3. **Collect** — Organize words and phrases.
4. **Review** — Let spaced repetition guide you.

## Watch the workflow

### Reading & lookup

[![Reading & lookup](docs/media/demo/lookup.gif)](https://skylar-deepmind.github.io/LexiCue/#feature-lookup)

Tap a word without leaving the sentence. Built-in offline dictionaries keep reading flowing.

### Context & phrases

[![Context & phrases](docs/media/demo/phrases.gif)](https://skylar-deepmind.github.io/LexiCue/#feature-phrases)

Optional AI identifies English expressions and explains their use in the original sentence. Gemma runs locally after a separate download.

### Review with original sentences

[![Review with original sentences](docs/media/demo/review.gif)](https://skylar-deepmind.github.io/LexiCue/#feature-review)

Review words and phrases with their original sentences. Your answers shape the spaced-repetition schedule.

> Demo scenes reuse product components with original sample data. AI results are fixed examples; sync is a process illustration.

## Features

- **[Bring your own content](https://skylar-deepmind.github.io/LexiCue/#feature-import)** — Import PDF (with a text layer), DOCX, EPUB, Markdown, TXT, SRT or VTT. Preview the full text and optionally choose PDF pages or EPUB chapters. YouTube subtitles can also be fetched from their source. Local files are parsed offline; request small batches of translations while reading. Complex layouts may be partially extracted, and OCR is not performed.
- **[A word away from understanding](https://skylar-deepmind.github.io/LexiCue/#feature-lookup)** — Tap a word without leaving the sentence. Built-in offline dictionaries keep reading flowing.
- **[Understand phrases in context](https://skylar-deepmind.github.io/LexiCue/#feature-phrases)** — Optional AI identifies English expressions and explains their use in the original sentence. Gemma runs locally after a separate download.
- **[Build a vocabulary you can trace](https://skylar-deepmind.github.io/LexiCue/#feature-collect)** — Filter, tag and mark words or phrases. Batch or one-at-a-time annotation keeps the original context within reach.
- **[Meet words again, at the right time](https://skylar-deepmind.github.io/LexiCue/#feature-review)** — Review words and phrases with their original sentences. Your answers shape the spaced-repetition schedule.
- **[See how far you have come](https://skylar-deepmind.github.io/LexiCue/#feature-progress)** — Track vocabulary states, seven-day reviews and each imported file’s learning index.
- **[Start from what you already know](https://skylar-deepmind.github.io/LexiCue/#feature-baseline)** — Optionally mark the top 1,000–10,000 English or Chinese words as known, then check a few in review.
- **[Four languages. Your way to read.](https://skylar-deepmind.github.io/LexiCue/#feature-languages)** — English, Japanese, German and Chinese. Kana, pinyin and word-form handling support reading; choose a light or midnight theme.
- **[Your learning stays with you](https://skylar-deepmind.github.io/LexiCue/#feature-privacy)** — Study records live locally. Export and restore backups. No account is needed for local learning.
- **[Continue across your devices](https://skylar-deepmind.github.io/LexiCue/#feature-sync)** — Optional end-to-end encrypted cloud sync connects desktop and phone. This animation illustrates the process.

## Download & install

Available for macOS, Windows and Android. Install the app, bring something you want to read, and begin.

[**Download free — macOS / Windows / Android**](https://github.com/skylar-deepmind/LexiCue/releases/latest)

Installers are unsigned. See the installation guide for first-launch instructions. Local Gemma models are downloaded separately. [Installation guide](DISTRIBUTION.md).

Gemma: [E2B / E4B](docs/embedded-gemma.md).

## Privacy & optional connections

Reading, dictionaries and reviews work locally. Downloading YouTube subtitles or AI models requires a connection. Optional cloud AI sends selected text to your configured API; optional cloud sync uploads encrypted learning records.

English read-aloud uses Microsoft's Edge online speech service by default. Only the English text you ask to hear and the chosen voice settings are sent; validated audio is cached on your device, separately from learning records and backups. Settings → English read-aloud lets you choose US/UK voices and speed, turn off online requests, and disable the explicitly labelled device-voice fallback. Cached speech remains available offline. This third-party service can change or become unavailable; no Azure key, Edge installation, or separate Python/Node runtime is required.

## Support the project

[Support the author — 爱发电 / Aifadian](https://www.ifdian.net/a/skylar-lexicue) · [GitHub Star](https://github.com/skylar-deepmind/LexiCue)

## Development

Node.js 22.12+ · Rust · CMake 3.22+ · C++17. [Gemma](docs/embedded-gemma.md).

```sh
npm install
npm run tauri dev
npm run build
npm test
cd src-tauri && cargo test
```

[Marketing / README / Website / Video](marketing/README.md)

## License

[MIT](LICENSE) · [Third-party notices](THIRD-PARTY-NOTICES.md) · [Dictionary packs](DICTIONARY_PACK.md)

### Online dictionary content attribution

Optional English fallback definitions and ordinary examples are adapted from
[Wiktionary contributors](https://en.wiktionary.org/) via
[FreeDictionaryAPI.com](https://freedictionaryapi.com/), under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Each displayed or saved excerpt retains the API-reported original Wiktionary entry
link, retrieval time, attribution, license, and adaptation notice. LexiCue omits
translations, quotations, and dictionary audio from this source and preserves
necessary parent-sense context. This content license applies to the attributed
dictionary excerpts, not the user's original reading material or personal notes;
the application's software license remains separate. A future download or
distribution page must retain this API and content attribution.

New Wiktionary references require a client containing the FreeDictionaryAPI V1
reader. The saved-record wire version remains compatible with existing Longman,
known Cambridge adapters, and records without references. Older clients are not
promised to recognize the new provider; unsupported references must fail
validation rather than be silently removed. No migration rewrites old records.
