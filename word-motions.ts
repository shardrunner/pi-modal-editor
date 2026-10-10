import type { CustomEditor } from "@earendil-works/pi-coding-agent";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
type Kind = "space" | "word" | "punctuation" | "atom";

/** Small-word motions using only native arrows: graphemes and paste markers stay intact. */
export function moveWord(editor: CustomEditor, input: (data: string) => void, key: "w" | "b" | "e"): void {
  if (editor.isShowingAutocomplete()) input("\x1b");
  const lines = editor.getLines();
  const original = editor.getCursor();

  function step(direction: -1 | 1): boolean {
    const before = editor.getCursor();
    if (direction === -1 && before.line === 0 && before.col === 0) return false;
    if (direction === 1 && before.line === lines.length - 1 && before.col === lines[before.line].length) return false;
    input(direction === 1 ? "\x1b[C" : "\x1b[D");
    const after = editor.getCursor();
    if (before.line === after.line && before.col === after.col) {
      throw new Error("Modal editor could not move to the requested word.");
    }
    return true;
  }

  function kind(): Kind | undefined {
    const { line, col } = editor.getCursor();
    const rest = lines[line].slice(col);
    if (!rest) return line < lines.length - 1 ? "space" : undefined;
    const first = graphemes.segment(rest)[Symbol.iterator]().next().value!.segment;
    if (rest.startsWith("[paste #")) {
      // The native arrow jumps real collapsed markers, but not literal lookalikes.
      // Probe and restore instead of reading private paste IDs or guessing by regex.
      step(1);
      const after = editor.getCursor();
      step(-1);
      const restored = editor.getCursor();
      if (restored.line !== line || restored.col !== col) {
        throw new Error("Modal editor could not restore the cursor after a paste-marker probe.");
      }
      if (after.line === line && after.col > col + first.length) return "atom";
    }
    return /^\s+$/u.test(first) ? "space" : /^[\p{L}\p{N}_]/u.test(first) ? "word" : "punctuation";
  }

  if (key === "b") {
    if (!step(-1)) return;
    while (kind() === "space") if (!step(-1)) return;
    const current = kind();
    if (current === "atom") return;
    while (step(-1)) {
      if (kind() !== current) { step(1); return; }
    }
    return;
  }
  if (key === "w") {
    const current = kind();
    if (current === undefined) return;
    if (current !== "space") {
      do { if (!step(1)) return; }
      while (current !== "atom" && kind() === current);
    }
    while (kind() === "space") if (!step(1)) return;
    return;
  }

  // e must advance from an existing word end, rather than getting stuck on it.
  if (!step(1)) return;
  while (kind() === "space") if (!step(1)) break;
  const current = kind();
  if (current === undefined) {
    // No following word: stay put instead of clamping the normal-mode cursor.
    while (editor.getCursor().line !== original.line || editor.getCursor().col !== original.col) step(-1);
    return;
  }
  if (current === "atom") return;
  while (step(1)) {
    if (kind() !== current) { step(-1); return; }
  }
}
