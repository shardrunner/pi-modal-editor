import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
interface ClipboardReaderOptions {
  env?: NodeJS.ProcessEnv;
  run?: (command: string, args: string[]) => Promise<string>;
}

/** Read the Linux CLIPBOARD selection (never primary), mirroring Pi's Linux copy tools. */
export async function readSystemClipboard(options: ClipboardReaderOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  const run = options.run ?? (async (command, args) => {
    const { stdout } = await exec(command, args, { encoding: "utf8", timeout: 5000, maxBuffer: 50 * 1024 * 1024 });
    return stdout;
  });
  // Do not fall through to a potentially stale X11 selection on Wayland.
  const commands: [string, string[]][] = env.WAYLAND_DISPLAY ? [["wl-paste", ["--no-newline", "--type", "text"]]] :
    env.DISPLAY ? [["xclip", ["-selection", "clipboard", "-out"]], ["xsel", ["--clipboard", "--output"]]] : [];
  let failure: unknown;
  for (const [command, args] of commands) {
    try { return await run(command, args); }
    catch (error) { failure = error; }
  }
  const hint = env.WAYLAND_DISPLAY ? "install wl-clipboard (wl-paste) or check Wayland access" :
    env.DISPLAY ? "install xclip or xsel, or check X11 access" :
    "no Wayland/X11 display; use your terminal's paste shortcut";
  throw new Error(`Clipboard unavailable: ${hint}${failure ? `; ${failure instanceof Error ? failure.message : String(failure)}` : ""}`);
}
