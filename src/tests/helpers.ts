import { Position } from '../game/board';
import {
  Color,
  PieceType,
  RED,
  makePiece,
  parseCoord,
} from '../game/types';

let idSeed = 1;

export function customPosition(
  pieces: Array<[string, Color, PieceType]>,
  turn: Color = RED,
  swapLocked = false,
): Position {
  idSeed = 1;
  const pos = new Position(undefined, undefined, turn, swapLocked);
  for (const [at, color, type] of pieces) {
    const sq = parseCoord(at);
    pos.board[sq] = makePiece(color, type);
    pos.ids[sq] = idSeed++;
  }
  return pos;
}

export function pieceAt(pos: Position, text: string): number {
  return pos.board[parseCoord(text)];
}

export function idAt(pos: Position, text: string): number {
  return pos.ids[parseCoord(text)];
}
