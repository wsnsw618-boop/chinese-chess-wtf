import { describe, expect, it } from 'vitest';
import { Game } from '../game/state';
import { generateAllLegalMoves, isCheckmate } from '../game/moves';
import { customPosition, idAt, pieceAt } from './helpers';
import {
  BLACK,
  PieceType,
  RED,
  parseCoord,
  typeOf,
} from '../game/types';

describe('duel state machine', () => {
  it('selection order is first selector then second selector, and transformations are applied', () => {
    const pos = customPosition([
      ['e1', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['e5', RED, PieceType.Pawn],
      ['c5', RED, PieceType.Pawn],
      ['c6', BLACK, PieceType.Pawn],
    ]);
    const game = new Game();
    game.loadPosition(pos);
    expect(game.startDuelByAgreement()).toBe(true);
    expect(game.duel.phase).toBe('selection');
    expect(game.duel.firstSelector).toBe(RED);
    expect(game.duel.secondSelector).toBe(BLACK);

    game.selectTransformations(RED, [
      { square: parseCoord('c5'), target: PieceType.Tiger },
    ]);
    expect(game.duel.phase).toBe('selection');
    expect(game.duel.firstChoices).toHaveLength(1);

    game.selectTransformations(BLACK, [
      { square: parseCoord('c6'), target: PieceType.Dragon },
    ]);
    expect(game.duel.phase).toBe('restriction');
    expect(game.duel.restrictionPlies).toBe(2);
    expect(game.position.turn).toBe(RED);
    expect(typeOf(pieceAt(game.position, 'c5'))).toBe(PieceType.Tiger);
    expect(typeOf(pieceAt(game.position, 'c6'))).toBe(PieceType.Dragon);
    expect(game.duel.newlyTransformedIds).toHaveLength(2);
    expect(game.duel.newlyTransformedIds).toContain(idAt(game.position, 'c5'));
    expect(game.duel.newlyTransformedIds).toContain(idAt(game.position, 'c6'));
  });

  it('starts a 3-ply countdown when both sides have at most five pieces', () => {
    const pos = customPosition([
      ['e1', RED, PieceType.King],
      ['e5', RED, PieceType.Pawn],
      ['e10', BLACK, PieceType.King],
      ['d7', BLACK, PieceType.Pawn],
    ]);
    const game = new Game();
    game.loadPosition(pos);
    expect(game.duel.phase).toBe('none');

    expect(game.makeMove(parseCoord('e5'), parseCoord('e6'))).toBe(true);
    expect(game.duel.phase).toBe('countdown');
    expect(game.duel.countdown).toBe(3);

    expect(game.makeMove(parseCoord('d7'), parseCoord('d6'))).toBe(true);
    expect(game.duel.phase).toBe('countdown');
    expect(game.duel.countdown).toBe(2);

    expect(game.makeMove(parseCoord('e1'), parseCoord('d1'))).toBe(true);
    expect(game.duel.countdown).toBe(1);

    expect(game.makeMove(parseCoord('e10'), parseCoord('d10'))).toBe(true);
    expect(game.duel.phase).toBe('selection');
    expect(game.duel.count).toBe(1);
    expect(game.duel.reason).toBe('pieces');
    expect(game.duel.firstSelector).toBe(RED);
  });

  it('does not award a mate with a newly transformed piece during the restriction round', () => {
    const pos = customPosition([
      ['d2', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['a10', BLACK, PieceType.Pawn],
      ['a1', RED, PieceType.Tiger],
      ['b9', RED, PieceType.Leopard],
      ['h9', RED, PieceType.Leopard],
      ['d7', RED, PieceType.Leopard],
      ['f7', RED, PieceType.Leopard],
    ]);
    const tigerId = idAt(pos, 'a1');
    const freeMoves = generateAllLegalMoves(pos);
    const freeMate = freeMoves.find(
      (m) => m.from === parseCoord('a1') && m.to === parseCoord('e1'),
    );
    expect(freeMate).toBeDefined();

    // Apply the free mate and verify that it really is mate.
    const matePos = pos.clone();
    const mateGame = new Game();
    mateGame.loadPosition(matePos);
    expect(mateGame.makeMove(parseCoord('a1'), parseCoord('e1'))).toBe(true);
    expect(isCheckmate(mateGame.position, BLACK)).toBe(true);

    const game = new Game();
    game.loadPosition(pos, {
      phase: 'restriction',
      restrictionPlies: 2,
      newlyTransformedIds: [tigerId],
    });
    const restricted = game.legalMoves().find(
      (m) => m.from === parseCoord('a1') && m.to === parseCoord('e1'),
    );
    expect(restricted).toBeUndefined();
  });

  it('wins immediately by capturing the opponent’s last non-king piece', () => {
    const pos = customPosition([
      ['e1', RED, PieceType.King],
      ['e5', RED, PieceType.Pawn],
      ['a1', RED, PieceType.Tiger],
      ['e10', BLACK, PieceType.King],
      ['a10', BLACK, PieceType.Pawn],
    ]);
    const game = new Game();
    game.loadPosition(pos);
    expect(game.makeMove(parseCoord('a1'), parseCoord('a10'))).toBe(true);
    expect(game.result?.winner).toBe(RED);
    expect(game.result?.reason).toBe('singleKing');
  });

  it('allows a newly transformed piece to capture the last non-king piece during restriction', () => {
    const pos = customPosition([
      ['e1', RED, PieceType.King],
      ['e5', RED, PieceType.Pawn],
      ['a1', RED, PieceType.Tiger],
      ['e10', BLACK, PieceType.King],
      ['a10', BLACK, PieceType.Pawn],
    ]);
    const tigerId = idAt(pos, 'a1');
    const game = new Game();
    game.loadPosition(pos, {
      phase: 'restriction',
      restrictionPlies: 2,
      newlyTransformedIds: [tigerId],
    });
    const move = game
      .legalMoves()
      .find((m) => m.from === parseCoord('a1') && m.to === parseCoord('a10'));
    expect(move).toBeDefined();
    expect(game.makeMove(move!)).toBe(true);
    expect(game.result?.winner).toBe(RED);
    expect(game.result?.reason).toBe('singleKing');
  });

  it('rejects a first-selector transformation that checks the side not to move', () => {
    const pos = customPosition([
      ['d1', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['e5', RED, PieceType.Pawn],
      ['c5', RED, PieceType.Pawn],
      ['a10', BLACK, PieceType.Pawn],
    ]);
    const game = new Game();
    game.loadPosition(pos);
    game.startDuelByAgreement();
    expect(() =>
      game.selectTransformations(RED, [
        { square: parseCoord('e5'), target: PieceType.Tiger },
      ]),
    ).toThrow();
  });

  it('allows the king to swap again after one intervening black move', () => {
    const pos = customPosition(
      [
        ['e1', RED, PieceType.King],
        ['e5', RED, PieceType.Pawn],
        ['a4', RED, PieceType.Pawn],
        ['g4', RED, PieceType.Pawn],
        ['c1', RED, PieceType.Advisor],
        ['f1', RED, PieceType.Advisor],
        ['e10', BLACK, PieceType.King],
        ['f10', BLACK, PieceType.Advisor],
        ['a7', BLACK, PieceType.Pawn],
        ['c7', BLACK, PieceType.Pawn],
        ['g7', BLACK, PieceType.Pawn],
        ['i7', BLACK, PieceType.Pawn],
      ],
      BLACK,
    );
    const game = new Game();
    game.loadPosition(pos);
    expect(game.makeMove(parseCoord('e10'), parseCoord('f10'))).toBe(true);
    expect(game.position.swapLocked).toBe(true);

    expect(game.makeMove(parseCoord('a4'), parseCoord('a5'))).toBe(true);
    expect(game.legalMoves().some((m) => m.kind === 'swapGuard')).toBe(false);

    expect(game.makeMove(parseCoord('a7'), parseCoord('a6'))).toBe(true);
    expect(game.position.swapLocked).toBe(false);
    expect(game.makeMove(parseCoord('e5'), parseCoord('e6'))).toBe(true);
    expect(game.legalMoves().some((m) => m.kind === 'swapGuard')).toBe(true);
  });

  it('forces a new duel when all superpieces are gone after a previous duel', () => {
    const pos = customPosition([
      ['e1', RED, PieceType.King],
      ['e5', RED, PieceType.Pawn],
      ['a4', RED, PieceType.Pawn],
      ['e10', BLACK, PieceType.King],
      ['a7', BLACK, PieceType.Pawn],
    ]);
    const game = new Game();
    game.loadPosition(pos, { count: 1 });
    expect(game.makeMove(parseCoord('a4'), parseCoord('a5'))).toBe(true);
    expect(game.duel.phase).toBe('selection');
    expect(game.duel.reason).toBe('superpieces');
    expect(game.duel.count).toBe(2);
  });

  it('loses immediately if the overlord eats its last slave', () => {
    const pos = customPosition([
      ['e1', RED, PieceType.King],
      ['d2', RED, PieceType.Advisor],
      ['e10', BLACK, PieceType.King],
      ['e5', BLACK, PieceType.Pawn],
    ]);
    const game = new Game();
    game.loadPosition(pos);
    expect(game.makeMove(parseCoord('e1'), parseCoord('d2'))).toBe(true);
    expect(game.result?.winner).toBe(BLACK);
    expect(game.result?.reason).toBe('singleKing');
  });

  it('promotes a leopard to a dragon on the enemy baseline', () => {
    const pos = customPosition([
      ['e1', RED, PieceType.King],
      ['e5', RED, PieceType.Pawn],
      ['a8', RED, PieceType.Leopard],
      ['e10', BLACK, PieceType.King],
    ]);
    const game = new Game();
    game.loadPosition(pos);
    expect(game.makeMove(parseCoord('a8'), parseCoord('b10'))).toBe(true);
    expect(typeOf(pieceAt(game.position, 'b10'))).toBe(PieceType.Dragon);
  });

  it('can undo a move and restore the previous turn', () => {
    const game = new Game();
    const before = game.position.turn;
    expect(game.makeMove(parseCoord('a1'), parseCoord('a2'))).toBe(true);
    expect(game.position.turn).toBe(BLACK);
    expect(game.undo()).toBe(true);
    expect(game.position.turn).toBe(before);
    expect(game.moveRecords).toHaveLength(0);
  });
});
