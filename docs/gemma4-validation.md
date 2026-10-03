# Gemma 4 recommendation and download validation

Validated on 2026-10-01: Apple M4, 32 GiB unified memory, Ollama 0.34.4.

- Installed `gemma4:12b-it-q4_K_M` through the Settings download button. Ollama digest prefix: `6114515d63c1`.
- Observed download progress before completion; navigating to Files and reopening Settings retained the active download.
- The registry returned a TLS handshake timeout during the first attempt. Clicking Continue resumed the download and completed installation. No automatic retry was issued by LexiCue.
- The checked use-after-download option selected local Ollama at `http://localhost:11434` and the installed 12B model. The prior cloud profile remained available.
- Checked default and midnight themes, disabled/selected states, and keyboard focus. Enter expanded the additional versions.

The explicitly invoked local streaming smoke check uses the existing prompt, schema, generation parameters, validation, and UTF-16 highlight calculation, with no database or learning-data writes. Fixed input:

1. `I picked it up.`
2. `She ran into an old friend.`
3. `We need to break the ice.`

Observed first validated candidate at **78,187 ms** and full extraction at **85,861 ms**. Three accepted phrases: `pick up`, `run into`, `break the ice`; the separated phrase highlights only `picked` and `up`. One streaming extraction request, zero fallbacks, zero retries, zero rejected candidates; Ollama reported **332 input tokens and 1,006 generated tokens**. The explanation stage made zero requests and used zero tokens. Generation includes the model's own thinking behavior; this check did not change it. This small sample is not a quality or speed benchmark for an entire subtitle file.

The separate empty-message loading request returned no `load_duration`, so internal cold-load time is **unknown**, not zero. The smoke-check helper also records loading-request wall time on subsequent runs. Do not treat a warm recheck as a cold-load measurement.

Reproduce after manually installing the model:

```sh
cd src-tauri
cargo test gemma4_local_streaming_smoke --lib -- --ignored --nocapture
```

The normal test suite skips this check because it requires the real local model. The download protocol tests use a controlled localhost service; their data is not real model usage.

Frontend production builds pass. Packaging the local debug app encountered the repository's existing JS/Rust Tauri minor-version mismatches; the verification bundle used the CLI's override without modifying dependencies. Resolve these existing mismatches before shipping a release. The already-installed application was not replaced.
