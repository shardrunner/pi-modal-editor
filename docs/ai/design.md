---
summary: Small modal-editor scope, composition, and safety decisions.
read_when:
  - Changing key handling, paste behavior, or editor lifecycle composition.
---

# Modal editor decisions

- Keep Vim key handling separate from `pi-shared-prompt-history`.
- Pi 1.1.0 exposes `getEditorComponent()`: capture the existing factory and
  decorate the instance it creates, retaining callbacks, app actions, focus,
  history, mouse handling, and paste expansion.
- Local auto-discovered extensions load before packages. Register this as the
  last local package, not as an auto-discovered extension.
- Use native cursor/deletion/insertion APIs only. No private editor state,
  global terminal input interception, or copy of the shared history reader.
- `dd` does not yank. Native Delete operations preserve paste metadata and
  avoid Pi's kill ring, at the cost of character-sized native undo steps.
- Movement follows native visual rows. Deletion and paste placement use logical
  lines; `yy` copies the entire current prompt draft regardless of cursor position.
- The intentionally small state machine only handles doubled `d`, `y`, `g`,
  the mode, a single draft register, and bracketed paste forwarding.
- Snapshot `yy` through public `getExpandedText()`. This safely supports collapsed
  pastes without private expansion APIs, stale IDs, or rejection/warning machinery.
  `p`/`P` insert the saved draft below/above the current line; an empty snapshot
  is a no-op. Also write the snapshot (including empty text) to the standard
  system clipboard through Pi's public `copyToClipboard()`. Serialize asynchronous
  writes to preserve command order; notify on failure while retaining the internal
  register for `p`/`P`. Inject the copier/error reporter in tests so they never
  overwrite the user's real clipboard.
- Report copy progress and results through `ctx.ui.setStatus()` under the dedicated
  `modal-editor-clipboard` key. Show success only after the copier resolves; replace
  it with a failure status if a later copy fails. An empty copy reports clipboard
  clearing. Keep the latest result until the next copy or native UI reset; no
  timers or additional lifecycle resources.
- Differentiate the focused software cursor: underline in insert mode, native
  inverse block in normal mode. Restyle only the inverse sequence immediately
  after `CURSOR_MARKER`, preserving IME positioning and unrelated inverse text.
  Copy the native render array before changing it so cached custom-editor output
  is not mutated. Avoid terminal-wide cursor shape or visibility changes.
- Dismiss autocomplete before `gg`/`G`, clamp `a` at logical-line end, and use
  Pi's public key parser for Kitty and modifyOtherKeys key identity. Preserve
  Shift on printable Kitty commands and forward parsed control keys to native
  handling rather than interpreting them through the printable decoder.
- Source verification and independent reviews confirm that Pi resets extension
  UI before session replacement and reload. Preserve the existing history-first,
  modal-last ordering; no shared-history implementation patch is needed.

Validation: `npm run check` runs TypeScript checking and real-editor tests for
modes, native movement, deletion edge cases, Unicode, history composition,
pasting, application callbacks, Kitty keys, narrow mode labels, clipboard
snapshots/write ordering/failures, UI error notifications, and cursor styling.
