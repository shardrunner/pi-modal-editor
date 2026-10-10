import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getNativeClipboard } from "@earendil-works/pi-tui";

const exec = promisify(execFile);
interface ClipboardReaderOptions {
  platform?: string;
  env?: NodeJS.ProcessEnv;
  nativeRead?: () => Promise<string | null | undefined>;
  run?: (command: string, args: string[]) => Promise<string>;
}

/** Read the standard clipboard, never the X11 primary selection or a local yank. */
export async function readSystemClipboard(options: ClipboardReaderOptions = {}): Promise<string | null> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const nativeRead = options.nativeRead ?? (() => getNativeClipboard()?.getText() ?? Promise.resolve(undefined));
  const run = options.run ?? (async (command, args) => {
    const { stdout } = await exec(command, args, {
      encoding: "utf8", timeout: 5000, maxBuffer: 50 * 1024 * 1024, windowsHide: true,
    });
    return stdout;
  });
  const commands: [string, string[]][] = [];
  if (env.TERMUX_VERSION) commands.push(["termux-clipboard-get", []]);
  else if (platform === "linux" && env.WAYLAND_DISPLAY) {
    // Do not fall through to a potentially stale X11 selection on Wayland.
    commands.push(["wl-paste", ["--no-newline", "--type", "text"]]);
  } else if (platform === "linux" && env.DISPLAY) {
    commands.push(["xclip", ["-selection", "clipboard", "-out"]], ["xsel", ["--clipboard", "--output"]]);
  } else if (platform === "darwin") commands.push(["pbpaste", []]);
  else if (platform === "win32" || (platform === "linux" && env.WSL_DISTRO_NAME)) {
    commands.push(["powershell.exe", ["-NoProfile", "-Command",
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $text = Get-Clipboard -Raw; if ($null -ne $text) { [Console]::Write($text) }",
    ]]);
  }

  let failure: unknown;
  if (platform !== "linux") {
    try {
      const text = await nativeRead();
      if (text !== undefined) return text;
    } catch (error) { failure = error; }
  }
  for (const [command, args] of commands) {
    try { return await run(command, args); }
    catch (error) { failure = error; }
  }
  if (platform === "linux" && !env.WAYLAND_DISPLAY && !env.TERMUX_VERSION && env.DISPLAY) {
    try {
      const text = await nativeRead();
      if (text !== undefined) return text;
    } catch (error) { failure = error; }
  }
  const hint = env.WAYLAND_DISPLAY ? "install wl-clipboard (wl-paste) or check Wayland access" :
    env.DISPLAY ? "install xclip or xsel, or check X11 access" :
    "use your terminal's paste shortcut if no local clipboard is available";
  throw new Error(`Clipboard unavailable: ${hint}${failure ? `; ${failure instanceof Error ? failure.message : String(failure)}` : ""}`);
}
