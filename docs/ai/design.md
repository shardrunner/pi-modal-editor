---
summary: Small modal-editor scope, composition, and safety decisions.
read_when:
  - Changing key handling, paste behavior, or editor lifecycle composition.
---

# Modal editor decisions

- Keep Vim key handling separate from `pi-shared-prompt-history`. Shared history
  records prompts and captures a fixed `/history` snapshot, but never owns the
  editor or seeds native Up/Down history. Picker selection only replaces the draft.
- Install a native `CustomEditor` via `setEditorComponent()` and decorate that
  instance, retaining callbacks, app actions, focus, history, mouse handling, and
  paste expansion. No factory composition: no installed package owns the editor
  (shared history is command-only), so load order does not matter. Another
  editor-replacing package would conflict; the last installer wins.
- Use native cursor/deletion/insertion APIs only. No private editor state,
  global terminal input interception, or copy of the shared history reader.
- `dd` does not yank. Native Delete operations preserve paste metadata and
  avoid Pi's kill ring, at the cost of character-sized native undo steps.
- Movement follows native visual rows. Deletion and paste placement use logical
  lines; `yy` copies the entire current prompt draft regardless of cursor position.
- Compose `w`/`b`/`e` from native word jumps plus single arrows; never an arrow
  per grapheme (Pi rebuilds visual layout on every arrow). Accept Pi's word
  segmentation instead of separate Vim word classes, so a second classifier
  cannot disagree with native jumps. Only continue across Intl splits between
  adjacent letters/numbers. Line ends count as whitespace. Native jumps keep
  graphemes and real paste markers atomic; no private paste IDs.
- `u` forwards native Ctrl+- undo. `I`/`A` insert at logical column 0/end, and
  `o`/`O` open a line below/above via atomic public `insertTextAtCursor("\\n")`.
  Dismiss autocomplete first, never submit, then enter insert mode. Keep native
  undo grouping and paste metadata; `ciw`/general operators remain out of scope.
- The intentionally small state machine only handles doubled `d`, `y`, `g`,
  the mode, and bracketed paste forwarding. Clipboard operations have a shared
  asynchronous queue and activity tracking for stale-paste cancellation.
- Snapshot `yy` through public `getExpandedText()`. This safely supports collapsed
  pastes without private expansion APIs, stale IDs, or rejection/warning machinery.
  Write the snapshot (including empty text) to the standard system clipboard
  through Pi's public `copyToClipboard()`.
- `p`/`P` read the current standard clipboard, not an internal register, and insert
  below/above the current line. Empty/no text is a no-op; read failures are visible
  and never use stale yanked text. Pi does not publicly export `readClipboardText`,
  so `clipboard.ts` runs the Linux commands Pi copies with (Linux only). Preserve
  whitespace; use CLIPBOARD, not X11 primary selection; never fall back from
  Wayland to potentially stale X11 data. No terminal OSC 52 read interception.
- Serialize copies and reads so rapid `yy`/`p` commands preserve order. Cancel
  pending pastes after input/focus/cursor/text changes or shutdown. Decorate public
  `setText()` to detect external draft resets even before queued reads begin.
  Inject clipboard readers/writers in tests; never read or overwrite the user's
  real clipboard.
- Report clipboard results through `ctx.ui.setStatus()` under the dedicated
  `modal-editor-clipboard` key. No copying-progress message. Show success only
  after the copier resolves; replace it with a failure status after a failed copy.
  An empty copy reports clipboard clearing. Keep the latest result until another
  clipboard result or native UI reset; no timers.
- Use a real steady I-beam in insert mode and a steady block in normal mode via
  DECSCUSR. Enable Pi's hardware cursor only while the modal editor is focused.
  Decorate Pi's plain `focused` field (accessors fail loudly) so overlays update it;
  restore prior visibility and request the terminal-default shape on focus loss.
  Strip only the software inverse sequence immediately after `CURSOR_MARKER`,
  keeping IME positioning, Unicode widths, and unrelated inverse text intact.
  Copy native render arrays before modification. Idempotent shutdown cleanup
  restores the focused field/native handlers and cancels pending pastes.
- Dismiss autocomplete before `gg`/`G`, clamp `a` at logical-line end, and use
  Pi's public key parser for Kitty and modifyOtherKeys key identity. Preserve
  Shift on printable Kitty commands and forward parsed control keys to native
  handling rather than interpreting them through the printable decoder.
- Pi resets extension UI before session replacement and reload; every
  `session_start` installs a fresh factory. Both-order tests use the actual packages and Pi 1.1.0 loader.
  Their synthetic native-history setup does not prove the host populates history
  correctly on actual lifecycle transitions. Live Pi 1.1.0 checks reproduce native
  history loss after resume/fork/reload and preloaded new sessions, including with
  baseline shared seeding; startup and the no-modal control work. This separate
  host/modal issue needs approval before a fix. Likely cause: Pi's custom-editor
  setter copies text/handlers, not hidden history; startup populates history after
  binding, but replacement/reload can render before modal creates its editor. Do
  not copy private history or restore shared seeding as a workaround. Live tmux
  reproduction: `pi-shared-prompt-history/docs/ai/command-only-history-validation.md`.
- Deferred: component-level paste plus trailing input in one packet; Pi's
  terminal input buffer separates those packets in normal use.

Validation: `npm run check` runs TypeScript checking and real-editor tests for
modes, native movement, deletion edge cases, Unicode, shared-history independence,
pasting, application callbacks, Kitty keys, narrow mode labels, clipboard
snapshots/operation ordering/failures, Linux clipboard readers, stale-paste
cancellation, result-only status messages, hardware cursor shapes, regular and
fullscreen rendering, overlay focus, shutdown restoration, word boundaries,
Unicode/atomic-paste motions, logical-line opening, native undo, and encoded keys.
