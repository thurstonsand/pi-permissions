import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TUI } from "@earendil-works/pi-tui";

// pi's own external-editor routine is a private method on interactive mode that
// only operates on its core input editor, so it can't be reused for our command
// buffer. This mirrors it (editor.ts:openExternalEditor) but takes the target
// text; the editor command is resolved by the caller via the public
// SettingsManager.getExternalEditorCommand(). The tmpfile carries a `.sh` suffix
// so editors apply shell syntax highlighting to the command being rewritten.
export async function openExternalEditor(
  tui: TUI,
  editorCommand: string,
  currentText: string,
): Promise<string | null> {
  const tmpFile = path.join(os.tmpdir(), `pi-permissions-edit-${Date.now()}.sh`);

  try {
    fs.writeFileSync(tmpFile, currentText, "utf-8");
    tui.stop();

    const [editor, ...editorArgs] = editorCommand.split(" ");
    process.stdout.write(
      `Launching external editor: ${editorCommand}\nPi will resume when the editor exits.\n`,
    );

    const status = await new Promise<number | null>((resolve) => {
      const child: ChildProcess = spawn(editor ?? editorCommand, [...editorArgs, tmpFile], {
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      child.on("error", () => resolve(null));
      child.on("close", (code) => resolve(code));
    });

    if (status === 0) {
      return fs.readFileSync(tmpFile, "utf-8").replace(/\n$/, "");
    }
    return null;
  } catch {
    return null;
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup errors
    }
    tui.start();
    tui.requestRender(true);
  }
}
