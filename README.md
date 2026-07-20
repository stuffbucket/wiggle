# Wiggle

A macOS menubar app that keeps only what won't budge.

> With AI, everything reads great now. That's the problem: you might miss
> something important. Wiggle cuts through the filler to what actually matters.

Wiggle *"wiggles every block in a tower of thought."* Borrowing the logic of
mutation testing (à la Stryker), it perturbs the meaning of each block of your
text and asks the only question that counts: **would this change what you do?**
If yes, the block stays in full ink. If not, it fades. What's left is the buried
lede.

Summon it anywhere with a **double-tap of Ctrl**: the screen dims and a small
card drops near the bottom of whatever monitor you're on. Paste, drop, or type —
and wiggle.

## How it works

- **Menubar app** (no Dock icon). Lives in the tray; summoned on demand.
- **Double-tap Ctrl** — a global hotkey (configurable) drops a native overlay
  that floats over everything without stealing focus, dims the screen, and
  centers a card near the bottom of the focused monitor.
- **Local models, no keys.** Wiggle auto-discovers a backend: **maximal**
  (`localhost:4141`, Anthropic-compatible) first, then **Ollama**
  (`localhost:11434`). If neither is up, it waits patiently and connects the
  moment one appears. Nothing to configure to start.

## Stack

- **[Tauri v2](https://tauri.app)** — Rust core + native macOS overlay
- **React + TypeScript + Vite** — the overlay card
- Native overlay via [`tauri-nspanel`](https://github.com/ahkohd/tauri-nspanel)
  (non-activating NSPanel) + `objc2` (global hotkey, screen targeting)
- Bundle identifier: `com.stuffbucket.wiggle`

## Configure

Settings live at `$XDG_CONFIG_HOME/wiggle/settings.json` (default
`~/.config/wiggle/settings.json`), written with defaults on first launch:

```jsonc
{
  "provider": "auto",                    // "auto" | "maximal" | "ollama"
  "maximal": { "base_url": "http://localhost:4141", "model": "claude-haiku-4-5" },
  "ollama":  { "base_url": "http://localhost:11434", "model": "llama3.1" },
  "hotkey":  { "modifier": "ctrl", "taps": 2, "window_ms": 400 },
  "dim":     0.18,
  "locale":  "auto"
}
```

`WIGGLE_API_KEY` / `ANTHROPIC_API_KEY` override the key if a remote endpoint
needs one (local providers don't).

## Develop

```sh
bun install
bun run tauri dev     # builds Rust, starts Vite, runs the tray app
```

First `tauri dev` compiles the Rust toolchain and can take several minutes;
later runs are seconds. On first launch macOS will ask for **Accessibility /
Input Monitoring** so the double-Ctrl hotkey can be detected — until then, use
the tray's **Summon** item.

## Build

```sh
bun run tauri build   # produces Wiggle.app + .dmg under src-tauri/target
```

## Where the intelligence lives

The wiggle engine is in `src-tauri/src/engine.rs`: it segments the passage into
blocks and, in one structured call to the provider (`src-tauri/src/provider.rs`),
judges each block's verdict. The native overlay lives under
`src-tauri/src/macos/` (panel, hotkey, screen).

---

Once branded "Microsoft Confidential" on the deck — that was the pitch framing.
The app is [stuffbucket/wiggle](https://github.com/stuffbucket/wiggle).
