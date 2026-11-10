# LexiCue local English Wiktionary package contract v1

Historical **full audit schema v1**. The current compact runtime and multi-pack contract is [TIERS.md](TIERS.md), schema v2. This audit format remains available for provenance and reproducible source processing.

Package ID `lexicue.wiktionary.en`; release `enwiktionary-20261001-lexicue-v1`;
SQLite `user_version=1`, `application_id=1280857155` (hex `0x4c585443`).
Provider **`wiktionary`**, dataset **`English Wiktionary`**, adapter identity
**`wiktionary-local-v1.0.0`**. Never represent this data as Longman/LDOCE6EC,
Cambridge, or the existing `freedictionaryapi-v1.0.0` online adapter.

## Delivery and integrity

The ZIP has flat relative filenames only, one manifest, a structured
`dictionary.sqlite3`, full CC BY-SA 4.0 legal code, attribution and modifications,
source input lock, schema, reproducible scripts, directed queries, corpus token
fixtures and quality/sample evidence. `manifest.json` lists the SHA-256 and bytes
of every member except itself. The ZIP SHA-256 is in an adjacent checksums JSON
(the archive cannot hash itself). Verify both before installation. No user-data
SQLite database is read or modified by these scripts.

Open the database read-only. Installation in a future app should first verify
identity, version, all member hashes, SQLite integrity and foreign keys in a
staging directory, then atomically activate the complete package. A failed
activation keeps the previous valid package. Package authenticity/signing and
installer integration are outside this data-only change.

## Tables and identities

`schema.sql` is the exact DDL. Text is UTF-8. JSON columns are UTF-8 JSON, not
translated strings. Foreign keys express entry/sense/example ownership.

| Table | Meaning and important fields |
| --- | --- |
| `metadata` | Provider, language, dataset, release, adapter, license and modification summary. |
| `entries` | One source record (one POS/etymology occurrence), `id` integer internal key, original-case `headword`, NFC/whitespace `folded` auxiliary key, original Wiktextract `pos`, `etymology_number`, one-based raw JSONL `source_line`, original `page_id`, `revision`, `source_url`, full source page `wikitext_sha256`, entry labels. Multiple records may share a spelling/POS; do not merge them by spelling alone. |
| `senses` | Stable release-scoped `id`, owning `entry_id`, zero-based source `ordinal`, leaf English `definition`, ordered `ancestors_json` (depth, definition and raw qualifier-bearing gloss), complete cleaned `gloss_path_json`, complete `raw_gloss_path_json`, labels, source sense identifiers, source path `/records/L/senses/N`. A leaf never replaces its ancestors. |
| `examples` | Owning `sense_id`, English `text`, positive source-template name, revision and one-based wikitext line; never audio or quoted publication text. Match evidence survives offline. |
| `pronunciations` | Entry and ordinal, `notation` (`ipa`, `enpr`, `enPR`, or source `other`), original `text`, full source tags/qualifiers. No media URL/file. Do not label enPR as IPA. |
| `forms` | Original form text and tags for each entry. Morphological labels are not examples or definitions. |
| `relation_examples` | Positive ordinary-template examples on relation senses, linked to a source relation record and original source sense ordinal; never substantive definitions. |
| `relation_records` | Pronunciation and form metadata from relation-only source records, with original headword/POS/raw line/revision. These rows and their separately linked examples are never definitions or hits; query results expose them in `surface_records` separately from substantive targets. This retains the IPA of US itself while definitions come from United States. |
| `aliases` | Source-case `surface`, auxiliary folded surface, substantive `target_entry`, relation kind, ordered `path_json`. Each path carries exact endpoints and source evidence, including raw line/sense or form ordinal, labels or the frozen MediaWiki redirect. Source-confirmed target corrections additionally carry the original extracted target, same-sense link, source relation template, revision and wikitext line. Every executable alias ends at an entry with substantive senses. |
| `redirects` | Candidate same-version mainspace local MediaWiki redirect index: source, target, original fragment and source URL. Some targets are absent/not English/removed by selection; **do not query this table as executable successful matches**. Use `aliases` for verified resolution. |

