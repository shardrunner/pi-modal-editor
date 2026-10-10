import assert from "node:assert/strict";
import { test } from "node:test";
import { CustomEditor, getSelectListTheme, initTheme, type ExtensionAPI, type ExtensionContext, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, Input, TuiAltScreen, TuiMainScreen, type EditorTheme, type Terminal, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { KeybindingsManager } from "./node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import modalEditor, { addModalKeys } from "./index.ts";

initTheme("dark", false);
const theme: EditorTheme = { borderColor: (text) => text, selectList: getSelectListTheme() };
function fakeTui() {
  let visible = false;
  const writes: string[] = [];
  return {
    requestRender() {},
    getShowHardwareCursor: () => visible,
    setShowHardwareCursor: (value: boolean) => { visible = value; },
    terminal: { rows: 30, columns: 80, write: (data: string) => { writes.push(data); } },
    writes,
  };
}
const tui = fakeTui() as unknown as TUI;
const bindings = new KeybindingsManager();

function memoryClipboard() {
  let text = "";
  return {
    copyToClipboard: async (value: string) => { text = value; },
    readClipboard: async () => text,
    onClipboardStatus: (_message: string) => {},
  };
}
const noClipboard = memoryClipboard();
const flush = () => new Promise((resolve) => setImmediate(resolve));

function create(text: string, options: Parameters<typeof addModalKeys>[2] = memoryClipboard()) {
  const editor = new CustomEditor(tui, theme, bindings);
  addModalKeys(editor, tui, options);
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

test("w/b/e move across word, punctuation, and whitespace boundaries", () => {
  const editor = create("foo_bar,  baz!! tail");
  normal(editor);
  keys(editor, "gg");
  for (const col of [7, 10, 13, 16, 20]) {
    keys(editor, "w");
    assert.deepEqual(editor.getCursor(), { line: 0, col });
  }
  for (const col of [16, 13, 10, 7, 0]) {
    keys(editor, "b");
    assert.deepEqual(editor.getCursor(), { line: 0, col });
  }
  for (const col of [6, 7, 12, 14, 19, 19]) {
    keys(editor, "e");
    assert.deepEqual(editor.getCursor(), { line: 0, col });
  }
});

for (const [text, w, b, e] of [
  // Pi keeps Unicode punctuation inside a word and joins `_` to adjacent punctuation.
  ["foo’bar tail", [8, 12], [8, 0], [6, 11]],
  ["a _!b c", [2, 4, 6, 7], [6, 4, 2, 0], [3, 4, 6, 6]],
] as const) {
  test(`w/b/e agree on Pi's word segmentation in ${JSON.stringify(text)}`, () => {
    const editor = create(text);
    normal(editor);
    for (const [key, cols] of [["w", w], ["b", b], ["e", e]] as const) {
      keys(editor, key === "b" ? "$" : "gg");
      for (const col of cols) {
        keys(editor, key);
        assert.deepEqual(editor.getCursor(), { line: 0, col }, `${key} in ${text}`);
      }
    }
  });
}

test("long-word motions use bounded native input calls rather than one arrow per grapheme", () => {
  const editor = new CustomEditor(tui, theme, bindings);
  const native = editor.handleInput.bind(editor);
  const calls: string[] = [];
  editor.handleInput = (data) => { calls.push(data); native(data); };
  addModalKeys(editor, tui, noClipboard);
  editor.setText(`${"a".repeat(4000)}   next`);
  editor.render(80);
  normal(editor);
  keys(editor, "gg");
  for (const [key, col] of [["w", 4003], ["e", 4006], ["b", 4003], ["b", 0], ["e", 3999]] as const) {
    calls.length = 0;
    keys(editor, key);
    assert.deepEqual(editor.getCursor(), { line: 0, col });
    assert.ok(calls.length <= 4, `${key} sent ${calls.length} native input events`);
  }
});

test("word motions cross blank lines, stay in the draft, and never browse history", () => {
  const editor = create("one\n\n  two\nlast");
  editor.addToHistory("older prompt");
  normal(editor);
  keys(editor, "ggb");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
  keys(editor, "w");
  assert.deepEqual(editor.getCursor(), { line: 2, col: 2 });
  keys(editor, "e");
  assert.deepEqual(editor.getCursor(), { line: 2, col: 4 });
  keys(editor, "e");
  assert.deepEqual(editor.getCursor(), { line: 3, col: 3 });
  keys(editor, "b");
  assert.deepEqual(editor.getCursor(), { line: 3, col: 0 });
  keys(editor, "b");
  assert.deepEqual(editor.getCursor(), { line: 2, col: 2 });
  keys(editor, "b");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
  keys(editor, "G$wwe");
  assert.deepEqual(editor.getCursor(), { line: 3, col: 4 });
  assert.equal(editor.getText(), "one\n\n  two\nlast");
  const empty = create("");
  normal(empty);
  keys(empty, "wbewbe");
  assert.equal(empty.getText(), "");
  assert.deepEqual(empty.getCursor(), { line: 0, col: 0 });
});

test("word motions preserve Unicode graphemes and ignore visual wrapping", () => {
  for (const width of [8, 80]) {
    const editor = create("é界 🙂🙂 next");
    editor.render(width);
    normal(editor);
    keys(editor, "gge");
    assert.deepEqual(editor.getCursor(), { line: 0, col: 2 });
    keys(editor, "w");
    assert.deepEqual(editor.getCursor(), { line: 0, col: 4 });
    keys(editor, "e");
    assert.deepEqual(editor.getCursor(), { line: 0, col: 6 });
    keys(editor, "w");
    assert.deepEqual(editor.getCursor(), { line: 0, col: 9 });
    keys(editor, "bb");
    assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
    assert.equal(editor.getText(), "é界 🙂🙂 next");
  }
});

test("word motions treat actual collapsed pastes as atomic, not literal lookalikes", () => {
  const editor = create("prefix ");
  const paste = "A".repeat(2100);
  editor.handleInput(`\x1b[200~${paste}\x1b[201~`);
  keys(editor, " suffix");
  const text = editor.getText();
  const suffix = text.indexOf("suffix");
  normal(editor);
  keys(editor, "ggw");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 7 });
  keys(editor, "w");
  assert.deepEqual(editor.getCursor(), { line: 0, col: suffix });
  keys(editor, "b");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 7 });
  keys(editor, "gge");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 5 });
  keys(editor, "e");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 7 });
  keys(editor, "e");
  assert.deepEqual(editor.getCursor(), { line: 0, col: suffix + 5 });
  assert.equal(editor.getExpandedText(), `prefix ${paste} suffix`);
  const literal = create("a [paste #99 (10 chars)] z");
  normal(literal);
  keys(literal, "ggww");
  assert.deepEqual(literal.getCursor(), { line: 0, col: 3 });
  keys(literal, "b");
  assert.deepEqual(literal.getCursor(), { line: 0, col: 2 });
});

