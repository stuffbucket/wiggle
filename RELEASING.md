# Releasing Wiggle

Wiggle ships a **signed, notarized arm64 macOS** build. All Apple secrets live in
the private **`stuffbucket/macos-builder`** repo — this repo holds none. A release
tag creates a draft, dispatches the builder for the signed `.dmg` (packaged with
`hdiutil`, **no AppleScript**), then publishes. Windows/Linux are later targets.

## One-time setup (done outside this repo)

These require access to `stuffbucket/macos-builder` and repo admin — do them once:

1. **Approve a builder policy** for this repo in `stuffbucket/macos-builder`
   (its build-config issue-ops flow) with:
   `bundle_id_allowed = com.stuffbucket.wiggle`, `entitlements_allowed = default`,
   `artifact_allowed = dmg`. Without a policy the build is refused.
2. **Install the `app-repoman` GitHub App** on `stuffbucket/wiggle` with
   **Contents: read+write** (lets the builder check out + upload the dmg).
3. **Set the repo secret** `MACOS_BUILDER_PAT` — a fine-grained PAT scoped to
   `stuffbucket/macos-builder` only, **Actions: write** (its sole power is to
   start the builder):
   ```sh
   gh secret set MACOS_BUILDER_PAT --repo stuffbucket/wiggle < pat.txt
   ```
4. **Enable Pages**: repo Settings ▸ Pages ▸ Source = "GitHub Actions".

## Cutting a release

1. Bump the version in lockstep (single source of truth is semver):
   `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.
2. Group the issues under a **GitHub Milestone** per minor/patch; close it when done.
3. Tag and push:
   ```sh
   git tag v0.2.0 && git push origin v0.2.0
   ```
4. `release.yml` creates the draft, dispatches `macos-builder`, polls (~up to
   30 min) for `Wiggle.dmg`, renames it to `wiggle-v0.2.0-darwin-arm64.dmg` +
   sha256, and flips the release to **published / latest**.

Manual re-run: `gh workflow run release.yml -f tag=v0.2.0`.

## The `.macos-builder/` contract

- `config` — declares `app_path`, `volname=Wiggle`, `bundle_id`, `entitlements`,
  `artifact`. The builder owns signing/notarization/packaging.
- `build.sh` — the producer: stamps the version and runs
  `bun run tauri build --bundles app` (unsigned `.app` only — it must NOT sign,
  notarize, or make a dmg).

## Auto-update (optional)

Local release builds already emit signed updater artifacts using
`~/.tauri/wiggle.key` (public half is in `tauri.conf.json` → `plugins.updater`),
and the app checks `…/releases/latest/download/latest.json` (tray ▸ Check for
Updates). To wire auto-update through CI:

1. Set `.macos-builder/config` `artifact = dmg,updater` (and add `updater` to the
   approved policy's `artifact_allowed`).
2. Replace `plugins.updater.pubkey` in `tauri.conf.json` with the builder's
   `TAURI_SIGNING_PUBLIC_KEY` (the builder signs the `.app.tar.gz` with its own
   Ed25519 key — the shipped pubkey must match it, not the local key).
3. Publish a `latest.json` next to the release assets (Tauri's native schema).

> ⚠ macOS auto-update needs the app **notarized** (the builder does this) — an
> un-notarized self-update triggers "Wiggle.app is damaged."

## Windows (later)

`gh workflow run windows.yml -f tag=v0.2.0` builds the NSIS per-user installer
(currently unsigned — SmartScreen will warn until an Authenticode cert is added).

## Constraints

- **Apple: arm64 only** — no Intel build.
- **No AppleScript** — the builder packages the dmg with `hdiutil`. For local host
  builds, `CI=true bun run tauri build` skips Tauri's Finder-AppleScript step.
