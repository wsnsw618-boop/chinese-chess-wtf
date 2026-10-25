export type Side = 'red' | 'black';

export type AgentKind = 'random' | 'greedy' | 'search';

export interface AgentSpec {
  kind: AgentKind;
  depth: number;
  randomize: number;
  timeMs: number;
  label: string;
}

export interface RunConfig {
  games: number;
  seed: number;
  maxPlies: number;
  red: AgentSpec;
  black: AgentSpec;
  outDir: string;
  reportPath: string;
}

export interface MoveLog {
  ply: number;
  notation: string;
  from: string;
  to: string;
  piece: string;
  captured?: string;
  promotion?: string;
  check: boolean;
  legalMoves: number;
  phase: string;
  evalRed: number;
}

export interface SelectionChoiceLog {
  square: number;
  coordinate: string;
  piece: string;
  target: string;
}

export interface SelectionLog {
  duelIndex: number;
  selector: Side;
  first: boolean;
  accepted: boolean;
  choices: SelectionChoiceLog[];
  error?: string;
}

export interface DuelTriggerLog {
  duelIndex: number;
  reason: string;
  firstSelector: Side;
  ply: number;
}

export interface GameStats {
  captures: number;
  selfCaptures: number;
  checks: number;
  promotions: number;
  firstCapturePly: number | null;
  firstCheckPly: number | null;
  firstPromotionPly: number | null;
  firstDuelPly: number | null;
  uniquePositions: number;
  positionsTotal: number;
  branchingAverage: number;
  evalVolatility: number;
  maxEvalSwing: number;
  leadChanges: number;
  finalEval: number;
  closeGame: boolean;
  pieceUsage: Record<string, number>;
}

export interface GameRecord {
  id: string;
  index: number;
  seed: number;
  red: string;
  black: string;
  result: {
    winner: Side;
    reason: string;
    message: string;
  } | null;
  plies: number;
  durationMs: number;
  moves: MoveLog[];
  selections: SelectionLog[];
  triggers: DuelTriggerLog[];
  opening: string[];
  stats: GameStats;
  error?: string;
}
