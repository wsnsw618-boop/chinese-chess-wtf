import { describe, expect, it } from 'vitest';
import { Game } from '../game/state';
import { customPosition } from './helpers';
import { BLACK, PieceType, RED, parseCoord } from '../game/types';

describe('repetition and perpetual check', () => {
  it('starts a duel countdown on the third occurrence of a quiet position', () => {
    const pos = customPosition([
      ['e1', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['e5', RED, PieceType.Pawn],
      ['e6', BLACK, PieceType.Pawn],
      ['a1', RED, PieceType.Tiger],
      ['b10', BLACK, PieceType.Tiger],
      ['c1', RED, PieceType.Advisor],
      ['f1', RED, PieceType.Advisor],
      ['c10', BLACK, PieceType.Advisor],
      ['f10', BLACK, PieceType.Advisor],
      ['a3', RED, PieceType.Pawn],
      ['a7', BLACK, PieceType.Pawn],
    ]);
    const game = new Game();
    game.loadPosition(pos);

    // One full cycle: P0 -> P1 -> P2 -> P3 -> P0.
    expect(game.makeMove(parseCoord('a1'), parseCoord('a2'))).toBe(true);
    expect(game.makeMove(parseCoord('b10'), parseCoord('b9'))).toBe(true);
    expect(game.makeMove(parseCoord('a2'), parseCoord('a1'))).toBe(true);
    expect(game.makeMove(parseCoord('b9'), parseCoord('b10'))).toBe(true);
    expect(game.duel.phase).toBe('none');

    // Second cycle reaches the third occurrence.
    expect(game.makeMove(parseCoord('a1'), parseCoord('a2'))).toBe(true);
    expect(game.makeMove(parseCoord('b10'), parseCoord('b9'))).toBe(true);
    expect(game.makeMove(parseCoord('a2'), parseCoord('a1'))).toBe(true);
    expect(game.makeMove(parseCoord('b9'), parseCoord('b10'))).toBe(true);
    expect(game.duel.phase).toBe('countdown');
    expect(game.duel.reason).toBe('repetition');
    expect(game.duel.countdown).toBe(3);
  });

  it('declares perpetual check as a loss for the checking side', () => {
    const pos = customPosition([
      ['f1', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['d2', RED, PieceType.Tiger],
      ['a4', RED, PieceType.Pawn],
      ['c4', RED, PieceType.Pawn],
      ['g4', RED, PieceType.Pawn],
      ['b2', RED, PieceType.Cannon],
      ['a7', BLACK, PieceType.Pawn],
      ['c7', BLACK, PieceType.Pawn],
      ['g7', BLACK, PieceType.Pawn],
      ['i7', BLACK, PieceType.Pawn],
      ['b8', BLACK, PieceType.Cannon],
      ['h8', BLACK, PieceType.Cannon],
    ]);
    const game = new Game();
    game.loadPosition(pos);

    // Red checks from d2/e2, black king shuffles e10/d10, position repeats.
    expect(game.makeMove(parseCoord('d2'), parseCoord('e2'))).toBe(true); // check e10
    expect(game.makeMove(parseCoord('e10'), parseCoord('d10'))).toBe(true);
    expect(game.makeMove(parseCoord('e2'), parseCoord('d2'))).toBe(true); // check d10
    expect(game.makeMove(parseCoord('d10'), parseCoord('e10'))).toBe(true);
    expect(game.duel.phase).toBe('none');

    expect(game.makeMove(parseCoord('d2'), parseCoord('e2'))).toBe(true);
    expect(game.makeMove(parseCoord('e10'), parseCoord('d10'))).toBe(true);
    expect(game.makeMove(parseCoord('e2'), parseCoord('d2'))).toBe(true);
    expect(game.makeMove(parseCoord('d10'), parseCoord('e10'))).toBe(true);

    expect(game.result?.winner).toBe(BLACK);
    expect(game.result?.reason).toBe('perpetualCheck');
  });
});
