# Touch and deletion polish — 0.4.7 candidate

Base: 82a9f060. Development branch: codex/mobile-deletion-polish.

Acceptance:
- Settings touch scrolling does not retain emulated hover or a native tap highlight; actual taps and keyboard focus remain usable.
- Both material menus expose confirmed native deletion. Cancellation does not write. Deletion refreshes the library and reconciles the reading desk; saved context snapshots survive.
- Saved and lookup history expose individual sentence removal. Other contexts survive, the final context can be undone, and uncertain replies reuse the same operation ID.
- Lookup collapse is an accessible icon without duplicate visible copy.
- Ocean and Midnight, narrow portrait/landscape and keyboard access.
- Android, iOS, macOS and Windows native verification must each be recorded against a frozen source commit before release.

Version preparation: 0.4.7. This document does not claim a published release or completed native tests.

Release notes draft:
- Fixed sticky touch highlights while scrolling Settings.
- Added material deletion to the reading desk and library menus, with confirmation and saved-context retention.
- Added per-sentence removal and undo inside lookup history, and made the Saved action readable.
- Simplified the lookup collapse control.

Release remains gated by four-platform verification, explicit branch merge approval and existing signing/notarization checks. No new dependencies or dictionary assets were added.
