import { Position, countNonKing, countPieces, findKing } from '../game/board';
import {
  BLACK,
  PieceType,
  RED,
  type Color,
  type Piece,
  crossedRiver,
  fileOf,
  rankOf,
  typeOf,
} from '../game/types';

export const PIECE_VALUES: Record<PieceType, number> = {
  [PieceType.King]: 100_000,
  [PieceType.Tiger]: 1_000,
  [PieceType.Dragon]: 950,
  [PieceType.Leopard]: 620,
  [PieceType.Cannon]: 580,
  [PieceType.Elephant]: 380,
  [PieceType.Advisor]: 320,
  [PieceType.Pawn]: 120,
  [PieceType.Wolf]: 380,
};

export function materialValue(piece: Piece): number {
  const type = typeOf(piece);
  if (!type) return 0;
  return PIECE_VALUES[type as PieceType];
}

function forwardRank(color: Color, rank: number): number {
  return color === RED ? rank : 9 - rank;
}

function center(file: number): number {
  return 4 - Math.abs(file - 4);
}

function pieceSquareBonus(type: PieceType, file: number, rank: number, color: Color): number {
  const c = center(file);
  const fwd = forwardRank(color, rank);
  const homeRank = color === RED ? 0 : 9;

  switch (type) {
    case PieceType.King: {
      const distanceFromHome = Math.abs(rank - homeRank);
      return -distanceFromHome * 4 - Math.abs(file - 4) * 3;
    }
    case PieceType.Tiger:
      return c * 5 + fwd * 3;
    case PieceType.Dragon:
      return c * 5 + fwd * 2;
    case PieceType.Leopard:
      return c * 7 + fwd * 5 + (fwd >= 7 ? 20 : 0);
    case PieceType.Cannon:
      return c * 4 + (fwd >= 3 && fwd <= 7 ? 10 : 0);
    case PieceType.Elephant:
      return c * 3 + (fwd >= 4 ? 8 : 0);
    case PieceType.Advisor:
      return c * 4 + (fwd <= 2 ? 8 : 0);
    case PieceType.Pawn:
      return fwd * 8 + c * 3 + (fwd >= 5 ? 20 : 0);
    case PieceType.Wolf:
      return fwd * 6 + c * 4 + (fwd >= 7 ? 15 : 0);
    default:
      return 0;
  }
}

function pieceSafety(pos: Position, color: Color): number {
  const king = findKing(pos, color);
  if (king < 0) return -10_000;
  const kf = fileOf(king);
  const kr = rankOf(king);
  let score = 0;

  // Friendly guards and elephants near the king.
  for (let sq = 0; sq < 90; sq++) {
    const p = pos.board[sq];
    if (!p || Math.sign(p) !== color) continue;
    const type = typeOf(p);
    const df = Math.abs(fileOf(sq) - kf);
    const dr = Math.abs(rankOf(sq) - kr);
    if ((type === PieceType.Advisor || type === PieceType.Elephant) && df <= 2 && dr <= 2) {
      score += 18;
    }
  }

  // Enemy heavy pieces near the palace.
  for (let sq = 0; sq < 90; sq++) {
    const p = pos.board[sq];
    if (!p || Math.sign(p) === color) continue;
    const type = typeOf(p);
    if (type === PieceType.King) continue;
    const df = Math.abs(fileOf(sq) - kf);
    const dr = Math.abs(rankOf(sq) - kr);
    if (df <= 2 && dr <= 2) {
      if (type === PieceType.Tiger || type === PieceType.Dragon) score -= 22;
      else if (type === PieceType.Cannon || type === PieceType.Leopard) score -= 12;
      else if (type === PieceType.Wolf || type === PieceType.Pawn) score -= 6;
    }
    if (df === 0 && dr <= 2 && (type === PieceType.Tiger || type === PieceType.Cannon)) {
      score -= 15;
    }
  }

  // A completely open king file is dangerous.
  let blockers = 0;
  const lo = Math.min(kr, color === RED ? 9 : 0);
  const hi = Math.max(kr, color === RED ? 9 : 0);
  for (let r = lo + 1; r < hi; r++) {
    if (pos.board[r * 9 + kf]) blockers++;
  }
  if (blockers === 0) score -= 25;

  return score;
}

function lastPiecePremium(pos: Position): number {
  const red = countNonKing(pos, RED);
  const black = countNonKing(pos, BLACK);
  let score = 0;
  if (red === 1) score -= 300;
  else if (red === 2) score -= 70;
  if (black === 1) score += 300;
  else if (black === 2) score += 70;
  return score;
}

function duelPotential(pos: Position): number {
  const redCount = countPieces(pos, RED);
  const blackCount = countPieces(pos, BLACK);
  if (redCount > 5 || blackCount > 5) return 0;

  let score = 0;
  for (let sq = 0; sq < 90; sq++) {
    const p = pos.board[sq];
    if (!p) continue;
    const type = typeOf(p);
    const sign = p > 0 ? 1 : -1;
    let value = 0;
    if (type === PieceType.Pawn || type === PieceType.Wolf) value = 30;
    else if (type === PieceType.Advisor || type === PieceType.Elephant) value = 24;
    else if (type === PieceType.Leopard || type === PieceType.Cannon) value = 10;
    score += sign * value;
  }
  return score;
}

/**
 * Static evaluation in centipawns, from Red's point of view.
 * Positive = good for Red.
 */
export function evaluate(pos: Position): number {
  let score = 0;
  for (let sq = 0; sq < 90; sq++) {
    const p = pos.board[sq];
    if (!p) continue;
    const color = p > 0 ? RED : BLACK;
    const type = typeOf(p) as PieceType;
    let value = PIECE_VALUES[type] ?? 0;
    // Wolves/Braves start on the board. Before crossing the river they only
    // move forward one step, so their effective value is much lower.
    if (type === PieceType.Wolf && !crossedRiver(color, rankOf(sq))) {
      value -= 250;
    }
    const positional = pieceSquareBonus(type, fileOf(sq), rankOf(sq), color);
    score += color * (value + positional);
  }

  score += pieceSafety(pos, RED) - pieceSafety(pos, BLACK);
  score += lastPiecePremium(pos);
  score += duelPotential(pos);
  score += pos.turn === RED ? 12 : -12;
  return score;
}

export function evaluateForTurn(pos: Position): number {
  return pos.turn === RED ? evaluate(pos) : -evaluate(pos);
}
