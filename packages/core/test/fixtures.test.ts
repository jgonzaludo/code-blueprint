import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseTree, type ParsedTree } from '../src/index.js';

const fx = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
const parse = (name: string) => parseTree(path.join(fx, name));

// compact views so the expectations read like the fixture source
const blocks = (t: ParsedTree) => [...t.blocks.values()].map((b) => `${b.id} ${b.kind}`).sort();
const edges = (t: ParsedTree) =>
  [...t.edges.values()].map((e) => `${e.from} -> ${e.to} L${e.callLine}->L${e.targetLine} ${e.resolution}`).sort();

describe('arrow function and exported consts', () => {
  const t = parse('arrow-consts');
  it('makes const blocks, and a module block for leftover statements', () => {
    expect(blocks(t)).toEqual(
      [
        'src/main.ts::imports imports',
        'src/main.ts::run function',
        'src/math.ts::LIMIT const',
        'src/math.ts::add const',
        'src/math.ts::double const',
        'src/math.ts::module module',
        'src/math.ts::table const',
      ].sort(),
    );
  });
  it('keeps the comment above a const in its block', () => {
    expect(t.blocks.get('src/math.ts::double')?.code[0]).toBe('// doubles through add');
    expect(t.blocks.get('src/math.ts::double')?.lineNums).toEqual([3, 4]);
  });
  it('draws edges between consts and into plain functions', () => {
    expect(edges(t)).toEqual([
      'src/main.ts::run -> src/math.ts::double L4->L4 checker',
      'src/math.ts::double -> src/math.ts::add L4->L1 checker',
    ]);
  });
  it('sees the module block as an edge source', () => {
    expect(t.blocks.get('src/math.ts::module')?.code).toEqual(['const hidden = 5;', 'console.log(hidden);']);
  });
});

describe('default exports', () => {
  const t = parse('default-exports');
  it('names them default', () => {
    expect(blocks(t)).toEqual(
      [
        'src/Thing.ts::default class',
        'src/greet.ts::default function',
        'src/greet.ts::hello function',
        'src/main.ts::imports imports',
        'src/main.ts::main function',
      ].sort(),
    );
  });
  it('resolves default imports, new X() and methods to the default block', () => {
    expect(edges(t)).toEqual([
      'src/greet.ts::default -> src/greet.ts::hello L2->L5 checker',
      'src/main.ts::main -> src/Thing.ts::default L5->L1 checker',
      'src/main.ts::main -> src/Thing.ts::default L6->L2 checker',
      'src/main.ts::main -> src/greet.ts::default L7->L1 checker',
    ]);
  });
});

describe('re-exports', () => {
  const t = parse('reexports');
  it('follows aliases through the barrel to the real declaration', () => {
    expect(edges(t)).toEqual(['src/use.ts::go -> src/impl.ts::real L5->L1 checker']);
  });
  it('counts export-from as a file edge', () => {
    expect([...t.fedges].sort()).toEqual(['src/barrel.ts|src/impl.ts', 'src/use.ts|src/barrel.ts']);
  });
});

describe('new X() and class methods', () => {
  it('draws new X() edges to the class', () => {
    const t = parse('new-expr');
    expect(edges(t)).toEqual([
      'src/make.ts::make -> src/widget.ts::Widget L4->L1 checker',
      'src/make.ts::make -> src/widget.ts::Widget L5->L4 checker',
    ]);
    expect(t.blocks.get('src/widget.ts::Widget')?.members.map((m) => m.name)).toEqual(['constructor', 'render']);
  });
  it('lands method calls on the class, with the method line as target', () => {
    const t = parse('class-methods');
    expect(edges(t)).toEqual(['src/use.ts::use -> src/counter.ts::Counter L4->L4 checker']);
    expect(t.blocks.get('src/counter.ts::Counter')?.members.map((m) => m.name)).toEqual(['n', 'inc', 'bump']);
  });
});

describe('type errors', () => {
  it('parses anyway and reports a count', () => {
    const t = parse('type-errors');
    expect(t.typeErrors).toBe(1);
    expect(edges(t)).toEqual(['src/broken.ts::f -> src/broken.ts::g L4->L7 checker']);
  });
});

describe('misc block kinds', () => {
  const t = parse('misc-kinds');
  it('merges overloads into one block', () => {
    expect(t.blocks.get('src/misc.ts::over')?.lineNums).toEqual([1, 2, 3, 4, 5]);
  });
  it('has enum, namespace and module blocks', () => {
    expect(blocks(t)).toEqual(
      [
        'src/misc.ts::Color enum',
        'src/misc.ts::Util namespace',
        'src/misc.ts::module module',
        'src/misc.ts::over function',
        'src/misc.ts::setup function',
      ].sort(),
    );
  });
  it('counts top-level calls as edges from the module block', () => {
    expect(edges(t)).toEqual(['src/misc.ts::module -> src/misc.ts::setup L16->L18 checker']);
  });
});

describe('untyped js', () => {
  it('resolves typed calls with the checker and falls back to name-match, labeled', () => {
    const t = parse('untyped-js');
    expect(edges(t)).toEqual([
      'src/a.js::a -> src/b.js::b L4->L1 checker',
      'src/a.js::c -> src/b.js::mystery L8->L5 name-match',
    ]);
  });
});
