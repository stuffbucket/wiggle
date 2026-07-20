import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { locale as osLocale } from "@tauri-apps/plugin-os";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import i18n, { normalizeLocale } from "./i18n";
import "./App.css";

type Block = { index: number; text: string; matters: boolean };
type ProviderStatus = { online: boolean; provider: string; model: string };

type Ingested =
  | { kind: "text"; name: string; text: string }
  | { kind: "image"; name: string; media_type: string; base64: string }
  | { kind: "file"; name: string; path: string; mime: string; size: number };

type Attachment =
  | { kind: "image"; name: string; mediaType: string; base64: string }
  | { kind: "file"; name: string; path: string; mime: string; size: number };

// Render a single block's text as inline markdown (bold/italic/code/links),
// keeping it on one line and opening links externally.
const mdComponents = {
  p: (props: { children?: React.ReactNode }) => <>{props.children}</>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href) openUrl(href).catch(() => {});
      }}
    >
      {children}
    </a>
  ),
};

function MdLine({ text }: { text: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSanitize]}
      components={mdComponents}
    >
      {text}
    </Markdown>
  );
}

function abToBase64(buf: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

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
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { t } = useTranslation();

  // One-time: read UI config, resolve locale, relocalize the tray, probe status.
  useEffect(() => {
    invoke<{ dim: number; locale: string }>("get_config")
      .then(async (c) => {
        setDim(c.dim);
        let tag = c.locale;
        if (!tag || tag === "auto") {
          tag = (await osLocale().catch(() => null)) ?? "en";
        }
        await i18n.changeLanguage(normalizeLocale(tag));
        invoke("set_tray_labels", {
          summon: i18n.t("tray.summon"),
          quit: i18n.t("tray.quit"),
        }).catch(() => {});
      })
      .catch(() => {});
    invoke<ProviderStatus>("provider_status").then(setStatus).catch(() => {});
  }, []);

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

  const wiggleImage = useCallback(
    async (mediaType: string, base64: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await invoke<Block[]>("wiggle_image", {
          mime: mediaType,
          data: base64,
        });
        setBlocks(res);
      } catch (e) {
        const msg = String(e);
        setError(msg.includes("no-provider") ? "no-provider" : msg);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const runWiggle = useCallback(async () => {
    // An attached image takes precedence over typed text.
    if (attachment?.kind === "image") {
      wiggleImage(attachment.mediaType, attachment.base64);
      return;
    }
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
  }, [text, busy, attachment, wiggleImage]);

  // Drag & drop of files/screenshots via Tauri's webview drop events.
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "over") {
        setDragging(true);
        return;
      }
      if (event.payload.type === "leave") {
        setDragging(false);
        return;
      }
      // "drop"
      setDragging(false);
      const paths = event.payload.paths ?? [];
      void (async () => {
        for (const path of paths) {
          try {
            const item = await invoke<Ingested>("ingest_path", { path });
            if (item.kind === "text") {
              setBlocks(null);
              setAttachment(null);
              setText((prev) => (prev ? `${prev}\n${item.text}` : item.text));
            } else if (item.kind === "image") {
              setBlocks(null);
              setAttachment({
                kind: "image",
                name: item.name,
                mediaType: item.media_type,
                base64: item.base64,
              });
              wiggleImage(item.media_type, item.base64);
            } else {
              setAttachment({
                kind: "file",
                name: item.name,
                path: item.path,
                mime: item.mime,
                size: item.size,
              });
            }
          } catch {
            /* ignore unreadable drops */
          }
        }
      })();
    });
    return () => {
      un.then((f) => f());
    };
  }, [wiggleImage]);

  // Paste an image straight from the clipboard.
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          e.preventDefault();
          const file = it.getAsFile();
          if (!file) continue;
          const b64 = abToBase64(await file.arrayBuffer());
          setBlocks(null);
          setAttachment({
            kind: "image",
            name: "pasted",
            mediaType: it.type,
            base64: b64,
          });
          wiggleImage(it.type, b64);
          return;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [wiggleImage]);

  const onInputKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      runWiggle();
    }
  };

  const clearAttachment = () => setAttachment(null);

  const copyKept = useCallback(() => {
    const t = (blocks ?? [])
      .filter((b) => b.matters)
      .map((b) => b.text)
      .join("\n");
    navigator.clipboard.writeText(t).catch(() => {});
  }, [blocks]);

  const kept = blocks?.filter((b) => b.matters).length ?? 0;
  const statusText = busy
    ? t("status.wiggling")
    : status.online
      ? `${status.provider} · ${status.model}`
      : t("status.waiting");

  return (
    <div
      className="scrim"
      style={{ background: `rgba(18,16,14,${dim})` }}
      onMouseDown={dismiss}
    >
      <div
        className={`card${dragging ? " dragging" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mark">
          <span className="brand">WIGGLE</span>
          <span className="dot" data-online={status.online} data-busy={busy} />
          <span className="prov">{statusText}</span>
        </div>

        {attachment && (
          <div className="attach">
            {attachment.kind === "image" ? (
              <img
                className="thumb"
                src={`data:${attachment.mediaType};base64,${attachment.base64}`}
                alt={attachment.name}
              />
            ) : (
              <span className="fileicon">▤</span>
            )}
            <span className="attname">
              {attachment.name}
              {attachment.kind === "file" && (
                <span className="attmeta"> · {humanSize(attachment.size)}</span>
              )}
            </span>
            {attachment.kind === "file" && (
              <>
                <button
                  className="tinybtn"
                  onClick={() => openPath(attachment.path).catch(() => {})}
                >
                  {t("action.open")}
                </button>
                <button
                  className="tinybtn"
                  onClick={() =>
                    revealItemInDir(attachment.path).catch(() => {})
                  }
                >
                  {t("action.reveal")}
                </button>
              </>
            )}
            <button className="x" onClick={clearAttachment} aria-label="remove">
              ×
            </button>
          </div>
        )}

        {blocks === null ? (
          <>
            <textarea
              ref={inputRef}
              className="input"
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              onKeyDown={onInputKey}
              placeholder={
                dragging ? t("placeholder.drop") : t("placeholder.default")
              }
              spellCheck={false}
              autoFocus
              rows={3}
            />
            {error === "no-provider" && (
              <p className="hint">{t("hint.noProvider")}</p>
            )}
            {error && error !== "no-provider" && (
              <p className="hint err">{error}</p>
            )}
          </>
        ) : (
          <div className="result">
            <p className="summary">
              {t("summary", { kept, total: blocks.length })}
              <span className="actions">
                <button className="tinybtn" onClick={copyKept}>
                  {t("action.copyKept")}
                </button>
                <button
                  className="tinybtn"
                  onClick={() => setExpanded((v) => !v)}
                >
                  {expanded ? t("action.collapse") : t("action.expand")}
                </button>
              </span>
            </p>
            <div className={`reading${expanded ? " expanded" : ""}`}>
              {blocks.map((b) =>
                b.text.trim() === "" ? (
                  <div key={b.index} className="blank" />
                ) : (
                  <p key={b.index} className={b.matters ? "keep" : "fade"}>
                    <MdLine text={b.text} />
                  </p>
                ),
              )}
            </div>
            <button
              className="ghost"
              onClick={() => {
                setBlocks(null);
                setAttachment(null);
                setExpanded(false);
              }}
            >
              {t("action.new")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
