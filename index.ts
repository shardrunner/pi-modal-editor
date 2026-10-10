import { copyToClipboard, CustomEditor, sessionEntryToContextMessages, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, decodeKittyPrintable, isKeyRelease, matchesKey, parseKey, truncateToWidth, visibleWidth, type TUI } from "@earendil-works/pi-tui";

import { readSystemClipboard } from "./clipboard.ts";
import { useModeCursor } from "./cursor.ts";
import { moveWord } from "./word-motions.ts";

const movement: Record<string, string> = {
  h: "\x1b[D", j: "\x1b[B", k: "\x1b[A", l: "\x1b[C", "0": "\x01", $: "\x05",
};

interface ModalEditorOptions {
  copyToClipboard?: (text: string) => Promise<void>;
  readClipboard?: () => Promise<string>;
  onClipboardError?: (message: string) => void;
  onClipboardStatus?: (message: string) => void;
}

/** Decorate the existing instance: history, callbacks, focus and app handlers stay intact. */
export function addModalKeys(editor: CustomEditor, tui: TUI, options: ModalEditorOptions = {}): () => void {
  const input = editor.handleInput.bind(editor);
  const render = editor.render.bind(editor);
  const setText = editor.setText.bind(editor);
  let mode: "insert" | "normal" = "insert";
  let pending: string | undefined;
  let pasting = false;
  let active = true;
  let activity = 0;
  const cursor = useModeCursor(editor, tui, () => mode, () => { activity++; });
  const copy = options.copyToClipboard ?? copyToClipboard;
  const readClipboard = options.readClipboard ?? readSystemClipboard;
  const reportClipboardError = options.onClipboardError ?? console.error;
  let clipboardOperation = Promise.resolve();

  function enqueue(operation: () => Promise<void>, action: "copy draft" | "paste clipboard"): void {
    clipboardOperation = clipboardOperation.then(async () => {
      if (active) await operation();
    }).catch((error: unknown) => {
      if (!active) return;
      options.onClipboardStatus?.(action === "copy draft" ? "Clipboard copy failed" : "Clipboard paste failed");
      reportClipboardError(`Failed to ${action}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  function copyDraft(): void {
    const text = editor.getExpandedText();
    // Snapshot immediately and serialize reads/writes: yy followed by p must
    // read the completed copy, not an old clipboard value.
    enqueue(async () => {
      await copy(text);
      if (active) options.onClipboardStatus?.(text ? "Copied draft to clipboard" : "Clipboard cleared");
    }, "copy draft");
  }

  function pasteClipboard(key: "p" | "P"): void {
    const requestedActivity = activity;
    enqueue(async () => {
      if (activity !== requestedActivity) return;
      const before = editor.getExpandedText();
      const position = editor.getCursor();
      const text = await readClipboard();
      const after = editor.getCursor();
      // Never insert a delayed clipboard response into a changed/submitted draft.
      if (!active || activity !== requestedActivity || before !== editor.getExpandedText() ||
          position.line !== after.line || position.col !== after.col || !text) return;
      if (editor.isShowingAutocomplete()) input("\x1b");
      input(key === "p" ? "\x05" : "\x01");
      editor.insertTextAtCursor(key === "p" ? `\n${text}` : `${text}\n`);
      moveToLine(key === "p" ? position.line + 1 : position.line);
      tui.requestRender();
    }, "paste clipboard");
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

  function enterInsert(): void {
    mode = "insert";
    cursor.update();
    tui.requestRender();
  }

  // A command or extension can replace a draft without sending keyboard input,
  // including while a paste is still waiting behind an earlier clipboard copy.
  editor.setText = (text) => { activity++; setText(text); };

  editor.handleInput = (data) => {
    if (isKeyRelease(data) || !active) return;
    if (data.includes("\x1b[200~")) pasting = true;
    if (pasting) {
      activity++;
      pending = undefined;
      input(data);
      if (data.includes("\x1b[201~")) pasting = false;
      return;
    }
    if (matchesKey(data, "escape")) {
      activity++;
      pending = undefined;
      if (mode === "insert") {
        if (editor.isShowingAutocomplete()) input(data);
        mode = "normal";
        cursor.update();
        tui.requestRender();
      } else input(data);
      return;
    }
    if (mode === "insert") {
      activity++;
      return input(data);
    }

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
    if (key === "p" || key === "P") return pasteClipboard(key);
    activity++;
    if (key && previous === key) {
      if (key === "d") deleteLine();
      else if (key === "y") copyDraft();
      else if (key === "g") moveToLine(0);
      return;
    }
    if (key === "d" || key === "y" || key === "g") pending = key;
    else if (key === "G") moveToLine(editor.getLines().length - 1);
    else if (key === "w" || key === "b" || key === "e") moveWord(editor, input, key);
    else if (key === "u") {
      if (editor.isShowingAutocomplete()) input("\x1b");
      input("\x1f"); // Native Ctrl+- undo, including paste metadata.
    } else if (key === "i" || key === "a" || key === "I" || key === "A") {
      if (editor.isShowingAutocomplete()) input("\x1b");
      if (key === "I") input("\x01");
      else if (key === "A") input("\x05");
      else if (key === "a") {
        const { line, col } = editor.getCursor();
        if (col < editor.getLines()[line].length) input("\x1b[C");
      }
      enterInsert();
    } else if (key === "o" || key === "O") {
      if (editor.isShowingAutocomplete()) input("\x1b");
      const line = editor.getCursor().line;
      input(key === "o" ? "\x05" : "\x01");
      // Public insertion makes the newline one native undo step; never submit.
      editor.insertTextAtCursor("\n");
      if (key === "O") moveToLine(line);
      enterInsert();
    } else if (key === "x") {
      const { line, col } = editor.getCursor();
      if (col < editor.getLines()[line].length) input("\x1b[3~");
    } else if (key && movement[key]) input(movement[key]);
    else if (key === undefined && (data.charCodeAt(0) < 32 || data.charCodeAt(0) === 127)) {
      // Unknown modifyOtherKeys text must not fall through to native text insertion.
      if (!(data.startsWith("\x1b[27;") && parsed === undefined)) input(data);
    }
    // Ignore unrecognized printable input in normal mode.
  };

  editor.render = (width) => {
    cursor.update();
    // Remove only Pi's focused software block; its marker positions the real
    // I-beam/block cursor without replacing text or disturbing Unicode widths.
    const lines = render(width).map((line) => line.replace(`${CURSOR_MARKER}\x1b[7m`, CURSOR_MARKER));
    if (lines.length > 0) {
      const label = truncateToWidth(` ${mode.toUpperCase()} `, width, "");
      const last = lines.length - 1;
      lines[last] = truncateToWidth(lines[last], Math.max(0, width - visibleWidth(label)), "") + label;
    }
    return lines;
  };
  return () => {
    if (!active) return;
    active = false;
    cursor.dispose();
    editor.handleInput = input;
    editor.render = render;
    editor.setText = setText;
  };
}

/**
 * Pi keeps Up history inside the editor and does not copy it to a replacement.
 * On new/resume/fork it fills the native editor before session_start; on reload
 * it never refills. Replay the same user prompts Pi's renderInitialMessages() uses.
 * TODO: remove once Pi carries history over in setCustomEditorComponent().
 */
function restoreHistory(editor: CustomEditor, sessionManager: ExtensionContext["sessionManager"]): void {
  for (const entry of sessionManager.buildContextEntries()) {
    for (const message of sessionEntryToContextMessages(entry)) {
      if (message.role !== "user") continue;
      editor.addToHistory(typeof message.content === "string" ? message.content :
        message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join(""));
    }
  }
}

export default function (pi: ExtensionAPI, options: ModalEditorOptions = {}): void {
  let dispose: (() => void) | undefined;
  pi.on("session_shutdown", () => { dispose?.(); dispose = undefined; });
  pi.on("session_start", (event, ctx) => {
    if (ctx.mode !== "tui") return;
    // Replaces Pi's editor outright; no other installed package owns the editor.
    ctx.ui.setEditorComponent((tui, theme, bindings) => {
      const editor = new CustomEditor(tui, theme, bindings);
      // Pi populates history after startup's session_start; replaying would duplicate it.
      if (event.reason !== "startup") restoreHistory(editor, ctx.sessionManager);
      dispose?.();
      dispose = addModalKeys(editor, tui, {
        ...options,
        onClipboardError: options.onClipboardError ?? ((message) => ctx.ui.notify(message, "error")),
        onClipboardStatus: options.onClipboardStatus ?? ((message) => ctx.ui.setStatus("modal-editor-clipboard", message)),
      });
      return editor;
    });
  });
}
