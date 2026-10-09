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

test("yy copies the full draft; p/P insert it below/above; dd leaves both registers alone", () => {
  const draft = "saved\ndelete\nlast";
  const editor = create(draft);
  normal(editor);
  keys(editor, "ggyyjddp");
  assert.equal(editor.getText(), `saved\nlast\n${draft}`);
  assert.deepEqual(editor.getCursor(), { line: 2, col: 0 });
  keys(editor, "P");
  assert.equal(editor.getText(), `saved\nlast\n${draft}\n${draft}`);
  const before = editor.getText();
  editor.handleInput("\x19"); // Ctrl+Y: native kill ring must still be empty.
  assert.equal(editor.getText(), before);
});

test("yy is independent of cursor position and does not change the draft or cursor", () => {
  const draft = " first\n界🙂 middle\nlast \n";
  const editor = create(draft);
  normal(editor);
  keys(editor, "ggjl");
  const cursor = editor.getCursor();
  assert.equal(cursor.line, 1);
  keys(editor, "yy");
  assert.equal(editor.getText(), draft);
  assert.deepEqual(editor.getCursor(), cursor);
  editor.setText("target");
  keys(editor, "P");
  assert.equal(editor.getText(), `${draft}\ntarget`);
  assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
});

test("p/P with no copied draft or an empty copied draft are no-ops", () => {
  const editor = create("previous");
  normal(editor);
  keys(editor, "pP");
  assert.equal(editor.getText(), "previous");
  keys(editor, "yy");
  editor.setText("");
  keys(editor, "yy");
  editor.setText("target");
  keys(editor, "pP");
  assert.equal(editor.getText(), "target");
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

test("Kitty Shift+G works with or without a shifted alternate codepoint", () => {
  for (const data of ["\x1b[103;2u", "\x1b[103:71;2u", "\x1b[71;2u"]) {
    const editor = create("first\nlast");
    normal(editor);
    keys(editor, "gg");
    editor.handleInput(data);
    assert.deepEqual(editor.getCursor(), { line: 1, col: 0 });
    editor.handleInput("\x1b[52:36;2u"); // Shift+4 with '$' alternate still means line end.
    assert.deepEqual(editor.getCursor(), { line: 1, col: 4 });
  }
});

test("unbound Kitty Shift+I does not accidentally enter insert mode", () => {
  const editor = create("draft");
  normal(editor);
  editor.handleInput("\x1b[105;2u");
  keys(editor, "q");
  assert.equal(editor.getText(), "draft");
});

test("Kitty Backspace is forwarded as editing input, not ignored as printable text", () => {
  const editor = create("abc");
  normal(editor);
  editor.handleInput("\x1b[127u");
  assert.equal(editor.getText(), "ab");
  let clears = 0;
  editor.onAction("app.clear", () => { clears++; });
  editor.handleInput("\x1b[99;5u"); // Ctrl+C still reaches the application.
  assert.equal(clears, 1);
});

test("a at the end of a logical line stays on that line", () => {
  const editor = create("foo\nbar");
  normal(editor);
  keys(editor, "gg$a!");
  assert.equal(editor.getText(), "foo!\nbar");
});

test("modifyOtherKeys printable input obeys normal-mode commands and ignores other letters", () => {
  const editor = create("one\ntwo");
  normal(editor);
  keys(editor, "gg");
  editor.handleInput("\x1b[27;2;71~"); // Shift+G
  assert.deepEqual(editor.getCursor(), { line: 1, col: 0 });
  editor.handleInput("\x1b[27;2;81~"); // Shift+Q (unbound)
  editor.handleInput("\x1b[27;2;32~"); // Shift+Space (unbound)
  editor.handleInput("\x1b[27;2;30028~"); // Shift+界 (unbound)
  assert.equal(editor.getText(), "one\ntwo");
  let clears = 0;
  editor.onAction("app.clear", () => { clears++; });
  editor.handleInput("\x1b[27;5;99~"); // Ctrl+C still reaches the application.
  assert.equal(clears, 1);
});

test("gg/G dismiss autocomplete; j/k retain native list navigation", async () => {
  const editor = create("first\nlast");
  editor.setAutocompleteProvider({
    async getSuggestions() {
      return { prefix: "", items: [{ value: "one", label: "one" }, { value: "two", label: "two" }] };
    },
    applyCompletion() { throw new Error("unexpected completion"); },
  });
  normal(editor);
  editor.handleInput("\t");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(editor.isShowingAutocomplete(), true);
  const before = editor.getCursor();
  keys(editor, "k");
  assert.deepEqual(editor.getCursor(), before);
  keys(editor, "gg");
  assert.equal(editor.isShowingAutocomplete(), false);
  assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
  editor.handleInput("\t");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(editor.isShowingAutocomplete(), true);
  keys(editor, "G");
  assert.equal(editor.isShowingAutocomplete(), false);
  assert.deepEqual(editor.getCursor(), { line: 1, col: 0 });
});

test("yy expands the entire draft and survives submission and paste-ID reuse", () => {
  const editor = create("prefix\n");
  const oldPaste = `${"A".repeat(2100)}\ntail A`;
  const newPaste = "B".repeat(2100);
  editor.handleInput(`\x1b[200~${oldPaste}\x1b[201~`);
  assert.ok(editor.getText().includes("[paste #"));
  const snapshot = `prefix\n${oldPaste}`;
  normal(editor);
  keys(editor, "yyi");
  editor.onSubmit = () => {};
  editor.handleInput("\r"); // Native submission clears and reuses paste IDs.
  editor.handleInput(`\x1b[200~${newPaste}\x1b[201~`);
  normal(editor);
  keys(editor, "p");
  assert.equal(editor.getExpandedText(), `${newPaste}\n${snapshot}`);
});

test("the copied draft survives native paste-marker deletion and renumbering", () => {
  const editor = create("");
  const first = "A".repeat(2100);
  const second = "B".repeat(2100);
  editor.handleInput(`\x1b[200~${first}\x1b[201~`);
  editor.handleInput("\n");
  editor.handleInput(`\x1b[200~${second}\x1b[201~`);
  normal(editor);
  keys(editor, "yygg$i");
  editor.handleInput("\x7f"); // Deletes the first marker and renumbers the second.
  normal(editor);
  keys(editor, "Gp");
  assert.equal(editor.getExpandedText(), `\n${second}\n${first}\n${second}`);
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
  keys(created, "i");
  created.setText("");
  created.handleInput(`\x1b[200~${"A".repeat(2100)}\x1b[201~`);
  normal(created);
  assert.doesNotThrow(() => keys(created, "yy"));
  created.setText("target");
  keys(created, "P");
  assert.equal(created.getExpandedText(), `${"A".repeat(2100)}\ntarget`);
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

test("history and modal composition gets a fresh factory after Pi's lifecycle UI reset", async () => {
  let start!: ExtensionHandler<SessionStartEvent>;
  modalEditor({ on(_name: string, handler: unknown) { start = handler as typeof start; } } as unknown as ExtensionAPI);
  let factory: Parameters<ExtensionUIContext["setEditorComponent"]>[0];
  const ctx = {
    mode: "tui",
    ui: {
      getEditorComponent: () => factory,
      setEditorComponent: (next: typeof factory) => { factory = next; },
    },
  } as unknown as ExtensionContext;
  for (const reason of ["startup", "new", "resume", "fork", "reload"] as const) {
    factory = undefined; // InteractiveMode.resetExtensionUI(), before session_start.
    const snapshot = `history for ${reason}`;
    factory = (tui, theme, bindings) => {
      const editor = new CustomEditor(tui, theme, bindings);
      editor.addToHistory(snapshot);
      return editor;
    };
    await start({ type: "session_start", reason }, ctx);
    const editor = factory!(tui, theme, bindings) as CustomEditor;
    let aborted = 0;
    editor.onEscape = () => { aborted++; };
    normal(editor);
    assert.equal(aborted, 0, `${reason}: Escape must not be handled twice`);
    keys(editor, "k");
    assert.equal(editor.getText(), snapshot);
    assert.ok(editor.render(80).at(-1)!.includes("NORMAL"));
    keys(editor, "0x");
    assert.equal(editor.getText(), snapshot.slice(1), `${reason}: x must run once`);
  }
});

test("does nothing outside TUI mode", async () => {
  let start!: ExtensionHandler<SessionStartEvent>;
  modalEditor({ on(_name: string, handler: unknown) { start = handler as typeof start; } } as unknown as ExtensionAPI);
  for (const mode of ["rpc", "print", "json"] as const) {
    await start({ type: "session_start", reason: "startup" }, { mode } as ExtensionContext);
  }
});
