import { describe, expect, it } from 'vitest';
import {
  Position,
  applyMove,
  countPieces,
  createInitialPosition,
  undoMove,
} from '../game/board';
import {
  generateAllLegalMoves,
  generateLegalMoves,
  generatePseudoMoves,
  hasAnyLegalMove,
  isCheckmate,
  isInCheck,
  isLegalMove,
  kingsFacing,
} from '../game/moves';
import {
  BLACK,
  PieceType,
  RED,
  type Color,
  type Move,
  type PieceType as PT,
  colorOf,
  coord,
  makePiece,
  parseCoord,
  rankOf,
  square,
  typeOf,
} from '../game/types';

let idSeed = 1;

function custom(
  pieces: Array<[string, Color, PT]>,
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

function at(pos: Position, text: string): number {
  return pos.board[parseCoord(text)];
}

describe('initial position', () => {
  it('has 16 pieces per side and red to move', () => {
    const pos = createInitialPosition();
    expect(countPieces(pos, RED)).toBe(16);
    expect(countPieces(pos, BLACK)).toBe(16);
    expect(pos.turn).toBe(RED);
    expect(isInCheck(pos, RED)).toBe(false);
    expect(isInCheck(pos, BLACK)).toBe(false);
    expect(kingsFacing(pos)).toBe(false);
  });

  it('generates legal moves for both sides', () => {
    const pos = createInitialPosition();
    const red = generateAllLegalMoves(pos);
    expect(red.length).toBeGreaterThan(20);
    for (const move of red) {
      const undo = applyMove(pos, move);
      expect(isInCheck(pos, RED)).toBe(false);
      undoMove(pos, undo);
    }
    pos.turn = BLACK;
    const black = generateAllLegalMoves(pos);
    expect(black.length).toBeGreaterThan(20);
  });

  it('knows the opening king, tiger, leopard and elephant moves', () => {
    const pos = createInitialPosition();
    const kingMoves = generateLegalMoves(pos, RED, {}).filter(
      (m) => m.from === parseCoord('e1'),
    );
    expect(kingMoves.map((m) => m.to).sort((a, b) => a - b)).toEqual(
      [parseCoord('e2'), parseCoord('d1'), parseCoord('f1')].sort((a, b) => a - b),
    );
    const tiger = generateLegalMoves(pos, RED).filter(
      (m) => m.from === parseCoord('a1'),
    );
    expect(tiger.map((m) => coord(m.to)).sort()).toEqual(['a2', 'a3', 'b2']);
    const leopard = generateLegalMoves(pos, RED).filter(
      (m) => m.from === parseCoord('b1'),
    );
    expect(leopard.map((m) => coord(m.to)).sort()).toEqual(['a3', 'c3', 'd2']);
    const elephant = generateLegalMoves(pos, RED).filter(
      (m) => m.from === parseCoord('c1'),
    );
    expect(elephant.map((m) => coord(m.to)).sort()).toEqual(['a3', 'b2', 'd2', 'e3']);
  });
});

describe('custom pieces', () => {
  it('leopard jumps over a blocked horse leg', () => {
    const pos = custom([
      ['e1', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['e5', RED, PieceType.Pawn],
      ['b1', RED, PieceType.Leopard],
      ['b2', RED, PieceType.Pawn],
    ]);
    const moves = generateLegalMoves(pos, RED).filter(
      (m) => m.from === parseCoord('b1') && m.to === parseCoord('a3'),
    );
    expect(moves).toHaveLength(1);
    // A normal horse would be blocked by the pawn on b2; the leopard is not.
    expect(at(pos, 'b2')).toBe(makePiece(RED, PieceType.Pawn));
  });

  it('elephant cannot jump the midpoint on a two-step diagonal', () => {
    const pos = custom([
      ['e1', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['e5', RED, PieceType.Pawn],
      ['c1', RED, PieceType.Elephant],
      ['b2', RED, PieceType.Pawn],
    ]);
    const moves = generateLegalMoves(pos, RED).filter(
      (m) => m.from === parseCoord('c1'),
    );
    expect(moves.some((m) => m.to === parseCoord('a3'))).toBe(false);
    expect(moves.some((m) => m.to === parseCoord('b2'))).toBe(false); // own pawn
    expect(moves.some((m) => m.to === parseCoord('d2'))).toBe(true);
  });

  it('elephant can cross the river', () => {
    const pos = custom([
      ['e1', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['e5', RED, PieceType.Pawn],
      ['c5', RED, PieceType.Elephant],
    ]);
    const moves = generateLegalMoves(pos, RED).filter(
      (m) => m.from === parseCoord('c5'),
    );
    expect(moves.some((m) => m.to === parseCoord('d6'))).toBe(true);
    expect(moves.some((m) => m.to === parseCoord('e7'))).toBe(true);
  });

  it('advisor can move two squares in the palace, blocked by the midpoint', () => {
    const pos = custom([
      ['e2', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['e5', RED, PieceType.Pawn],
      ['d1', RED, PieceType.Advisor],
      ['e1', RED, PieceType.Pawn],
    ]);
    const moves = generateLegalMoves(pos, RED).filter(
      (m) => m.from === parseCoord('d1'),
    );
    // d1 -> f1 would need e1, which is occupied by a friendly pawn.
    expect(moves.some((m) => m.to === parseCoord('f1'))).toBe(false);
    // d1 -> d3 is a clear two-step along the file.
    expect(moves.some((m) => m.to === parseCoord('d3'))).toBe(true);
  });
});

describe('king special abilities', () => {
  it('overlord can eat a friendly slave at a distance', () => {
    const pos = custom([
      ['e1', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['e5', RED, PieceType.Pawn],
      ['d3', RED, PieceType.Advisor],
    ]);
    const moves = generateLegalMoves(pos, RED).filter(
      (m) => m.from === parseCoord('e1') && m.kind === 'eatSlave',
    );
    expect(moves).toHaveLength(1);
    expect(moves[0].to).toBe(parseCoord('d3'));
  });

  it('king can swap with a guard, and the guard survives', () => {
    const pos = custom([
      ['e1', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['e5', RED, PieceType.Pawn],
      ['f10', BLACK, PieceType.Advisor],
    ]);
    const move = generateLegalMoves(pos, BLACK).find(
      (m) => m.kind === 'swapGuard' && m.from === parseCoord('e10'),
    );
    expect(move).toBeDefined();
    expect(move?.captured).toBeUndefined();
    applyMove(pos, move!);
    expect(at(pos, 'f10')).toBe(makePiece(BLACK, PieceType.King));
    expect(at(pos, 'e10')).toBe(makePiece(BLACK, PieceType.Advisor));
  });

  it('king cannot swap twice in a row', () => {
    const pos = custom(
      [
        ['e1', RED, PieceType.King],
        ['e10', BLACK, PieceType.King],
        ['e5', RED, PieceType.Pawn],
        ['f10', BLACK, PieceType.Advisor],
      ],
      BLACK,
      true,
    );
    const swaps = generatePseudoMoves(pos, BLACK).filter(
      (m) => m.kind === 'swapGuard',
    );
    expect(swaps).toHaveLength(0);
  });
});

describe('flying general and check', () => {
  it('detects facing kings', () => {
    const pos = custom([
      ['e1', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
    ]);
    expect(kingsFacing(pos)).toBe(true);
    expect(isInCheck(pos, RED)).toBe(true);
    expect(isInCheck(pos, BLACK)).toBe(true);
  });

  it('a blocker prevents facing kings', () => {
    const pos = custom([
      ['e1', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['e5', RED, PieceType.Pawn],
    ]);
    expect(kingsFacing(pos)).toBe(false);
    expect(isInCheck(pos, RED)).toBe(false);
  });

  it('cannot move a blocking piece off the kings file', () => {
    const pos = custom([
      ['e1', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['e5', RED, PieceType.Tiger],
    ]);
    const moves = generateLegalMoves(pos, RED).filter(
      (m) => m.from === parseCoord('e5'),
    );
    expect(moves.some((m) => m.to === parseCoord('d5'))).toBe(false);
    expect(moves.some((m) => m.to === parseCoord('f5'))).toBe(false);
    // Moves along the e-file keep the kings separated and remain legal.
    expect(moves.some((m) => m.to === parseCoord('e6'))).toBe(true);
  });
});

describe('cannon', () => {
  it('captures with one or two screens', () => {
    const pos = custom([
      ['e1', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['a10', RED, PieceType.Pawn],
      ['e2', RED, PieceType.Cannon],
      ['e6', RED, PieceType.Pawn],
      ['e7', RED, PieceType.Pawn],
      ['e8', BLACK, PieceType.Pawn],
    ]);
    const moves = generateLegalMoves(pos, RED).filter(
      (m) => m.from === parseCoord('e2'),
    );
    // e6 and e7 are the two screens, e8 is the target.
    expect(moves.some((m) => m.to === parseCoord('e8'))).toBe(true);
    // e7 itself is the second screen; it is own, so not capturable.
    expect(moves.some((m) => m.to === parseCoord('e7'))).toBe(false);
  });

  it('does not capture a piece with no screen', () => {
    const pos = custom([
      ['e1', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['e5', RED, PieceType.Pawn],
      ['a2', RED, PieceType.Cannon],
      ['a6', BLACK, PieceType.Pawn],
    ]);
    const moves = generateLegalMoves(pos, RED).filter(
      (m) => m.from === parseCoord('a2'),
    );
    expect(moves.some((m) => m.to === parseCoord('a6'))).toBe(false);
  });
});

describe('initial wolves and river upgrade', () => {
  it('starts with wolves/braves, not pawns, and they only advance before the river', () => {
    const pos = createInitialPosition();
    expect(at(pos, 'a4')).toBe(makePiece(RED, PieceType.Wolf));
    expect(at(pos, 'a7')).toBe(makePiece(BLACK, PieceType.Wolf));
    expect(pos.board.some((p) => Math.abs(p) === PieceType.Pawn)).toBe(false);

    const moves = generateLegalMoves(pos, RED).filter(
      (m) => m.from === parseCoord('a4'),
    );
    expect(moves.map((m) => coord(m.to))).toEqual(['a5']);
  });

  it('keeps the wolf type after crossing and gains five directions', () => {
    const pos = custom([
      ['e1', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['e5', RED, PieceType.Wolf],
      ['c5', RED, PieceType.Wolf],
    ]);
    const before = generateLegalMoves(pos, RED).filter(
      (m) => m.from === parseCoord('c5'),
    );
    expect(before.map((m) => coord(m.to))).toEqual(['c6']);

    const move = before[0];
    applyMove(pos, move);
    expect(at(pos, 'c6')).toBe(makePiece(RED, PieceType.Wolf));
    const after = generateLegalMoves(pos, RED).filter(
      (m) => m.from === parseCoord('c6'),
    );
    expect(after.map((m) => coord(m.to)).sort()).toEqual(
      ['b6', 'b7', 'c7', 'd6', 'd7'].sort(),
    );
  });
});

describe('promotion', () => {
  it('leopard promotes to dragon on the enemy baseline', () => {
    const pos = custom([
      ['e1', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['a10', RED, PieceType.Pawn],
      ['a8', RED, PieceType.Leopard],
      ['e5', RED, PieceType.Pawn],
    ]);
    const move = generateLegalMoves(pos, RED).find(
      (m) => m.from === parseCoord('a8') && m.to === parseCoord('b10'),
    );
    expect(move?.promotion).toBe(PieceType.Dragon);
  });

  it('elephant does not promote on the baseline', () => {
    const pos = custom([
      ['e1', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['a10', RED, PieceType.Pawn],
      ['a9', RED, PieceType.Elephant],
      ['e5', RED, PieceType.Pawn],
    ]);
    const move = generateLegalMoves(pos, RED).find(
      (m) => m.from === parseCoord('a9') && m.to === parseCoord('b10'),
    );
    expect(move).toBeDefined();
    expect(move?.promotion).toBeUndefined();
  });
});

describe('checkmate and legal moves', () => {
  it('has at least one legal move in the initial position', () => {
    const pos = createInitialPosition();
    expect(hasAnyLegalMove(pos, RED)).toBe(true);
    expect(hasAnyLegalMove(pos, BLACK)).toBe(true);
  });

  it('detects a simple checkmate with tigers', () => {
    const pos = custom(
      [
        ['e1', RED, PieceType.King],
        ['e2', RED, PieceType.Tiger],
        ['d9', RED, PieceType.Tiger],
        ['f9', RED, PieceType.Tiger],
        ['e10', BLACK, PieceType.King],
      ],
      BLACK,
    );
    expect(isInCheck(pos, BLACK)).toBe(true);
    expect(isCheckmate(pos, BLACK)).toBe(true);
    expect(hasAnyLegalMove(pos, BLACK)).toBe(false);
  });
});
