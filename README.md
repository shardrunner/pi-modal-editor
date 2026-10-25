# Pi modal editor

> **Disclaimer:** This extension is vibe coded for personal use. Use at your own risk.

Small Vim-like bindings on Pi's native prompt editor (Pi 1.1.0). Starts in insert mode and shows the
current mode in the editor's bottom border. The focused cursor is a vertical
I-beam in insert mode and a block in normal mode.

| Key | Normal-mode behavior |
| --- | --- |
| Escape | Insert → normal; in normal mode, forwards Pi's Escape action |
| `i`, `a` | Insert at the cursor / move right and insert |
| `I`, `A` | Enter insert mode at the logical line start (column 0) / end |
| `o`, `O` | Open an empty line below/above and enter insert mode |
| `w`, `b`, `e` | Next word start / previous word start / word end |
| `u` | Forward Pi's native Ctrl+- undo |
| `h`, `j`, `k`, `l` | Forward left/down/up/right arrows, including visual wrapping and history |
| `0`, `$` | Start/end of the logical line |
| `gg`, `G` | Start of the first/last logical line in the prompt; never browse history |
| `x` | Delete the grapheme under the cursor; never join lines |
| `dd` | Delete the current logical line without yanking |
| `yy` | Copy the entire expanded prompt draft to the standard system clipboard |
| `p`, `P` | Read the current system clipboard and paste below/above the current line |

Application shortcuts, Enter, arrow keys, and bracketed paste keep their native
behavior. Escape closes autocomplete when entering normal mode. Unrecognized
printable characters are ignored in normal mode. `yy` writes to the standard
system clipboard through Pi's public `copyToClipboard()` API (on Linux:
`wl-copy` or `xclip`/`xsel`, with terminal OSC 52 for remote/headless sessions). Clipboard
failures produce an error notification. The status line shows
`Copied draft to clipboard` after success (or `Clipboard cleared` for an empty
draft); there is no copying-progress message. A failed copy shows
`Clipboard copy failed`. The latest result remains until another clipboard result
or UI reset.

`p`/`P` always read fresh clipboard text, including text copied in another app.
There is no private yank register or fallback to old copied text. Clipboard
operations are serialized so `yy` followed by `p` reads the completed copy.
An empty clipboard is a no-op. A paste is cancelled if input, focus, cursor, or
text changes while the read is pending; submission and session shutdown also
cancel pending pastes.

Pasting supports Linux only and requires `wl-paste` (Wayland) or `xclip`/`xsel`
(X11); Wayland reads never fall back to potentially stale X11 data. OSC 52 copying requires terminal
support and permission. Reading the client clipboard over SSH/headless terminals
is not supported: use the terminal's paste shortcut if no local clipboard exists.

`yy` snapshots the entire draft through Pi's public
`getExpandedText()` API, including the actual content of collapsed pastes. The
clipboard text does not depend on mutable paste IDs, so draft edits, submission,
and paste-ID reuse do not alter it. `yy` does not change the draft or cursor;
an empty draft clears the clipboard.

The hardware cursor uses standard DECSCUSR shapes (steady I-beam/block), with
Pi's existing cursor marker preserving positioning and IME support. Terminal
support for cursor shapes is required; the mode label remains available either
way. On focus loss or session shutdown, the extension requests the terminal's
default cursor shape and restores Pi's previous hardware-cursor visibility.
Custom editors must keep Pi's plain `focused` field; accessors fail loudly.

`w`/`b`/`e` follow Pi's native word jumps (Alt+F/Alt+B): ASCII punctuation
separates words, Unicode punctuation inside a word (`foo’bar`) does not, and `_`
next to punctuation joins the punctuation run. Adjacent letters and numbers stay
one word even where Unicode segmentation splits them (e.g. Latin next to CJK).
Motions cross logical lines and blank lines without browsing history and are
independent of visual wrapping. Graphemes and real collapsed paste markers remain atomic.
At the prompt boundary, `w` may reach the end-of-line insertion position; `e`
stays put when there is no following word.

`I` means column 0, including any leading whitespace—not Vim's first nonblank.
`o`/`O` insert a newline atomically through Pi's public insertion API, so one `u`
undoes an untouched opened line. Typing and `dd` keep Pi's native undo grouping.

`gg`/`G`, word motions, undo, and insert-entry commands dismiss autocomplete
without applying a completion; `j`/`k` still navigate its list.
Escape in normal mode retains Pi's abort behavior; double Escape with an empty
prompt can still open Pi's session tree.

This intentionally is not a full Vim implementation: no counts, visual mode,
operators (including `ciw`), or Vim cursor clamping. `dd` uses native Delete/Backspace rather than
kill-line, so it leaves both the system clipboard and Pi's kill ring alone.
Native undo restores these deletions in character/grapheme-sized steps.

## Installation and composition

Install from the private GitHub repository (requires GitHub SSH access):

```sh
pi install git:git@github.com:shardrunner/pi-modal-editor
```

This adds the GitHub source to `~/.pi/agent/settings.json`'s `packages` array.
When migrating from a local installation, replace its existing package entry
rather than keeping both sources, so the extension loads only once.

After pushing changes, update the installed checkout:

```sh
pi update git:git@github.com:shardrunner/pi-modal-editor
```

Run `/reload` in active sessions after installation or updates. Editing the
local development checkout alone does not change the installed GitHub checkout.
For local development, use `pi install /absolute/path/to/pi-modal-editor` instead
of the GitHub source.

Each session installs a native `CustomEditor` through
`ctx.ui.setEditorComponent()` and decorates that instance; it does not copy
editor internals. It does not compose with other packages that replace the
editor: whichever installs its editor last wins.

`pi-shared-prompt-history` is command-only lookup and does not own the editor, so
these two packages work in either relative order. Native Up/Down (and modal `j`/`k`)
and shared `/history` lookup are separate: choosing a shared prompt replaces the
draft without submitting it or importing it into native history.

**Native Up history across session changes:** Pi 1.1.0 keeps Up history inside
the editor and does not copy it to a replacement editor. On new, resume, fork, and
reload, modal therefore refills its editor with the session's user prompts, the
same entries Pi itself loads. On startup Pi fills it after installation, so modal
skips the refill. Remaining gap: after `/reload`, `!bash` commands and slash
commands typed earlier are no longer in Up history, because Pi never stores them
in the session. `/history` is unaffected.

## Development

```sh
npm ci --ignore-scripts
npm run check
```

The real-package integration tests use Pi 1.1.0's resource loader and an isolated
agent directory. They run with a sibling `../pi-shared-prompt-history` checkout,
or set `PI_SHARED_HISTORY_PACKAGE=/absolute/path/to/pi-shared-prompt-history`.
Without either, only those two integration tests are skipped; there is no
cross-repository production dependency. They check both load orders and simulated
lifecycle UI resets with a synthetic session; startup ordering of Pi's own history
population is modeled, not exercised.
