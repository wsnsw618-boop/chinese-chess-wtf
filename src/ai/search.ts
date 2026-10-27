import { Position, applyMove, countNonKing, undoMove } from '../game/board';
import {
  generateAllLegalMoves,
  generatePseudoMoves,
  isInCheck,
} from '../game/moves';
import {
  Move,
  PieceType,
  isSuperPiece,
  moveKey,
  opposite,
  typeOf,
} from '../game/types';
import { PIECE_VALUES, evaluateForTurn } from './evaluate';

export const MATE = 1_000_000;
const INF = 10_000_000;

export interface SearchRestriction {
  forbidNewPieceMate: boolean;
  newlyTransformedIds: number[];
}

export interface SearchOptions {
  maxDepth: number;
  timeMs: number;
  /** Randomize among near-best root moves, in centipawns. */
  randomize?: number;
  /** Injectable RNG for reproducible simulations/tests. */
  rng?: () => number;
  restriction?: SearchRestriction;
}

export interface SearchResult {
  move: Move | null;
  score: number;
  depth: number;
  nodes: number;
}

class SearchTimeout extends Error {}

function moveOrderScore(move: Move): number {
  let score = 0;
  if (move.captured) {
    const captured = typeOf(move.captured) as PieceType;
    const moving = typeOf(move.piece) as PieceType;
    score += (PIECE_VALUES[captured] ?? 0) * 10 - (PIECE_VALUES[moving] ?? 0);
    if (Math.abs(move.captured) === PieceType.King) score += 1_000_000;
  }
  if (move.promotion) {
    score += isSuperPiece(move.promotion) ? 800 : 300;
  }
  if (move.kind === 'eatSlave' || move.kind === 'swapGuard') score += 120;
  return score;
}

class Search {
  private pos: Position;
  private opts: SearchOptions;
  private deadline: number;
  private nodes = 0;
  private history = new Map<string, number>();
  private killers: Array<[Move | null, Move | null]> = [];

  constructor(pos: Position, opts: SearchOptions) {
    this.pos = pos;
    this.opts = opts;
    this.deadline = performance.now() + opts.timeMs;
  }

  run(): SearchResult {
    const rootMoves = generateAllLegalMoves(this.pos, {
      forbidNewPieceMate: this.opts.restriction?.forbidNewPieceMate,
      newlyTransformedIds: this.opts.restriction?.newlyTransformedIds,
    });
    if (!rootMoves.length) {
      return { move: null, score: -MATE, depth: 0, nodes: 0 };
    }

    let bestMove = rootMoves[0];
    let bestScore = -INF;
    let completedDepth = 0;
    let lastScores: Array<{ move: Move; score: number }> = [];

    const ordered = [...rootMoves].sort((a, b) => moveOrderScore(b) - moveOrderScore(a));

    for (let depth = 1; depth <= this.opts.maxDepth; depth++) {
      try {
        const result = this.searchRoot(depth, ordered);
        if (result.best) {
          bestMove = result.best;
          bestScore = result.score;
          completedDepth = depth;
          lastScores = result.scores;
          // Bring the PV move to the front for the next iteration.
          const idx = ordered.findIndex((m) => moveKey(m) === moveKey(bestMove));
          if (idx > 0) {
            ordered.splice(idx, 1);
            ordered.unshift(bestMove);
          }
        }
        if (Math.abs(bestScore) > MATE - 10_000) break;
        if (performance.now() >= this.deadline) break;
      } catch (err) {
        if (err instanceof SearchTimeout) break;
        throw err;
      }
    }

    if (this.opts.randomize && lastScores.length > 1) {
      const margin = this.opts.randomize;
      const candidates = lastScores.filter((entry) => entry.score >= bestScore - margin);
      if (candidates.length > 1) {
        const rng = this.opts.rng ?? Math.random;
        const pick = candidates[Math.floor(rng() * candidates.length)];
        bestMove = pick.move;
        bestScore = pick.score;
      }
    }

    return {
      move: bestMove,
      score: bestScore,
      depth: completedDepth,
      nodes: this.nodes,
    };
  }

  private searchRoot(
    depth: number,
    ordered: Move[],
  ): { best: Move | null; score: number; scores: Array<{ move: Move; score: number }> } {
    let alpha = -INF;
    const beta = INF;
    let best: Move | null = null;
    let bestScore = -INF;
    const scores: Array<{ move: Move; score: number }> = [];

    for (const move of ordered) {
      this.checkTime();
      const mover = this.pos.turn;
      const undo = applyMove(this.pos, move);
      if (isInCheck(this.pos, mover)) {
        undoMove(this.pos, undo);
        continue;
      }
      let score: number;
      if (countNonKing(this.pos, mover) === 0) {
        score = -MATE + 1;
      } else if (countNonKing(this.pos, opposite(mover)) === 0) {
        score = MATE - 1;
      } else if (Math.abs(move.captured ?? 0) === PieceType.King) {
        score = MATE - 1;
      } else {
        score = -this.negamax(depth - 1, -beta, -alpha, 1);
      }
      undoMove(this.pos, undo);
      scores.push({ move, score });
      if (score > bestScore) {
        bestScore = score;
        best = move;
      }
      if (score > alpha) alpha = score;
    }

    return { best, score: bestScore, scores };
  }

