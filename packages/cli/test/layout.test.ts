import { describe, expect, it } from 'vitest';
import type { CardSize } from '@blueprint/core/layout';
import { unoverlap } from '../src/layout.js';

const card = (file: string, w: number, h: number): CardSize => ({ file, w, h, blocks: [] });

describe('unoverlap', () => {
  it('leaves non-overlapping files alone', () => {
    const pos = { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, c: { x: 0, y: 700 } };
    const cards = { a: card('a', 400, 300), b: card('b', 400, 300), c: card('c', 400, 300) };
    expect(unoverlap(pos, cards)).toEqual(pos);
  });

  it('pushes the lower file down when the upper one grew into it', () => {
    const pos = { a: { x: 0, y: 0 }, b: { x: 0, y: 400 } };
    const cards = { a: card('a', 400, 900), b: card('b', 400, 300) };
    const out = unoverlap(pos, cards);
    expect(out.a).toEqual({ x: 0, y: 0 });
    expect(out.b?.y).toBe(900 + 80);
  });

  it('cascades down a column', () => {
    const pos = { a: { x: 0, y: 0 }, b: { x: 0, y: 400 }, c: { x: 0, y: 800 } };
    const cards = { a: card('a', 400, 600), b: card('b', 400, 600), c: card('c', 400, 100) };
    const out = unoverlap(pos, cards);
    expect(out.b?.y).toBe(680);
    expect(out.c?.y).toBe(680 + 600 + 80);
  });
});
