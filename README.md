# Pi modal editor

Small Vim-like bindings layered onto Pi's existing prompt editor. Requires Pi
1.1.0's `ctx.ui.getEditorComponent()` API. Starts in insert mode and shows the
current mode in the editor's bottom border. The development checkout lives at
`/home/michaelb/Documents/repos/projects/pi-extensions/pi-modal-editor`.

| Key | Normal-mode behavior |
| --- | --- |
| Escape | Insert → normal; in normal mode, forwards Pi's Escape action |
| `i`, `a` | Insert at the cursor / move right and insert |
| `h`, `j`, `k`, `l` | Forward left/down/up/right arrows, including visual wrapping and history |
| `0`, `$` | Start/end of the logical line |
| `gg`, `G` | Start of the first/last logical line in the prompt; never browse history |
| `x` | Delete the grapheme under the cursor; never join lines |
| `dd` | Delete the current logical line without yanking |
| `yy` | Yank the current logical line to an internal register |
| `p`, `P` | Paste the yanked line below/above the current line |

Application shortcuts, Enter, arrow keys, and bracketed paste keep their native
behavior. Escape closes autocomplete when entering normal mode. Unrecognized
printable characters are ignored in normal mode. The yank register is internal,
not the system clipboard. `yy` refuses lines containing collapsed paste markers
and shows a warning, preserving the previous yank. Paste IDs are mutable and can
be reused, so retaining a marker could paste the wrong content. Open the prompt
with Ctrl+G first to expand that content into ordinary text.

`gg`/`G` close autocomplete before moving; `j`/`k` still navigate its list.
Escape in normal mode retains Pi's abort behavior; double Escape with an empty
prompt can still open Pi's session tree.

This intentionally is not a full Vim implementation: no counts, visual mode,
operators, or Vim cursor clamping. `dd` uses native Delete/Backspace rather than
kill-line, so it leaves both the internal yank register and Pi's kill ring alone.
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
