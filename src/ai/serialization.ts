import { Position } from '../game/board';
import { Color } from '../game/types';

export interface SerializedPosition {
  board: number[];
  ids: number[];
  turn: Color;
  swapLocked: boolean;
  /** Number of plies already played, used by the cannon charge rule. */
  ply: number;
  /** Stable cannon ids and the pre-move ply of their last move. */
  cannonLastMove: Array<[number, number]>;
}

export function serializePosition(pos: Position): SerializedPosition {
  return {
    board: Array.from(pos.board),
    ids: Array.from(pos.ids),
    turn: pos.turn,
    swapLocked: pos.swapLocked,
    ply: pos.ply,
    cannonLastMove: Array.from(pos.cannonLastMove.entries()),
  };
}

export function deserializePosition(data: SerializedPosition): Position {
  return new Position(
    new Int8Array(data.board),
    new Int16Array(data.ids),
    data.turn,
    data.swapLocked,
    data.ply,
    new Map(data.cannonLastMove),
  );
}
