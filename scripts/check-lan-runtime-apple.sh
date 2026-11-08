#!/bin/bash
# Uses production TLS/discovery/trust and a test journal in two isolated hosts.
# With DEVICE_ID and TEAM_ID it installs a separately signed iPhone QA app.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
root=$PWD
scratch=$(mktemp -d)
mac_pid=
cleanup() {
  if [[ -n "$mac_pid" ]]; then kill "$mac_pid" 2>/dev/null || true; fi
  rm -rf "$scratch"
}
trap cleanup EXIT
mkdir -p "$scratch/mac" "$scratch/phone"
mac_id=$(uuidgen)
phone_id=$(uuidgen)
for role in mac phone; do
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 1 -subj '/CN=Runtime test only' \
    -keyout "$scratch/$role.key" -out "$scratch/$role.pem" >/dev/null 2>&1
  openssl pkcs12 -export -inkey "$scratch/$role.key" -in "$scratch/$role.pem" -keypbe PBE-SHA1-3DES \
    -certpbe PBE-SHA1-3DES -macalg sha1 -passout pass:probe -out "$scratch/$role/identity.p12"
done
xcrun swiftc -target "$(uname -m)-apple-macos15.0" src-tauri/native/lan-sync/*.swift \
  tests/lan-sync/runtime/main.swift -o "$scratch/test"
codesign --force --sign "${CODE_SIGN_IDENTITY:-Apple Development}" "$scratch/test" >/dev/null
bundle=com.lexicue.dev.deviceruntimeprobe
if [[ -n "${DEVICE_ID:-}" ]]; then
  : "${TEAM_ID:?Set the development signing team for the iPhone test}"
  mkdir -p "$scratch/mobile/App"
  cp src-tauri/native/lan-sync/*.swift tests/lan-sync/runtime/main.swift "$scratch/phone/identity.p12" "$scratch/mobile/App/"
  cd "$scratch/mobile"
  cat > project.yml <<YAML
name: DeviceRuntimeProbe
targets:
  DeviceRuntimeProbe:
    type: application
    platform: iOS
    deploymentTarget: '15.0'
    sources:
      - path: App
        excludes: ['*.p12']
      - path: App/identity.p12
        buildPhase: resources
    info:
      path: Info.plist
      properties:
        NSLocalNetworkUsageDescription: Connect the two isolated runtime test libraries on your network.
        NSBonjourServices: ['_lexicue-sync._tcp']
        UILaunchScreen: {}
    settings:
      PRODUCT_BUNDLE_IDENTIFIER: $bundle
      DEVELOPMENT_TEAM: $TEAM_ID
      CURRENT_PROJECT_VERSION: 1
      MARKETING_VERSION: 1.0
YAML
  xcodegen generate >/dev/null
  xcodebuild -quiet -project DeviceRuntimeProbe.xcodeproj -scheme DeviceRuntimeProbe -configuration Debug \
    -destination "id=$DEVICE_ID" -allowProvisioningUpdates -derivedDataPath build build
  xcrun devicectl device install app --device "$DEVICE_ID" build/Build/Products/Debug-iphoneos/DeviceRuntimeProbe.app
  cd "$root"
fi
for phase in pair resume revoke revoked; do
  "$scratch/test" mac "$phase" "$mac_id" "$scratch/mac" >"$scratch/mac.log" 2>&1 &
  mac_pid=$!
  if [[ "$phase" == pair ]]; then
    for _ in {1..150}; do
      if [[ -f "$scratch/mac/offer.json" ]]; then break; fi
      sleep 0.1
    done
    if [[ ! -f "$scratch/mac/offer.json" ]]; then cat "$scratch/mac.log"; exit 1; fi
    if [[ -n "${DEVICE_ID:-}" ]]; then
      xcrun devicectl device copy to --device "$DEVICE_ID" --source "$scratch/mac/offer.json" --destination Documents/offer.json \
        --domain-type appDataContainer --domain-identifier "$bundle"
    else
      cp "$scratch/mac/offer.json" "$scratch/phone/offer.json"
    fi
  fi
  run_phone() {
    if [[ -n "${DEVICE_ID:-}" ]]; then
      xcrun devicectl device process launch --device "$DEVICE_ID" --terminate-existing --console "$bundle" "$1" "$phone_id"
    else
      "$scratch/test" phone "$1" "$phone_id" "$scratch/phone"
    fi
  }
  if ! run_phone "$phase" >"$scratch/phone.log" 2>&1; then cat "$scratch/mac.log" "$scratch/phone.log"; exit 1; fi
  if [[ "$phase" == pair ]]; then
    # The original Mac process stays alive from the QR offer through this ACK.
    touch "$scratch/mac/edited-while-offline"
    if ! run_phone rejoin >>"$scratch/phone.log" 2>&1; then cat "$scratch/mac.log" "$scratch/phone.log"; exit 1; fi
    test -f "$scratch/mac/ack-after-restart" || { echo 'Missing receipt after phone-only restart'; exit 1; }
  fi
  if ! wait "$mac_pid"; then cat "$scratch/mac.log" "$scratch/phone.log"; exit 1; fi
  mac_pid=
  if [[ "$phase" == pair ]]; then
    mac_code=$(sed -n 's/^SAS //p' "$scratch/mac.log")
    phone_code=$(sed -n 's/^SAS //p' "$scratch/phone.log" | tr -d '\r')
    [[ -n "$mac_code" && "$mac_code" == "$phone_code" ]] || { echo 'Pairing codes did not match'; exit 1; }
  fi
  rg 'DEVICE_RUNTIME (PASS|FAIL)' "$scratch/mac.log" "$scratch/phone.log"
  rg -q 'DEVICE_RUNTIME PASS' "$scratch/mac.log" && rg -q 'DEVICE_RUNTIME PASS' "$scratch/phone.log"
done
