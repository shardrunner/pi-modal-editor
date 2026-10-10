import assert from "node:assert/strict";
import { test } from "node:test";
import { readSystemClipboard } from "./clipboard.ts";

test("Wayland reads exact Unicode and whitespace from wl-paste, never stale X11", async () => {
  const calls: [string, string[]][] = [];
  const text = " first\n界🙂 \n\n";
  const result = await readSystemClipboard({
    env: { WAYLAND_DISPLAY: "wayland-1", DISPLAY: ":0" },
    run: async (command, args) => { calls.push([command, args]); return text; },
  });
  assert.equal(result, text);
  assert.deepEqual(calls, [["wl-paste", ["--no-newline", "--type", "text"]]]);
});

test("Wayland reader failures are explicit and do not fall back to X11", async () => {
  const calls: string[] = [];
  await assert.rejects(readSystemClipboard({
    env: { WAYLAND_DISPLAY: "wayland-1", DISPLAY: ":0" },
    run: async (command) => { calls.push(command); throw new Error("wl-paste: access denied"); },
  }), /Clipboard unavailable: install wl-clipboard.*wl-paste: access denied/);
  assert.deepEqual(calls, ["wl-paste"]);
});

test("X11 uses CLIPBOARD, with xsel fallback rather than primary selection", async () => {
  const calls: [string, string[]][] = [];
  const result = await readSystemClipboard({
    env: { DISPLAY: ":0" },
    run: async (command, args) => {
      calls.push([command, args]);
      if (command === "xclip") throw new Error("not installed");
      return "clipboard\n";
    },
  });
  assert.equal(result, "clipboard\n");
  assert.deepEqual(calls, [
    ["xclip", ["-selection", "clipboard", "-out"]],
    ["xsel", ["--clipboard", "--output"]],
  ]);
});

test("empty clipboard text stays empty", async () => {
  assert.equal(await readSystemClipboard({ env: { DISPLAY: ":0" }, run: async () => "" }), "");
});

test("headless clipboard reads fail visibly instead of reading an internal register", async () => {
  await assert.rejects(readSystemClipboard({
    env: {},
    run: async () => { throw new Error("must not run a reader"); },
  }), /Clipboard unavailable: no Wayland\/X11 display/);
});
