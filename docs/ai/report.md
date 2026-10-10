---
summary: Consolidated implementation, relocation, review, and validation report.
read_when:
  - Checking current behavior, repository setup, or completed review work.
---

# Pi prompt editor report

Status: completed and tested. Includes standard-clipboard copies/pastes,
result-only copy status messages, and mode-specific hardware cursor shapes.

## Repository and runtime setup

Both projects are independent Git repositories under
`/home/michaelb/Documents/repos/projects/pi-extensions/`:

- `pi-modal-editor`: moved from `~/.pi/agent/local-packages/`, preserving commits.
- `pi-shared-prompt-history`: its existing clean development checkout matched the
  installed version and was retained rather than overwritten.

`~/.pi/agent/settings.json` references these local directories; paths and package
list are unchanged. Shared history no longer owns an editor factory, so its
relative order with modal does not matter. Modal still wraps other custom factories
or creates a native editor when none exists. Its editing, callbacks, focus, app
controls, and paste handling are unchanged.
The old cached history checkout and its preexisting dirty lockfile were preserved.
Nothing was published or pushed.

The `/history` command only replaces draft text with `setEditorText()` after a
selection. Shared history now records eligible prompts and captures its fixed
session-start snapshot without owning the editor or seeding native Up/Down history.
Native history remains Pi's responsibility; selection neither submits nor imports
an entry into it.

## Current behavior

| Key | Behavior |
| --- | --- |
| Escape | Insert → normal; normal-mode Escape retains Pi's actions |
| `i`, `a` | Insert / append without crossing the logical-line boundary |
| `I`, `A` | Insert at logical column 0/end |
| `o`, `O` | Open an empty line below/above and enter insert mode |
| `w`, `b`, `e` | Next/previous small-word start, or word end; never browse history |
| `u` | Native Ctrl+- undo |
| `hjkl` | Native arrows, including visually wrapped rows and prompt history |
| `0`, `$` | Logical-line start/end |
| `gg`, `G` | First/last prompt line, dismissing autocomplete first |
| `x` | Delete a grapheme without joining lines |
| `dd` | Delete the current logical line without saving deleted text |
| `yy` | Copy the entire expanded prompt draft to the standard system clipboard |
| `p`, `P` | Read the current standard clipboard and insert below/above the current line |

Starts in insert mode, with a mode indicator in the bottom border. The focused
hardware cursor is a steady vertical I-beam in insert mode and a steady block in
normal mode; the IME position marker is preserved. Focus loss/shutdown requests
the terminal-default cursor shape and restores prior hardware-cursor visibility.

### Whole-draft `yy` simplification

`yy` now uses public `getExpandedText()` and captures a self-contained text
snapshot, independent of cursor position. It includes actual collapsed-paste
content, preserving draft whitespace and leaving the current draft/cursor alone.
The snapshot is copied through Pi's public `copyToClipboard()` API. `p`/`P` now
read fresh system-clipboard text, including changes made in other applications.
The old internal register has been removed; clipboard failures are visible and
never fall back to stale text. Copies/reads are serialized, and delayed pastes are
cancelled after input, focus, cursor, or draft changes and during session shutdown.

The status line reports successful copies, empty-draft clipboard clearing, and
failures, with no copying-progress message. Success appears only after the copy
completes, and a later failure replaces the previous success message.

This supersedes the earlier line-yank rejection policy: there is no longer a
paste-marker regex, warning callback, or restriction on copying pasted content.
Later submission, edits, or paste-ID deletion/reuse cannot alter the clipboard
snapshot. Copying an empty draft clears the clipboard; pasting empty/no text is
a no-op. Clipboard reads use native/platform readers; Wayland never falls back
to stale X11 data. Remote terminal clipboard reads are not supported.

### Additional everyday editing keys

