#!/usr/bin/env bash
# Signed sideload APK. The keystore and passwords stay in the environment or a key=value file.
set -euo pipefail
set +x

cd "$(dirname "$0")/.."

fail() {
  echo "$1" >&2
  exit 1
}

load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || fail "Env file not found."
  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || fail "Env file has a line that is not KEY=value."
    key="${line%%=*}"
    value="${line#*=}"
    if [[ "$value" =~ ^\".*\"$ || "$value" =~ ^\'.*\'$ ]]; then
      value="${value:1:${#value}-2}"
    fi
    printf -v "$key" '%s' "$value"
    export "$key"
  done < "$file"
}

if [[ $# -gt 1 ]]; then
  fail "Usage: ./scripts/build-apk.sh [path/to/release.env]"
fi
if [[ $# -eq 1 ]]; then
  load_env_file "$1"
fi

required=(
  SITEPACK_KEYSTORE_PATH
  SITEPACK_KEYSTORE_PASSWORD
  SITEPACK_KEY_ALIAS
  SITEPACK_KEY_PASSWORD
  EXPO_PUBLIC_SUPABASE_URL
  EXPO_PUBLIC_SUPABASE_ANON_KEY
)
missing=()
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("$name")
  fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  fail "Missing required environment: ${missing[*]}. Pass them in the environment or as ./scripts/build-apk.sh path/to/release.env"
fi

if [[ "${EXPO_PUBLIC_USE_FIXTURES:-}" == "1" ]]; then
  fail "EXPO_PUBLIC_USE_FIXTURES must not be 1 for a release APK."
fi
export EXPO_PUBLIC_USE_FIXTURES=""
export EXPO_NO_DOTENV=1

while IFS= read -r name; do
  case "$name" in
    *SERVICE_ROLE*|*service_role*)
      fail "Unset ${name} before building. The release bundle must not see a service role."
      ;;
  esac
done < <(compgen -e)

if [[ ! -f "$SITEPACK_KEYSTORE_PATH" ]]; then
  fail "SITEPACK_KEYSTORE_PATH is missing or is not a file."
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
keystore_real=$(realpath "$SITEPACK_KEYSTORE_PATH")
repo_real=$(realpath "$repo_root")
case "$keystore_real" in
  "$repo_real"|"$repo_real"/*)
    fail "The keystore must not live inside the repo."
    ;;
esac

if ! java -version 2>&1 | grep -Eq 'version "17([. ]|")'; then
  fail "JDK 17 is required. Install it, and an Android SDK with NDK 27.1."
fi

sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$sdk" || ! -d "$sdk" ]]; then
  fail "Set ANDROID_HOME to an Android SDK with NDK 27.1."
fi
ndk=$(find "$sdk/ndk" -maxdepth 1 -mindepth 1 -type d -name '27.1*' 2>/dev/null | head -n 1 || true)
if [[ -z "${ndk}" ]]; then
  fail "Android NDK 27.1 is not installed under the Android SDK."
fi

signer=$(find "$sdk/build-tools" -type f -name apksigner 2>/dev/null | sort | tail -n 1 || true)
if [[ -z "$signer" ]]; then
  fail "apksigner was not found in the Android SDK build-tools."
fi

npx expo prebuild --platform android --clean --no-install
( cd android && ./gradlew assembleRelease --no-daemon )

mapfile -t apks < <(find android/app/build/outputs/apk/release -type f -name '*.apk' ! -name '*unsigned*' | sort)
if [[ ${#apks[@]} -ne 1 ]]; then
  fail "Expected one signed release APK."
fi

version=$(node -p "require('./app.json').expo.version")
mkdir -p dist-apk
out="dist-apk/sitepack-${version}.apk"
cp "${apks[0]}" "$out"

certs=$("$signer" verify --print-certs "$out") || fail "apksigner verify failed."
printf '%s\n' "$certs" | node -e '
const fs = require("fs");
const text = fs.readFileSync(0, "utf8");
const expected = "83:C8:DD:E7:8A:3A:2B:A4:26:B6:CC:B4:DF:ED:CF:53:DC:DD:64:54:3C:28:11:A6:29:07:8F:07:49:16:57:B6";
const match = text.match(/SHA-256 digest:\s*([0-9A-Fa-f:]+)/);
if (!match) {
  console.error("apksigner did not print a SHA-256 digest.");
  process.exit(1);
}
const got = match[1].replace(/[^0-9a-fA-F]/g, "").toLowerCase();
const want = expected.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
if (got !== want) {
  console.error("Release certificate SHA-256 does not match assetlinks.json.");
  console.error(match[0]);
  process.exit(1);
}
'

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
unzip -q "$out" -d "$tmp"
node scripts/check-js-bundle.mjs "$tmp"
echo "Wrote ${out}"
