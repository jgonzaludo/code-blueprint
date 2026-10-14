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
// when Claude Code is the one running us, it has its own place to show the page (the browser pane
// in the desktop app), so don't pop a tab in the user's own browser
export const drivenByClaude = (env: NodeJS.ProcessEnv = process.env): boolean => !!(env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT);

export function canOpenBrowser(env: NodeJS.ProcessEnv = process.env, platform = process.platform): boolean {
  if (env.CI) return false;
  if (drivenByClaude(env)) return false;
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
  return true;
}

export async function openBrowser(url: string, platform = process.platform): Promise<boolean> {
  if (platform === 'darwin') return launch('open', [url]);
  if (platform === 'win32') return launch('cmd', ['/c', 'start', '""', url]);
  return launch('xdg-open', [url]);
}

// jump to a file and line in the user's editor: `code -g file:line`, else $VISUAL / $EDITOR
export async function openInEditor(abs: string, line: number, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (await launch('code', ['-g', `${abs}:${line}`])) return true;
  const ed = env.VISUAL || env.EDITOR;
  if (ed) {
    const [cmd, ...rest] = ed.split(/\s+/);
    if (cmd) return launch(cmd, [...rest, `+${line}`, abs]);
  }
  return false;
}