Word motions use Unicode word/punctuation runs with whitespace boundaries across
logical/blank lines. Native arrows preserve grapheme and collapsed-paste atomicity;
marker-shaped literals are not mistaken for real pastes. `I` uses column 0,
not first nonblank; `A` uses the logical line end. `o`/`O` insert an empty line
atomically without submission and enter insert mode. `u` retains native undo
snapshots, grouping, and paste expansion. All new commands dismiss autocomplete
without applying completions. Kitty/modifyOtherKeys Shift decoding also applies
to the uppercase commands. No `ciw` or operator parser was added.

## Independent reviews and shared-history decision

The earlier mb-advisor (Astra) and persistent mb-peer-work (Claude Code) reviews
supported separate projects and found four modal defects: stale paste-marker
references, append crossing a line boundary, autocomplete blocking absolute
movement, and modifyOtherKeys printable input bypassing normal mode. These were
reproduced and corrected. The latest whole-draft change resolves the marker
problem directly rather than rejecting those yanks; it was regression-tested,
not sent for another independent review.

The earlier reviews found no necessary shared-history patch **while preserving
cross-session native Up/Down seeding**. The newly requested boundary deliberately
removes that feature instead: use `/history` for shared lookup and leave native
navigation separate. This is a change in requirements, not a reversal of those
historical findings. Pi resets extension UI before new/resume/fork/reload; modal's
generic factory wrapper remains useful for other editor-owning packages.

Historical review records are in each project's `docs/ai/oracle-reviews.md` and
remain uncommitted as requested by the peer-work skill.

## Final focused review

A fresh review reproduced three Kitty-protocol decoding failures: Shift+G was
handled as `g`, unbound Shift+I entered insert mode, and encoded Backspace was
ignored. A small decoding-precedence correction now honors parsed Shift identity
and forwards recognized control keys to native handling. Regression coverage also
checks shifted symbol alternates and Ctrl+C forwarding. No new commands, history
behavior changes, or unrelated fixes were introduced. Tests were added before
being run, then the production correction was validated. This was the earlier
unbound-key policy; `I` is now an intentional line-start insert command, so its
Kitty Shift+I regression now checks line-start insertion rather than rejection.

## Finish review

The fresh review found a hot-path problem in the new word motions: sending one
native arrow per grapheme repeatedly rebuilt Pi's visual-line map and grapheme
arrays. Native word jumps now handle ordinary runs; arrows remain for precise
boundaries and real-paste probes. A deterministic 4,000-character-word regression
limits each tested motion to at most four native input events. Unicode punctuation
inside native word segments (`foo’bar`) retains the original grapheme fallback,
with a separate regression preserving the existing small-word semantics.
No new features or unrelated production fixes were added.

Separate pre-existing issue, left unchanged: the mode label is appended to the
last native render row, which can be an autocomplete suggestion rather than the
bottom border while the menu is open.

## Validation

- Modal's previous validation: TypeScript check and all **90 tests** passed.
  Current command-only integration validation is recorded below.
- New editing regressions cover word/punctuation/whitespace boundaries, Unicode,
  wrapping, blank lines, real/literal paste markers, line opening at first/middle/
  last/empty lines, native undo of typing/newlines/clipboard insertion, autocomplete
  dismissal, Kitty/modifyOtherKeys encodings, bounded long-word native input calls,
  and Unicode punctuation inside native word segments.
- Clipboard regressions inject readers/writers, not the desktop clipboard. They
  cover Unicode/whitespace/empty text, external clipboard changes, copy/read
  ordering, failure recovery, stale-paste cancellation (including external draft
  resets before queued reads begin), and result-only statuses.
  Platform-reader tests verify Wayland, X11 CLIPBOARD, native macOS/Windows,
  platform-command fallbacks, Termux, WSL, and explicit headless read errors.
- Cursor regressions cover shapes, Unicode/line ends, IME markers, unrelated
  inverse styling, cached render arrays, focus accessors, and shutdown cleanup.
  Real regular/fullscreen TUIs with fake terminals verify visible hardware cursors
  and overlay focus restoration. No live terminal visual check or desktop clipboard
  round trip was performed; local `wl-copy` and `wl-paste` are available.
