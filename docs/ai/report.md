---
summary: Consolidated implementation, relocation, review, and validation report.
read_when:
  - Checking current behavior, repository setup, or completed review work.
---

# Pi prompt editor report

Status: completed and tested. Includes system-clipboard yanks and mode-specific
software cursor styling.

## Repository and runtime setup

Both projects are independent Git repositories under
`/home/michaelb/Documents/repos/projects/pi-extensions/`:

- `pi-modal-editor`: moved from `~/.pi/agent/local-packages/`, preserving commits.
- `pi-shared-prompt-history`: its existing clean development checkout matched the
  installed version and was retained rather than overwritten.

`~/.pi/agent/settings.json` references these local directories. Shared history
loads before modal, which wraps its editor factory and decorates the same editor
instance. History, callbacks, focus, app controls, and paste metadata stay native.
The old cached history checkout and its preexisting dirty lockfile were preserved.
Nothing was published or pushed.

The `/history` command itself only replaces draft text with `setEditorText()`.
Shared history owns an editor factory solely to seed its separate native Up/Down
history list. That extra feature was not removed during the final review.

## Current behavior

| Key | Behavior |
| --- | --- |
| Escape | Insert → normal; normal-mode Escape retains Pi's actions |
| `i`, `a` | Insert / append without crossing the logical-line boundary |
| `hjkl` | Native arrows, including visually wrapped rows and prompt history |
| `0`, `$` | Logical-line start/end |
| `gg`, `G` | First/last prompt line, dismissing autocomplete first |
| `x` | Delete a grapheme without joining lines |
| `dd` | Delete the current logical line without saving deleted text |
| `yy` | Copy the entire expanded prompt draft to the standard system clipboard and an internal register |
| `p`, `P` | Insert the saved draft below/above the current line |

Starts in insert mode, with a mode indicator in the bottom border. The focused
software cursor is an underline in insert mode and an inverse block in normal
mode; the IME position marker is preserved.

### Whole-draft `yy` simplification

`yy` now uses public `getExpandedText()` and captures a self-contained text
snapshot, independent of cursor position. It includes actual collapsed-paste
content, preserving draft whitespace and leaving the current draft/cursor alone.
The snapshot is saved internally for `p`/`P` and copied to the system clipboard
through Pi's public `copyToClipboard()` API. Asynchronous writes are serialized;
failures produce a Pi UI error notification without losing the saved draft.

This supersedes the earlier line-yank rejection policy: there is no longer a
paste-marker regex, warning callback, or restriction on copying pasted content.
Later submission, edits, or paste-ID deletion/reuse cannot alter the saved text.
Copying an empty draft clears the register and clipboard; pasting it is a no-op.

## Independent reviews and shared-history decision

The earlier mb-advisor (Astra) and persistent mb-peer-work (Claude Code) reviews
supported separate projects and found four modal defects: stale paste-marker
references, append crossing a line boundary, autocomplete blocking absolute
movement, and modifyOtherKeys printable input bypassing normal mode. These were
reproduced and corrected. The latest whole-draft change resolves the marker
problem directly rather than rejecting those yanks; it was regression-tested,
not sent for another independent review.

Both reviews and runtime-source verification found no necessary shared-history
production-code patch. Pi resets extension UI before new/resume/fork/reload, so
factories do not accumulate across normal session replacement. Keep history first
and modal last; generic load-order-independent wrapping remains optional.

Historical review records are in each project's `docs/ai/oracle-reviews.md` and
remain uncommitted as requested by the peer-work skill.

## Final focused review

A fresh review reproduced three Kitty-protocol decoding failures: Shift+G was
handled as `g`, unbound Shift+I entered insert mode, and encoded Backspace was
ignored. A small decoding-precedence correction now honors parsed Shift identity
and forwards recognized control keys to native handling. Regression coverage also
checks shifted symbol alternates and Ctrl+C forwarding. No new commands, history
behavior changes, or unrelated fixes were introduced. Tests were added before
being run, then the production correction was validated.

## Validation

- Modal: TypeScript check and all **39 tests** pass.
- Clipboard regressions use an injected copier, not the desktop clipboard. They
  cover expanded Unicode/whitespace/empty snapshots, ordering of slow writes,
  recovery after failure, retained internal paste behavior, and UI notifications.
- Cursor regressions cover mode transitions, Unicode graphemes, line ends, IME
  markers, unrelated inverse styling, cached render output, and narrow widths.
  No live terminal visual check or desktop clipboard round trip was performed.
- Shared history: TypeScript check and all **5 tests** pass; production code is
  unchanged.
- Real-package integration passes across startup/new/resume/fork/reload, checking
  fresh history and the updated whole-draft `yy`, including collapsed pastes.
- New regressions cover cursor independence, multiline/Unicode/whitespace content,
  paste-ID reuse after submission, marker deletion/renumbering, empty snapshots,
  and `dd` preserving the saved draft and native kill ring.

## Deliberate limits and next action

No counts, visual mode, general Vim parser, or full Vim cursor semantics. Native
undo restores `dd` in character/grapheme steps. Native arrows may browse history;
normal-mode Escape still aborts or invokes Pi's session actions. A component-only
combined-paste-and-trailing-key edge case remains deferred: Pi's terminal input
buffer separates those packets in normal use.

Run `/reload` to activate the latest code. Local package updates come from their
Git checkouts and `/reload`, not `pi update`.
