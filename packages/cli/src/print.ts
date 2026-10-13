import type { CallNode, FileTree } from '@blueprint/core';

// plain ascii plus box drawing, nothing a fallback font could mangle (CONTEXT.md section 13).
// a leading ":" means the line is in the same file as the parent.
function renderChildren(children: CallNode[], parentFile: string, prefix: string, lines: string[]): void {
  children.forEach((c, i) => {
    const last = i === children.length - 1;
    const loc = c.file === parentFile ? `:${c.line}` : `${c.file}:${c.line}`;
    lines.push(`${prefix}${last ? '└─ ' : '├─ '}${c.name}  ${loc}${c.seen ? ' (above)' : ''}`);
    renderChildren(c.children, c.file, prefix + (last ? '   ' : '│  '), lines);
  });
}

export function renderFileTree(t: FileTree): string {
  const blocks = t.roots.map((r) => {
    const lines = [`${r.name}  ${r.file}:${r.line}`];
    renderChildren(r.children, r.file, '', lines);
    return lines.join('\n');
  });
  return blocks.join('\n\n');
}