  private orderMoves(moves: Move[], ply: number): void {
    const pair = this.killers[ply];
    const killerA = pair?.[0] ? moveKey(pair[0]) : null;
    const killerB = pair?.[1] ? moveKey(pair[1]) : null;
    moves.sort((a, b) => {
      const keyA = moveKey(a);
      const keyB = moveKey(b);
      const killerScore = (key: string) => (key === killerA ? 900 : key === killerB ? 450 : 0);
      const scoreA =
        moveOrderScore(a) + (this.history.get(keyA) ?? 0) + killerScore(keyA);
      const scoreB =
        moveOrderScore(b) + (this.history.get(keyB) ?? 0) + killerScore(keyB);
      return scoreB - scoreA;
    });
  }

  private rememberKiller(move: Move, ply: number): void {
    if (move.captured) return;
    const pair = this.killers[ply] ?? [null, null];
    const key = moveKey(move);
    if (pair[0] && moveKey(pair[0]) === key) return;
    pair[1] = pair[0];
    pair[0] = move;
    this.killers[ply] = pair;
  }

  private negamax(depth: number, alpha: number, beta: number, ply: number): number {
    this.checkTime();
    this.nodes += 1;

    const turn = this.pos.turn;
    if (countNonKing(this.pos, turn) === 0) return -MATE + ply;
    if (countNonKing(this.pos, opposite(turn)) === 0) return MATE - ply;

    if (depth <= 0) {
      return this.quiescence(alpha, beta, ply, 0);
    }

    const moves = generatePseudoMoves(this.pos, turn);
    if (!moves.length) return -MATE + ply;

    this.orderMoves(moves, ply);

    let legal = 0;
    let best = -INF;
    for (const move of moves) {
      if (Math.abs(move.captured ?? 0) === PieceType.King) continue;
      const undo = applyMove(this.pos, move);
      if (isInCheck(this.pos, turn)) {
        undoMove(this.pos, undo);
        continue;
      }
      legal += 1;

      let score: number;
      if (countNonKing(this.pos, turn) === 0) {
        score = -MATE + ply + 1;
      } else if (countNonKing(this.pos, opposite(turn)) === 0) {
        score = MATE - ply - 1;
      } else {
        score = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      }
      undoMove(this.pos, undo);

      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        const key = moveKey(move);
        this.history.set(key, (this.history.get(key) ?? 0) + depth * depth);
        this.rememberKiller(move, ply);
        break;
      }
    }

    if (legal === 0) return -MATE + ply;
    return best;
  }

  private quiescence(alpha: number, beta: number, ply: number, qdepth: number): number {
    this.checkTime();
    this.nodes += 1;

    const turn = this.pos.turn;
    if (countNonKing(this.pos, turn) === 0) return -MATE + ply;
    if (countNonKing(this.pos, opposite(turn)) === 0) return MATE - ply;

    const inCheck = isInCheck(this.pos, turn);
    if (!inCheck) {
      const standPat = evaluateForTurn(this.pos);
      if (standPat >= beta) return beta;
      if (standPat > alpha) alpha = standPat;
      if (qdepth >= 4) return alpha;
    }

    const moves = generatePseudoMoves(this.pos, turn).filter(
      (move) => inCheck || !!move.captured || !!move.promotion,
    );
    if (!moves.length) {
      if (inCheck) return -MATE + ply;
      return alpha;
    }
    this.orderMoves(moves, ply);

    let legal = 0;
    for (const move of moves) {
      if (Math.abs(move.captured ?? 0) === PieceType.King) continue;
      const undo = applyMove(this.pos, move);
      if (isInCheck(this.pos, turn)) {
        undoMove(this.pos, undo);
        continue;
      }
      legal += 1;
      let score: number;
      if (countNonKing(this.pos, turn) === 0) {
        score = -MATE + ply + 1;
      } else if (countNonKing(this.pos, opposite(turn)) === 0) {
        score = MATE - ply - 1;
      } else {
        score = -this.quiescence(-beta, -alpha, ply + 1, qdepth + 1);
      }
      undoMove(this.pos, undo);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }

    if (inCheck && legal === 0) return -MATE + ply;
    return alpha;
  }

  private checkTime(): void {
    if ((this.nodes & 511) === 0 && performance.now() >= this.deadline) {
      throw new SearchTimeout();
    }
  }
}

export function findBestMove(pos: Position, opts: SearchOptions): SearchResult {
  return new Search(pos.clone(), opts).run();
}

export function randomLegalMove(
  pos: Position,
  restriction?: SearchRestriction,
  rng: () => number = Math.random,
): Move | null {
  const moves = generateAllLegalMoves(pos, {
    forbidNewPieceMate: restriction?.forbidNewPieceMate,
    newlyTransformedIds: restriction?.newlyTransformedIds,
  });
  if (!moves.length) return null;
  return moves[Math.floor(rng() * moves.length)];
}
