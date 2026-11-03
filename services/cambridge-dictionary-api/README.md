# LexiCue Cambridge V1 service

Self-hosted Node service repaired from [Nongfsq/cambridge-dictionary-api](https://github.com/Nongfsq/cambridge-dictionary-api), baseline `2666e4cb41222a25c58d750603f9dd9cc44e5f00`. MIT copyright EliasChen is preserved in `LICENSE.txt`; original code and SHA-256 fingerprints are in `upstream/`. Cambridge page content retains its source rights. This service is an unofficial adapter, with no content or availability guarantee from Cambridge.

The desktop application calls this service from Rust. Desktop users do not install Node or Python. An operator installs Node **22 or newer** on the machine hosting the service.

## Run locally

```sh
cd services/cambridge-dictionary-api
npm ci --ignore-scripts
npm test
npm start
```

Default: `http://127.0.0.1:3211`. Stop with Ctrl-C or SIGTERM. Verify:

```sh
curl http://127.0.0.1:3211/health
curl --get --data-urlencode 'text=doomscrolling' http://127.0.0.1:3211/v1/lookup
```

Launch the existing desktop application with `LEXICUE_CAMBRIDGE_API_URL=http://127.0.0.1:3211` in its environment. See the main project scripts for `npm run tauri dev` and the final validation report for the exact Longman package configuration used on this machine. The application needs no browser CORS exception: only the native Rust client calls this API.

## Configuration and deployment

- `HOST`: default `127.0.0.1`; explicitly set `0.0.0.0` only inside an operator-controlled container/network.
- `PORT`: default `3211`.
- `CACHE_DIR`: persistent writable directory; default this service's ignored `.cache/`. Mount it if using a container. It stores complete source pages and fetch metadata, with no reading context. Cache keys include schema, adapter, dataset and case/punctuation-preserving target identity.
- `TOTAL_TIMEOUT_MS`: default `8000`, bounded to 1000–15000 ms.
- `UPSTREAM_TIMEOUT_MS`: default `7000`, bounded to 100–14000 ms and the remaining total budget.
- `MAX_CONCURRENT`: default `4`, bounded to 1–8; queue is limited to 16 requests with at most 1 second waiting.
- Existing `HTTPS_PROXY`/`https_proxy` or `HTTP_PROXY`/`http_proxy` is honored through Undici ProxyAgent. The service does not rotate user agents, solve challenges or change network routes on a block.

For remote deployment, use a TLS reverse proxy, a service manager and a persistent cache volume. Configure the desktop application with that operator-controlled **HTTPS** origin. Debug builds permit local loopback HTTP. A production address is not supplied or deployed by this repository. Do not expose the Node listener directly to an untrusted network without operator access controls/rate limits. `/health` only reports readiness, mode and counters; it does not prove upstream availability.

Example container build:

```sh
docker build -t lexicue-cambridge-v1 .
docker run --rm -p 127.0.0.1:3211:3211 -v lexicue-cambridge-cache:/cache -e CACHE_DIR=/cache lexicue-cambridge-v1
```

## API and semantics

`GET /v1/lookup?text=<expression>[&refresh=1]` returns the project's unmodified Dictionary Result V1 schema. Only these parameters are accepted. Query context is always null; reading material, personal explanations, authentication credentials and arbitrary upstream URLs are not accepted. Limits: 120 characters, no controls. Content is plain text and controlled Cambridge HTTPS resource URLs. Schema validation uses Ajv draft 2020-12 plus formats; semantic ID/default/sense/URL checks run before output.

- HTTP 200: confirmed `found`, `partial` or `not_found`; stale valid data may be returned with `stale_cache` notice.
- HTTP 400: invalid request (`unavailable`, `invalid_query`).
- HTTP 429: upstream limit/backoff, with Retry-After.
- HTTP 502: upstream 5xx, wrong content type, untrusted redirect, identity/parse error.
- HTTP 503: network failure, upstream 403, busy queue or offline replay miss.
- HTTP 504: upstream deadline.

Failure responses are V1 `unavailable`, never a fabricated missing word. No automatic retries are made. 429 establishes a bounded Retry-After backoff; 403 or DOM errors do not loop. In-flight requests for the same source target coalesce.

Valid source pages remain fresh for 24 hours and may be used stale for up to 7 days when refresh fails, with the original retrieval time. Confirmed absence is cached for 60 seconds. Failures never overwrite valid pages. Refreshes that lose a previously retained sense or Chinese meaning retain the more complete valid page with an `incomplete_refresh` notice. Up to 500 memory/disk cache entries are retained. Complete source pages and query restrictions are separate: `look it up` and `looked the word up` select only the source's `look something up` scope without overwriting the complete `look up` page. US/us, punctuation and underscores remain different cache identities.

Original entry/group boundaries remain distinct even for the same POS. Nested expressions are separately located and never donate definitions to parent entries. Cambridge's phrasal-verb header audio explicitly belongs to its parent verb and is intentionally omitted from expression pronunciations. Word audio stays with its original group. The `took`→`take` expansion requires Cambridge's own inflection link and the target group's own `took` form. Exact source spelling across the whole returned page takes priority. If no exact target exists, a sentence-style initial capital may be lowered only when the first character is uppercase, the remaining characters contain lowercase letters and contain no uppercase letters, and the corresponding actual source headword is present. Thus Doomscrolling can match doomscrolling; US, I and internal capitals are not generically lowered. Query text is preserved and match.note records the change. Surrounding and repeated whitespace is safely normalized with a separate note; punctuation is preserved. Unrecognized expressions are not guessed. There is no Wiktionary dependency, AI translation or mixed-source definition.

## Evidence, replay and tests

`npm test` always runs the standalone cache-identity, schema and artificial DOM checks. Saved-page replay tests require a separately collected local corpus and are explicitly skipped when it is absent. Set `CAMBRIDGE_REPLAY_DIR` to the corpus directory containing `pages.json` and its HTML files; the ignored local evidence directory `../../docs/implementation/evidence/cambridge-online-v1/service/` is used when available. The original validation used **26 actual saved pages**, with URL/final URL/UTC fetch time/SHA-256 in the local manifest. These bulk source-page captures are not distributed in this repository. Tests check actual definition pairs, source scopes, groups, pronunciation differences, complete abbreviations, separable expression restrictions, datasets, cache identity/expiry/staleness/concurrency and transport distinctions. Artificial DOM tests cover multiple datasets and absent fields; these are not live success evidence.

To replay the saved source pages in a separate process:

```sh
PORT=3212 CACHE_DIR=/tmp/lexicue-cambridge-replay-cache CAMBRIDGE_REPLAY_DIR='../../docs/implementation/evidence/cambridge-online-v1/service' npm start
```

Use a separate cache directory. `/health` reports `real_page_replay`; this mode never fetches the network and must not be described as live fetching. The default mode reports `live`. `scripts/capture.js` is an explicit low-frequency, finite evidence collector that stops at 403/429. `scripts/live-smoke.js` records real API results separately, including actual delivery mode and fetch times.

Supported extraction is bounded to observed Cambridge entry, phrasal-verb, idiom and phrase blocks. A future page change can require a new adapter version. Unknown page identity or undecodable target content returns unavailable. Group-local grammar article extracts already present on the source page are retained as grammar notes, explicitly ending in the source ellipsis; linked articles are not fetched or presented as full notes. Sense-local source variants/symbols (such as Pb) remain usage notes. Construction labels directly preceding an example become that sense’s pattern with its own example, without repeating it in the ordinary examples. No standalone `.usage-info`/`.usage-block`/`.dnote` was observed in these 26 pages; support for future independent note formats is not claimed. Source notices/fields absent on the captured page remain absent; no missing Chinese is invented. This is targeted regression coverage, not an accuracy audit of the whole dictionary.
