# Sideload APK

SitePack's Android package is `uk.sitepack.app`. The release APK is built on a machine that already has the upload keystore. That keystore is not in this repo, not in CI, and not in the app.

The release certificate SHA-256, already published in `assetlinks.json`, is:

`83:C8:DD:E7:8A:3A:2B:A4:26:B6:CC:B4:DF:ED:CF:53:DC:DD:64:54:3C:28:11:A6:29:07:8F:07:49:16:57:B6`

## What you need

- JDK 17
- An Android SDK with NDK 27.1 installed (`ndk/27.1*` under the SDK)
- `ANDROID_HOME` or `ANDROID_SDK_ROOT` pointing at that SDK
- `apksigner` from the SDK build-tools (the script picks the newest one it finds)
- The release keystore, outside this repo
- `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_`)

## Build

Pass the secrets in the environment. The script does not print them.

```sh
SITEPACK_KEYSTORE_PATH=/absolute/path/upload.keystore \
SITEPACK_KEYSTORE_PASSWORD='...' \
SITEPACK_KEY_ALIAS='...' \
SITEPACK_KEY_PASSWORD='...' \
EXPO_PUBLIC_SUPABASE_URL='https://YOUR.supabase.co' \
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='...' \
./scripts/build-apk.sh
```

Or put those same keys in a file that is not in the repo, one `KEY=value` per line, and pass the path:

```sh
./scripts/build-apk.sh /absolute/path/release.env
```

Values may be wrapped in single or double quotes. Lines starting with `#` are ignored.

The script stops if any required name is missing, if the keystore file is missing, or if that file is inside this repo. It also stops if `EXPO_PUBLIC_USE_FIXTURES=1`, if a `SERVICE_ROLE` variable is set, or if `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` does not start with `sb_publishable_`. A legacy `eyJ` JWT and an `sb_secret_` key are refused. The refusal names the variable and does not print the key.

It runs a clean Android prebuild, then `gradlew assembleRelease`. Prebuild keeps `reactNativeArchitectures=arm64-v8a` via `plugins/withArm64Architectures.js`, so the release APK contains the arm64-v8a native libraries only. A 32-bit-only phone cannot install it. Gradle reads the four `SITEPACK_*` variables when it signs. The passwords are not written into the project. A release build fails if any of those four is missing. It does not fall back to the debug keystore. Debug builds are unchanged and do not need the keystore.

`expo prebuild` rewrites `package.json` (the `android` and `ios` scripts) and can rewrite other tracked files. On exit, including when the build fails, the script runs `git checkout` to put `package.json` back to HEAD and to restore any other tracked file that was clean when the script started. Do not leave uncommitted edits in `package.json` while you run it. Those edits are discarded. The generated `android/` directory is gitignored and is left in place.

The signed APK is `dist-apk/sitepack-<version>.apk`. The version comes from `app.json`.

After the build, the script runs `apksigner verify --print-certs` and checks the certificate SHA-256 against the fingerprint above. It then unpacks the APK and fails if the JS bundle contains a non-anon JWT, an `sb_secret_` key, a PEM private key, `service_role`, or a fixture seed login. The failure names the file and offset and does not print the matched secret.

## Install

Copy the APK to the phone and open it. Allow install from that source. There is no Play Store listing.

## CI

CI does not sign and does not have the keystore. The Android job exports the JS bundle and scans it for a non-anon JWT, an `sb_secret_` key, a PEM private key, `service_role`, and seed logins. It also runs the manifest checks: App Link paths, blocked permissions, `android:allowBackup="false"`, and release signing that reads those four environment variables and fails the release build when any of them is missing.
