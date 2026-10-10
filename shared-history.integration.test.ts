import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  CustomEditor, DefaultResourceLoader, getSelectListTheme, initTheme, SettingsManager,
  type ExtensionCommandContext, type ExtensionContext, type ExtensionUIContext, type Theme,
} from "@earendil-works/pi-coding-agent";
import { type Component, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { KeybindingsManager } from "./node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";

// Test-only package boundary: no production dependency on a sibling checkout.
const modalPath = dirname(fileURLToPath(import.meta.url));
const sharedPath = resolve(process.env.PI_SHARED_HISTORY_PACKAGE ?? join(modalPath, "../pi-shared-prompt-history"));
const missingSibling = !process.env.PI_SHARED_HISTORY_PACKAGE && !existsSync(join(sharedPath, "package.json"));

for (const historyFirst of [true, false]) {
  test(`real shared lookup and modal editor are independent (${historyFirst ? "history first" : "modal first"})`, {
    skip: missingSibling ? "set PI_SHARED_HISTORY_PACKAGE to a shared-history checkout" : false,
  }, async (t) => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-modal-history-"));
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    t.after(() => {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
      rmSync(agentDir, { recursive: true, force: true });
    });
    const sharedOnly = "unique-shared-only 界🙂\nfull multiline entry";
    const historyFile = join(agentDir, "shared-prompt-history.jsonl");
    const stored = `${JSON.stringify(sharedOnly)}\n`;
    writeFileSync(historyFile, stored, { mode: 0o600 });
    initTheme("dark", false);
    const packages = historyFirst ? [sharedPath, modalPath] : [modalPath, sharedPath];
    const loader = new DefaultResourceLoader({
      cwd: agentDir, agentDir, settingsManager: SettingsManager.inMemory({ packages }),
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    });
    await loader.reload();
    const { extensions, errors } = loader.getExtensions();
    assert.deepEqual(errors, []);
    assert.deepEqual(extensions.map((extension) => dirname(extension.path)), packages);
    const historyExtension = extensions.find((extension) => extension.commands.has("history"))!;
    const history = historyExtension.commands.get("history")!;
    const bindings = new KeybindingsManager();
    const editorTheme: EditorTheme = { borderColor: (text) => text, selectList: getSelectListTheme() };
    const pickerTheme = { fg: (_role: string, text: string) => text } as Theme;
    const tui = {
      requestRender() {}, getShowHardwareCursor: () => false, setShowHardwareCursor() {},
      terminal: { rows: 30, columns: 80, write() {} },
    } as unknown as TUI;
    let factory: Parameters<ExtensionUIContext["setEditorComponent"]>[0];
    let editor!: CustomEditor;
    let owner = "";
    const installations: string[] = [];
    const restored: string[] = [];
    const ctx = {
      mode: "tui",
      sessionManager: {
        buildContextEntries: () => [{ type: "message", message: { role: "user", content: "native-local-only" } }],
      },
      ui: {
        getEditorComponent() {
          assert.notEqual(dirname(owner), sharedPath, "shared history must not inspect the editor");
          return factory;
        },
        setEditorComponent(next: typeof factory) { installations.push(owner); factory = next; },
        setEditorText(text: string) { restored.push(text); editor.setText(text); },
        pasteToEditor() { assert.fail("lookup must not paste"); },
        notify() { assert.fail("unexpected notification"); },
        async custom(create: Parameters<ExtensionUIContext["custom"]>[0]) {
          let selected: unknown;
          let completed = false;
          const picker = await create(tui, pickerTheme, bindings, (value) => { selected = value; completed = true; }) as Component;
          assert.ok(picker.render(100).join("\n").includes("unique-shared-only"));
          picker.handleInput!("\r");
          assert.equal(completed, true);
          return selected;
        },
      },
    } as unknown as ExtensionCommandContext;

    for (const reason of ["startup", "new", "resume", "fork", "reload"] as const) {
      factory = undefined; // Pi resets extension UI before dispatching session_start.
      installations.length = 0;
      restored.length = 0;
      for (const extension of extensions) {
        owner = extension.path;
        for (const handler of extension.handlers.get("session_start") ?? []) {
          await handler({ type: "session_start", reason }, ctx as ExtensionContext);
        }
      }
      assert.deepEqual(installations, [join(modalPath, "index.ts")], reason);
      editor = factory!(tui, editorTheme, bindings) as CustomEditor;
      assert.ok(editor.render(80).at(-1)!.includes("INSERT"), reason);
      editor.setText("hello");
      let aborted = 0;
      let submitted = 0;
      editor.onEscape = () => { aborted++; };
      editor.onSubmit = () => { submitted++; };
      editor.handleInput("\x1b");
      assert.equal(aborted, 0, "Escape must execute once");
      assert.ok(editor.render(80).at(-1)!.includes("NORMAL"));
      for (const key of "0x") editor.handleInput(key);
      assert.equal(editor.getText(), "ello", "x must execute once");

      // Pi populates the startup editor after session_start; modal restores the
      // session's prompts itself on replacement and reload.
      if (reason === "startup") editor.addToHistory("native-local-only");
      let seeded = 0;
      const addToHistory = editor.addToHistory.bind(editor);
      editor.addToHistory = (text) => { seeded++; addToHistory(text); };
      const checkNative = () => {
        editor.setText("");
        editor.render(80);
        for (const key of ["\x1b[A", "k", "\x1b[A"]) {
          editor.handleInput("0"); // Native browsing requires the cursor at line start.
          editor.handleInput(key);
          assert.equal(editor.getText(), "native-local-only", `${reason}: ${key}`);
        }
      };
      checkNative();
      owner = historyExtension.path;
      await history.handler("unique-shared-only", ctx);
      assert.deepEqual(restored, [sharedOnly]);
      assert.equal(editor.getText(), sharedOnly);
      assert.equal(submitted, 0);
      assert.equal(seeded, 0, "picker must not seed native history");
      assert.equal(installations.length, 1, "picker must not replace the editor");
      assert.equal(readFileSync(historyFile, "utf8"), stored, "selection must not record or submit");
      checkNative(); // Exhaust Up again: no shared-only entry was added.
    }
    for (const extension of extensions) {
      for (const handler of extension.handlers.get("session_shutdown") ?? []) {
        await handler({ type: "session_shutdown" }, ctx as ExtensionContext);
      }
    }
  });
}
