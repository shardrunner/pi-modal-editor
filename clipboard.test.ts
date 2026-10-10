import assert from "node:assert/strict";
import { test } from "node:test";
import { readSystemClipboard } from "./clipboard.ts";

const unavailable = async () => undefined;

test("Wayland reads exact Unicode and whitespace from wl-paste, never stale X11", async () => {
  const calls: [string, string[]][] = [];
  const text = " first\n界🙂 \n\n";
  const result = await readSystemClipboard({
    platform: "linux", env: { WAYLAND_DISPLAY: "wayland-1", DISPLAY: ":0" },
    nativeRead: async () => { throw new Error("must not read X11"); },
    run: async (command, args) => { calls.push([command, args]); return text; },
  });
  assert.equal(result, text);
  assert.deepEqual(calls, [["wl-paste", ["--no-newline", "--type", "text"]]]);
});

test("Wayland reader failures are explicit and do not fall back to X11", async () => {
  const calls: string[] = [];
  await assert.rejects(readSystemClipboard({
    platform: "linux", env: { WAYLAND_DISPLAY: "wayland-1", DISPLAY: ":0" },
    nativeRead: async () => "stale",
    run: async (command) => { calls.push(command); throw new Error("wl-paste: access denied"); },
  }), /Clipboard unavailable: install wl-clipboard.*wl-paste: access denied/);
  assert.deepEqual(calls, ["wl-paste"]);
});

test("X11 uses CLIPBOARD, with xsel fallback rather than primary selection", async () => {
  const calls: [string, string[]][] = [];
  const result = await readSystemClipboard({
    platform: "linux", env: { DISPLAY: ":0" }, nativeRead: unavailable,
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

test("empty clipboard text stays empty instead of falling back to stale data", async () => {
  const result = await readSystemClipboard({
    platform: "linux", env: { DISPLAY: ":0" }, nativeRead: async () => "stale",
    run: async () => "",
  });
  assert.equal(result, "");
});

for (const platform of ["darwin", "win32"]) {
  test(`${platform} uses the native clipboard and distinguishes unavailable from empty`, async () => {
    for (const value of ["界🙂\n", "", null]) {
      assert.equal(await readSystemClipboard({
        platform, env: {}, nativeRead: async () => value,
        run: async () => { throw new Error("must not run a fallback"); },
      }), value);
    }
  });
}

test("macOS falls back to pbpaste if the native clipboard is unavailable", async () => {
  const calls: string[] = [];
  assert.equal(await readSystemClipboard({
    platform: "darwin", env: {}, nativeRead: unavailable,
    run: async (command) => { calls.push(command); return "text"; },
  }), "text");
  assert.deepEqual(calls, ["pbpaste"]);
});

test("Windows and headless WSL fall back to UTF-8 PowerShell without adding a newline", async () => {
  for (const platform of ["win32", "linux"]) {
    assert.equal(await readSystemClipboard({
      platform, env: { WSL_DISTRO_NAME: "Ubuntu" }, nativeRead: unavailable,
      run: async (command, args) => {
        assert.equal(command, "powershell.exe");
        assert.ok(args.at(-1)?.includes("UTF8Encoding"));
        assert.ok(args.at(-1)?.includes("[Console]::Write($text)"));
        return "界🙂";
      },
    }), "界🙂");
  }
});

test("Termux reads its standard clipboard", async () => {
  assert.equal(await readSystemClipboard({
    platform: "android", env: { TERMUX_VERSION: "test" }, nativeRead: unavailable,
    run: async (command, args) => {
      assert.equal(command, "termux-clipboard-get");
      assert.deepEqual(args, []);
      return "text";
    },
  }), "text");
});

test("headless clipboard reads fail visibly instead of reading an internal register", async () => {
  await assert.rejects(readSystemClipboard({
    platform: "linux", env: {}, nativeRead: unavailable,
    run: async () => { throw new Error("must not query the terminal clipboard"); },
  }), /Clipboard unavailable: use your terminal's paste shortcut/);
});
