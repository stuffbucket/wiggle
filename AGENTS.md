# AGENTS.md

Guidance for coding agents working in this repo. Keep changes clean and brief —
brevity is Wiggle's thing.

## What Wiggle is

A macOS menubar app that reads a wall of text and keeps only the lines that
matter, fading the filler. It *"wiggles every block in a tower of thought"*:
mutation-testing logic (à la Stryker) applied to meaning — mutate a block, and if
that would change what you'd do, it matters; if not, it's filler. Summoned by a
global **double-tap Ctrl**; a dimmed overlay drops near the bottom of the focused
monitor to paste/drop/type into.

## Stack & layout

- **Tauri v2** (Rust core) + **React + TypeScript + Vite** (the overlay card).
- Frontend: `src/` (`App.tsx`, `App.css`, `i18n.ts`, `locales/<lang>/common.json`).
- Rust: `src-tauri/src/`
  - `lib.rs` — builder wiring: plugins, tray, commands, updater, poller.
  - `engine.rs` — the wiggle engine (segment → one structured judge call).
  - `provider.rs` — providers + auto-discovery (maximal / Ollama).
  - `settings.rs` — XDG `settings.json` load/save.
  - `ingest.rs` — classify dropped paths (text/image/file).
  - `macos/` — native overlay (`#[cfg(target_os="macos")]`): `overlay.rs`
    (NSPanel via `tauri-nspanel`), `hotkey.rs` (NSEvent global monitor),
    `screen.rs` (monitor targeting).
- Native summon is a **full-screen transparent non-activating NSPanel**; the dim
  scrim + bottom-center card are drawn in **CSS**, not native code.

## Commands

```sh
bun install
bun run dev                    # Vite only
bun run build                  # tsc + vite build (frontend typecheck)
bun run tauri dev              # full app (first run compiles Rust, minutes)
cd src-tauri && cargo check    # Rust typecheck
CI=true bun run tauri build    # release .app + .dmg  (CI=true is REQUIRED, see below)
```

## Tests

```sh
bun test               # frontend unit tests (bun test + happy-dom)
bun run test:rust      # cargo test (engine parsing, ingest, settings)
bun run test:all       # both
```

- Frontend tests live beside the code as `src/lib/*.test.ts`. Pure logic
  (`locale`, `format`) and catalog integrity (all 12 locales share en's keys +
  keep `{{kept}}`/`{{total}}`) need no DOM; IPC tests mock the bridge with
  `@tauri-apps/api/mocks` (`mockIPC`/`clearMocks`) over a happy-dom `window`
  (preloaded via `bunfig.toml` → `test-setup.ts`).
- Keep IPC behind `src/lib/client.ts` so it stays mockable; test files are
  excluded from the production `tsc` build.
- Rust tests are in-module `#[cfg(test)] mod tests`. `.github/workflows/ci.yml`
  runs both suites on push/PR.

## Constraints & gotchas (read before building/releasing)

- **Apple: arm64 only.** No Intel build.
- **No AppleScript.** Tauri's host `bundle_dmg.sh` runs a Finder AppleScript that
  fails headlessly — always build the DMG with **`CI=true`** locally. Real signed
  releases go through **`stuffbucket/macos-builder`** (see `RELEASING.md`), never
  host AppleScript.
- **objc2 is pinned** to `0.6` / objc2-app-kit `0.3` to match `tauri-nspanel`
  v2.1 — a version skew becomes type-mismatch errors on the panel calls. Don't
  bump them independently.
- **Providers, keyless, auto-discovered:** maximal `http://localhost:4141`
  (Anthropic Messages API shape) first, then Ollama `:11434`, else a patient
  background poll. Never hard-fail for a missing provider.
- **Model calls** use raw HTTP (`reqwest`) to the Messages API — there's no
  official Rust SDK. Default model `claude-haiku-4-5`.
- **The macro injects imports.** `tauri_panel!` in `macos/overlay.rs` brings its
  own `MainThreadMarker`/`msg_send`/`Manager` into scope — don't re-import them
  there (fully-qualify instead).
- **Overlay funcs are concrete-runtime** (`AppHandle`, not `<R: Runtime>`) because
  the panel's `FromWindow` impl is for `Wry`.
- **Updater signing key** is local at `~/.tauri/wiggle.key` (pubkey in
  `tauri.conf.json`). Local release builds need
  `TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/wiggle.key)` (empty password).
- **Cross-platform fallback** (`cfg(not(target_os="macos"))`: global-shortcut +
  positioner) compiles on macOS but is unverified on Windows/Linux toolchains.

## Conventions

- Match the surrounding code's comment density and naming.
- Commit per logical change; Conventional Commits (`feat:`/`fix:`/`chore:`).
- The implementation plan is at `.claude/plans/generic-sleeping-gem.md`.
- Release process: `RELEASING.md`.
