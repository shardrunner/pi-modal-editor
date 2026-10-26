# pi-modal-editor

> **Disclaimer:** This extension is vibe coded for personal use. Use at your own risk.

Edit long [Pi](https://pi.dev) prompts with Vim-style motions, while keeping the
native editor's undo, history and collapsed-paste handling.

## Why

- Editing long, multi-line prompts with arrow keys alone is slow for Vim users.
- Swapping out the whole editor would lose Pi's native undo, history and paste handling.

## Features

- Insert and normal modes. The current mode is shown in the editor border, and the
  cursor shape changes (I-beam in insert mode, block in normal mode).
- Word motions, line motions, open-line, delete-line and system clipboard yank/paste.
- Built on Pi's native `CustomEditor` and public APIs, without copying editor internals.
- Works alongside [`pi-shared-prompt-history`](https://github.com/shardrunner/pi-shared-prompt-history).

## Installation

Requires **Pi 1.1.0+**.

```sh
pi install git:github.com/shardrunner/pi-modal-editor
```

Run `/reload` in open Pi sessions. Update with
`pi update git:github.com/shardrunner/pi-modal-editor`. For local development,
install a checkout instead (`pi install /absolute/path/to/pi-modal-editor`). If you
switch between the two, replace the existing entry in the `packages` array of
`~/.pi/agent/settings.json` so the extension only loads once.

## Usage

The editor starts in insert mode.

| Key                | Normal-mode behavior                                                 |
| ------------------ | -------------------------------------------------------------------- |
| Escape             | Insert → normal; in normal mode, triggers Pi's own Escape action     |
| `i`, `a`           | Insert at the cursor / move right and insert                         |
| `I`, `A`           | Insert at the start (column 0) / end of the line                     |
| `o`, `O`           | Open an empty line below / above and switch to insert mode           |
| `w`, `b`, `e`      | Next word start / previous word start / word end                     |
| `h`, `j`, `k`, `l` | Same as the arrow keys, including visual wrapping and history        |
| `0`, `$`           | Start / end of the line                                              |
| `gg`, `G`          | Start of the first / last line of the prompt (never browses history) |
| `x`                | Delete the character under the cursor (never joins lines)            |
| `dd`               | Delete the current line, without copying it                          |
| `u`                | Undo, using Pi's native Ctrl+- undo                                  |
| `yy`               | Copy the whole prompt draft to the system clipboard                  |
| `p`, `P`           | Paste the current system clipboard below / above the current line    |

Application shortcuts, Enter, arrow keys and bracketed paste work as usual. Other
printable keys do nothing in normal mode.

## Behavior and limitations

**Clipboard.** `yy` copies the full draft, including the content of collapsed pastes,
through Pi's `copyToClipboard()`. On Linux that uses `wl-copy` or `xclip`/`xsel`, with
OSC 52 for remote sessions. The status line reports `Copied draft to clipboard`,
`Clipboard cleared` (empty draft) or `Clipboard copy failed`. `p`/`P` always read the
current system clipboard; there is no private register. Clipboard actions run in order,
so `yy` followed by `p` pastes what was just copied. A pending paste is cancelled if you
type, move the cursor, submit or switch focus in the meantime. Pasting only works on
Linux and needs `wl-paste` (Wayland) or `xclip`/`xsel` (X11). Over SSH, use your
terminal's paste shortcut instead.

**Motions.** `w`/`b`/`e` behave like Pi's native word jumps (Alt+F/Alt+B). ASCII
punctuation separates words; Unicode punctuation inside a word does not. Motions cross
line boundaries without browsing history and ignore visual wrapping. Multi-byte
characters and collapsed paste markers are treated as single units. `I` goes to column 0,
not Vim's first non-blank character.

**Undo and autocomplete.** One `u` undoes a line opened with `o`/`O` that you haven't
typed in yet. Typing and `dd` keep Pi's native undo grouping. Undoing a `dd` restores
the text in character-sized steps. Motions, undo and insert commands close autocomplete
without applying a suggestion; `j`/`k` still move through its list.

**Cursor.** Cursor shapes use standard DECSCUSR sequences, and the terminal has to
support them. On focus loss or shutdown, the default cursor shape and visibility are
restored.

**Composition.** The extension replaces Pi's editor component, so it doesn't combine
with other packages that do the same; whichever sets its editor last wins.
`pi-shared-prompt-history` only adds a command, so both work in either load order.
Pi doesn't carry Up-arrow history over to a replacement editor, so on new, resume, fork
and reload the extension refills it with the session's prompts; on startup Pi fills it
itself. Like Pi, the refill only replays typed prompts, so earlier `!bash` and slash
commands are missing from Up history after any of these.

**Not a full Vim.** No counts, visual mode or operators (such as `ciw`). `dd` leaves both
the system clipboard and Pi's kill ring unchanged.

## Development

```sh
npm ci --ignore-scripts
npm run check
```

Requires Node.js 24+. The integration tests load the real package with Pi 1.1.0's
resource loader in an isolated agent directory. They check both load orders with
`pi-shared-prompt-history` and need either a `../pi-shared-prompt-history` checkout next
to this one or `PI_SHARED_HISTORY_PACKAGE=/absolute/path/to/pi-shared-prompt-history`.
Without either, only those two tests are skipped.

## License

[MIT](LICENSE) © 2026 Michael Brunner
