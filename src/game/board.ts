import {
  BLACK,
  BOARD_SIZE,
  Color,
  PieceType,
  RED,
  type Move,
  type Piece,
  fileOf,
  makePiece,
  opposite,
  rankOf,
  square,
} from './types';

export interface Undo {
  from: number;
  to: number;
  fromCode: Piece;
  toCode: Piece;
  fromId: number;
  toId: number;
  turn: Color;
  swapLocked: boolean;
  /** Ply counter before the move was applied. */
  ply: number;
  /** Set when a cannon moved; the cannon's previous charge timestamp, if any. */
  cannonId?: number;
  cannonLast?: number;
}

/**
 * A mutable position. `board` uses signed piece codes: red 1..9, black -1..-9.
 * `ids` is a parallel array of stable piece identities, used by the repetition
 * and chase adjudicator and by animations.
 */
export class Position {
  board: Int8Array;
  ids: Int16Array;
  turn: Color;
  /** True when Black's king has just used the swap and must wait one Black move before swapping again. */
  swapLocked: boolean;
  /** Number of plies already played. Used by the cannon charge rule. */
  ply: number;
  /**
   * Last ply (the ply index before the move) on which each cannon moved.
   * The key is the stable piece id. Missing means the cannon has never moved
   * and is therefore ready to use its two-screen capture.
   */
  cannonLastMove: Map<number, number>;

  constructor(
    board = new Int8Array(BOARD_SIZE),
    ids = new Int16Array(BOARD_SIZE),
    turn: Color = RED,
    swapLocked = false,
    ply = 0,
    cannonLastMove: Map<number, number> = new Map(),
  ) {
    this.board = board;
    this.ids = ids;
    this.turn = turn;
    this.swapLocked = swapLocked;
    this.ply = ply;
    this.cannonLastMove = cannonLastMove;
  }

  clone(): Position {
    return new Position(
      new Int8Array(this.board),
      new Int16Array(this.ids),
      this.turn,
      this.swapLocked,
      this.ply,
      new Map(this.cannonLastMove),
    );
  }

  pieceAt(sq: number): Piece {
    return this.board[sq] ?? 0;
  }

  idAt(sq: number): number {
    return this.ids[sq] ?? 0;
  }

  key(): string {
    let s = '';
    for (let i = 0; i < BOARD_SIZE; i++) {
      s += String.fromCharCode(this.board[i] + 32);
    }
    // Two positions with the same pieces but different cannon charge states do
    // not have the same legal moves, so they must not be treated as identical
    // by the repetition adjudicator. Only the remaining wait matters here, not
    // the absolute ply number.
    let cannons = '';
    for (let i = 0; i < BOARD_SIZE; i++) {
      if (Math.abs(this.board[i]) !== PieceType.Cannon) continue;
      const id = this.ids[i];
      const last = this.cannonLastMove.get(id);
      const remaining = last === undefined ? 0 : Math.max(0, 4 - (this.ply - last));
      cannons += `${i}:${remaining};`;
    }
    return `${s}|${this.turn === RED ? 'r' : 'b'}|${this.swapLocked ? '1' : '0'}|${cannons}`;
  }

  /** Debug helper, e.g. "rK@e0,...". */
  describe(): string {
    const parts: string[] = [];
    for (let i = 0; i < BOARD_SIZE; i++) {
      const p = this.board[i];
      if (p) parts.push(`${p > 0 ? 'r' : 'b'}${Math.abs(p)}@${fileOf(i)},${rankOf(i)}`);
    }
    return parts.join(' ');
  }
}

let nextInitialId = 1;

function place(
  board: Int8Array,
  ids: Int16Array,
  file: number,
  rank: number,
  color: Color,
  type: PieceType,
): number {
  const sq = square(file, rank);
  board[sq] = makePiece(color, type);
  const id = nextInitialId++;
  ids[sq] = id;
  return id;
}

export function createInitialPosition(): Position {
  nextInitialId = 1;
  const board = new Int8Array(BOARD_SIZE);
  const ids = new Int16Array(BOARD_SIZE);

  // Red, bottom.
  place(board, ids, 4, 0, RED, PieceType.King);
  place(board, ids, 0, 0, RED, PieceType.Tiger);
  place(board, ids, 8, 0, RED, PieceType.Tiger);
  place(board, ids, 1, 0, RED, PieceType.Leopard);
  place(board, ids, 7, 0, RED, PieceType.Leopard);
  place(board, ids, 2, 0, RED, PieceType.Elephant);
  place(board, ids, 6, 0, RED, PieceType.Elephant);
  place(board, ids, 3, 0, RED, PieceType.Advisor);
  place(board, ids, 5, 0, RED, PieceType.Advisor);
  place(board, ids, 1, 2, RED, PieceType.Cannon);
  place(board, ids, 7, 2, RED, PieceType.Cannon);
  for (const file of [0, 2, 4, 6, 8]) {
    place(board, ids, file, 3, RED, PieceType.Wolf);
  }

  // Black, top.
  place(board, ids, 4, 9, BLACK, PieceType.King);
  place(board, ids, 0, 9, BLACK, PieceType.Tiger);
  place(board, ids, 8, 9, BLACK, PieceType.Tiger);
  place(board, ids, 1, 9, BLACK, PieceType.Leopard);
  place(board, ids, 7, 9, BLACK, PieceType.Leopard);
  place(board, ids, 2, 9, BLACK, PieceType.Elephant);
  place(board, ids, 6, 9, BLACK, PieceType.Elephant);
  place(board, ids, 3, 9, BLACK, PieceType.Advisor);
  place(board, ids, 5, 9, BLACK, PieceType.Advisor);
  place(board, ids, 1, 7, BLACK, PieceType.Cannon);
  place(board, ids, 7, 7, BLACK, PieceType.Cannon);
  for (const file of [0, 2, 4, 6, 8]) {
    place(board, ids, file, 6, BLACK, PieceType.Wolf);
  }

  return new Position(board, ids, RED, false);
}

