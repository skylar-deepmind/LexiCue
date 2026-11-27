# iOS TestFlight preparation

Use the existing iOS identifier `com.skylar.lexicue.ios` and its existing Apple
Developer team. Keep signing keys, API keys, profiles and upload receipts outside
the repository. Never uninstall the everyday application to resolve signing.

Build with a currently supported Xcode/iOS SDK. Set `DEVELOPER_DIR` for the build
instead of switching the machine's default Xcode. Pass the team and a sequential
`bundle.iOS.bundleVersion` in a local Tauri config; the marketing version remains
the repository version. TestFlight uses the `app-store-connect` export method.
The API key is optional; Xcode Organizer can also upload the archive.

`npm run ios:prepare` includes `src-tauri/PrivacyInfo.xcprivacy` in the native
application's Resources phase and replaces the generated template icons with
full-bleed opaque RGB LexiCue assets from `src-tauri/icons/ios`. iOS applies
its own rounded mask.
Verify the actual exported icon, not only the source icon directory.
Do not remove local signing settings when updating
an existing generated project. Verify that the exported app contains the manifest
at its root, and verify its signature, team, application identifier, build number,
distribution profile and disabled debugger entitlement before upload.

The required-reason declarations cover:

- File metadata inside the application container (`C617.1`) and files explicitly
  chosen through the document picker (`3B52.1`). Rust file operations, SQLite and
  the native document picker use these APIs.
- Free-space checks before downloading or caching media/models (`E174.1`), which
  report insufficient space and prevent the write.
- Monotonic timers and elapsed-time checks (`35F9.1`), including the local pairing
  ticket timeout. Boot-time values are not transmitted.

This manifest is not an App Store privacy-label submission or an encryption
exemption declaration. Review export compliance separately: the application uses
TLS and also Argon2/ChaCha20-Poly1305 for encrypted backups. Do not describe it as
using only operating-system encryption. Keep the build awaiting compliance if
the appropriate classification has not been established.

References: [Tauri App Store distribution](https://v2.tauri.app/distribute/app-store/),
[Apple required-reason API](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api),
[Apple TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).

## Apple distribution builds

Use the Apple distribution configuration when preparing an iOS archive for
TestFlight or the App Store. The regular local iOS build uses its usual
configuration. Pass the team and a monotonically increasing build number in a
separate local overlay as described above.

```sh
npm run ios:prepare
npm run tauri -- ios build --archive-only --export-method app-store-connect --ci \
  --config src-tauri/tauri.ios-store.conf.json --config /path/to/local-signing.json
```

All distributions import user-provided documents, subtitles, and material ZIPs.
The Apple distribution configuration also disables in-app macOS software updates.

To verify a material ZIP, put `Lesson.srt`, `Lesson.jpg`, and either `Lesson.m4a`
or `Lesson.mp4` in the same ZIP folder. Select the ZIP through the file picker.
The preview uses the provided cover. After confirmation, LexiCue reads the
subtitle sentences and plays the aligned audio. The app extracts the audio
locally when the package contains a video. If the package contains text only,
reading uses Edge TTS with the user's speech settings. Existing learning
records and audio already stored on the device remain usable.

The ZIP limit is 64 MiB. Supported subtitle files are SRT and VTT. The importer
accepts JPEG, PNG, and WebP covers and supports common audio tracks, including
AAC in MP4 and Opus in WebM. A subtitle file named `Lesson.en.vtt` can match
`Lesson.webp` and `Lesson.webm`. A local audio file remains on the device that
imports it.

## Mac App Store

Use the macOS platform on the existing App Store Connect LexiCue record with
Bundle ID `com.skylar.lexicue.ios`. The store package uses App Sandbox and has its
own data container. Verify file selection and backup export and restore with
test data, including a backup created in the regular macOS build.

Build an Apple Silicon App Store package with
`node scripts/build-mac-app-store.mjs`. Set these variables locally.

- `APPLE_SIGNING_IDENTITY` selects the Apple Distribution identity.
- `LEXICUE_MAC_APP_STORE_PROFILE` points to the Mac App Store provisioning profile for the shared Bundle ID.
- `LEXICUE_MAC_APP_STORE_INSTALLER_IDENTITY` selects the Mac Installer Distribution identity.
- `LEXICUE_MAC_APP_STORE_BUILD_NUMBER` sets a sequential build number.
- `CARGO_TARGET_DIR` points to an absolute, task-specific build directory.

The script verifies the app signature, entitlement values, privacy manifest and
installer signature, then prints the package path. Use App Store Connect
validation and test the sandboxed build before adding the package to TestFlight.
