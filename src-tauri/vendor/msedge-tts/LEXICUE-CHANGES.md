# LexiCue native Edge adapter dependency

Source: published `msedge-tts` 0.4.1 from crates.io, repository https://github.com/hs-CN/msedge-tts (observed HEAD 0c60fb67e95fb20d484e26f565cca1abdd81def4 on 2026-10-26). Published crate source revision: `79d6d83c8e1ac6507b37f775055e7a4abbe78a82` (retained UPSTREAM-VCS.json). Cargo metadata declares MIT OR Apache-2.0; the distributed LICENSE is MIT, retained here. Original manifest and original source SHA-256 manifest are retained.

Selected under the upstream MIT license. This is a third-party compatible client, not a Microsoft SDK or a grant of Microsoft service rights. The upstream DRM module explicitly describes a Rust port of the public `edge-tts` v2 protocol compatibility algorithm (October 2026). That attribution is retained. LexiCue has not copied Python source or added a Python runtime; upstream licensing provenance should continue to be reviewed before distributing changes to that module.

Local changes:
- Preserve upstream source; only use its Tokio client. Manifest aligns shared dependency versions with LexiCue and selects verified TLS using rustls/webpki roots instead of platform verifier (avoids Android JNI setup). Unused blocking/smol/proxy modules remain as upstream reference, not compiled.
- Reject websocket close/EOF before explicit turn.end. Validate binary header length and audio path before indexing, limit response size to 4MB, and allow ping/pong.
- Tokio transport honors HTTPS_PROXY/ALL_PROXY with bounded HTTP CONNECT and NO_PROXY; the target remains fixed and verified TLS remains end-to-end. Unsupported proxy schemes fail explicitly rather than bypass verification.
- Expose transport error type for redacted structured HTTP status handling.
- App adapter performs plain-text escaping, validates finite voice/rate choices, 1000-character input limit, complete MP3 decoding and metadata duration checks before caching.

Effective minimum toolchain is Rust 1.88 (edition 2024 plus upstream APIs); verified with Rust 1.97.1. No shell/sidecar, Azure key, paid replacement or developer relay.