Release-scoped stable entry identity is
`wiktionary:enwiktionary-20261001-lexicue-v1:rL`; group identity appends `:group`;
sense identity appends `:sN`, example identity appends `:eN`. Numeric SQLite entry
IDs are internal and must not be persisted across releases. Raw line numbers and
source paths refer to the exact SHA-pinned all-language extraction, not a newly
sorted JSONL file. Source sense IDs may be absent and are not used as unique keys.

## Lookup semantics

The Python `lookup` command is the executable read-only reference. It returns a
versioned-by-package local query object (`requested_form`, `normalization`,
`entries`, `surface_records`) with entry/POS/source/senses/examples and evidence paths. It is an
**intermediate contract**, not a currently accepted Dictionary Result V1 payload.

1. Normalize query whitespace and NFC. Query both `entries.headword` and
   `aliases.surface` with exact case. Return direct substantive entries and
   valid explicit relation targets together; a rare noun homograph must not
   hide the verb of `ran → run`.
2. Only when neither exact-case direct records nor aliases exist, use casefold
   indexes. Label the results `casefold_candidates`; preserve every source
   headword and do not call the result an exact match. Disambiguation by reading
   context/POS remains an app responsibility. `us` must not return `US` merely
   because an auxiliary index lowercases both.
3. Relation matching preserves compatible POS where supplied. MediaWiki redirects
   have no POS and may return all retained target POS records. Redirect fragments
   are evidence only; v1 does not implement fragment-to-sense targeting.
4. No target with zero substantive senses is a hit. All relation paths are at
   most 16 edges; cycles, dead ends and out-of-package targets are omitted from
   executable aliases and reported. Do not remove a trailing preposition to
   manufacture a match. `pay attention to` is allowed to miss while `pay
   attention` is a separate real entry.

Example:

```sh
python3 scripts/dictionary/build_pack.py lookup \
  --inputs /absolute/task/inputs --output /absolute/task/package \
  --query 'get along with'
```

Full real outputs are in `sample-entries.json`, including misses, modern words,
case homographs, nested senses and relation paths.

## Mapping into the application later

The current application already has entry → POS group → sense → examples and
ancestor support. Map records to separate entries/groups; preserve source POS
and etymology occurrence. Map the leaf to `meaning.en`, set `meaning.zh=null`,
retain ancestor order and qualifier-bearing raw context, and map each ordinary
example to `english` with `chinese=null`. Preserve tags losslessly, even if the
current five label kinds cannot express every topic. Do not silently map every
unknown tag to a region. IPA/enPR need different display labels. No audio is
available. Pure relation glosses stay relation evidence, never selectable senses. Associate surface metadata with the matching path’s `evidence.source_line` and source POS; do not mix the adjective example “The radio is US” into the country initialism merely because both spellings are US. Preserve relation-only surface pronunciations separately from the matched target’s pronunciation.

New source metadata must include provider/dataset/release/adapter/entry key,
original source page and revision locator, CC BY-SA 4.0 license URL, attribution,
modification summary and content/source path hashes. An offline excerpt should
carry the selected leaf **plus all its ancestor context**, labels, examples and
attribution. A later package update must not rewrite stored old excerpts.

**Existing validators require an explicit integration change.** In baseline
`aae6c141`, `dictionary-result-v1.schema.json`, `free_dictionary::valid_source`
and `saved::validate_wiktionary_snapshot` accept Wiktionary only through the
online FreeDictionaryAPI identity and `/entries/...` source paths. They will
reject this local adapter's release, metadata and `/records/...` paths. Do not
satisfy those validators by lying about the online service or omitting required
local attribution. Add a separately scoped local provider branch and snapshot
validation tests during app integration. No runtime validator or product UI is
changed by this package task. Native installation, offline lookups, save/export
round trips and cross-device compatibility remain unverified until that work.
