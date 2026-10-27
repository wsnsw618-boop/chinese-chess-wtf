import { describe, expect, it } from 'vitest';
import {
  Position,
  applyMove,
  undoMove,
} from '../game/board';
import {
  cannonChargeRemaining,
  cannonTwoScreenReady,
  generateLegalMoves,
  isInCheck,
} from '../game/moves';
import { Game } from '../game/state';
import { customPosition, idAt } from './helpers';
import {
  BLACK,
  PieceType,
  RED,
  parseCoord,
} from '../game/types';
import {
  deserializePosition,
  serializePosition,
} from '../ai/serialization';

const E2 = parseCoord('e2');
const E3 = parseCoord('e3');
const E8 = parseCoord('e8');

function cannonPositionWithTwoScreens(): Position {
  return customPosition([
    ['e1', RED, PieceType.King],
    ['e10', BLACK, PieceType.King],
    ['e2', RED, PieceType.Cannon],
    ['e6', RED, PieceType.Pawn],
    ['e7', RED, PieceType.Pawn],
    ['e8', BLACK, PieceType.Pawn],
    ['a4', RED, PieceType.Pawn],
    ['a7', BLACK, PieceType.Pawn],
  ]);
}

function cannonPositionWithOneScreen(): Position {
  return customPosition([
    ['e1', RED, PieceType.King],
    ['e10', BLACK, PieceType.King],
    ['e2', RED, PieceType.Cannon],
    ['e6', RED, PieceType.Pawn],
    ['e8', BLACK, PieceType.Pawn],
    ['a4', RED, PieceType.Pawn],
    ['a7', BLACK, PieceType.Pawn],
  ]);
}

function findMove(pos: Position, from: number, to: number) {
  return generateLegalMoves(pos, pos.turn).find(
    (move) => move.from === from && move.to === to,
  );
}

