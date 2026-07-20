// Exercises the IPC seam with Tauri's mock bridge (see the
// tauri-debug-test-mock-ipc skill): the client wrappers must call the right
// command with the right args, and surface errors as rejections.
import { afterEach, expect, test } from "bun:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { ingestPath, setTrayLabels, wiggleImage, wiggleText } from "./client";

afterEach(() => clearMocks());

test("wiggleText calls 'wiggle' with the text arg", async () => {
  const seen: Array<{ cmd: string; args: unknown }> = [];
  mockIPC((cmd, args) => {
    seen.push({ cmd, args });
    if (cmd === "wiggle") return [{ index: 0, text: "hi", matters: true }];
    throw new Error(`unmocked: ${cmd}`);
  });

  const res = await wiggleText("hi");
  expect(res).toEqual([{ index: 0, text: "hi", matters: true }]);
  expect(seen[0]).toEqual({ cmd: "wiggle", args: { text: "hi" } });
});

test("wiggleImage forwards mime + data", async () => {
  let captured: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "wiggle_image") {
      captured = args;
      return [];
    }
    throw new Error(`unmocked: ${cmd}`);
  });

  await wiggleImage("image/png", "AAAA");
  expect(captured).toEqual({ mime: "image/png", data: "AAAA" });
});

test("ingestPath returns the classified item", async () => {
  mockIPC((cmd) => {
    if (cmd === "ingest_path") return { kind: "text", name: "n.txt", text: "x" };
    throw new Error(`unmocked: ${cmd}`);
  });

  expect(await ingestPath("/tmp/n.txt")).toEqual({
    kind: "text",
    name: "n.txt",
    text: "x",
  });
});

test("setTrayLabels passes all three labels", async () => {
  let captured: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "set_tray_labels") {
      captured = args;
      return null;
    }
    throw new Error(`unmocked: ${cmd}`);
  });

  await setTrayLabels({ summon: "S", update: "U", quit: "Q" });
  expect(captured).toEqual({ summon: "S", update: "U", quit: "Q" });
});

test("a failing command rejects", async () => {
  mockIPC(() => {
    throw new Error("no-provider");
  });
  await expect(wiggleText("x")).rejects.toThrow("no-provider");
});
