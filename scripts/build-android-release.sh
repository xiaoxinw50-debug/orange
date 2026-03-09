#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/android"
JAVA_HOME_DEFAULT="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
SIGNING_ENV_FILE="$ROOT_DIR/.android-signing.env"

export JAVA_HOME="${JAVA_HOME:-$JAVA_HOME_DEFAULT}"
export PATH="$JAVA_HOME/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$PATH"

if [ -f "$SIGNING_ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$SIGNING_ENV_FILE"
  set +a
fi

BUILD_TOOLS_DIR="$(ls -d "$HOME/Library/Android/sdk/build-tools/"* | sort -V | tail -n 1)"
UNSIGNED_APK="$ANDROID_DIR/app/build/outputs/apk/release/app-release-unsigned.apk"
ALIGNED_APK="$ANDROID_DIR/app/build/outputs/apk/release/app-release-aligned.apk"
SIGNED_APK="$ANDROID_DIR/app/build/outputs/apk/release/app-release-signed.apk"

KEYSTORE_PATH="${ANDROID_KEYSTORE_PATH:-$HOME/.android/debug.keystore}"
KEY_ALIAS="${ANDROID_KEYSTORE_ALIAS:-androiddebugkey}"
KEYSTORE_PASSWORD="${ANDROID_KEYSTORE_PASSWORD:-android}"
KEY_PASSWORD="${ANDROID_KEY_PASSWORD:-android}"

cd "$ANDROID_DIR"
./gradlew --no-daemon assembleRelease --console=plain

rm -f "$ALIGNED_APK" "$SIGNED_APK"
"$BUILD_TOOLS_DIR/zipalign" -f -p 4 "$UNSIGNED_APK" "$ALIGNED_APK"
"$BUILD_TOOLS_DIR/apksigner" sign \
  --ks "$KEYSTORE_PATH" \
  --ks-key-alias "$KEY_ALIAS" \
  --ks-pass "pass:$KEYSTORE_PASSWORD" \
  --key-pass "pass:$KEY_PASSWORD" \
  --out "$SIGNED_APK" \
  "$ALIGNED_APK"

"$BUILD_TOOLS_DIR/apksigner" verify --print-certs "$SIGNED_APK"
ls -lh "$SIGNED_APK"
