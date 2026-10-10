import type { CustomEditor } from "@earendil-works/pi-coding-agent";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const words = new Intl.Segmenter(undefined, { granularity: "word" });
type Kind = "space" | "word" | "punctuation" | "atom";
const classify = (text: string): Kind => /^\s+$/u.test(text) ? "space" : /^[\p{L}\p{N}_]/u.test(text) ? "word" : "punctuation";

/** Small-word motions using native word jumps, with arrows only at exact boundaries. */
export function moveWord(editor: CustomEditor, input: (data: string) => void, key: "w" | "b" | "e"): void {
  if (editor.isShowingAutocomplete()) input("\x1b");
  const lines = editor.getLines();
  const mixedWords = new Map<number, [number, number][]>();

  function crossesSmallWordBoundary(line: number, col: number, direction: -1 | 1): boolean {
    let spans = mixedWords.get(line);
    if (!spans) {
      spans = [];
      for (const part of words.segment(lines[line])) {
        if (!part.isWordLike) continue;
        let first: Kind | undefined;
        for (const piece of graphemes.segment(part.segment)) {
          const current = classify(piece.segment);
          if (first === undefined) first = current;
          else if (current !== first) { spans.push([part.index, part.index + part.segment.length]); break; }
        }
      }
      mixedWords.set(line, spans);
    }
    let index = direction === 1 ? col : col - 1;
    while (index >= 0 && index < lines[line].length && /\s/u.test(lines[line][index])) index += direction;
    return spans.some(([start, end]) => index >= start && index < end);
  }

  function move(direction: -1 | 1, word = false): boolean {
    const before = editor.getCursor();
    if (direction === -1 && before.line === 0 && before.col === 0) return false;
    if (direction === 1 && before.line === lines.length - 1 && before.col === lines[before.line].length) return false;
    // Intl can include apostrophes inside words (e.g. foo’bar). Keep the
    // existing small-word semantics there instead of jumping across punctuation.
    if (word && crossesSmallWordBoundary(before.line, before.col, direction)) word = false;
    input(word ? (direction === 1 ? "\x1bf" : "\x1bb") : (direction === 1 ? "\x1b[C" : "\x1b[D"));
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
      // Native arrows jump real collapsed markers, but not literal lookalikes.
      move(1);
      const after = editor.getCursor();
      move(-1);
      const restored = editor.getCursor();
      if (restored.line !== line || restored.col !== col) {
        throw new Error("Modal editor could not restore the cursor after a paste-marker probe.");
      }
      if (after.line === line && after.col > col + first.length) return "atom";
    }
    return classify(first);
  }

  function skipWhitespace(): void {
    while (kind() === "space") {
      const before = editor.getCursor();
      if (!move(1, true)) return;
      const after = editor.getCursor();
      // A native word jump can consume leading space AND the following word.
      // Back up to that word's start, but not when only whitespace was consumed.
      if (after.line === before.line && /\S/u.test(lines[before.line].slice(before.col, after.col))) {
        move(-1, true);
        return;
      }
    }
  }

  function forwardRun(): void {
    const current = kind();
    if (current === undefined || current === "space") return;
    do { if (!move(1, true)) return; }
    while (current !== "atom" && kind() === current);
  }

  if (key === "b") {
    if (!move(-1, true)) return;
    while (kind() === "space") if (!move(-1, true)) return;
    const current = kind();
    if (current === "atom") return;
    // Native Unicode segmentation may divide a contiguous small-word run.
    while (move(-1)) {
      const previous = kind();
      move(1);
      if (previous !== current) return;
      if (!move(-1, true)) return;
    }
    return;
  }
  if (key === "w") {
    forwardRun();
    skipWhitespace();
    return;
  }

  // e must advance from an existing word end, rather than getting stuck on it.
  if (!move(1)) return;
  if (kind() === "space" || kind() === undefined) {
    const { line, col } = editor.getCursor();
    const hasNext = /\S/u.test(lines[line].slice(col)) || lines.slice(line + 1).some((text) => /\S/u.test(text));
    if (!hasNext) { move(-1); return; }
    skipWhitespace();
  }
  if (kind() === "atom") return;
  forwardRun();
  move(-1);
}
