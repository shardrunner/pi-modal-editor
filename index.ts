import { copyToClipboard, CustomEditor, type ExtensionAPI, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, decodeKittyPrintable, isKeyRelease, matchesKey, parseKey, truncateToWidth, visibleWidth, type TUI } from "@earendil-works/pi-tui";

type EditorFactory = NonNullable<Parameters<ExtensionUIContext["setEditorComponent"]>[0]>;
const movement: Record<string, string> = {
  h: "\x1b[D", j: "\x1b[B", k: "\x1b[A", l: "\x1b[C", "0": "\x01", $: "\x05",
};

interface ModalEditorOptions {
  copyToClipboard?: (text: string) => Promise<void>;
  onClipboardError?: (message: string) => void;
}

/** Decorate the existing instance: history, callbacks, focus and app handlers stay intact. */
export function addModalKeys(editor: CustomEditor, tui: TUI, options: ModalEditorOptions = {}): void {
  const input = editor.handleInput.bind(editor);
  const render = editor.render.bind(editor);
  let mode: "insert" | "normal" = "insert";
  let pending: string | undefined;
  let yank: string | undefined;
  let pasting = false;
  const copy = options.copyToClipboard ?? copyToClipboard;
  const reportClipboardError = options.onClipboardError ?? console.error;
  let clipboardWrite = Promise.resolve();

  function copyDraft(): void {
    const text = editor.getExpandedText();
    yank = text;
    // Snapshot immediately, but serialize async writes so the latest yy wins.
    clipboardWrite = clipboardWrite.then(() => copy(text)).catch((error: unknown) => {
      reportClipboardError(`Failed to copy draft: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  // Arrow movement honors the native visual wrapping. Stop before crossing into history.
  function moveToLine(line: number): void {
    if (editor.isShowingAutocomplete()) input("\x1b");
    while (editor.getCursor().line !== line) {
      const before = editor.getCursor();
      input(before.line > line ? "\x1b[A" : "\x1b[B");
      const after = editor.getCursor();
      if (before.line === after.line && before.col === after.col) {
        throw new Error("Modal editor could not move to the requested line.");
      }
    }
    input("\x01");
  }

  function deleteLine(): void {
    const line = editor.getCursor().line;
    input("\x01");
    // Use native Delete, not kill-line or setText: no yank, and collapsed pastes survive.
    while (editor.getLines()[line].length > 0) {
      const before = editor.getText();
      input("\x1b[3~");
      if (editor.getText() === before) throw new Error("Modal editor could not delete the current line.");
    }
    if (line < editor.getLines().length - 1) input("\x1b[3~");
    else if (line > 0) input("\x7f");
    input("\x01");
  }

  editor.handleInput = (data) => {
    if (isKeyRelease(data)) return;
    if (data.includes("\x1b[200~")) pasting = true;
    if (pasting) {
      pending = undefined;
      input(data);
      if (data.includes("\x1b[201~")) pasting = false;
      return;
    }
    if (matchesKey(data, "escape")) {
      pending = undefined;
      if (mode === "insert") {
        if (editor.isShowingAutocomplete()) input(data);
        mode = "normal";
        tui.requestRender();
      } else input(data);
      return;
    }
    if (mode === "insert") return input(data);

    const parsed = parseKey(data);
    const plain = parsed?.replace(/^shift\+/, "");
    // Parsed control keys must reach the native handler; printable decoding can include DEL.
    const decoded = parsed && plain !== "space" && plain?.length !== 1 ? undefined : decodeKittyPrintable(data);
    const key = decoded !== undefined ? (parsed?.startsWith("shift+") ? decoded.toUpperCase() : decoded) : (
      plain === "space" ? " " :
      plain?.length === 1 ? (parsed === plain ? plain : plain.toUpperCase()) :
      data.length === 1 && data.charCodeAt(0) >= 32 && data !== "\x7f" ? data : undefined
    );
    const previous = pending;
    pending = undefined;
    if (key && previous === key) {
      if (key === "d") deleteLine();
      else if (key === "y") copyDraft();
      else if (key === "g") moveToLine(0);
      return;
    }
    if (key === "d" || key === "y" || key === "g") pending = key;
    else if (key === "G") moveToLine(editor.getLines().length - 1);
    else if (key === "i" || key === "a") {
      if (key === "a") {
        const { line, col } = editor.getCursor();
        if (col < editor.getLines()[line].length) input("\x1b[C");
      }
      mode = "insert";
      tui.requestRender();
    } else if (key === "x") {
      const { line, col } = editor.getCursor();
      if (col < editor.getLines()[line].length) input("\x1b[3~");
    } else if ((key === "p" || key === "P") && yank) {
      const line = editor.getCursor().line;
      input(key === "p" ? "\x05" : "\x01");
      editor.insertTextAtCursor(key === "p" ? `\n${yank}` : `${yank}\n`);
      moveToLine(key === "p" ? line + 1 : line);
    } else if (key && movement[key]) input(movement[key]);
    else if (key === undefined && (data.charCodeAt(0) < 32 || data.charCodeAt(0) === 127)) {
      // Unknown modifyOtherKeys text must not fall through to native text insertion.
      if (!(data.startsWith("\x1b[27;") && parsed === undefined)) input(data);
    }
    // Ignore unrecognized printable input in normal mode.
  };

  editor.render = (width) => {
    // Pi draws a software cursor. Only restyle the focused cursor, not other
    // inverse text; retain the marker for hardware-cursor/IME positioning.
    const lines = render(width).map((line) => mode === "insert"
      ? line.replace(`${CURSOR_MARKER}\x1b[7m`, `${CURSOR_MARKER}\x1b[4m`)
      : line);
    if (lines.length > 0) {
      const label = truncateToWidth(` ${mode.toUpperCase()} `, width, "");
      const last = lines.length - 1;
      lines[last] = truncateToWidth(lines[last], Math.max(0, width - visibleWidth(label)), "") + label;
    }
    return lines;
  };
}

export default function (pi: ExtensionAPI, options: ModalEditorOptions = {}): void {
  const wrappers = new WeakSet<EditorFactory>();
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const current = ctx.ui.getEditorComponent();
    if (current && wrappers.has(current)) return;
    const wrapped: EditorFactory = (tui, theme, bindings) => {
      const editor = current ? current(tui, theme, bindings) : new CustomEditor(tui, theme, bindings);
      // Duck typing: instanceof is unreliable across Pi's extension module boundaries.
      for (const method of ["getCursor", "getLines", "getExpandedText", "isShowingAutocomplete", "insertTextAtCursor"] as const) {
        if (!(method in editor) || typeof (editor as unknown as Record<string, unknown>)[method] !== "function") {
          throw new Error(`Modal editor requires an editor exposing ${method}().`);
        }
      }
      addModalKeys(editor as CustomEditor, tui, {
        ...options,
        onClipboardError: options.onClipboardError ?? ((message) => ctx.ui.notify(message, "error")),
      });
      return editor;
    };
    wrappers.add(wrapped);
    ctx.ui.setEditorComponent(wrapped);
  });
}
