import assert from "node:assert/strict";
import { test } from "node:test";
import { CustomEditor, getSelectListTheme, initTheme, type ExtensionAPI, type ExtensionContext, type ExtensionHandler, type ExtensionUIContext, type SessionStartEvent } from "@earendil-works/pi-coding-agent";
import { type EditorTheme, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { KeybindingsManager } from "./node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import modalEditor, { addModalKeys } from "./index.ts";

initTheme("dark", false);
const theme: EditorTheme = { borderColor: (text) => text, selectList: getSelectListTheme() };
const tui = { requestRender() {}, terminal: { rows: 30, columns: 80 } } as unknown as TUI;
const bindings = new KeybindingsManager();

function create(text: string) {
  const editor = new CustomEditor(tui, theme, bindings);
  addModalKeys(editor, tui);
  editor.setText(text);
  editor.render(80);
  return editor;
}
function keys(editor: CustomEditor, text: string) {
  for (const key of text) editor.handleInput(key);
}
function normal(editor: CustomEditor) { editor.handleInput("\x1b"); }

test("starts in insert mode; normal mode owns only its keys", () => {
  const editor = create("");
  keys(editor, "hello");
  normal(editor);
  keys(editor, "q");
  assert.equal(editor.getText(), "hello");
  keys(editor, "0li!");
  assert.equal(editor.getText(), "h!ello");
  normal(editor);
  keys(editor, "ax");
  assert.equal(editor.getText(), "h!exllo");
});

test("hjkl forwards arrows, including movement through visually wrapped rows", () => {
  const text = "one two three four five six seven eight nine";
  const modal = create(text);
  const reference = new CustomEditor(tui, theme, bindings);
  reference.setText(text);
  modal.render(14);
  reference.render(14);
  normal(modal);
  const arrows: Record<string, string> = { h: "\x1b[D", j: "\x1b[B", k: "\x1b[A", l: "\x1b[C" };
  for (const key of "kkhjl") {
    keys(modal, key);
    reference.handleInput(arrows[key]);
    assert.deepEqual(modal.getCursor(), reference.getCursor());
  }
});

test("gg/G stay within the prompt instead of browsing history", () => {
  const editor = create("first\nsecond\nlast long line");
  editor.addToHistory("older prompt");
  editor.render(10);
  normal(editor);
  keys(editor, "gg");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
  keys(editor, "gg");
  assert.equal(editor.getText(), "first\nsecond\nlast long line");
  keys(editor, "G");
  assert.deepEqual(editor.getCursor(), { line: 2, col: 0 });
  keys(editor, "G");
  assert.equal(editor.getText(), "first\nsecond\nlast long line");
});

for (const [name, text, navigation, expected, line] of [
  ["first", "one\ntwo\nthree", "gg", "two\nthree", 0],
  ["middle", "one\ntwo\nthree", "ggj", "one\nthree", 1],
  ["last", "one\ntwo\nthree", "G", "one\ntwo", 1],
  ["only", "only", "", "", 0],
  ["empty middle", "one\n\nthree", "ggj", "one\nthree", 1],
  ["empty last", "one\n", "G", "one", 0],
  ["empty prompt", "", "", "", 0],
  ["Unicode", "one\n界🙂é\nthree", "ggj", "one\nthree", 1],
] as const) {
  test(`dd deletes the ${name} line`, () => {
    const editor = create(text);
    normal(editor);
    keys(editor, `${navigation}dd`);
    assert.equal(editor.getText(), expected);
    assert.deepEqual(editor.getCursor(), { line, col: 0 });
  });
}

test("yy/p/P are linewise; dd does not replace the yank register or kill ring", () => {
  const editor = create("saved\ndelete\nlast");
  normal(editor);
  keys(editor, "ggyyjddp");
  assert.equal(editor.getText(), "saved\nlast\nsaved");
  assert.deepEqual(editor.getCursor(), { line: 2, col: 0 });
  keys(editor, "P");
  assert.equal(editor.getText(), "saved\nlast\nsaved\nsaved");
  const before = editor.getText();
  editor.handleInput("\x19"); // Ctrl+Y: native kill ring must still be empty.
  assert.equal(editor.getText(), before);
});

test("p with no yank is a no-op; an empty line can be yanked", () => {
  const editor = create("\nlast");
  normal(editor);
  keys(editor, "pggyyGp");
  assert.equal(editor.getText(), "\nlast\n");
});

test("x deletes a grapheme, not a line break", () => {
  const editor = create("界🙂\nnext");
  normal(editor);
  keys(editor, "ggx");
  assert.equal(editor.getText(), "🙂\nnext");
  keys(editor, "$x");
  assert.equal(editor.getText(), "🙂\nnext");
});

test("an interrupted two-key command does not linger", () => {
  const editor = create("one\ntwo");
  normal(editor);
  keys(editor, "dgGd");
  assert.equal(editor.getText(), "one\ntwo");
  editor.handleInput("\x1b");
  keys(editor, "d");
  assert.equal(editor.getText(), "one\ntwo");
});

test("application shortcuts, callbacks, and history still work on the same instance", () => {
  const editor = create("draft");
  let aborted = 0;
  let submitted = "";
  editor.onEscape = () => { aborted++; };
  editor.onSubmit = (text) => { submitted = text; };
  editor.addToHistory("older prompt");
  normal(editor);
  assert.equal(aborted, 0);
  editor.handleInput("\x1b");
  assert.equal(aborted, 1);
  keys(editor, "0k");
  assert.equal(editor.getText(), "older prompt");
  editor.handleInput("\r");
  assert.equal(submitted, "older prompt");
});

test("bracketed paste chunks remain text in normal mode", () => {
  const editor = create("");
  normal(editor);
  editor.handleInput("\x1b[200~");
  editor.handleInput("dd");
  editor.handleInput("gg");
  editor.handleInput("\x1b[201~");
  assert.equal(editor.getExpandedText(), "ddgg");
});

test("Kitty printable keys work without inserting unrecognized letters", () => {
  const editor = create("one\ntwo");
  normal(editor);
  editor.handleInput("\x1b[103u");
  editor.handleInput("\x1b[103u");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
  editor.handleInput("\x1b[113u");
  assert.equal(editor.getText(), "one\ntwo");
});

test("mode label fits even very narrow editor widths", () => {
  // Native Editor cannot wrap a two-cell grapheme into a one-cell terminal.
  const editor = create("");
  for (const mode of ["insert", "normal"]) {
    for (const width of [1, 4, 8, 20, 80]) {
      const border = editor.render(width).at(-1)!;
      assert.ok(visibleWidth(border) <= width, `${mode} border exceeds ${width}`);
    }
    normal(editor);
  }
});

test("wraps an existing editor factory without replacing its history behavior", async () => {
  let start!: ExtensionHandler<SessionStartEvent>;
  modalEditor({ on(_name: string, handler: unknown) { start = handler as typeof start; } } as unknown as ExtensionAPI);
  let created!: CustomEditor;
  let factory: Parameters<ExtensionUIContext["setEditorComponent"]>[0] = (tui, theme, bindings) => {
    created = new CustomEditor(tui, theme, bindings);
    created.addToHistory("shared prompt");
    return created;
  };
  const ctx = {
    mode: "tui",
    ui: {
      getEditorComponent: () => factory,
      setEditorComponent: (next: typeof factory) => { factory = next; },
    },
  } as unknown as ExtensionContext;
  await start({ type: "session_start", reason: "startup" }, ctx);
  const editor = factory!(tui, theme, bindings);
  assert.equal(editor, created);
  normal(created);
  keys(created, "k");
  assert.equal(created.getText(), "shared prompt");
  assert.ok(created.render(80).at(-1)!.includes("NORMAL"));
});

test("dd preserves other collapsed pastes and their expanded content", () => {
  const editor = create("delete\n");
  const pasted = "large content ".repeat(300);
  editor.handleInput(`\x1b[200~${pasted}\x1b[201~`);
  assert.ok(editor.getText().includes("[paste #"));
  normal(editor);
  keys(editor, "ggdd");
  assert.equal(editor.getExpandedText(), pasted);
});

test("a native editor is created when no custom factory exists; repeated starts do not double-wrap", async () => {
  let start!: ExtensionHandler<SessionStartEvent>;
  modalEditor({ on(_name: string, handler: unknown) { start = handler as typeof start; } } as unknown as ExtensionAPI);
  let factory: Parameters<ExtensionUIContext["setEditorComponent"]>[0];
  let installations = 0;
  const ctx = {
    mode: "tui",
    ui: {
      getEditorComponent: () => factory,
      setEditorComponent: (next: typeof factory) => { factory = next; installations++; },
    },
  } as unknown as ExtensionContext;
  await start({ type: "session_start", reason: "startup" }, ctx);
  await start({ type: "session_start", reason: "new" }, ctx);
  assert.equal(installations, 1);
  const editor = factory!(tui, theme, bindings) as CustomEditor;
  editor.setText("hello");
  normal(editor);
  keys(editor, "0x");
  assert.equal(editor.getText(), "ello");
});

test("does nothing outside TUI mode", async () => {
  let start!: ExtensionHandler<SessionStartEvent>;
  modalEditor({ on(_name: string, handler: unknown) { start = handler as typeof start; } } as unknown as ExtensionAPI);
  for (const mode of ["rpc", "print", "json"] as const) {
    await start({ type: "session_start", reason: "startup" }, { mode } as ExtensionContext);
  }
});
