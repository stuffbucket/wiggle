import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type Line = {
  index: number;
  text: string;
  matters: boolean;
};

const SAMPLE = `Thanks everyone for the great discussion today.
As a quick recap, the team is aligned and morale is high.
Decision: we ship the new onboarding flow on Monday.
There were a lot of thoughtful points raised throughout.
Blocker: legal still needs to approve the updated copy by Friday.
Really appreciate all the hard work going into this.
Can someone confirm the final headcount for the offsite?`;

function App() {
  const [text, setText] = useState(SAMPLE);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function runWiggle() {
    setBusy(true);
    try {
      setLines(await invoke<Line[]>("wiggle", { text }));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setLines(null);
  }

  const kept = lines?.filter((l) => l.matters).length ?? 0;

  return (
    <main className="app">
      <header className="topbar">
        <span className="brand">Wiggle</span>
        <span className="tag">finds the parts that matter</span>
      </header>

      {lines === null ? (
        <section className="editor">
          <textarea
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            placeholder="Paste the thread, the doc, the wall of text…"
            spellCheck={false}
          />
          <button className="primary" onClick={runWiggle} disabled={busy || !text.trim()}>
            {busy ? "Wiggling…" : "Wiggle it"}
          </button>
        </section>
      ) : (
        <section className="result">
          <p className="summary">
            Kept <strong>{kept}</strong> of {lines.length} lines. The rest is filler.
          </p>
          <div className="reading">
            {lines.map((l) =>
              l.text.trim() === "" ? (
                <div key={l.index} className="blank" />
              ) : (
                <p key={l.index} className={l.matters ? "keep" : "fade"}>
                  {l.text}
                </p>
              )
            )}
          </div>
          <button className="ghost" onClick={reset}>
            ← New text
          </button>
        </section>
      )}
    </main>
  );
}

export default App;
