# Third-Party Notices

LexiCue bundles derived data from several third-party projects. Each dataset is
compiled into the application binary via `include_bytes!` and imported into the
local database on first launch. The full license text for each dataset is
shipped with the application in `src-tauri/resources/`.

## Built-in dictionaries and data

| Data | Language | Source | License | License file |
| ---- | -------- | ------ | ------- | ------------ |
| ECDICT (English–Chinese) | en | https://github.com/skywind3000/ECDICT | MIT | `ECDICT-LICENSE.txt` |
| PhraseDict (English phrases) | en | https://kaikki.org/dictionary/English/pos-phrase/ | CC BY-SA 4.0 | `PHRASEDICT-LICENSE.txt` |
| JMdict (Japanese) | ja | https://www.edrdg.org/ | CC BY-SA 4.0 | `JMDICT-LICENSE.txt` |
| JMdict Idioms (Japanese 慣用句) | ja | https://github.com/scriptin/jmdict-simplified | CC BY-SA 4.0 | `JMDICT-LICENSE.txt` |
| CC-CEDICT (Chinese) | zh | https://www.mdbg.net/chinese/dictionary?page=cc-cedict | CC BY-SA 4.0 | `CC-CEDICT-LICENSE.txt` |
| German Wiktionary word forms & glosses | de | https://kaikki.org/dictionary/German/ | CC BY-SA 4.0 | `GERMAN-LICENSE.txt` |
| FrequencyWords (German frequency filter) | de | https://github.com/hermitdave/FrequencyWords | MIT | `GERMAN-LICENSE.txt` |
| English Wiktionary word forms | en | https://kaikki.org/dictionary/English/ | CC BY-SA 4.0 | `ENGLISH-LICENSE.txt` |
| FrequencyWords (English frequency filter) | en | https://github.com/hermitdave/FrequencyWords | MIT | `ENGLISH-LICENSE.txt` |

The German word-form and sense data is derived from the kaikki.org
machine-readable Wiktionary data extracted by Tatu Ylonen (wiktextract). The
resulting TSV files combine both Wiktionary-derived data (CC BY-SA 4.0) and the
FrequencyWords filter list (MIT). See `GERMAN-LICENSE.txt` for details.

The English word-form data (used to reduce surface forms like `books` or `went`
to their base lemma) is derived from the kaikki.org machine-readable Wiktionary
data, combined with the FrequencyWords filter list (MIT). See
`ENGLISH-LICENSE.txt` for details.

The PhraseDict data combines the original LexiCue phrase list with filtered data
from Kaikki's machine-readable English Wiktionary data. See
`PHRASEDICT-LICENSE.txt` for details.

## Third-party software

LexiCue is built on the following major open-source projects:

- [Tauri](https://tauri.app/) — MIT / Apache-2.0
- [React](https://react.dev/) — MIT
- [Vite](https://vite.dev/) — MIT
- [Tailwind CSS](https://tailwindcss.com/) — MIT
- [lindera](https://github.com/lindera-morphology/lindera) — MIT
- [jieba-rs](https://github.com/messense/jieba-rs) — MIT
- [rusqlite](https://github.com/rusqlite/rusqlite) — MIT
- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) — MIT

## Notes

- The built-in dictionary data may have been filtered, normalized or otherwise
  modified by the conversion scripts in `scripts/`. Check the source project's
  license before redistributing derived data.
- CC BY-SA 4.0 data requires attribution and share-alike when redistributed;
  this file and the bundled license files serve as the required attribution.
- If you redistribute LexiCue or parts of it, keep these notices and the
  license files intact.
