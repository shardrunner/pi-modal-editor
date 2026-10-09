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
- Movement follows native visual rows. Linewise operations use logical lines.
- The intentionally small state machine only handles doubled `d`, `y`, `g`,
  the mode, a single linewise register, and bracketed paste forwarding.
- Reject `yy` of collapsed-paste placeholders with a visible warning, preserving
  the prior yank. Their IDs are mutable/reused; do not rely on private expansion
  APIs or retain references that can silently change content.
- Dismiss autocomplete before `gg`/`G`, clamp `a` at logical-line end, and use
  Pi's public key parser for modifyOtherKeys printable commands.
- Source verification and independent reviews confirm that Pi resets extension
  UI before session replacement and reload. Preserve the existing history-first,
  modal-last ordering; no shared-history implementation patch is needed.

Validation: `npm run check` runs TypeScript checking and real-editor tests for
modes, native movement, deletion edge cases, Unicode, history composition,
pasting, application callbacks, Kitty keys, and narrow mode labels.