for (const key of ["I", "A"] as const) {
  test(`${key} enters insert mode at the logical line boundary, even with wrapping`, () => {
    const editor = create("first\n  a long wrapped middle line\nlast");
    editor.render(8);
    normal(editor);
    keys(editor, "ggj");
    // j may land on a visual row; gg starts on the short first line.
    assert.equal(editor.getCursor().line, 1);
    keys(editor, `${key}!`);
    assert.equal(editor.getText(), key === "I"
      ? "first\n!  a long wrapped middle line\nlast"
      : "first\n  a long wrapped middle line!\nlast");
    assert.ok(editor.render(80).at(-1)?.includes("INSERT"));
  });
}

for (const [name, text, navigation, line] of [
  ["first", "one\ntwo", "ggl", 0],
  ["middle", "one\ntwo\nthree", "ggj", 1],
  ["last", "one\ntwo", "G", 1],
  ["only", "界🙂é", "ggl", 0],
  ["empty", "", "", 0],
  ["wrapped", "a long line that wraps several times\nlast", "ggll", 0],
] as const) {
  for (const key of ["o", "O"] as const) {
    test(`${key} opens a new line at the ${name} line and enters insert mode`, () => {
      const editor = create(text);
      editor.render(10);
      let submissions = 0;
      editor.onSubmit = () => { submissions++; };
      normal(editor);
      keys(editor, `${navigation}${key}`);
      const lines = text.split("\n");
      const target = key === "o" ? line + 1 : line;
      lines.splice(target, 0, "");
      assert.equal(editor.getText(), lines.join("\n"));
      assert.deepEqual(editor.getCursor(), { line: target, col: 0 });
      assert.ok(editor.render(80).at(-1)?.includes("INSERT"));
      keys(editor, "new");
      lines[target] = "new";
      assert.equal(editor.getText(), lines.join("\n"));
      assert.equal(submissions, 0);
    });
  }
}