describe('cannon charge rule', () => {
  it('a cannon that has never moved can use the two-screen capture', () => {
    const pos = cannonPositionWithTwoScreens();
    expect(cannonTwoScreenReady(pos, E2)).toBe(true);
    expect(cannonChargeRemaining(pos, E2)).toBe(0);
    const move = findMove(pos, E2, E8);
    expect(move).toBeDefined();
    expect(move?.captured).toBe(-PieceType.Pawn);
  });

  it('blocks the two-screen capture on the next turn after moving', () => {
    const pos = cannonPositionWithTwoScreens();
    const id = idAt(pos, 'e2');
    pos.ply = 2; // red moved at ply 0, black replied at ply 1
    pos.cannonLastMove.set(id, 0);

    expect(cannonTwoScreenReady(pos, E2)).toBe(false);
    expect(cannonChargeRemaining(pos, E2)).toBe(2);
    expect(findMove(pos, E2, E8)).toBeUndefined();
    // Normal sliding remains available while the cannon is charging.
    expect(findMove(pos, E2, E3)).toBeDefined();
  });

  it('allows the two-screen capture again after the cannon sits out one turn', () => {
    const pos = cannonPositionWithTwoScreens();
    const id = idAt(pos, 'e2');
    pos.ply = 4; // two red turns later; the cannon skipped the previous one
    pos.cannonLastMove.set(id, 0);

    expect(cannonTwoScreenReady(pos, E2)).toBe(true);
    expect(findMove(pos, E2, E8)).toBeDefined();
  });

  it('keeps the one-screen capture available while charging', () => {
    const pos = cannonPositionWithOneScreen();
    const id = idAt(pos, 'e2');
    pos.ply = 2;
    pos.cannonLastMove.set(id, 0);

    const move = findMove(pos, E2, E8);
    expect(move).toBeDefined();
    expect(move?.captured).toBe(-PieceType.Pawn);
  });

  it('resets the charge timer when the cannon moves again', () => {
    const pos = cannonPositionWithTwoScreens();
    const id = idAt(pos, 'e2');
    pos.ply = 2;
    pos.cannonLastMove.set(id, 0);
    expect(cannonTwoScreenReady(pos, E2)).toBe(false);

    // Move the cannon again at ply 2. The timer restarts from that move.
    const move = { from: E2, to: E3, kind: 'normal' as const, piece: pos.board[E2] };
    applyMove(pos, move);
    expect(pos.ply).toBe(3);
    expect(pos.cannonLastMove.get(id)).toBe(2);

    pos.ply = 4; // black has replied; this is the cannon side's next turn
    expect(cannonTwoScreenReady(pos, E3)).toBe(false);
    pos.ply = 6; // skipped one full own turn after the second move
    expect(cannonTwoScreenReady(pos, E3)).toBe(true);
  });

  it('updates and restores charge state through applyMove/undoMove', () => {
    const pos = cannonPositionWithTwoScreens();
    const id = idAt(pos, 'e2');
    const move = findMove(pos, E2, E8)!;
    const undo = applyMove(pos, move);

    expect(pos.ply).toBe(1);
    expect(pos.cannonLastMove.get(id)).toBe(0);
    expect(cannonTwoScreenReady(pos, E8)).toBe(false);

    undoMove(pos, undo);
    expect(pos.ply).toBe(0);
    expect(pos.cannonLastMove.has(id)).toBe(false);
    expect(cannonTwoScreenReady(pos, E2)).toBe(true);
  });

  it('restores charge state through the Game undo snapshot', () => {
    const pos = customPosition([
      ['e1', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['e2', RED, PieceType.Cannon],
      ['e5', RED, PieceType.Pawn],
      ['a4', RED, PieceType.Pawn],
      ['a7', BLACK, PieceType.Pawn],
    ]);
    const game = new Game();
    game.loadPosition(pos);
    const id = idAt(game.position, 'e2');

    expect(game.makeMove(E2, E3)).toBe(true);
    expect(game.position.ply).toBe(1);
    expect(game.position.cannonLastMove.get(id)).toBe(0);
    expect(game.undo()).toBe(true);
    expect(game.position.ply).toBe(0);
    expect(game.position.cannonLastMove.has(id)).toBe(false);
  });

  it('does not count a charging cannon as attacking through two screens', () => {
    const pos = customPosition([
      ['e1', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['e2', RED, PieceType.Cannon],
      ['e6', RED, PieceType.Pawn],
      ['e7', RED, PieceType.Pawn],
      ['a4', RED, PieceType.Pawn],
      ['a7', BLACK, PieceType.Pawn],
    ]);
    const id = idAt(pos, 'e2');

    pos.ply = 4;
    pos.cannonLastMove.set(id, 0);
    expect(isInCheck(pos, BLACK)).toBe(true);

    pos.ply = 2;
    expect(isInCheck(pos, BLACK)).toBe(false);
  });

  it('includes charge state in the repetition key', () => {
    const pos = cannonPositionWithTwoScreens();
    const id = idAt(pos, 'e2');
    pos.ply = 2;

    const ready = pos.clone();
    ready.cannonLastMove.delete(id);
    const cooling = pos.clone();
    cooling.cannonLastMove.set(id, 0);

    expect(ready.key()).not.toBe(cooling.key());
  });

  it('serializes charge state for the AI worker', () => {
    const pos = cannonPositionWithTwoScreens();
    const id = idAt(pos, 'e2');
    pos.ply = 4;
    pos.cannonLastMove.set(id, 0);

    const restored = deserializePosition(serializePosition(pos));
    expect(restored.ply).toBe(4);
    expect(restored.cannonLastMove.get(id)).toBe(0);
    expect(cannonTwoScreenReady(restored, E2)).toBe(true);

    const cooling = cannonPositionWithTwoScreens();
    cooling.ply = 2;
    cooling.cannonLastMove.set(id, 0);
    const restoredCooling = deserializePosition(serializePosition(cooling));
    expect(cannonTwoScreenReady(restoredCooling, E2)).toBe(false);
  });
});
