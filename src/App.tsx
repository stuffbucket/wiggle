import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { locale as osLocale } from "@tauri-apps/plugin-os";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import {
  ArrowCounterclockwise20Regular,
  ArrowMaximize20Regular,
  ArrowMinimize20Regular,
  Checkmark20Filled,
  Copy20Regular,
  Dismiss20Regular,
  Open20Regular,
  OpenFolder20Regular,
  Settings20Regular,
} from "@fluentui/react-icons";
import i18n, { normalizeLocale } from "./i18n";
import {
  dismiss as dismissCmd,
  getConfig,
  ingestPath,
  providerStatus,
  setTrayLabels,
  settingsPath,
  wiggleImage as wiggleImageCmd,
  wiggleText,
  type Block,
  type ProviderStatus,
} from "./lib/client";
import { abToBase64, humanSize } from "./lib/format";
import { fillerDelays, wantsHistoryDown, wantsHistoryUp } from "./lib/history";
import { IconButton } from "./lib/IconButton";
import "./App.css";

type Attachment =
  | { kind: "image"; name: string; mediaType: string; base64: string }
  | { kind: "file"; name: string; path: string; mime: string; size: number };

type Interaction = {
  id: number;
  input: string;
  blocks: Block[];
  attachment: Attachment | null;
};

type Phase = "idle" | "judging" | "result";

const IDLE_MS = 90_000;
const HISTORY_CAP = 25;

// Render one block's text as inline markdown, opening links externally.
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

