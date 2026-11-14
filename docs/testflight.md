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
application's Resources phase. Do not remove local signing settings when updating
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
