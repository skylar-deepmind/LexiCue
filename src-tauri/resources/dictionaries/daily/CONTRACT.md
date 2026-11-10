# Tiered English Wiktionary runtime packages v2

The default is **日常通识 / Everyday & General** (`daily`). Optional supplements
are **进阶阅读 / Extended Reading** (`extended`) and **专业参考 / Specialist
Reference** (`specialist`). Only `daily` is marked bundled in `catalog.json`.
No downloader, native adapter or application UI is implemented by this change.
Download URLs remain null until a separately authorized hosting/release step.

## Coverage policy

This is a product selection policy, not a measurement of every native speaker's
vocabulary. The baseline is broader than elementary learner essentials. Common
health, arts, work, public affairs, school science and contemporary technology
are deliberately represented: pneumonia, eczema, chemotherapy, monologue,
soliloquy, mortgage, photosynthesis, quark and modern AI vocabulary are examples.

Selection is per **substantive source sense**, not just per spelling. Familiar
words keep general senses in `daily`; narrow subject senses can go to
`specialist`, and archaic/rare senses to `extended`. The same headword/source
record may therefore occur in several packs. Each original sense is owned by
exactly one pack, with its full ancestor chain, qualifiers and verified examples.
Installing all three reconstructs the complete audited sense set without
creating new definitions. There is no generated translation or new dictionary
content from a different publisher.

Executable rules and review vocabulary are in `tier-policy.json`:

- Exact English token-frequency bins from wordfreq 3.1.1 are a selection signal.
  Zipf >= 2.80 admits a general token; frequent explicit forms/aliases can promote
  the underlying record. These statistics describe usage through about 2021,
  so modern and general-familiarity supplements are separate, explicit lists.
- Closed grammatical parts of speech are protected. Numerals and interjections
  do not get an unconditional exemption that would admit arbitrary rare forms.
- For unlisted compounds, every component must be familiar **and** the source
  must have at least two distinct recent quotation references in different
  years, with the latest at least 2000. Only aggregate reference/year counts
  are retained. This is evidence of establishment, not population phrase
  frequency or rights clearance. Individual component words alone are not enough.
- Familiar short phrasal verbs and an explicit list of common expressions are
  protected separately. Supplement lists are reviewable domain vocabulary,
  not a whitelist silently derived from test misses.
- Explicit familiar lookup forms also protect their source-confirmed expanded
  targets (e.g. chickenpox → chicken pox and RNA → ribonucleic acid), regardless
  of the expanded target’s own frequency.
- Rare/archaic source tags move the sense to `extended`. Narrow subject tags
  move it to `specialist`, except explicit general-familiarity vocabulary.
  For less frequent words, broad subject labels and conservative definition/
  morphology clues identify technical terms even when upstream topics are absent.
- `historical` alone describes a referent, not word rarity: familiar historical
  concepts retain that label in the daily pack. Archaic/obsolete/dated/rare senses
  remain optional.
- Non-Latin-only notation and explicitly Braille senses are specialist material,
  even when a familiar ordinary spelling is linked.
- Historical/technical ancestor context is never deleted to make a selected
  child look general. Raw gloss chains and labels remain present.

Frequency statistics and aggregate attestations never supply definitions or
examples. All linguistic text comes from the previously source-verified English
Wiktionary extraction. The original positive ordinary-template admission and
cross-quotation exclusions still apply unchanged. See POLICY.md for that audit
policy; it describes the full audit source, not v2's narrower default selection.

Some rare spellings and inflections of familiar lemmas remain resolvable aliases.
They are not substantive headwords and are not included in the headword count.
An alias always ends at actual content present in its runtime pack; a surface
metadata row alone is never a definition hit. Missing common expressions remain
explicit misses. In particular, this fixed input lacks one-man show / one-person
show; monologue and soliloquy provide available related dramatic vocabulary,
without pretending to be an exact lookup for the missing expression.

## Compact runtime schema

`dictionary.sqlite3` has application ID 1280857155, `user_version=2`.
The exact DDL is `schema.sql`; the reference reader is `build_tiers.py lookup`.

| Table | Contract |
| --- | --- |
| `metadata` | Canonical JSON values: provider, dataset, release, adapter, pack ID, codec, language, default-bundle flag, audit input hash and selection policy hash. |
| `surfaces` | Original-case word and NFC/whitespace/casefold candidate index. Exact case is tried across installed packs before folded fallback. Shared by headwords and aliases. |
| `pages` | Original page ID, revision ID and raw 32-byte wikitext SHA-256 for a substantive headword. Source URL is deterministically `https://en.wiktionary.org/wiki/` plus percent-encoded original headword with spaces represented by underscores. |
| `entries` | Primary key is the **original one-based raw extraction line**. Source POS and etymology occurrence are separate; `body` is bounded `zlib-json-v1`, described below. Every row has substantive senses. |
| `aliases` | Exact source surface, substantive target entry line, relation kind enum and pooled source origin. Every target is local and nonempty; no cross-file unresolved alias is counted as a hit. |
| `origins`, `labels`, `confirmations` | Shared numeric source locators, qualifier metadata and positive source-template target confirmations. The 1.13 GB audit database retains complete path evidence; runtime packs retain sufficient source locators and the audit hash rather than duplicating each path JSON. |
| `surface_records` | Original query-surface IPA/forms/verified relation examples, with source line, POS and revision. These rows do not create successful lookups without actual substantive entries. |

