import { Position } from '../game/board';
import { Color } from '../game/types';

export interface SerializedPosition {
  board: number[];
  ids: number[];
  turn: Color;
  swapLocked: boolean;
}

export function serializePosition(pos: Position): SerializedPosition {
  return {
    board: Array.from(pos.board),
    ids: Array.from(pos.ids),
    turn: pos.turn,
    swapLocked: pos.swapLocked,
  };
}

export function deserializePosition(data: SerializedPosition): Position {
  return new Position(
    new Int8Array(data.board),
    new Int16Array(data.ids),
    data.turn,
    data.swapLocked,
  );
}
