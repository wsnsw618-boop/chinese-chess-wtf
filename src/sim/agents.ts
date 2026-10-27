import { applyMove, piecesOf, undoMove, type Position } from '../game/board';
import {
  Color,
  Move,
  PieceType,
  RED,
  TransformChoice,
  typeOf,
} from '../game/types';
import { evaluate } from '../ai/evaluate';
import {
  findBestMove,
  randomLegalMove,
  type SearchRestriction,
} from '../ai/search';
import { chooseTransformations } from '../ai/selection';
import { mulberry32, pickOne, randomInt, shuffle, type Rng } from './rng';
import type { AgentSpec } from './types';

export interface AgentContext {
  rng: Rng;
  ply: number;
}

export interface Agent {
  spec: AgentSpec;
  chooseMove(
    pos: Position,
    moves: Move[],
    ctx: AgentContext,
    restriction?: SearchRestriction,
  ): Move;
  chooseTransformations(
    pos: Position,
    color: Color,
    opponentChoices: TransformChoice[] | undefined,
    opponentColor: Color | undefined,
    ctx: AgentContext,
  ): TransformChoice[];
}

export function parseAgentSpec(input: string): AgentSpec {
  const raw = input.trim().toLowerCase();
  if (raw === 'random') {
    return { kind: 'random', depth: 0, randomize: 0, timeMs: 0, label: 'random' };
  }
  if (raw === 'greedy') {
    return { kind: 'greedy', depth: 1, randomize: 20, timeMs: 0, label: 'greedy' };
  }
  if (raw === 'hard') {
    // Match the in-game "困难" AI: depth 6, 2.4s, no near-best randomization.
    return { kind: 'search', depth: 6, randomize: 0, timeMs: 2_400, label: 'hard' };
  }
  if (raw === 'expert') {
    // Match the in-game "专家" AI: depth 7, 6s, killer-move ordering.
    return { kind: 'search', depth: 7, randomize: 0, timeMs: 6_000, label: 'expert' };
  }
  if (raw.startsWith('hard:')) {
    // Hard search with a small near-best margin, for reproducible but diverse
    // training games. The opponent can still use the strict `hard` profile.
    const margin = Math.max(0, Math.min(200, Number(raw.slice(5)) || 0));
    return {
      kind: 'search',
      depth: 6,
      randomize: margin,
      timeMs: 2_400,
      label: `hard:r${margin}`,
    };
  }

  const parts = raw.split(':');
  const head = parts[0];
  if (head !== 'search' && head !== 'depth' && head !== 's') {
    throw new Error(`Unknown agent "${input}". Use random, greedy, hard, search:2 or search:2:60.`);
  }
  const depth = Math.max(1, Math.min(10, Number(parts[1] ?? 2) || 2));
  const randomize = Math.max(0, Number(parts[2] ?? 60) || 60);
  const timeMs =
    depth <= 1 ? 80 : depth === 2 ? 160 : depth === 3 ? 500 : depth <= 5 ? 1_500 : depth === 6 ? 2_400 : depth === 7 ? 4_000 : 6_000;
  return {
    kind: 'search',
    depth,
    randomize,
    timeMs,
    label: `search:d${depth}:r${randomize}`,
  };
}

function targetName(target: PieceType.Tiger | PieceType.Dragon, color: Color): string {
  if (target === PieceType.Tiger) return color === RED ? '虎' : '坦';
  return color === RED ? '龙' : '仙';
}

export function targetLabel(
  target: PieceType.Tiger | PieceType.Dragon,
  color: Color,
): string {
  return targetName(target, color);
}

class RandomAgent implements Agent {
  spec: AgentSpec;

  constructor(spec: AgentSpec) {
    this.spec = spec;
  }

  chooseMove(pos: Position, moves: Move[], ctx: AgentContext, restriction?: SearchRestriction): Move {
    if (!moves.length) throw new Error('RandomAgent received no legal moves');
    if (restriction) {
      const move = randomLegalMove(pos, restriction, ctx.rng);
      if (move) return move;
    }
    return pickOne(ctx.rng, moves);
  }

  chooseTransformations(
    pos: Position,
    color: Color,
    _opponentChoices: TransformChoice[] | undefined,
    _opponentColor: Color | undefined,
    ctx: AgentContext,
  ): TransformChoice[] {
    const candidates = piecesOf(pos, color).filter(
      ({ piece }) => typeOf(piece) !== PieceType.King,
    );
    if (!candidates.length) return [];
    const shuffled = shuffle(ctx.rng, candidates);
    const count = randomInt(ctx.rng, Math.min(3, shuffled.length + 1));
    const selected = shuffled.slice(0, count);
    return selected.map(({ sq, piece }) => {
      const current = typeOf(piece);
      const target =
        current === PieceType.Tiger ? PieceType.Dragon : PieceType.Tiger;
      return { square: sq, target };
    });
  }
}

class GreedyAgent implements Agent {
  spec: AgentSpec;

  constructor(spec: AgentSpec) {
    this.spec = spec;
  }

  chooseMove(pos: Position, moves: Move[], ctx: AgentContext): Move {
    const color = pos.turn;
    let bestScore = -Infinity;
    const best: Move[] = [];
    for (const move of moves) {
      const undo = applyMove(pos, move);
      const score = (color === RED ? 1 : -1) * evaluate(pos);
      undoMove(pos, undo);
      if (score > bestScore + 1e-9) {
        bestScore = score;
        best.length = 0;
        best.push(move);
      } else if (Math.abs(score - bestScore) <= this.spec.randomize) {
        best.push(move);
      }
    }
    return best.length ? pickOne(ctx.rng, best) : moves[0];
  }

  chooseTransformations(
    pos: Position,
    color: Color,
    opponentChoices?: TransformChoice[],
    opponentColor?: Color,
  ): TransformChoice[] {
    return chooseTransformations(pos, { color, opponentChoices, opponentColor });
  }
}

class SearchAgent implements Agent {
  spec: AgentSpec;

  constructor(spec: AgentSpec) {
    this.spec = spec;
  }

  chooseMove(pos: Position, moves: Move[], ctx: AgentContext, restriction?: SearchRestriction): Move {
    const result = findBestMove(pos, {
      maxDepth: this.spec.depth,
      timeMs: this.spec.timeMs,
      randomize: this.spec.randomize,
      rng: ctx.rng,
      restriction,
    });
    if (result.move) return result.move;
    const fallback = randomLegalMove(pos, restriction, ctx.rng);
    if (fallback) return fallback;
    return moves[0];
  }

  chooseTransformations(
    pos: Position,
    color: Color,
    opponentChoices?: TransformChoice[],
    opponentColor?: Color,
  ): TransformChoice[] {
    return chooseTransformations(pos, { color, opponentChoices, opponentColor });
  }
}

export function createAgent(spec: AgentSpec): Agent {
  switch (spec.kind) {
    case 'random':
      return new RandomAgent(spec);
    case 'greedy':
      return new GreedyAgent(spec);
    case 'search':
      return new SearchAgent(spec);
  }
}

export function makeRng(seed: number): Rng {
  return mulberry32(seed);
}