test("u uses native undo without entering insert mode", () => {
  const editor = create("");
  keys(editor, "hello");
  normal(editor);
  keys(editor, "u");
  assert.equal(editor.getText(), "");
  keys(editor, "q");
  assert.equal(editor.getText(), "");
  assert.ok(editor.render(80).at(-1)?.includes("NORMAL"));
  keys(editor, "u");
  assert.equal(editor.getText(), "");
});

for (const key of ["o", "O"] as const) {
  test(`u undoes ${key}'s newline atomically and preserves collapsed pastes`, () => {
    const editor = create("prefix\n");
    const paste = "A".repeat(2100);
    editor.handleInput(`\x1b[200~${paste}\x1b[201~`);
    const text = editor.getText();
    const expanded = editor.getExpandedText();
    normal(editor);
    keys(editor, key);
    normal(editor);
    keys(editor, "u");
    assert.equal(editor.getText(), text);
    assert.equal(editor.getExpandedText(), expanded);
  });
}

test("u undoes a clipboard insertion atomically without changing the clipboard", async () => {
  const clipboard = memoryClipboard();
  await clipboard.copyToClipboard("copied\ntext");
  const editor = create("target", clipboard);
  normal(editor);
  keys(editor, "P");
  await flush();
  assert.equal(editor.getText(), "copied\ntext\ntarget");
  keys(editor, "u");
  assert.equal(editor.getText(), "target");
  assert.equal(await clipboard.readClipboard(), "copied\ntext");
});

function withAutocomplete(editor: CustomEditor) {
  editor.setAutocompleteProvider({
    async getSuggestions() { return { prefix: "", items: [{ value: "one", label: "one" }, { value: "two", label: "two" }] }; },
    applyCompletion() { throw new Error("unexpected completion"); },
  });
  return editor;
}

test("commands dismiss autocomplete without applying a completion or submitting", async () => {
  const targets: Record<string, { line: number; col: number }> = { gg: { line: 0, col: 0 }, G: { line: 1, col: 0 } };
  for (const key of ["w", "b", "e", "I", "A", "o", "O", "u", "gg", "G"]) {
    const editor = withAutocomplete(create("first\nlast"));
    let submissions = 0;
    editor.onSubmit = () => { submissions++; };
    normal(editor);
    editor.handleInput("\t");
    await flush();
    assert.equal(editor.isShowingAutocomplete(), true);
    keys(editor, key);
    assert.equal(editor.isShowingAutocomplete(), false, `${key} must dismiss autocomplete`);
    if (targets[key]) assert.deepEqual(editor.getCursor(), targets[key]);
    assert.equal(submissions, 0);
  }
});

