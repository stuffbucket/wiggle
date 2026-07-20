# Wiggle

A macOS desktop app that reads a wall of text and keeps only the lines that
matter — graying out the rest.

> With AI, everything reads great now. That's the problem: you might miss
> something important. Wiggle cuts through the filler to what won't budge.

Wiggle takes a passage and, line by line, asks the only question that counts:
**would this change what you do?** If yes, it keeps the line. If not, it's
grayed out. What's left is the buried lede.

## Stack

- **[Tauri v2](https://tauri.app)** — Rust core + native macOS window
- **React + TypeScript + Vite** — frontend
- Bundle identifier: `com.microsoft.wiggle`

## Develop

```sh
bun install
bun run tauri dev     # builds Rust, starts Vite, opens the window
```

First `tauri dev` compiles the Rust toolchain and can take several minutes;
later runs are seconds.

## Build

```sh
bun run tauri build   # produces a signed-ready .app / .dmg under src-tauri/target
```

## Where the intelligence goes

The line-by-line verdict lives in the `wiggle` Tauri command
(`src-tauri/src/lib.rs`). Today it uses a deterministic placeholder heuristic so
the app runs end to end. Replace `line_matters` with a real model call — an LLM
that twists each line's meaning and tests whether it changes your next move —
to make Wiggle actually smart.

---

Microsoft Confidential.
