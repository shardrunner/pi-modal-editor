import type { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

/** Let Pi position the real cursor using its existing IME marker. */
export function useModeCursor(editor: CustomEditor, tui: TUI, mode: () => "insert" | "normal", onFocusChange: () => void) {
  const own = Object.getOwnPropertyDescriptor(editor, "focused");
  let descriptor = own;
  let prototype = Object.getPrototypeOf(editor);
  while (!descriptor && prototype) {
    descriptor = Object.getOwnPropertyDescriptor(prototype, "focused");
    prototype = Object.getPrototypeOf(prototype);
  }
  if (own?.configurable === false || (descriptor?.get && !descriptor.set) || descriptor?.writable === false) {
    throw new Error("Modal editor requires a writable, configurable focused property.");
  }
  let focused = editor.focused;
  let previousVisibility: boolean | undefined;
  let disposed = false;

  function restore(): void {
    if (previousVisibility === undefined) return;
    tui.terminal.write("\x1b[0 q"); // Terminal default, not a forced shell cursor shape.
    tui.setShowHardwareCursor(previousVisibility);
    previousVisibility = undefined;
  }
  function update(): void {
    if (disposed) return;
    if (!editor.focused) return restore();
    if (previousVisibility === undefined) previousVisibility = tui.getShowHardwareCursor();
    tui.setShowHardwareCursor(true);
    tui.terminal.write(mode() === "insert" ? "\x1b[6 q" : "\x1b[2 q");
  }
  Object.defineProperty(editor, "focused", {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    get: () => descriptor?.get ? descriptor.get.call(editor) : focused,
    set: (value: boolean) => {
      const before = editor.focused;
      if (descriptor?.set) descriptor.set.call(editor, value);
      else focused = value;
      if (before !== editor.focused) onFocusChange();
      update();
    },
  });
  update();
  return {
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      restore();
      const value = editor.focused;
      if (own) Object.defineProperty(editor, "focused", "value" in own ? { ...own, value } : own);
      else Reflect.deleteProperty(editor, "focused");
    },
  };
}
