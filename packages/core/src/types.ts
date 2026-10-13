// data model, see docs/CONTEXT.md section 7

export type BlockId = string; // "<relpath>::<name>"
export type BlockKind = 'imports' | 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum';
export type LineDiff = ' ' | '+' | '-';
export type Status = 'same' | 'mod' | 'new' | 'del';
export type EdgeStatus = 'same' | 'new' | 'del';

export interface Line {
  t: string; // exact source text
  d: LineDiff;
  o: number | null; // line number in the baseline file (null for '+')
  n: number | null; // line number in the new file (null for '-')
}

export interface Member {
  name: string;
  line: number;
}

export interface Block {
  id: BlockId;
  file: string; // repo-relative, forward slashes
  kind: BlockKind;
  name: string;
  status: Status;
  lines: Line[];
  members: Member[];
  exported?: boolean;
  external?: { from: string };
}

export interface Edge {
  from: BlockId;
  to: BlockId;
  callText: string; // trimmed source line of the call site
  targetText: string; // trimmed source line of the callee declaration
  status: EdgeStatus;
  callLine?: number;
  targetLine?: number;
  source?: 'parser' | 'claim';
  check?: 'confirmed' | 'missing' | 'unplanned';
  resolution?: 'checker' | 'name-match' | 'unresolved';
}

export interface FileEdge {
  from: string;
  to: string;
  status: EdgeStatus;
}

export type FileStat = Record<string, Status>;
export type FileText = Record<string, Line[]>;

export interface PlanInfo {
  id: string;
  title: string;
  state: 'proposed' | 'applied' | 'checked';
  claims: Edge[];
  summary?: { confirmed: number; missing: number; unplanned: number };
}

export interface Graph {
  blocks: Record<BlockId, Block>;
  edges: Edge[];
  fedges: FileEdge[];
  fstat: FileStat;
  ftext: FileText;
  meta?: { root: string; baseline: string; parsedAt: string; files: number; ms: number };
  plan?: PlanInfo;
}

// what a single tree parses into, before any diffing
export interface ParsedBlock {
  id: BlockId;
  file: string;
  kind: BlockKind;
  name: string;
  start: number; // 1-based, includes leading comments
  end: number;
  code: string[]; // dedented lines
  members: Member[];
}

export type ParsedEdge = Omit<Edge, 'status'>;

export interface ParsedTree {
  blocks: Map<BlockId, ParsedBlock>;
  edges: Map<string, ParsedEdge>; // key: from|to|callText
  fedges: Set<string>; // key: from|to
  files: string[]; // repo-relative
}