export function applyMove(pos: Position, move: Move): Undo {
  const undo: Undo = {
    from: move.from,
    to: move.to,
    fromCode: pos.board[move.from],
    toCode: pos.board[move.to],
    fromId: pos.ids[move.from],
    toId: pos.ids[move.to],
    turn: pos.turn,
    swapLocked: pos.swapLocked,
    ply: pos.ply,
  };

  const mover = pos.turn;
  const moving = pos.board[move.from];
  const movingType = Math.abs(moving);
  const movingId = pos.ids[move.from];

  if (movingType === PieceType.Cannon) {
    undo.cannonId = movingId;
    undo.cannonLast = pos.cannonLastMove.get(movingId);
  }

  if (move.kind === 'swapGuard') {
    // King and guard exchange squares; no capture.
    pos.board[move.from] = undo.toCode;
    pos.board[move.to] = undo.fromCode;
    pos.ids[move.from] = undo.toId;
    pos.ids[move.to] = undo.fromId;
  } else {
    // Normal move, including the Overlord eating a friendly slave.
    pos.board[move.from] = 0;
    pos.ids[move.from] = 0;
    pos.board[move.to] = move.promotion
      ? makePiece(mover, move.promotion)
      : moving;
    pos.ids[move.to] = undo.fromId;
  }

  pos.turn = opposite(mover);
  if (mover === BLACK) {
    pos.swapLocked = move.kind === 'swapGuard';
  }
  pos.ply += 1;
  if (movingType === PieceType.Cannon) {
    // Store the pre-move ply. A cannon is ready when at least four plies have
    // passed since this timestamp, which means it skipped one full own turn.
    pos.cannonLastMove.set(movingId, undo.ply);
  }
  return undo;
}

export function undoMove(pos: Position, undo: Undo): void {
  pos.board[undo.from] = undo.fromCode;
  pos.board[undo.to] = undo.toCode;
  pos.ids[undo.from] = undo.fromId;
  pos.ids[undo.to] = undo.toId;
  pos.turn = undo.turn;
  pos.swapLocked = undo.swapLocked;
  pos.ply = undo.ply;
  if (undo.cannonId !== undefined) {
    if (undo.cannonLast === undefined) pos.cannonLastMove.delete(undo.cannonId);
    else pos.cannonLastMove.set(undo.cannonId, undo.cannonLast);
  }
}

export function findKing(pos: Position, color: Color): number {
  const king = makePiece(color, PieceType.King);
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (pos.board[i] === king) return i;
  }
  return -1;
}

export function countPieces(pos: Position, color: Color): number {
  let n = 0;
  for (let i = 0; i < BOARD_SIZE; i++) {
    const p = pos.board[i];
    if (p !== 0 && Math.sign(p) === color) n++;
  }
  return n;
}

export function countNonKing(pos: Position, color: Color): number {
  let n = 0;
  for (let i = 0; i < BOARD_SIZE; i++) {
    const p = pos.board[i];
    if (p !== 0 && Math.sign(p) === color && Math.abs(p) !== PieceType.King) n++;
  }
  return n;
}

export function hasSuperPiece(pos: Position, color?: Color): boolean {
  for (let i = 0; i < BOARD_SIZE; i++) {
    const p = pos.board[i];
    if (!p) continue;
    if (color !== undefined && Math.sign(p) !== color) continue;
    const type = Math.abs(p);
    if (type === PieceType.Tiger || type === PieceType.Dragon) return true;
  }
  return false;
}

export function allSuperPiecesCaptured(pos: Position): boolean {
  return !hasSuperPiece(pos);
}

export function piecesOf(pos: Position, color: Color): { sq: number; piece: Piece; id: number }[] {
  const out: { sq: number; piece: Piece; id: number }[] = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    const p = pos.board[i];
    if (p !== 0 && Math.sign(p) === color) {
      out.push({ sq: i, piece: p, id: pos.ids[i] });
    }
  }
  return out;
}

export function isKingInPalace(pos: Position, color: Color): boolean {
  const king = findKing(pos, color);
  if (king < 0) return false;
  return true;
}

export function squareName(sq: number): string {
  return `${String.fromCharCode(97 + fileOf(sq))}${rankOf(sq) + 1}`;
}
