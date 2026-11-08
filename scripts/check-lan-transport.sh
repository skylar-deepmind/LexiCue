#!/bin/bash
# macOS 15+ for in-memory PKCS#12 import. No login Keychain changes.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
openssl_bin=${OPENSSL_BIN:-openssl}
for identity in mac phone stranger; do
  "$openssl_bin" req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 1 \
    -subj "/CN=LexiCue Probe $identity" -keyout "$scratch/$identity.key" \
    -out "$scratch/$identity.pem" >/dev/null 2>&1
  "$openssl_bin" x509 -in "$scratch/$identity.pem" -outform DER -out "$scratch/$identity.der"
  "$openssl_bin" pkcs12 -export -inkey "$scratch/$identity.key" -in "$scratch/$identity.pem" \
    -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
    -passout pass:probe -out "$scratch/$identity.p12"
done
sources=(src-tauri/native/lan-sync/{TrustedTransport,PairingOffer}.swift)
# Compile against the actual device SDK with the app's iOS 15 deployment target.
xcrun --sdk iphoneos swiftc -sdk "$(xcrun --sdk iphoneos --show-sdk-path)" \
  -target arm64-apple-ios15.0 -parse-as-library -whole-module-optimization -emit-object "${sources[@]}" -o "$scratch/transport.o"
xcrun swiftc -target "$(uname -m)-apple-macos15.0" "${sources[@]}" tests/lan-sync/apple/*.swift -o "$scratch/probe"
if [[ -n "${CODE_SIGN_IDENTITY:-}" ]]; then
  codesign --force --sign "$CODE_SIGN_IDENTITY" "$scratch/probe"
  codesign --verify --strict "$scratch/probe"
fi
for mode in pairing trusted wrong-client wrong-server; do
  "$scratch/probe" "$scratch" "$mode"
done
