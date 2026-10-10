import type { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

/** Let Pi position the real cursor using its existing IME marker. */
export function useModeCursor(editor: CustomEditor, tui: TUI, mode: () => "insert" | "normal", onFocusChange: () => void) {
  // Pi's Editor declares `focused` as a plain field; decorate exactly that.
  const own = Object.getOwnPropertyDescriptor(editor, "focused");
  if (!own || !("value" in own) || !own.writable || !own.configurable) {
    throw new Error("Modal editor requires a plain writable focused field.");
  }
  let focused: boolean = own.value;
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
    enumerable: own.enumerable,
    get: () => focused,
    set: (value: boolean) => {
      if (value !== focused) onFocusChange();
      focused = value;
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
      Object.defineProperty(editor, "focused", { ...own, value: focused });
    },
  };
}
