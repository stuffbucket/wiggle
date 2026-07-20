import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

type Block = { index: number; text: string; matters: boolean };
type ProviderStatus = { online: boolean; provider: string; model: string };

function App() {
  const [text, setText] = useState("");
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ProviderStatus>({
    online: false,
    provider: "",
    model: "",
  });
  const [dim, setDim] = useState(0.18);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // One-time: read UI config + current provider status.
  useEffect(() => {
    invoke<{ dim: number; locale: string }>("get_config")
      .then((c) => setDim(c.dim))
      .catch(() => {});
    invoke<ProviderStatus>("provider_status").then(setStatus).catch(() => {});
  }, []);

  // React to the native summon + provider-status events.
  useEffect(() => {
    const summon = listen("wiggle://summon", () => {
      setBlocks(null);
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 30);
    });
    const provider = listen<ProviderStatus>("wiggle://provider", (e) =>
      setStatus(e.payload),
    );
    return () => {
      summon.then((f) => f());
      provider.then((f) => f());
    };
  }, []);

  const dismiss = useCallback(() => {
    invoke("dismiss").catch(() => {});
  }, []);

  // Esc dismisses from anywhere in the card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  const runWiggle = useCallback(async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await invoke<Block[]>("wiggle", { text });
      setBlocks(res);
    } catch (e) {
      const msg = String(e);
      setError(msg.includes("no-provider") ? "no-provider" : msg);
    } finally {
      setBusy(false);
    }
  }, [text, busy]);

  const onInputKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      runWiggle();
    }
  };

  const kept = blocks?.filter((b) => b.matters).length ?? 0;
  const statusText = busy
    ? "wiggling…"
    : status.online
      ? `${status.provider} · ${status.model}`
      : "waiting for a model";

  return (
    <div
      className="scrim"
      style={{ background: `rgba(18,16,14,${dim})` }}
      onMouseDown={dismiss}
    >
      <div className="card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mark">
          <span className="brand">WIGGLE</span>
          <span className="dot" data-online={status.online} data-busy={busy} />
          <span className="prov">{statusText}</span>
        </div>

        {blocks === null ? (
          <>
            <textarea
              ref={inputRef}
              className="input"
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              onKeyDown={onInputKey}
              placeholder="Paste the thread, the doc, the wall of text…  ⏎ to wiggle"
              spellCheck={false}
              autoFocus
              rows={3}
            />
            {error === "no-provider" && (
              <p className="hint">
                No model yet. Start <code>maximal</code> (localhost:4141) or Ollama —
                Wiggle connects on its own.
              </p>
            )}
            {error && error !== "no-provider" && (
              <p className="hint err">{error}</p>
            )}
          </>
        ) : (
          <div className="result">
            <p className="summary">
              kept <strong>{kept}</strong> of {blocks.length}
            </p>
            <div className="reading">
              {blocks.map((b) =>
                b.text.trim() === "" ? (
                  <div key={b.index} className="blank" />
                ) : (
                  <p key={b.index} className={b.matters ? "keep" : "fade"}>
                    {b.text}
                  </p>
                ),
              )}
            </div>
            <button className="ghost" onClick={() => setBlocks(null)}>
              ← new text
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
