import { Position } from './board';
import {
  Color,
  Move,
  coord,
  pieceName,
  typeName,
} from './types';

export function notationForMove(pos: Position, move: Move): string {
  const mover = pos.turn;
  const name = pieceName(move.piece);
  const from = coord(move.from);
  const to = coord(move.to);

  if (move.kind === 'swapGuard') {
    return `${name} ${from} ↔ 卫 ${to}`;
  }
  if (move.kind === 'eatSlave') {
    return `${name} ${from} → ${to}（吃奴）`;
  }

  const connector = move.captured ? '×' : '→';
  let text = `${name} ${from}${connector}${to}`;
  if (move.promotion) {
    text += ` = ${typeName(mover, move.promotion)}`;
  }
  return text;
}

export function moveTone(move: Move): 'quiet' | 'capture' | 'special' {
  if (move.kind !== 'normal') return 'special';
  return move.captured ? 'capture' : 'quiet';
}

export function sideMoveLabel(mover: Color, index: number): string {
  return `${mover === 1 ? '红' : '黑'} ${index + 1}`;
}
