# Build and review the English Wiktionary package

Current distribution uses the compact v2 packages: **日常通识** (default), **进阶阅读**, and **专业参考**. See [TIERS.md](TIERS.md) and [TIER-VALIDATION.md](TIER-VALIDATION.md). The original builder below now creates the full **developer audit input**, not an application install dependency.

Read POLICY.md and CONTRACT.md before redistribution or app integration.
Python 3.10+ (standard library), curl and ~8–12 GiB task space suffice; preserve
at least 10 GiB free disk. Inputs are ~5.1 GB compressed. Never unpack the full
all-language JSONL or full XML. The build checks free/task space every 5 seconds,
uses streaming decompressors and disk-backed source/graph indexes, and does not
access the user's LexiCue database.

From a repository checkout:

```sh
python3 -m unittest discover -s tests/dictionary -v
python3 scripts/dictionary/build_pack.py all \
  --inputs /absolute/task/inputs --output /absolute/task/package
python3 scripts/dictionary/validate_pack.py verify-zip \
  --output /absolute/task/enwiktionary-20261001-lexicue-v1.zip
```

From an extracted distribution ZIP, run the same scripts in its root; the query
and corpus fixture filenames are also in that root. Use a **new empty output**
directory. The source audit is a sibling of the input directory and can resume
completed, hash-matching XML shards. If a build fails after output creation,
inspect and retain the failed artifacts before selecting a fresh output path;
the builder refuses to overwrite an existing dictionary. The source audit can be reused; graph tables are rebuilt from pinned raw input
for every new output. Do not run two builds against one staging database.

Individual phases: `download`, `audit`, `build`, `lookup`, `pack` in build_pack.py;
`validate`, `verify-zip`, `capture-corpora` in validate_pack.py. `pack` requires a
passing, current quality report; it bundles documentation, script and fixture
copies, schema and license. The final report includes counts, every query's
outcome, true misses, example exclusions and source problems.

Download URLs for Kaikki's raw extraction are mutable. The lock rejects changed
bytes; **do not update hashes just to make a failing build pass**. Preserve the
compressed input cache for long-term reconstruction. Wikimedia paths include
the dump date and are also verified against the publisher's SHA-1 and local
SHA-256. Exact Wiktextract producer commit/command is unavailable; this workflow
reproduces conversion from the audited input, not independent upstream parsing.
For a future version, audit a fresh source snapshot and use a new release ID.

Determinism: fixed record/source order, canonical JSON, explicit indexes, ZIP
member order/timestamps/permissions and compression. Bit-for-bit SQLite/ZIP
reproduction additionally requires matching recorded Python, SQLite and zlib
versions. Input bytes, scripts and source lock are hashed in the package.

Coverage fixtures reuse the prior 57 words, 40 expressions, 20 functional words,
10 modern terms and 10 inflections; add 50 modern terms, 30 inflections and case
homographs. The reading fixtures contain token frequencies and source/text
hashes for downloaded Pride and Prejudice, Python tutorial and NASA evidence
pages. They contain no imported dictionary definitions or copied reading
paragraphs. This is directed and surface-level coverage, not an overall accuracy
claim. `capture-corpora` documents tokenization and enables recapture from saved
source downloads; refreshing a changing webpage is a new fixture version.

No application UI, installer integration, generic dictionary importer, release
publication, merge or branch deletion is performed by these scripts.
