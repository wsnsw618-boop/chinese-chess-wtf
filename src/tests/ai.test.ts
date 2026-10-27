import { describe, expect, it } from 'vitest';
import { Game } from '../game/state';
import { createInitialPosition } from '../game/board';
import { generateAllLegalMoves, isLegalMove } from '../game/moves';
import { findAIMove } from '../ai/engine';
import { findBestMove } from '../ai/search';
import { chooseTransformations } from '../ai/selection';
import { customPosition } from './helpers';
import { BLACK, PieceType, RED, parseCoord } from '../game/types';

describe('AI engine', () => {
  it('returns a legal move from the initial position within a bounded time', () => {
    const pos = createInitialPosition();
    const started = performance.now();
    const result = findBestMove(pos, { maxDepth: 3, timeMs: 700 });
    const elapsed = performance.now() - started;
    expect(result.move).not.toBeNull();
    expect(elapsed).toBeLessThan(3_000);
    expect(isLegalMove(pos, result.move!, {})).toBe(true);
  }, 15_000);

  it('finds a mate in one with a tiger', () => {
    const pos = customPosition(
      [
        ['d2', RED, PieceType.King],
        ['e10', BLACK, PieceType.King],
        ['a10', BLACK, PieceType.Pawn],
        ['a1', RED, PieceType.Tiger],
        ['b9', RED, PieceType.Leopard],
        ['h9', RED, PieceType.Leopard],
        ['d7', RED, PieceType.Leopard],
        ['f7', RED, PieceType.Leopard],
      ],
      RED,
    );
    const result = findBestMove(pos, { maxDepth: 3, timeMs: 1_000 });
    expect(result.move).not.toBeNull();
    const legal = generateAllLegalMoves(pos);
    expect(legal.some((m) => m.from === result.move!.from && m.to === result.move!.to)).toBe(true);
    expect(result.score).toBeGreaterThan(100_000);
  }, 15_000);

  it('does not choose a newly transformed mate during the restriction round', () => {
    const pos = customPosition(
      [
        ['d2', RED, PieceType.King],
        ['e10', BLACK, PieceType.King],
        ['a10', BLACK, PieceType.Pawn],
        ['a1', RED, PieceType.Tiger],
        ['b9', RED, PieceType.Leopard],
        ['h9', RED, PieceType.Leopard],
        ['d7', RED, PieceType.Leopard],
        ['f7', RED, PieceType.Leopard],
      ],
      RED,
    );
    const tigerId = pos.ids[parseCoord('a1')];
    const result = findAIMove(pos, 'normal', {
      forbidNewPieceMate: true,
      newlyTransformedIds: [tigerId],
    });
    expect(result.move).not.toBeNull();
    const mate = result.move!.from === parseCoord('a1') && result.move!.to === parseCoord('e1');
    expect(mate).toBe(false);
  }, 15_000);

  it('expert difficulty finds a mate in one with a tiger', () => {
    const pos = customPosition(
      [
        ['d2', RED, PieceType.King],
        ['e10', BLACK, PieceType.King],
        ['a10', BLACK, PieceType.Pawn],
        ['a1', RED, PieceType.Tiger],
        ['b9', RED, PieceType.Leopard],
        ['h9', RED, PieceType.Leopard],
        ['d7', RED, PieceType.Leopard],
        ['f7', RED, PieceType.Leopard],
      ],
      RED,
    );
    const started = performance.now();
    const result = findAIMove(pos, 'expert');
    expect(result.move).not.toBeNull();
    expect(result.score).toBeGreaterThan(100_000);
    expect(performance.now() - started).toBeLessThan(8_000);
  }, 15_000);

  it('chooses valid duel transformations for both colors', () => {
    const pos = customPosition([
      ['e1', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['e5', RED, PieceType.Pawn],
      ['c5', RED, PieceType.Pawn],
      ['c6', BLACK, PieceType.Pawn],
    ]);
    const red = chooseTransformations(pos, { color: RED });
    const black = chooseTransformations(pos, { color: BLACK });
    expect(red.length).toBeLessThanOrEqual(2);
    expect(black.length).toBeLessThanOrEqual(2);
    for (const choice of red) {
      expect(pos.board[choice.square]).toBeGreaterThan(0);
      expect(choice.target === PieceType.Tiger || choice.target === PieceType.Dragon).toBe(true);
    }
    for (const choice of black) {
      expect(pos.board[choice.square]).toBeLessThan(0);
      expect(choice.target === PieceType.Tiger || choice.target === PieceType.Dragon).toBe(true);
    }
  });

  it('can play a short AI vs AI game without crashing', () => {
    const game = new Game();
    for (let i = 0; i < 6; i++) {
      if (game.gameOver || game.duel.phase === 'selection') break;
      const result = findAIMove(game.position, 'easy', {
        forbidNewPieceMate: game.duel.phase === 'restriction',
        newlyTransformedIds: game.duel.newlyTransformedIds,
      });
      if (!result.move) break;
      expect(game.makeMove(result.move)).toBe(true);
    }
    expect(game.moveRecords.length).toBeGreaterThan(0);
  }, 30_000);
});
