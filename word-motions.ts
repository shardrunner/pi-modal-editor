import type { CustomEditor } from "@earendil-works/pi-coding-agent";

/** Vim-like w/b/e composed from Pi's native word jumps; graphemes and paste markers stay atomic. */
export function moveWord(editor: CustomEditor, input: (data: string) => void, key: "w" | "b" | "e"): void {
  if (editor.isShowingAutocomplete()) input("\x1b");
  const lines = editor.getLines();
  const atStart = () => { const { line, col } = editor.getCursor(); return line === 0 && col === 0; };
  const atEnd = () => { const { line, col } = editor.getCursor(); return line === lines.length - 1 && col === lines[line].length; };
  // Line ends count as whitespace, so motions cross logical and blank lines.
  const onSpace = () => { const { line, col } = editor.getCursor(); return col === lines[line].length || /\s/u.test(lines[line][col]); };
  // Intl may split adjacent letters (e.g. Latin/CJK); keep them in one word run.
  const insideWord = () => {
    const { line, col } = editor.getCursor();
    return /[\p{L}\p{M}\p{N}_]$/u.test(lines[line].slice(0, col)) && /^[\p{L}\p{N}_]/u.test(lines[line].slice(col));
  };
  function send(data: string): void {
    const before = editor.getCursor();
    input(data);
    const after = editor.getCursor();
    if (before.line === after.line && before.col === after.col) throw new Error("Modal editor could not move to the requested word.");
  }
  // Native Alt+F skips whitespace AND the next run; back up to that run's start.
  function skipSpace(): void {
    while (onSpace() && !atEnd()) {
      const { line, col } = editor.getCursor();
      send("\x1bf");
      const after = editor.getCursor();
      if (after.line === line && /\S/u.test(lines[line].slice(col, after.col))) return send("\x1bb");
    }
  }

  if (key === "b") {
    while (!atStart()) { send("\x1bb"); if (!onSpace() && !insideWord()) return; }
    return;
  }
  if (key === "w") {
    if (!onSpace()) do send("\x1bf"); while (insideWord());
    return skipSpace();
  }
  if (atEnd()) return;
  send("\x1b[C");
  if (onSpace()) {
    const { line, col } = editor.getCursor();
    if (!/\S/u.test(lines[line].slice(col)) && !lines.slice(line + 1).some((text) => /\S/u.test(text))) return send("\x1b[D");
    while (editor.getCursor().col === lines[editor.getCursor().line].length) send("\x1bf");
  }
  do send("\x1bf"); while (insideWord());
  send("\x1b[D");
}