function App() {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [committed, setCommitted] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [status, setStatus] = useState<ProviderStatus>({
    online: false,
    provider: "",
    model: "",
  });
  const [dim, setDim] = useState(0.18);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [entries, setEntries] = useState<Interaction[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dirtyRef = useRef(false);
  const draftRef = useRef("");
  const lastSummonRef = useRef(Date.now());
  const programmaticRef = useRef(false);
  const idRef = useRef(0);
  // Mirror state the once-registered summon listener needs to read.
  const liveRef = useRef({ blocks, committed, attachment });
  useEffect(() => {
    liveRef.current = { blocks, committed, attachment };
  }, [blocks, committed, attachment]);

  const archive = useCallback((it: Interaction) => {
    setEntries((e) => [...e, it].slice(-HISTORY_CAP));
  }, []);

  const focusInput = useCallback((caret?: number) => {
    setTimeout(() => {
      const ta = inputRef.current;
      if (!ta) return;
      ta.focus();
      if (caret !== undefined) ta.setSelectionRange(caret, caret);
      programmaticRef.current = false;
    }, 0);
  }, []);

  // Reset to a fresh (or restored-draft) live prompt.
  const resetToDraft = useCallback(
    (draft = "") => {
      programmaticRef.current = true;
      setText(draft);
      setBlocks(null);
      setCommitted("");
      setPhase("idle");
      setAttachment(null);
      setError(null);
      setExpanded(false);
      setCursor(null);
      dirtyRef.current = false;
      focusInput(draft.length);
    },
    [focusInput],
  );

  // Recall a past interaction: fill the prompt with its input, show its result.
  const loadInteraction = useCallback(
    (it: Interaction) => {
      programmaticRef.current = true;
      setText(it.input);
      setCommitted(it.input);
      setBlocks(it.blocks);
      setAttachment(it.attachment);
      setPhase("result");
      setError(null);
      setExpanded(false);
      dirtyRef.current = false;
      focusInput(it.input.length);
    },
    [focusInput],
  );

  // One-time: config, locale, tray labels, provider status.
  useEffect(() => {
    getConfig()
      .then(async (c) => {
        setDim(c.dim);
        let tag = c.locale;
        if (!tag || tag === "auto") {
          tag = (await osLocale().catch(() => null)) ?? "en";
        }
        await i18n.changeLanguage(normalizeLocale(tag));
        setTrayLabels({
          summon: i18n.t("tray.summon"),
          update: i18n.t("tray.checkUpdates"),
          quit: i18n.t("tray.quit"),
        }).catch(() => {});
      })
      .catch(() => {});
    providerStatus().then(setStatus).catch(() => {});
  }, []);

  // Summon + provider events.
  useEffect(() => {
    const summon = listen("wiggle://summon", () => {
      const now = Date.now();
      const idle = now - lastSummonRef.current;
      lastSummonRef.current = now;
      const live = liveRef.current;
      // If we've been away a while and a result is on screen, archive it and
      // present a fresh prompt (the old output is stale). Otherwise keep working.
      if (live.blocks && idle >= IDLE_MS) {
        archive({
          id: idRef.current++,
          input: live.committed,
          blocks: live.blocks,
          attachment: live.attachment,
        });
        resetToDraft("");
      } else {
        setTimeout(() => inputRef.current?.focus(), 30);
      }
    });
    const provider = listen<ProviderStatus>("wiggle://provider", (e) =>
      setStatus(e.payload),
    );
    return () => {
      summon.then((f) => f());
      provider.then((f) => f());
    };
  }, [archive, resetToDraft]);

  const dismiss = useCallback(() => {
    dismissCmd().catch(() => {});
  }, []);

  // Esc dismisses.
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

  // Filler blocks fade in (staggered) after each result mounts.
  useEffect(() => {
    if (phase === "result" && blocks) {
      setRevealed(false);
      const id = requestAnimationFrame(() =>
        requestAnimationFrame(() => setRevealed(true)),
      );
      return () => cancelAnimationFrame(id);
    }
  }, [phase, blocks]);

  const runWiggle = useCallback(async () => {
    if (phase === "judging") return;
    const isImage = attachment?.kind === "image";
    if (!isImage && !text.trim()) return;

    // Archive the currently-shown interaction before starting a new one.
    if (blocks) {
      archive({
        id: idRef.current++,
        input: committed,
        blocks,
        attachment,
      });
    }

    const shown = isImage ? "" : text;
    programmaticRef.current = true;
    setCommitted(shown);
    setBlocks(null);
    setPhase("judging");
    setError(null);
    setRevealed(false);
    setCursor(null);
    draftRef.current = "";
    setText(""); // text commits to the reading view; prompt clears
    dirtyRef.current = false;
    setTimeout(() => (programmaticRef.current = false), 0);

    try {
      const res = isImage
        ? await wiggleImageCmd(attachment.mediaType, attachment.base64)
        : await wiggleText(shown);
      setBlocks(res);
      setPhase("result");
      if (!isImage) setAttachment(null);
    } catch (e) {
      const msg = String(e);
      setError(msg.includes("no-provider") ? "no-provider" : msg);
      setPhase("idle");
      setCommitted("");
      if (!isImage) {
        programmaticRef.current = true;
        setText(shown); // restore so the user can retry
        focusInput(shown.length);
      }
    }
  }, [phase, attachment, text, blocks, committed, archive, focusInput]);

  const startOver = useCallback(() => {
    if (blocks) {
      archive({ id: idRef.current++, input: committed, blocks, attachment });
    }
    resetToDraft("");
  }, [blocks, committed, attachment, archive, resetToDraft]);

  const wiggleImage = useCallback(
    async (mediaType: string, base64: string) => {
      const live = liveRef.current;
      if (live.blocks) {
        archive({
          id: idRef.current++,
          input: live.committed,
          blocks: live.blocks,
          attachment: live.attachment,
        });
      }
      setBlocks(null);
      setCommitted("");
      setPhase("judging");
      setError(null);
      setRevealed(false);
      setCursor(null);
      try {
        const res = await wiggleImageCmd(mediaType, base64);
        setBlocks(res);
        setPhase("result");
      } catch (e) {
        const msg = String(e);
        setError(msg.includes("no-provider") ? "no-provider" : msg);
        setPhase("idle");
      }
    },
    [archive],
  );

  // Drag & drop of files/screenshots.
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
      setDragging(false);
      const paths = event.payload.paths ?? [];
      void (async () => {
        for (const path of paths) {
          try {
            const item = await ingestPath(path);
            if (item.kind === "text") {
              resetToDraft(item.text);
            } else if (item.kind === "image") {
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
  }, [resetToDraft, wiggleImage]);

  // Paste an image from the clipboard.
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

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!programmaticRef.current) dirtyRef.current = true;
    setText(e.currentTarget.value);
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      runWiggle();
      return;
    }
    const caret = {
      selectionStart: ta.selectionStart,
      selectionEnd: ta.selectionEnd,
      value: ta.value,
    };
    if (e.key === "ArrowUp" && wantsHistoryUp(caret, dirtyRef.current)) {
      if (entries.length === 0) return;
      e.preventDefault();
      if (cursor === null) {
        draftRef.current = ta.value;
        const i = entries.length - 1;
        setCursor(i);
        loadInteraction(entries[i]);
      } else if (cursor > 0) {
        const i = cursor - 1;
        setCursor(i);
        loadInteraction(entries[i]);
      }
    } else if (e.key === "ArrowDown" && wantsHistoryDown(caret, dirtyRef.current)) {
      if (cursor === null) return;
      e.preventDefault();
      if (cursor < entries.length - 1) {
        const i = cursor + 1;
        setCursor(i);
        loadInteraction(entries[i]);
      } else {
        resetToDraft(draftRef.current);
      }
    }
  };

  const copyKept = useCallback(() => {
    const kept = (blocks ?? [])
      .filter((b) => b.matters)
      .map((b) => b.text)
      .join("\n");
    navigator.clipboard.writeText(kept).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [blocks]);

  const openSettings = useCallback(() => {
    settingsPath()
      .then((p) => openPath(p))
      .catch(() => {});
  }, []);

  const nonBlank = (blocks ?? []).filter((b) => b.text.trim() !== "");
  const kept = nonBlank.filter((b) => b.matters).length;
  const total = nonBlank.length;
  const filler = total - kept;
  const delays = blocks ? fillerDelays(blocks.map((b) => b.matters)) : [];

  const statusText =
    phase === "judging"
      ? t("status.judging")
      : status.online
        ? `${status.provider} · ${status.model}`
        : t("status.waiting");

  const verdictMsg =
    filler === 0
      ? t("verdict.allKept")
      : kept === 0
        ? t("verdict.allFiller")
        : t("verdict.trimmed", { filler, total, kept });

  return (
    <div
      className="scrim"
      style={{ background: `rgba(18,16,14,${dim})` }}
      onMouseDown={dismiss}
    >
      <div
        className={`card${dragging ? " dragging" : ""}${cursor !== null ? " history" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="mark">
          <div className="brandcluster">
            <span className="brand">WIGGLE</span>
            <span
              className="dot"
              data-online={status.online}
              data-busy={phase === "judging"}
            />
            <span className="prov">{statusText}</span>
          </div>
          <div className="headctl">
            {cursor !== null && (
              <span className="histpos">
                {t("history.position", {
                  pos: cursor + 1,
                  total: entries.length,
                })}
              </span>
            )}
            <IconButton label={t("action.settings")} onClick={openSettings}>
              <Settings20Regular />
            </IconButton>
            <IconButton label={t("action.dismiss")} onClick={dismiss}>
              <Dismiss20Regular />
            </IconButton>
          </div>
        </header>

        {phase !== "idle" && (
          <div className={`reading${expanded ? " expanded" : ""}`}>
            {phase === "judging" && <div className="scan-band" aria-hidden />}
            {phase === "judging"
              ? committed.split("\n").map((line, i) =>
                  line.trim() === "" ? (
                    <div key={i} className="blank" />
                  ) : (
                    <p key={i} className="block">
                      <MdLine text={line} />
                    </p>
                  ),
                )
              : (blocks ?? []).map((b, i) =>
                  b.text.trim() === "" ? (
                    <div key={b.index} className="blank" />
                  ) : (
                    <p
                      key={b.index}
                      className={`block${b.matters ? "" : revealed ? " filler" : ""}`}
                      style={
                        b.matters
                          ? undefined
                          : { transitionDelay: `${delays[i] ?? 0}ms` }
                      }
                    >
                      <MdLine text={b.text} />
                    </p>
                  ),
                )}
          </div>
        )}

        {phase === "result" && blocks && (
          <div className="resultbar">
            <span className="verdict">
              {filler === 0 && <Checkmark20Filled className="vcheck" />}
              {verdictMsg}
            </span>
            <span className="rctl">
              <IconButton
                label={copied ? t("action.copied") : t("action.copy")}
                onClick={copyKept}
              >
                {copied ? (
                  <Checkmark20Filled className="ok" />
                ) : (
                  <Copy20Regular />
                )}
              </IconButton>
              <IconButton
                label={expanded ? t("action.collapse") : t("action.expand")}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? <ArrowMinimize20Regular /> : <ArrowMaximize20Regular />}
              </IconButton>
              <IconButton label={t("action.new")} onClick={startOver}>
                <ArrowCounterclockwise20Regular />
              </IconButton>
            </span>
          </div>
        )}

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
                <IconButton
                  label={t("action.open")}
                  onClick={() => openPath(attachment.path).catch(() => {})}
                >
                  <Open20Regular />
                </IconButton>
                <IconButton
                  label={t("action.reveal")}
                  onClick={() =>
                    revealItemInDir(attachment.path).catch(() => {})
                  }
                >
                  <OpenFolder20Regular />
                </IconButton>
              </>
            )}
            <IconButton
              label={t("action.remove")}
              onClick={() => setAttachment(null)}
            >
              <Dismiss20Regular />
            </IconButton>
          </div>
        )}

        {error === "no-provider" && <p className="hint">{t("hint.noProvider")}</p>}
        {error && error !== "no-provider" && <p className="hint err">{error}</p>}

        <textarea
          ref={inputRef}
          className="input"
          value={text}
          onChange={onChange}
          onKeyDown={onInputKey}
          placeholder={
            dragging ? t("placeholder.drop") : t("placeholder.default")
          }
          spellCheck={false}
          autoFocus
          rows={phase === "idle" ? 3 : 1}
        />
      </div>
    </div>
  );
}

export default App;
