import { describe, expect, it } from 'vitest';
import { canOpenBrowser, drivenByClaude } from '../src/open.js';

describe('canOpenBrowser', () => {
  it('opens a browser on a normal desktop', () => {
    expect(canOpenBrowser({}, 'darwin')).toBe(true);
    expect(canOpenBrowser({ DISPLAY: ':0' }, 'linux')).toBe(true);
  });
  it('does not on CI or a headless linux box', () => {
    expect(canOpenBrowser({ CI: 'true' }, 'darwin')).toBe(false);
    expect(canOpenBrowser({}, 'linux')).toBe(false);
  });
  it('does not when Claude Code is driving, so nothing opens outside the app', () => {
    // claude runs commands with no tty
    expect(drivenByClaude({ CLAUDE_CODE_ENTRYPOINT: 'cli' }, false)).toBe(true);
    expect(drivenByClaude({ CLAUDECODE: '1' }, false)).toBe(true);
    expect(drivenByClaude({}, false)).toBe(false);
    expect(canOpenBrowser({ CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' }, 'darwin', false)).toBe(false);
  });
  it('still opens for a person at a terminal, even one inside the app that inherited the variables', () => {
    expect(drivenByClaude({ CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', CLAUDE_CODE_DESKTOP_APP_VERSION: '1' }, true)).toBe(false);
    expect(canOpenBrowser({ CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' }, 'darwin', true)).toBe(true);
  });
});