- Earlier shared-history validation: TypeScript check and all **5 tests** passed,
  before removing native seeding.
- Earlier real-package integration checked seeded history across lifecycle resets
  and whole-draft `yy`, including collapsed pastes. That is historical coverage,
  not evidence for the new command-only boundary.
- New regressions cover cursor independence, multiline/Unicode/whitespace content,
  paste-ID reuse after submission, marker deletion/renumbering, empty snapshots,
  and `dd` preserving the clipboard and native kill ring.

## Command-only shared-history validation

Shared history's native seeding was removed test-first: four focused regressions
failed on the old factory setter, then TypeScript and all **9 history tests**
passed. Modal production code is unchanged. TypeScript and all **92 modal tests**
pass, including the existing 90 tests and two real-package integration tests.
`git diff --check` passes in both repositories.

`shared-history.integration.test.ts` loads the real local packages through Pi
1.1.0's `DefaultResourceLoader` with in-memory settings and synthetic isolated
JSONL, in both relative orders. Startup/new/resume/fork/reload install only modal's
factory. Mode rendering and commands run once. Synthetic native-local history
stays separate from shared-only multiline picker results; selection neither
submits, seeds native history, replaces the editor, nor appends to the file.
The test-only sibling path is overridable via `PI_SHARED_HISTORY_PACKAGE`.
Without a sibling or override these two tests skip, not the ordinary modal suite.
Generic preexisting-factory tests remain, with misleading shared fixture wording
removed. Clipboard, collapsed-paste, whole-draft `yy`, `dd`, app shortcuts,
no-custom-factory behavior, and UI-reset coverage remain unchanged.

### Live TUI lifecycle limitation (preexisting)

Real Pi 1.1.0 regular-mode TUIs were exercised in a dedicated tmux server with
isolated agent directories, synthetic session messages and shared JSONL, offline
mode, no tools, and no credentials. Native history was checked through actual
keyboard navigation; test-only commands invoked Pi's command-context session
replacement/fork/new operations, and reload used built-in `/reload`.
No model/API requests or personal history/clipboard operations were made.

| Lifecycle | Command-only shared + modal | Baseline seeded shared + modal | No-modal control |
| --- | --- | --- | --- |
| Startup | Native local entry | Native local entry | Native local entry |
| Resume / fork / reload | Empty native history | Shared-only entry, missing native local entry | Native local entry |
| New with preloaded setup message | Empty native history | Shared-only entry, missing setup entry | Native setup entry |

Both modal versions restored the full shared-only multiline prompt through the
real `/history` picker at startup. Live modal checks used history-first ordering;
the automated real-loader tests cover both orders. Repeated line-start `gg0k`
checks after resume exhausted navigation, ruling out a multiline cursor-position
artifact. The transcript still displayed the native session messages.

Baseline reproduction used history `f55a2f9` and unchanged modal `5deffd3`.
The refactor **exposes but does not cause** native session-history loss on these
transitions. Pi's custom-editor setter copies text/handlers, not hidden history;
startup populates history after binding, while replacement/reload can render
before modal creates a new editor. Shared seeding previously masked that loss.
The no-modal control works across all tested transitions. A separate host/modal
lifecycle fix needs user approval; no private-history copying or shared-seeding
workaround was added. Full procedure/results are recorded in shared history's
`docs/ai/command-only-history-validation.md`.

## Deliberate limits and next action

No counts, visual mode, general Vim parser, or full Vim cursor semantics. Native
undo restores `dd` in character/grapheme steps. Native arrows may browse history;
normal-mode Escape still aborts or invokes Pi's session actions. A component-only
combined-paste-and-trailing-key edge case remains deferred: Pi's terminal input
buffer separates those packets in normal use.

Run `/reload` to activate the latest code. Local package updates come from their
Git checkouts and `/reload`, not `pi update`. Native history after lifecycle
transitions with modal remains a known separate issue pending approval for a fix;
shared `/history` lookup remains available.
