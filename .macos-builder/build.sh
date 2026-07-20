#!/usr/bin/env bash
# Producer for stuffbucket/macos-builder: build the UNSIGNED Wiggle.app only.
# The builder handles signing, notarization, and DMG packaging afterward — this
# script must NOT sign, notarize, or build a dmg.
#
# The builder runs this in a non-login shell and exports: TAG, REF, REPO, ARCH,
# SIGN_IDENTITY, ENTITLEMENTS_DIR, BUN_INSTALL, CARGO_HOME, OUTPUT_DIR.
set -euo pipefail

export PATH="${BUN_INSTALL:-$HOME/.bun}/bin:${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"

# Stamp the release version (from the tag) into tauri.conf.json.
VERSION="${TAG#v}"
if [ -n "${VERSION}" ]; then
  sed -i '' -E "s/(\"version\": \")[0-9]+\.[0-9]+\.[0-9]+(\")/\1${VERSION}\2/" \
    src-tauri/tauri.conf.json
fi

bun install --frozen-lockfile
# --bundles app: produce only the .app at `app_path`; the builder does the rest.
bun run tauri build --bundles app