A body is a zlib stream containing UTF-8 canonical JSON. Readers must enforce the
manifest's **8 MiB maximum decompressed record**, reject trailing streams and
invalid JSON, and validate the version before decoding. The reference decoder
uses a bounded streaming decompressor. It does not decompress the whole database.
SQLite provides direct indexed word lookup; only matching records are decoded.
The future Rust adapter can use the app's existing flate2 dependency.

An entry body contains `senses`, `pronunciations`, `forms`, and entry `labels`.
Each sense contains original `ordinal`, English leaf `definition`, full ordered
`ancestors` with raw parent qualifiers, full `raw_gloss_path`, source labels,
source sense identifiers and admitted `examples`. Examples retain source
revision, source wikitext line, template, labels and original example ordinal.
The cleaned full gloss path is derived from ancestor definitions plus the leaf;
it is not redundantly stored three times. No sense text is shortened or rewritten.

Stable runtime identity: `wiktionary:enwiktionary-20261001-lexicue-v2:rL:sN`.
The identity remains the same across the three packs. Entries use `:rL` and
preserve source POS/etymology. Merge installed results by source entry line and
sense ordinal; do not merge unrelated etymologies or match labels by list index.
Original source paths are `/records/L/senses/N`. English `meaning.zh` and example
Chinese text remain null in a future application adapter.

Alias kinds: 1 `form_of`, 2 `alt_of`, 3 `headword_form`, 4 `mediawiki_redirect`.
Origins store the first step's raw source line / original sense ordinal, labels
and any source-confirmed corrected endpoint. Full ordered path evidence can be
recovered from the exact audit database hash using surface, target line and kind.
Do not present a folded candidate as exact, or delete prepositions to infer a hit.

Query all installed packs first for exact surfaces, then fall back to folded
candidates only when no installed pack has an exact substantive match. Return
all direct and explicit-relation results; retain original spelling and source
metadata. Aggregate each record's available senses across installed packs,
deduplicated by stable source line and ordinal. Results must be independent of
pack file argument order. Files from different releases must be rejected.

The versioned provider is `wiktionary`, dataset `English Wiktionary`, adapter
`wiktionary-local-v2.0.0`. Existing online FreeDictionaryAPI and Longman validators
must not be impersonated. Offline saved excerpts need the leaf plus ancestor
context, labels, examples, original source/revision, license, attribution,
modification notice and runtime release. Old stored excerpts remain unchanged
when optional packs are added or removed.

## Build and verify

Use the existing v1 audit builder to produce the SHA-pinned full audit database
from raw Wiktionary input. That audit is a developer artifact and is **not** an
application install dependency. Then prepare selection inputs:

```sh
# A separate venv is recommended; extraction preparation only.
python -m pip install msgpack==1.1.2
python scripts/dictionary/extract_frequency.py wordfreq-3.1.1-py3-none-any.whl frequency-en.json.gz
python scripts/dictionary/extract_attestations.py raw-wiktextract-data.jsonl.gz phrase-attestations.json.gz

python3 scripts/dictionary/build_tiers.py build \
  --audit /absolute/audit/dictionary.sqlite3 \
  --frequency /absolute/inputs/frequency-en.json.gz \
  --attestations /absolute/inputs/phrase-attestations.json.gz \
  --output /absolute/fresh/task/packages
python3 scripts/dictionary/build_tiers.py validate \
  --audit /absolute/audit/dictionary.sqlite3 --output /absolute/fresh/task/packages
python3 scripts/dictionary/build_tiers.py pack --output /absolute/fresh/task/packages
python3 scripts/dictionary/build_tiers.py lookup --output /absolute/fresh/task/packages \
  --packs daily --query pneumonia
python3 scripts/dictionary/build_tiers.py lookup --output /absolute/fresh/task/packages \
  --packs daily extended specialist --query field
```

`frequency.lock.json` pins the frequency wheel, English member, extracted signal
hash and upstream notice revision. `tier-policy.json` pins attestation statistics
and the full audit SQLite. The audit database is reconstructible from the fixed
raw input using its recorded Python/SQLite/zlib toolchain; exact bytes can vary
with a different SQLite version. The tier builder fails closed on hash changes.
Use fresh output paths, preserve the raw cache, and never silently substitute new
input versions or change hashes to bypass validation.

Three installable ZIPs contain only the compact runtime database, schema,
manifest and attribution/contract documents. A separate build-review ZIP contains
scripts, selection rules, per-sense assignment reasons and quality evidence.
The frequency wheel and full audit database do not inflate the installed daily
pack. The catalog binds ZIP and database byte counts and SHA-256 hashes, and the
bundled flag. Optional packs are separate downloads, not copies of the base pack.

The hard daily database budget is **150,000,000 bytes**, with a 100,000,000-byte
target. The build fails before packaging if the hard budget is exceeded. Report
actual ZIP bytes separately from extracted SQLite bytes. A future installer
should use one runtime copy, release temporary ZIPs after verified activation,
and avoid copying the same database into the user library unnecessarily.
No installed-device footprint or native download/save/sync behavior is claimed
until the application integration task tests it.
