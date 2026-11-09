#!/bin/bash
# Requires a paired iPhone on a reachable LAN, Xcode, xcodegen and the iOS Rust target.
# Installs a separate QA app with synthetic records and ephemeral test certificates.
set -euo pipefail
umask 077
: "${TEAM_ID:?Set TEAM_ID to the development signing team}"
: "${DEVICE_ID:?Set DEVICE_ID to the iPhone UDID}"
cd "$(dirname "$0")/.."
root=$PWD
scratch=$(mktemp -d)
mac_pid=
cleanup() {
  if [[ -n "$mac_pid" ]]; then kill "$mac_pid" 2>/dev/null || true; fi
  rm -rf "$scratch"
}
trap cleanup EXIT
pair=$(uuidgen)
bundle=com.lexicue.dev.journalprobe
export CARGO_TARGET_DIR=${CARGO_TARGET_DIR:-"$scratch/target"}
mkdir -p "$scratch/mac" "$scratch/mobile/App"
for role in mac phone; do
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 1 -subj "/CN=LexiCue QA $role" \
    -keyout "$scratch/$role.key" -out "$scratch/$role.pem" >/dev/null 2>&1
  openssl x509 -in "$scratch/$role.pem" -outform DER -out "$scratch/$role.der"
  openssl pkcs12 -export -inkey "$scratch/$role.key" -in "$scratch/$role.pem" -keypbe PBE-SHA1-3DES \
    -certpbe PBE-SHA1-3DES -macalg sha1 -passout pass:probe -out "$scratch/$role.p12"
done
cp "$scratch/mac.p12" "$scratch/phone.der" "$scratch/mac/"
cp "$scratch/phone.p12" "$scratch/mac.der" "$scratch/mobile/App/"
sources=(src-tauri/native/lan-sync/TrustedTransport.swift tests/lan-sync/apple/FixtureIdentity.swift tests/lan-sync/device/main.swift)
cp "${sources[@]}" tests/lan-sync/device/Probe.h "$scratch/mobile/App/"
cd src-tauri
cargo build --locked -p lexicue-lan-journal --example device_probe
cargo build --locked -p lexicue-lan-journal --example device_probe --target aarch64-apple-ios
cd "$root"
xcrun swiftc -target "$(uname -m)-apple-macos15.0" -import-objc-header tests/lan-sync/device/Probe.h \
  "${sources[@]}" "$CARGO_TARGET_DIR/debug/examples/libdevice_probe.a" -o "$scratch/mac/probe"
codesign --force --sign "${CODE_SIGN_IDENTITY:-Apple Development}" "$scratch/mac/probe"
cd "$scratch/mobile"
cp "$CARGO_TARGET_DIR/aarch64-apple-ios/debug/examples/libdevice_probe.a" .
cat > project.yml <<YAML
name: JournalProbe
targets:
  JournalProbe:
    type: application
    platform: iOS
    deploymentTarget: '15.0'
    sources:
      - path: App
        excludes: ['*.der', '*.p12']
      - path: App/phone.p12
        buildPhase: resources
      - path: App/mac.der
        buildPhase: resources
    dependencies:
      - framework: libdevice_probe.a
        embed: false
    info:
      path: Info.plist
      properties:
        NSLocalNetworkUsageDescription: Exchange synthetic journal fixtures with the paired test Mac.
        NSBonjourServices: ['_lexicue-sync._tcp']
        UILaunchScreen: {}
    settings:
      PRODUCT_BUNDLE_IDENTIFIER: $bundle
      DEVELOPMENT_TEAM: $TEAM_ID
      LIBRARY_SEARCH_PATHS: '.'
      SWIFT_OBJC_BRIDGING_HEADER: App/Probe.h
      CURRENT_PROJECT_VERSION: 1
      MARKETING_VERSION: 1.0
YAML
xcodegen generate >/dev/null
if ! xcodebuild -quiet -project JournalProbe.xcodeproj -scheme JournalProbe -configuration Debug \
    -destination "id=$DEVICE_ID" -allowProvisioningUpdates -derivedDataPath build build; then exit 1; fi
xcrun devicectl device install app --device "$DEVICE_ID" build/Build/Products/Debug-iphoneos/JournalProbe.app
for phase in drop resume material-drop material-resume material-edit; do
  "$scratch/mac/probe" "$pair" "$phase" "$scratch/mac" > "$scratch/mac.log" 2>&1 &
  mac_pid=$!
  if ! xcrun devicectl device process launch --device "$DEVICE_ID" --terminate-existing --console "$bundle" "$pair" "$phase" | tee "$scratch/phone.log"; then
    cat "$scratch/mac.log"; exit 1
  fi
  if ! wait "$mac_pid"; then cat "$scratch/mac.log"; exit 1; fi
  mac_pid=
  cat "$scratch/mac.log"
  rg -q 'JOURNAL_PROBE PASS' "$scratch/mac.log"
  rg -q 'JOURNAL_PROBE PASS' "$scratch/phone.log"
done
