# Pi modal editor

Small Vim-like bindings layered onto Pi's existing prompt editor. Requires Pi
1.1.0's `ctx.ui.getEditorComponent()` API. Starts in insert mode and shows the
current mode in the editor's bottom border. The focused cursor is a vertical
I-beam in insert mode and a block in normal mode. The development checkout lives at
`/home/michaelb/Documents/repos/projects/pi-extensions/pi-modal-editor`.

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
system clipboard through Pi's public `copyToClipboard()` API (native platform
backends, with terminal OSC 52 support for remote/headless sessions). Clipboard
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

On Linux, copying/pasting may require `wl-copy`/`wl-paste` (Wayland) or
`xclip`/`xsel` (X11). Wayland reads never fall back to potentially stale X11 data.
macOS/Windows use native clipboard readers with platform-command fallbacks;
Termux and headless WSL also have command readers. OSC 52 copying requires terminal
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
Existing custom-editor focus accessors are preserved.

`w`/`b`/`e` use small-word boundaries: Unicode letters, numbers, and `_` form
words; punctuation/emoji form separate runs; whitespace separates both. Motions
cross logical lines and blank lines without browsing history and are independent
of visual wrapping. Graphemes and real collapsed paste markers remain atomic.
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

Add this directory as the **last** entry in `~/.pi/agent/settings.json`'s
`packages` array:

```json
"/home/michaelb/Documents/repos/projects/pi-extensions/pi-modal-editor"
```

Run `/reload`. Keep it after packages that replace the editor, such as
`pi-shared-prompt-history`. The extension captures their editor factory, creates
its editor, and decorates that same instance. It does not replace history logic
or copy editor internals. An incompatible custom editor fails with an explicit
error naming the missing method.

Do not put this extension in the auto-discovered `extensions/` directory: Pi
loads those extensions before package extensions. A later editor replacement
would override this wrapper.

## Development

```sh
npm install --ignore-scripts
npm run check
```
