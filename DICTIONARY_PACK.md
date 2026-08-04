# Offline Dictionary Pack

LexiCue can import a JSON dictionary pack from the Files page. The pack is merged into the local SQLite cache and is available without a network connection.

LexiCue also includes a compact ECDICT-derived core dictionary. It is loaded into
the local database on first launch and provides Chinese translations and phonetics
offline. The included data is distributed under the MIT license; see
`src-tauri/resources/ECDICT-LICENSE.txt`.

For Chinese learning, LexiCue bundles a CC-CEDICT-derived dictionary (simplified
and traditional lookup, pinyin readings and English definitions). It is distributed
under the CC BY-SA 4.0 license; see `src-tauri/resources/CC-CEDICT-LICENSE.txt`.

LexiCue also bundles dictionaries for Japanese (JMdict, CC BY-SA 4.0) and German
(Wiktionary-derived data, CC BY-SA 4.0). For the complete list of built-in data,
sources and licenses, see `THIRD-PARTY-NOTICES.md`.

```json
{
  "manifest": {
    "name": "Example English Pack",
    "version": "1.0.0",
    "license": "CC BY-SA 4.0",
    "source": "https://example.org",
    "language": "en"
  },
  "entries": [
    {
      "lemma": "example",
      "language": "en",
      "provider": "Example English Pack",
      "phonetic": "/\u026a\u0261\u02c8z\u0251\u02d0mp\u0259l/",
      "definitions": [
        {
          "part_of_speech": "noun",
          "definition": "A representative instance or model.",
          "translation": "例子；实例",
          "example": "This is a good example of clear writing."
        }
      ],
      "audio_base64": ""
    }
  ]
}
```

`audio_base64` is optional. When present, it must contain MP3 bytes encoded as Base64. The audio is stored in the app data directory and can be played offline.

The application also ships built-in dictionary data derived from third-party
sources. Check the source license before importing, redistributing or deriving
from a pack, and keep the source and license fields in the manifest.
