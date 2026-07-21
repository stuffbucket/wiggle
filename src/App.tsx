import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { locale as osLocale } from "@tauri-apps/plugin-os";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import {
  Attach20Regular,
  Checkmark20Filled,
  Copy20Regular,
  Dismiss20Regular,
  Open20Regular,
  OpenFolder20Regular,
  Send20Filled,
} from "@fluentui/react-icons";
import i18n, { normalizeLocale } from "./i18n";
import {
  dismiss as dismissCmd,
  getConfig,
  ingestPath,
  listModels,
  providerStatus,
  setModel,
  setTrayLabels,
  wiggleImage as wiggleImageCmd,
  wiggleText,
  type Block,
  type ProviderStatus,
} from "./lib/client";
import { abToBase64, humanSize } from "./lib/format";
import { wantsHistoryDown, wantsHistoryUp } from "./lib/history";
import { markSeed, strikePath } from "./lib/strike";
import { IconButton } from "./lib/IconButton";
import markUrl from "./assets/wiggle-mark.svg";
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
type Strike = { d: string; delay: number };

const IDLE_MS = 90_000;
const HISTORY_CAP = 25;

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

const shortModel = (m: string) =>
  m.replace(/^claude-/, "").replace(/-\d{6,8}$/, "");

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
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [entries, setEntries] = useState<Interaction[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [strikes, setStrikes] = useState<Strike[]>([]);
  const [strikeH, setStrikeH] = useState(0);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const readingRef = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(false);
  const draftRef = useRef("");
  const lastSummonRef = useRef(Date.now());
  const programmaticRef = useRef(false);
  const idRef = useRef(0);
  const nonceRef = useRef(1);
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

  const resetToDraft = useCallback(
    (draft = "") => {
      programmaticRef.current = true;
      setText(draft);
      setBlocks(null);
      setCommitted("");
      setPhase("idle");
      setAttachment(null);
      setError(null);
      setCursor(null);
      dirtyRef.current = false;
      focusInput(draft.length);
    },
    [focusInput],
  );

  const loadInteraction = useCallback(
    (it: Interaction) => {
      programmaticRef.current = true;
      nonceRef.current = (nonceRef.current + 1) & 0x7fffffff;
      setText(it.input);
      setCommitted(it.input);
      setBlocks(it.blocks);
      setAttachment(it.attachment);
      setPhase("result");
      setError(null);
      dirtyRef.current = false;
      focusInput(it.input.length);
    },
    [focusInput],
  );

  // config + locale + tray + status
  useEffect(() => {
    getConfig()
      .then(async (c) => {
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

  // summon + provider events
  useEffect(() => {
    const summon = listen("wiggle://summon", () => {
      const now = Date.now();
      const idle = now - lastSummonRef.current;
      lastSummonRef.current = now;
      const live = liveRef.current;
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (pickerOpen) setPickerOpen(false);
        else dismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss, pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  // Measure filler lines and generate a hand-drawn brush strike per visual line.
  useLayoutEffect(() => {
    const cont = readingRef.current;
    if (phase !== "result" || !blocks || !cont) {
      setStrikes([]);
      return;
    }
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const cRect = cont.getBoundingClientRect();
      const st = cont.scrollTop;
      const sl = cont.scrollLeft;
      const nonce = nonceRef.current;
      const out: Strike[] = [];
      let order = 0;
      cont.querySelectorAll<HTMLElement>(".block.filler").forEach((el, bi) => {
        const rects = el.getClientRects();
        for (let ri = 0; ri < rects.length; ri++) {
          const r = rects[ri];
          if (r.width < 6) continue;
          const y = r.top - cRect.top + st + r.height * 0.58;
          const x1 = r.left - cRect.left + sl;
          const x2 = r.right - cRect.left + sl;
          out.push({
            d: strikePath(x1, x2, y, markSeed(bi, ri, nonce)),
            delay: order * 55,
          });
          order++;
        }
      });
      setStrikes(out);
      setStrikeH(cont.scrollHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(cont);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => {
      cancelled = true;
      ro.disconnect();
    };
  }, [phase, blocks]);

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
      setCursor(null);
      try {
        const res = await wiggleImageCmd(mediaType, base64);
        nonceRef.current = (nonceRef.current + 1) & 0x7fffffff;
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

  const runWiggle = useCallback(async () => {
    if (phase === "judging") return;
    const isImage = attachment?.kind === "image";
    if (!isImage && !text.trim()) return;

    if (blocks) {
      archive({ id: idRef.current++, input: committed, blocks, attachment });
    }

    const shown = isImage ? "" : text;
    programmaticRef.current = true;
    setCommitted(shown);
    setBlocks(null);
    setPhase("judging");
    setError(null);
    setCursor(null);
    draftRef.current = "";
    setText("");
    dirtyRef.current = false;
    setTimeout(() => (programmaticRef.current = false), 0);

    try {
      const res = isImage
        ? await wiggleImageCmd(attachment.mediaType, attachment.base64)
        : await wiggleText(shown);
      nonceRef.current = (nonceRef.current + 1) & 0x7fffffff;
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
        setText(shown);
        focusInput(shown.length);
      }
    }
  }, [phase, attachment, text, blocks, committed, archive, focusInput]);

  // drag & drop
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
            /* ignore */
          }
        }
      })();
    });
    return () => {
      un.then((f) => f());
    };
  }, [resetToDraft, wiggleImage]);

  // paste image
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

  const openPicker = () => {
    setPickerOpen((o) => !o);
    if (models.length === 0) listModels().then(setModels).catch(() => {});
  };
  const chooseModel = (m: string) => {
    setModel(m)
      .then(() => setStatus((s) => ({ ...s, model: m })))
      .catch(() => {});
    setPickerOpen(false);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!f) return;
    if (f.type.startsWith("image/")) {
      const b64 = abToBase64(await f.arrayBuffer());
      setAttachment({
        kind: "image",
        name: f.name,
        mediaType: f.type,
        base64: b64,
      });
      wiggleImage(f.type, b64);
    } else {
      resetToDraft(await f.text());
    }
  };

  const kept = (blocks ?? []).filter(
    (b) => b.matters && b.text.trim() !== "",
  ).length;
  const canSend =
    phase !== "judging" && (attachment?.kind === "image" || text.trim() !== "");

  return (
    <div className="scrim" onMouseDown={dismiss}>
      <div className="card" onMouseDown={(e) => e.stopPropagation()}>
        {/* output above the input */}
        {phase !== "idle" && (
          <div className="reading" ref={readingRef}>
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
              : (blocks ?? []).map((b) =>
                  b.text.trim() === "" ? (
                    <div key={b.index} className="blank" />
                  ) : (
                    <p
                      key={b.index}
                      className={`block${b.matters ? "" : " filler"}`}
                    >
                      <MdLine text={b.text} />
                    </p>
                  ),
                )}
            {phase === "result" && strikes.length > 0 && (
              <svg
                className="strikes"
                width="100%"
                height={strikeH}
                aria-hidden
              >
                {strikes.map((s, i) => (
                  <path
                    key={i}
                    d={s.d}
                    className="strike"
                    style={{ animationDelay: `${s.delay}ms` }}
                  />
                ))}
              </svg>
            )}
          </div>
        )}

        {phase === "result" && blocks && kept > 0 && (
          <div className="outbar">
            <IconButton
              label={copied ? t("action.copied") : t("action.copy")}
              onClick={copyKept}
            >
              {copied ? <Checkmark20Filled className="ok" /> : <Copy20Regular />}
            </IconButton>
          </div>
        )}

        {phase !== "idle" && <div className="divider" />}

        {attachment && (
          <div className="chip">
            {attachment.kind === "image" ? (
              <img
                className="thumb"
                src={`data:${attachment.mediaType};base64,${attachment.base64}`}
                alt={attachment.name}
              />
            ) : (
              <span className="fileicon">▤</span>
            )}
            <span className="name">
              {attachment.name}
              {attachment.kind === "file" && (
                <span className="meta"> · {humanSize(attachment.size)}</span>
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

        {/* input row — anchored at the bottom */}
        <div className={`inputrow${dragging ? " dragover" : ""}`}>
          <img className="mark" src={markUrl} alt="Wiggle" />
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
            rows={1}
          />
          {cursor !== null && (
            <span className="histpos">
              ‹ {cursor + 1}/{entries.length}
            </span>
          )}
          <div className="rowtrail">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,text/*"
              hidden
              onChange={onFile}
            />
            <IconButton
              label={t("action.attach")}
              onClick={() => fileRef.current?.click()}
            >
              <Attach20Regular />
            </IconButton>
            <div className="modelpick" ref={pickerRef}>
              <button
                className="modelbtn"
                onClick={openPicker}
                title={status.model}
              >
                <span
                  className="dot"
                  data-online={status.online}
                  data-busy={phase === "judging"}
                />
                <span className="name">
                  {status.model
                    ? shortModel(status.model)
                    : t("status.waiting")}
                </span>
                <span aria-hidden>▾</span>
              </button>
              {pickerOpen && (
                <div className="modelmenu">
                  {models.length === 0 ? (
                    <div className="modelitem">…</div>
                  ) : (
                    models.map((m) => (
                      <button
                        key={m}
                        className="modelitem"
                        data-sel={m === status.model}
                        onClick={() => chooseModel(m)}
                      >
                        {shortModel(m)}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <button
              className="send"
              onClick={runWiggle}
              disabled={!canSend}
              aria-label="Wiggle"
              title="Wiggle (⏎)"
            >
              <Send20Filled />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