test("new commands work with Kitty and modifyOtherKeys encodings", () => {
  for (const [data, expected] of [
    ["\x1b[97;2u", "draft!"], // Shift+A
    ["\x1b[27;2;65~", "draft!"],
    ["\x1b[111;2u", "!\ndraft"], // Shift+O
    ["\x1b[27;2;79~", "!\ndraft"],
  ]) {
    const editor = create("draft");
    normal(editor);
    editor.handleInput(data);
    keys(editor, "!");
    assert.equal(editor.getText(), expected);
  }
  const editor = create("one two");
  normal(editor);
  keys(editor, "gg");
  editor.handleInput("\x1b[119u"); // w
  assert.deepEqual(editor.getCursor(), { line: 0, col: 4 });
  editor.handleInput("\x1b[27;1;101~"); // e
  assert.deepEqual(editor.getCursor(), { line: 0, col: 6 });
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

test("yy copies the full draft; p/P insert it below/above; dd leaves the clipboard and kill ring alone", async () => {
  const draft = "saved\ndelete\nlast";
  const editor = create(draft);
  normal(editor);
  keys(editor, "ggyyjddp");
  await flush();
  assert.equal(editor.getText(), `saved\nlast\n${draft}`);
  assert.deepEqual(editor.getCursor(), { line: 2, col: 0 });
  keys(editor, "P");
  await flush();
  assert.equal(editor.getText(), `saved\nlast\n${draft}\n${draft}`);
  const before = editor.getText();
  editor.handleInput("\x19"); // Ctrl+Y: native kill ring must still be empty.
  assert.equal(editor.getText(), before);
});

test("yy is independent of cursor position and does not change the draft or cursor", async () => {
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
  await flush();
  assert.equal(editor.getText(), `${draft}\ntarget`);
  assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
});

test("p/P with an empty clipboard are no-ops", async () => {
  const editor = create("previous");
  normal(editor);
  keys(editor, "pP");
  await flush();
  assert.equal(editor.getText(), "previous");
  keys(editor, "yy");
  editor.setText("");
  keys(editor, "yy");
  editor.setText("target");
  keys(editor, "pP");
  await flush();
  assert.equal(editor.getText(), "target");
});

test("p/P read the current global clipboard, including changes outside yy", async () => {
  let clipboard = " first\n界🙂 \n";
  const editor = create("target", {
    copyToClipboard: async (text) => { clipboard = text; },
    readClipboard: async () => clipboard,
  });
  normal(editor);
  keys(editor, "P");
  await flush();
  assert.equal(editor.getText(), " first\n界🙂 \n\ntarget");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
  keys(editor, "yy");
  await flush();
  clipboard = "outside";
  keys(editor, "Gp");
  await flush();
  assert.equal(editor.getText(), " first\n界🙂 \n\ntarget\noutside");
  assert.deepEqual(editor.getCursor(), { line: 4, col: 0 });
});

test("repeated clipboard pastes are serialized and read fresh text for each command", async () => {
  let read = 0;
  const editor = create("target", { readClipboard: async () => `paste ${++read}` });
  normal(editor);
  keys(editor, "pp");
  await flush();
  assert.equal(editor.getText(), "target\npaste 1\npaste 2");
  assert.deepEqual(editor.getCursor(), { line: 2, col: 0 });
});

test("clipboard read errors do not fall back to a previous yy snapshot", async () => {
  const errors: string[] = [];
  const editor = create("saved", {
    copyToClipboard: async () => {},
    readClipboard: async () => { throw new Error("read unavailable"); },
    onClipboardError: (message) => { errors.push(message); },
  });
  normal(editor);
  keys(editor, "yy");
  await flush();
  editor.setText("target");
  keys(editor, "P");
  await flush();
  assert.equal(editor.getText(), "target");
  assert.deepEqual(errors, ["Failed to paste clipboard: read unavailable"]);
});

test("a queued clipboard paste is cancelled by a draft reset before reading begins", async () => {
  const editor = create("old", { readClipboard: async () => "clipboard" });
  normal(editor);
  keys(editor, "P");
  editor.setText("new");
  await flush();
  assert.equal(editor.getText(), "new");
});

for (const change of ["text", "cursor", "input", "submission", "focus"] as const) {
  test(`a slow clipboard paste is cancelled after ${change} changes`, async () => {
    let finish!: (text: string) => void;
    const read = new Promise<string>((resolve) => { finish = resolve; });
    const editor = create("target", { readClipboard: () => read });
    normal(editor);
    keys(editor, "P");
    await flush();
    if (change === "text") editor.setText("changed");
    else if (change === "cursor") keys(editor, "h");
    else if (change === "input") keys(editor, "i!");
    else if (change === "focus") editor.focused = !editor.focused;
    else { editor.onSubmit = () => {}; editor.handleInput("\r"); }
    const text = editor.getExpandedText();
    const cursor = editor.getCursor();
    finish("stale");
    await flush();
    assert.equal(editor.getExpandedText(), text);
    assert.deepEqual(editor.getCursor(), cursor);
  });
}

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

test("Kitty Shift+I enters insert mode at line start, not at the old cursor", () => {
  const editor = create("draft");
  normal(editor);
  editor.handleInput("\x1b[105;2u");
  keys(editor, "q");
  assert.equal(editor.getText(), "qdraft");
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

test("j/k retain native autocomplete list navigation", async () => {
  const editor = withAutocomplete(create("first\nlast"));
  normal(editor);
  editor.handleInput("\t");
  await flush();
  assert.equal(editor.isShowingAutocomplete(), true);
  const before = editor.getCursor();
  keys(editor, "k");
  assert.deepEqual(editor.getCursor(), before);
  assert.equal(editor.isShowingAutocomplete(), true);
});

test("yy expands the entire draft and survives submission and paste-ID reuse", async () => {
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
  await flush();
  assert.equal(editor.getExpandedText(), `${newPaste}\n${snapshot}`);
});

test("the copied draft survives native paste-marker deletion and renumbering", async () => {
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
  await flush();
  assert.equal(editor.getExpandedText(), `\n${second}\n${first}\n${second}`);
});

test("yy writes expanded Unicode, whitespace, and empty drafts to the system clipboard", async () => {
  const copies: string[] = [];
  const editor = create(" first\n界🙂 \n", {
    copyToClipboard: async (text) => { copies.push(text); },
  });
  const paste = "A".repeat(2100);
  editor.handleInput(`\x1b[200~${paste}\x1b[201~`);
  const draft = editor.getExpandedText();
  normal(editor);
  const cursor = editor.getCursor();
  keys(editor, "y");
  await flush();
  assert.deepEqual(copies, []);
  keys(editor, "y");
  assert.equal(editor.getExpandedText(), draft);
  assert.deepEqual(editor.getCursor(), cursor);
  editor.setText("");
  keys(editor, "yy");
  await flush();
  assert.deepEqual(copies, [draft, ""]);
});

test("clipboard failures are reported without changing the clipboard or blocking later copies", async () => {
  const errors: string[] = [];
  const copies: string[] = [];
  const editor = create("saved", {
    copyToClipboard: async (text) => {
      copies.push(text);
      if (text === "saved") throw new Error("Clipboard unavailable: install wl-copy");
    },
    readClipboard: async () => "external",
    onClipboardError: (message) => { errors.push(message); },
  });
  normal(editor);
  keys(editor, "yy");
  await flush();
  assert.deepEqual(errors, ["Failed to copy draft: Clipboard unavailable: install wl-copy"]);
  editor.setText("target");
  keys(editor, "P");
  await flush();
  assert.equal(editor.getText(), "external\ntarget");
  keys(editor, "yy");
  await flush();
  assert.deepEqual(copies, ["saved", "external\ntarget"]);
});

test("clipboard status confirms completion, clears stale success on failure, and reports empty copies", async () => {
  const statuses: string[] = [];
  let finish!: () => void;
  const wait = new Promise<void>((resolve) => { finish = resolve; });
  const editor = create("draft", {
    copyToClipboard: async (text) => {
      if (text === "draft") await wait;
      if (text === "fail") throw new Error("unavailable");
    },
    onClipboardError: () => {},
    onClipboardStatus: (message) => { statuses.push(message); },
  });
  normal(editor);
  keys(editor, "yy");
  await flush();
  assert.deepEqual(statuses, []);
  finish();
  await flush();
  assert.equal(statuses.at(-1), "Copied draft to clipboard");
  editor.setText("fail");
  keys(editor, "yy");
  await flush();
  assert.deepEqual(statuses, ["Copied draft to clipboard", "Clipboard copy failed"]);
  editor.setText("");
  keys(editor, "yy");
  await flush();
  assert.equal(statuses.at(-1), "Clipboard cleared");
});

test("clipboard writes finish in command order even when the first write is slow", async () => {
  const copies: string[] = [];
  let finish!: () => void;
  const wait = new Promise<void>((resolve) => { finish = resolve; });
  const editor = create("first", {
    copyToClipboard: async (text) => {
      if (text === "first") await wait;
      copies.push(text);
    },
  });
  normal(editor);
  keys(editor, "yy");
  editor.setText("second");
  keys(editor, "yy");
  await flush();
  assert.deepEqual(copies, []);
  finish();
  await flush();
  assert.deepEqual(copies, ["first", "second"]);
});

test("focused cursor uses a hardware I-beam in insert mode and a block in normal mode", () => {
  const terminalTui = fakeTui();
  const editor = new CustomEditor(terminalTui as unknown as TUI, theme, bindings);
  const dispose = addModalKeys(editor, terminalTui as unknown as TUI, noClipboard);
  editor.setText("界🙂é");
  editor.focused = true;
  assert.equal(terminalTui.getShowHardwareCursor(), true);
  assert.equal(terminalTui.writes.at(-1), "\x1b[6 q");
  for (const navigation of ["gg", "l", "l", "$"]) {
    normal(editor);
    keys(editor, navigation);
    const block = editor.render(80);
    assert.equal(terminalTui.writes.at(-1), "\x1b[2 q");
    keys(editor, "i");
    const beam = editor.render(80);
    assert.equal(terminalTui.writes.at(-1), "\x1b[6 q");
    assert.ok(beam.some((line) => line.includes(CURSOR_MARKER)));
    assert.ok(!beam.some((line) => line.includes(`${CURSOR_MARKER}\x1b[7m`)));
    assert.deepEqual(beam.slice(0, -1), block.slice(0, -1));
  }
  normal(editor);
  keys(editor, "a");
  assert.equal(terminalTui.writes.at(-1), "\x1b[6 q");
  editor.focused = false;
  assert.equal(terminalTui.getShowHardwareCursor(), false);
  assert.equal(terminalTui.writes.at(-1), "\x1b[0 q");
  editor.focused = true;
  dispose();
  assert.equal(terminalTui.getShowHardwareCursor(), false);
  assert.equal(terminalTui.writes.at(-1), "\x1b[0 q");
  const writes = terminalTui.writes.length;
  dispose();
  assert.equal(terminalTui.writes.length, writes);
});

for (const Tui of [TuiMainScreen, TuiAltScreen]) {
  test(`${Tui.name} positions a visible I-beam and restores native overlay behavior`, () => {
    const writes: string[] = [];
    const terminal = {
      rows: 30, columns: 80, kittyProtocolActive: false,
      start() {}, stop() {},
      write(data: string) { writes.push(data); },
      hideCursor() { writes.push("\x1b[?25l"); },
      showCursor() { writes.push("\x1b[?25h"); },
      clearScreen() { writes.push("\x1b[2J"); },
      moveBy() {},
    } as unknown as Terminal;
    const realTui = new Tui(terminal, false);
    const editor = new CustomEditor(realTui, theme, bindings);
    const dispose = addModalKeys(editor, realTui, noClipboard);
    editor.setText("界🙂é");
    realTui.addChild(editor);
    try {
      realTui.start();
      realTui.setFocus(editor);
      realTui.renderNow(true);
      assert.ok(writes.join("").includes("\x1b[6 q"));
      assert.ok(writes.at(-1)?.includes("\x1b[?25h"));
      assert.ok(!writes.join("").includes(CURSOR_MARKER));
      assert.ok(!writes.join("").includes("\x1b[7m"));
      const overlay = realTui.showOverlay(new Input(), { width: 20 });
      assert.equal(editor.focused, false);
      assert.equal(realTui.getShowHardwareCursor(), false);
      assert.equal(writes.at(-1), "\x1b[?25l");
      assert.ok(writes.includes("\x1b[0 q"));
      overlay.hide();
      assert.equal(editor.focused, true);
      assert.equal(realTui.getShowHardwareCursor(), true);
      normal(editor);
      realTui.renderNow();
      assert.ok(writes.join("").includes("\x1b[2 q"));
    } finally {
      dispose();
      realTui.stop();
    }
  });
}

test("cursor focus decoration restores the plain field and fails loudly on accessors", () => {
  const terminalTui = fakeTui();
  const editor = new CustomEditor(terminalTui as unknown as TUI, theme, bindings);
  const dispose = addModalKeys(editor, terminalTui as unknown as TUI, noClipboard);
  editor.focused = true;
  dispose();
  assert.deepEqual(Object.getOwnPropertyDescriptor(editor, "focused"), { value: true, writable: true, enumerable: true, configurable: true });
  const custom = new CustomEditor(tui, theme, bindings);
  Object.defineProperty(custom, "focused", { configurable: true, get: () => false, set: () => {} });
  assert.throws(() => addModalKeys(custom, tui, noClipboard), /plain writable focused field/);
});

test("cursor styling preserves unrelated inverse text and cached render output", () => {
  const editor = new CustomEditor(tui, theme, bindings);
  const original = [`\x1b[7mselected\x1b[0m ${CURSOR_MARKER}\x1b[7m界\x1b[0m`, "────────────"];
  const snapshot = [...original];
  editor.render = () => original;
  addModalKeys(editor, tui, noClipboard);
  assert.equal(editor.render(40)[0], `\x1b[7mselected\x1b[0m ${CURSOR_MARKER}界\x1b[0m`);
  normal(editor);
  assert.equal(editor.render(40)[0], `\x1b[7mselected\x1b[0m ${CURSOR_MARKER}界\x1b[0m`);
  assert.deepEqual(original, snapshot);
});

test("mode label fits even very narrow editor widths", () => {
  // Native Editor cannot wrap a two-cell grapheme into a one-cell terminal.
  const editor = create("");
  editor.focused = true;
  for (const mode of ["insert", "normal"]) {
    for (const width of [1, 4, 8, 20, 80]) {
      const border = editor.render(width).at(-1)!;
      assert.ok(visibleWidth(border) <= width, `${mode} border exceeds ${width}`);
    }
    normal(editor);
  }
});

type Factory = Parameters<ExtensionUIContext["setEditorComponent"]>[0];
/** Load the extension into a fake Pi whose UI records the installed editor factory. */
function loadExtension(options: Parameters<typeof modalEditor>[1] = noClipboard, ui: Record<string, unknown> = {}) {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  modalEditor({
    on(name: string, handler: (event: unknown, ctx: unknown) => unknown) { handlers.set(name, handler); },
  } as unknown as ExtensionAPI, options);
  const pi: { factory: Factory; installations: number } = { factory: undefined, installations: 0 };
  const ctx = { mode: "tui", ui: {
    setEditorComponent: (next: Factory) => { pi.factory = next; pi.installations++; },
    ...ui,
  } } as unknown as ExtensionContext;
  return Object.assign(pi, {
    start: async (reason = "startup", context = ctx) => { await handlers.get("session_start")!({ type: "session_start", reason }, context); },
    shutdown: async () => { await handlers.get("session_shutdown")!({ type: "session_shutdown" }, ctx); },
    editor: (terminal = tui) => pi.factory!(terminal, theme, bindings) as CustomEditor,
  });
}

test("dd preserves other collapsed pastes and their expanded content", () => {
  const editor = create("delete\n");
  const pasted = "large content ".repeat(300);
  editor.handleInput(`\x1b[200~${pasted}\x1b[201~`);
  assert.ok(editor.getText().includes("[paste #"));
  normal(editor);
  keys(editor, "ggdd");
  assert.equal(editor.getExpandedText(), pasted);
});

test("each TUI session start installs one native editor with modal keys", async () => {
  const pi = loadExtension();
  for (const reason of ["startup", "new", "resume", "fork", "reload"]) {
    await pi.start(reason);
    const editor = pi.editor();
    assert.ok(editor instanceof CustomEditor);
    editor.setText("hello");
    let aborted = 0;
    editor.onEscape = () => { aborted++; };
    normal(editor);
    assert.equal(aborted, 0, `${reason}: Escape must not be handled twice`);
    assert.ok(editor.render(80).at(-1)!.includes("NORMAL"));
    keys(editor, "0x");
    assert.equal(editor.getText(), "ello", `${reason}: x must run once`);
  }
  assert.equal(pi.installations, 5);
});
test("extension reports clipboard results through Pi's status line and UI", async () => {
  let fail = true;
  const notifications: [string, string | undefined][] = [];
  const statuses: [string, string][] = [];
  const pi = loadExtension({
    copyToClipboard: async () => { if (fail) throw new Error("Clipboard unavailable"); },
    readClipboard: async () => "global",
  }, {
    notify: (message: string, type?: string) => { notifications.push([message, type]); },
    setStatus: (key: string, message: string) => { statuses.push([key, message]); },
  });
  await pi.start();
  const editor = pi.editor();
  editor.setText("draft");
  normal(editor);
  keys(editor, "yy");
  await flush();
  assert.deepEqual(notifications, [["Failed to copy draft: Clipboard unavailable", "error"]]);
  keys(editor, "p");
  await flush();
  assert.equal(editor.getText(), "draft\nglobal");
  assert.deepEqual(statuses, [["modal-editor-clipboard", "Clipboard copy failed"]]);
  fail = false;
  keys(editor, "yy");
  await flush();
  assert.deepEqual(statuses.at(-1), ["modal-editor-clipboard", "Copied draft to clipboard"]);
  assert.equal(notifications.length, 1);
});

test("session shutdown restores the cursor and cancels pending clipboard pastes", async () => {
  let finish!: (text: string) => void;
  const read = new Promise<string>((resolve) => { finish = resolve; });
  const pi = loadExtension({ ...noClipboard, readClipboard: () => read });
  const terminalTui = fakeTui();
  await pi.start();
  const editor = pi.editor(terminalTui as unknown as TUI);
  editor.setText("target");
  editor.focused = true;
  normal(editor);
  keys(editor, "P");
  await flush();
  await pi.shutdown();
  assert.equal(terminalTui.getShowHardwareCursor(), false);
  assert.equal(terminalTui.writes.at(-1), "\x1b[0 q");
  finish("stale");
  await flush();
  assert.equal(editor.getText(), "target");
});

test("does nothing outside TUI mode", async () => {
  const pi = loadExtension();
  for (const mode of ["rpc", "print", "json"] as const) {
    await pi.start("startup", { mode } as ExtensionContext);
  }
  assert.equal(pi.installations, 0);
});
