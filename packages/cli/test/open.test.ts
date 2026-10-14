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
    expect(drivenByClaude({ CLAUDE_CODE_ENTRYPOINT: 'cli' })).toBe(true);
    expect(drivenByClaude({ CLAUDECODE: '1' })).toBe(true);
    expect(drivenByClaude({})).toBe(false);
    expect(canOpenBrowser({ CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' }, 'darwin')).toBe(false);
  });
});
