import { spawn } from 'node:child_process';

// fire and forget. returns false when the command can't even start.
function launch(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
      p.once('error', () => resolve(false));
      p.once('spawn', () => {
        p.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

// open a url in the default browser. skipped when there's nobody to look at it.
// when Claude Code is the one running us it has its own place to show the page (the browser pane in
// the desktop app), so don't pop a tab in the user's own browser. but a terminal you opened yourself,
// even one inside the app, inherits the same CLAUDE_CODE_* variables. the difference is that you are
// at a terminal: a person's shell has a tty on stdout, the tool Claude runs commands through does not.
export const drivenByClaude = (env: NodeJS.ProcessEnv = process.env, isTTY: boolean = !!process.stdout.isTTY): boolean =>
  !isTTY && !!(env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT);

export function canOpenBrowser(env: NodeJS.ProcessEnv = process.env, platform = process.platform, isTTY: boolean = !!process.stdout.isTTY): boolean {
  if (env.CI) return false;
  if (drivenByClaude(env, isTTY)) return false;
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
  return true;
}

export async function openBrowser(url: string, platform = process.platform): Promise<boolean> {
  if (platform === 'darwin') return launch('open', [url]);
  if (platform === 'win32') return launch('cmd', ['/c', 'start', '""', url]);
  return launch('xdg-open', [url]);
}
