# App integration of the v2 dictionary packs

The application reads the SHA-pinned v2 Wiktionary packs. `daily` is bundled;
`extended` and `specialist` are independent optional installations. The 1.13 GB
audit database, frequency wheel and review ZIP are developer inputs and never
application resources. See [TIER-VALIDATION.md](TIER-VALIDATION.md) for the frozen
dataset, selection limits, source gaps, attribution and measured database sizes.

## Lookup and saved data

- Reading lookup uses `lookup_local_expression`. Word, phrase and older reading
  command shapes also resolve their live local dictionary content through the
  same installed-pack reader. Old dictionaries and caches are not fallbacks.
- SQLite files are opened read-only, without importing their entries into
  `lexicue.db`. Queries try exact spelling across all installed packs before
  Unicode casefold candidates. The casefold table is pinned to the extraction
  toolchain. No prepositions are deleted and no unsupported lemma is guessed.
- Source records and original sense ordinals give stable IDs. A record shared
  across packs merges by those IDs, not by list position. Source POS is preserved
  alongside its normalized display category. Ancestor context, labels, ordinary
  examples, original page/revision, raw source hash and license remain available.
- The local adapter is `wiktionary-local-v2.0.0`, separately validated from
  `freedictionaryapi-v1.0.0`. It never presents local content as an online result.
  Existing Cambridge/FreeDictionaryAPI request sequencing, timeouts, cache and
  online source adapters remain unchanged. The UI keeps local and online
  Wiktionary in distinct source slots.
- Source revision/page are optional extensions to serialized saved metadata.
  Older records omit them unchanged. New frozen references validate independently
  of installation state, so removing an optional pack does not delete or change
  saved contexts, personal notes, dictionary excerpts, backups or sync payloads.
- Historical dictionary tables and archive/recall compatibility code remain for
  existing data. They are not registered as live Longman lookup commands. Legacy
  resource importers and UniDic embedding are restricted to regression tests;
  English morphology data still serves the English reading pipeline.

## Bundling and measured scope

The bundled `daily/dictionary.sqlite3` is **60,694,528 bytes**. The build script
verifies every manifest member and its SHA-256 and rejects missing or altered
resources before an installer can be produced. Byte-pinned resources bypass Git
line-ending conversion. macOS, Windows, Linux and iOS read the bundled SQLite
in place, without an additional library copy.

Android packages resources as asset URIs, which cannot be opened directly by
SQLite. The native FS plugin materializes one verified base database in app
storage. Its APK resource and readable copy can both contribute to device usage;
60.69 MB is the dictionary database size, not a claim about total installed size.
See the [Tauri resource documentation](https://v2.tauri.app/develop/resources/).
Actual installer/device totals must be reported separately for each tested
platform. Browser phone emulation is not iPhone or Android installation acceptance.

## Optional installation, removal and downloads

Settings → Dictionary lists the three packs, database sizes and download sizes.
The base cannot be removed. Optional packages can be installed from a selected
ZIP, removed, and installed again. File URLs/content URIs use the native FS
plugin, including iOS security-scoped access; this path needs physical-device
acceptance before claiming the native picker has been verified on those devices.

Each operation takes an in-process guard and an OS file lock. A uniquely named
staging directory owns its temporary ZIP and extracted members. Before atomic
activation the installer checks the pinned archive size/hash, member inventory,
member size/hash, manifest identity, release, SQLite application ID/schema,
metadata and quick check. It rejects unknown IDs, traversal, links, mixed releases,
incomplete streams and oversized records. Cancellation/failure removes staging;
startup removes abandoned staging only while holding the OS lock. No operation
opens the learning database. Removal closes this process's optional connections
and removes only that pack's directory.

The HTTP downloader streams to staging, reports progress, checks length and
SHA-256, supports cancellation while awaiting the network, and shares the same
verification/activation path. It accepts only URLs in the pinned catalog under
this repository's HTTPS GitHub Release download path. URLs are currently null:
the packages have not been publicly hosted. The UI therefore says download is
not yet available and offers file installation. Publishing the existing audited
ZIPs and configuring their real URLs is a separate authorized release step; no
working public download or application release is claimed by this implementation.

## Verification

Core/frontend tests include a real Rust-projected fixture from the bundled
database, revision-preserving snapshots, strict adapter separation and invalid
source/context rejection. Rust tests exercise real base queries and the shared
schema. Controlled loopback HTTP tests cover progress, truncation, wrong length,
wrong digest and cancellation without contacting dictionary services.

The opt-in genuine-package test installs both optional ZIPs in a temporary
directory, checks merged results in both pack orders, saves an optional-only
reference, removes both packs, and exports/restores the saved reference after
the live entry has become unavailable:

```sh
LEXICUE_DICTIONARY_TEST_ARCHIVES=/absolute/directory/with/the/three/zips \
  cargo test --manifest-path src-tauri/Cargo.toml --lib \
  dictionary_packs::tests::real_optional_install_merge_remove_and_saved_reference_survives \
  -- --ignored --nocapture
```

UI validation uses isolated temporary libraries and the production Rust cores.
Online responses and native picker boundaries are controlled fixtures. No check
connects to or resets the user's actual learning database.
