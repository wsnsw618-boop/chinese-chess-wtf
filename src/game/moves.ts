import {
  Position,
  applyMove,
  countNonKing,
  findKing,
  undoMove,
} from './board';
import {
  BLACK,
  BOARD_SIZE,
  Color,
  PieceType,
  RED,
  type Move,
  type Piece,
  colorOf,
  crossedRiver,
  enemyBaseline,
  fileOf,
  forward,
  inBoard,
  inPalace,
  makePiece,
  opposite,
  rankOf,
  square,
  typeOf,
} from './types';

const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];
const DIAG: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const ALL8 = [...ORTHO, ...DIAG];
const HORSE: ReadonlyArray<readonly [number, number]> = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

/**
 * A cannon must spend one full own turn without moving before it can use the
 * two-screen capture again. `cannonLastMove` stores the ply index before the
 * cannon's last move; four plies later is the cannon side's next-next turn.
 */
export function cannonTwoScreenReady(pos: Position, from: number): boolean {
  const last = pos.cannonLastMove.get(pos.ids[from]);
  return last === undefined || pos.ply - last >= 4;
}

/** Remaining plies of charge, or 0 when the two-screen capture is ready. */
export function cannonChargeRemaining(pos: Position, from: number): number {
  const last = pos.cannonLastMove.get(pos.ids[from]);
  if (last === undefined) return 0;
  return Math.max(0, 4 - (pos.ply - last));
}

function promotionFor(piece: Piece, to: number): PieceType | undefined {
  const type = typeOf(piece);
  const color = colorOf(piece);
  if (!color) return undefined;
  if (type === PieceType.Leopard && rankOf(to) === enemyBaseline(color)) {
    return PieceType.Dragon;
  }
  if (type === PieceType.Pawn && crossedRiver(color, rankOf(to))) {
    return PieceType.Wolf;
  }
  return undefined;
}

function pushMove(
  moves: Move[],
  pos: Position,
  from: number,
  to: number,
  kind: Move['kind'] = 'normal',
  promotion?: PieceType,
  capturedOverride?: Piece,
): void {
  const piece = pos.board[from];
  const target = pos.board[to];
  if (kind === 'normal' && target && Math.sign(target) === Math.sign(piece)) return;
  const isSwap = kind === 'swapGuard';
  moves.push({
    from,
    to,
    kind,
    piece,
    captured: isSwap ? undefined : (capturedOverride ?? (target || undefined)),
    capturedId: isSwap ? undefined : target ? pos.ids[to] : undefined,
    promotion,
  });
}

function addStep(
  moves: Move[],
  pos: Position,
  from: number,
  file: number,
  rank: number,
  promotion?: PieceType,
): void {
  if (!inBoard(file, rank)) return;
  const to = square(file, rank);
  const target = pos.board[to];
  if (target && Math.sign(target) === Math.sign(pos.board[from])) return;
  pushMove(moves, pos, from, to, 'normal', promotion);
}

function addSliding(
  moves: Move[],
  pos: Position,
  from: number,
  dirFile: number,
  dirRank: number,
): void {
  const piece = pos.board[from];
  let file = fileOf(from) + dirFile;
  let rank = rankOf(from) + dirRank;
  while (inBoard(file, rank)) {
    const to = square(file, rank);
    const target = pos.board[to];
    if (!target) {
      pushMove(moves, pos, from, to);
    } else {
      if (Math.sign(target) !== Math.sign(piece)) {
        pushMove(moves, pos, from, to);
      }
      break;
    }
    file += dirFile;
    rank += dirRank;
  }
}

/** Pseudo-legal moves for `color`. King safety is not checked here. */
export function generatePseudoMoves(pos: Position, color: Color): Move[] {
  const moves: Move[] = [];

  for (let from = 0; from < BOARD_SIZE; from++) {
    const piece = pos.board[from];
    if (!piece || Math.sign(piece) !== color) continue;
    const type = typeOf(piece);
    const file = fileOf(from);
    const rank = rankOf(from);

    switch (type) {
      case PieceType.King: {
        for (const [df, dr] of ORTHO) {
          const nf = file + df;
          const nr = rank + dr;
          if (!inPalace(color, nf, nr)) continue;
          addStep(moves, pos, from, nf, nr);
        }
        // Overlord eats a friendly slave anywhere in the palace.
        if (color === RED) {
          for (let to = 0; to < BOARD_SIZE; to++) {
            const target = pos.board[to];
            if (target === makePiece(RED, PieceType.Advisor) && inPalace(RED, fileOf(to), rankOf(to))) {
              pushMove(moves, pos, from, to, 'eatSlave', undefined, target);
            }
          }
        }
        // King swaps with a friendly guard anywhere in the palace.
        if (color === BLACK && !pos.swapLocked) {
          for (let to = 0; to < BOARD_SIZE; to++) {
            const target = pos.board[to];
            if (target === makePiece(BLACK, PieceType.Advisor) && inPalace(BLACK, fileOf(to), rankOf(to))) {
              pushMove(moves, pos, from, to, 'swapGuard');
            }
          }
        }
        break;
      }

      case PieceType.Tiger: {
        for (const [df, dr] of ORTHO) addSliding(moves, pos, from, df, dr);
        for (const [df, dr] of DIAG) addStep(moves, pos, from, file + df, rank + dr);
        break;
      }

      case PieceType.Leopard: {
        for (const [df, dr] of HORSE) {
          const nf = file + df;
          const nr = rank + dr;
          if (!inBoard(nf, nr)) continue;
          const to = square(nf, nr);
          const target = pos.board[to];
          if (target && Math.sign(target) === color) continue;
          pushMove(moves, pos, from, to, 'normal', promotionFor(piece, to));
        }
        break;
      }

      case PieceType.Elephant: {
        for (const [df, dr] of DIAG) {
          // One step.
          addStep(moves, pos, from, file + df, rank + dr);
          // Two steps: the midpoint must be empty.
          const mf = file + df;
          const mr = rank + dr;
          const nf = file + df * 2;
          const nr = rank + dr * 2;
          if (!inBoard(nf, nr)) continue;
          if (pos.board[square(mf, mr)] !== 0) continue;
          addStep(moves, pos, from, nf, nr);
        }
        break;
      }

      case PieceType.Advisor: {
        for (const [df, dr] of ALL8) {
          // One step within palace.
          const f1 = file + df;
          const r1 = rank + dr;
          if (inPalace(color, f1, r1)) {
            addStep(moves, pos, from, f1, r1);
          }
          // Two steps within palace, midpoint empty.
          const f2 = file + df * 2;
          const r2 = rank + dr * 2;
          if (!inPalace(color, f2, r2)) continue;
          if (pos.board[square(f1, r1)] !== 0) continue;
          addStep(moves, pos, from, f2, r2);
        }
        break;
      }

      case PieceType.Cannon: {
        for (const [df, dr] of ORTHO) {
          let f = file + df;
          let r = rank + dr;
          // Quiet moves: any empty square before the first screen.
          while (inBoard(f, r)) {
            const to = square(f, r);
            if (pos.board[to] !== 0) break;
            pushMove(moves, pos, from, to);
            f += df;
            r += dr;
          }
          // Capture: exactly one or two screens; target is the piece after them.
          const screens: number[] = [];
          while (inBoard(f, r) && screens.length < 3) {
            const to = square(f, r);
            if (pos.board[to] !== 0) screens.push(to);
            f += df;
            r += dr;
          }
          if (screens.length >= 2) {
            const target = pos.board[screens[1]];
            if (target && Math.sign(target) !== color) {
              pushMove(moves, pos, from, screens[1]);
            }
          }
          if (screens.length >= 3) {
            const target = pos.board[screens[2]];
            if (target && Math.sign(target) !== color && cannonTwoScreenReady(pos, from)) {
              pushMove(moves, pos, from, screens[2]);
            }
          }
        }
        break;
      }

      case PieceType.Pawn: {
        const fwd = forward(color);
        const promo = (to: number) => promotionFor(piece, to);
        // Forward.
        {
          const nf = file;
          const nr = rank + fwd;
          if (inBoard(nf, nr)) {
            const to = square(nf, nr);
            const target = pos.board[to];
            if (!target || Math.sign(target) !== color) {
              pushMove(moves, pos, from, to, 'normal', promo(to));
            }
          }
        }
        if (crossedRiver(color, rank)) {
          for (const df of [-1, 0, 1]) {
            if (df === 0) continue;
            // Sideways.
            const sf = file + df;
            const sr = rank;
            if (inBoard(sf, sr)) {
              const to = square(sf, sr);
              const target = pos.board[to];
              if (!target || Math.sign(target) !== color) {
                pushMove(moves, pos, from, to, 'normal', promotionFor(piece, to));
              }
            }
            // Diagonal forward.
            const dfw = file + df;
            const drw = rank + fwd;
            if (inBoard(dfw, drw)) {
              const to = square(dfw, drw);
              const target = pos.board[to];
              if (!target || Math.sign(target) !== color) {
                pushMove(moves, pos, from, to, 'normal', promotionFor(piece, to));
              }
            }
          }
        }
        break;
      }

      case PieceType.Wolf: {
        const fwd = forward(color);
        const crossed = crossedRiver(color, rank);
        const candidates: Array<[number, number]> = crossed
          ? [
              [file, rank + fwd],
              [file - 1, rank],
              [file + 1, rank],
              [file - 1, rank + fwd],
              [file + 1, rank + fwd],
            ]
          : [[file, rank + fwd]];
        for (const [nf, nr] of candidates) {
          if (!inBoard(nf, nr)) continue;
          const to = square(nf, nr);
          const target = pos.board[to];
          if (target && Math.sign(target) === color) continue;
          pushMove(moves, pos, from, to);
        }
        break;
      }

      case PieceType.Dragon: {
        // Horse part.
        for (const [df, dr] of HORSE) {
          const nf = file + df;
          const nr = rank + dr;
          if (!inBoard(nf, nr)) continue;
          addStep(moves, pos, from, nf, nr);
        }
        // Elephant part.
        for (const [df, dr] of DIAG) {
          addStep(moves, pos, from, file + df, rank + dr);
          const mf = file + df;
          const mr = rank + dr;
          const nf = file + df * 2;
          const nr = rank + dr * 2;
          if (!inBoard(nf, nr)) continue;
          if (pos.board[square(mf, mr)] !== 0) continue;
          addStep(moves, pos, from, nf, nr);
        }
        break;
      }

      default:
        break;
    }
  }

  return moves;
}

/** True if the two kings share a file with no pieces between them. */
export function kingsFacing(pos: Position): boolean {
  const rk = findKing(pos, RED);
  const bk = findKing(pos, BLACK);
  if (rk < 0 || bk < 0) return false;
  if (fileOf(rk) !== fileOf(bk)) return false;
  const lo = Math.min(rankOf(rk), rankOf(bk));
  const hi = Math.max(rankOf(rk), rankOf(bk));
  for (let r = lo + 1; r < hi; r++) {
    if (pos.board[square(fileOf(rk), r)] !== 0) return false;
  }
  return true;
}

function countPiecesBetween(pos: Position, from: number, to: number): number {
  const ff = fileOf(from);
  const fr = rankOf(from);
  const tf = fileOf(to);
  const tr = rankOf(to);
  if (ff !== tf && fr !== tr) return -1;
  let n = 0;
  if (ff === tf) {
    const lo = Math.min(fr, tr);
    const hi = Math.max(fr, tr);
    for (let r = lo + 1; r < hi; r++) {
      if (pos.board[square(ff, r)] !== 0) n++;
    }
  } else {
    const lo = Math.min(ff, tf);
    const hi = Math.max(ff, tf);
    for (let f = lo + 1; f < hi; f++) {
      if (pos.board[square(f, fr)] !== 0) n++;
    }
  }
  return n;
}

function diagonalDistance(from: number, to: number): number {
  const df = Math.abs(fileOf(from) - fileOf(to));
  const dr = Math.abs(rankOf(from) - rankOf(to));
  return df === dr ? df : -1;
}

function pieceAttacksSquare(pos: Position, from: number, target: number): boolean {
  const piece = pos.board[from];
  if (!piece) return false;
  const color = Math.sign(piece) as Color;
  const type = typeOf(piece);
  const ff = fileOf(from);
  const fr = rankOf(from);
  const tf = fileOf(target);
  const tr = rankOf(target);

  switch (type) {
    case PieceType.King: {
      return Math.abs(ff - tf) + Math.abs(fr - tr) === 1;
    }
    case PieceType.Tiger: {
      if (ff === tf || fr === tr) {
        return countPiecesBetween(pos, from, target) === 0;
      }
      return Math.abs(ff - tf) === 1 && Math.abs(fr - tr) === 1;
    }
    case PieceType.Leopard: {
      const df = Math.abs(ff - tf);
      const dr = Math.abs(fr - tr);
      return (df === 1 && dr === 2) || (df === 2 && dr === 1);
    }
    case PieceType.Elephant: {
      const d = diagonalDistance(from, target);
      if (d === 1) return true;
      if (d === 2) {
        return pos.board[square((ff + tf) / 2, (fr + tr) / 2)] === 0;
      }
      return false;
    }
    case PieceType.Advisor: {
      if (!inPalace(color, tf, tr)) return false;
      const df = Math.abs(ff - tf);
      const dr = Math.abs(fr - tr);
      if (df === 1 && dr === 0) return true;
      if (df === 0 && dr === 1) return true;
      if (df === 1 && dr === 1) return true;
      if (df === 2 && dr === 0) return pos.board[square((ff + tf) / 2, fr)] === 0;
      if (df === 0 && dr === 2) return pos.board[square(ff, (fr + tr) / 2)] === 0;
      if (df === 2 && dr === 2) {
        return pos.board[square((ff + tf) / 2, (fr + tr) / 2)] === 0;
      }
      return false;
    }
    case PieceType.Cannon: {
      if (ff !== tf && fr !== tr) return false;
      const screens = countPiecesBetween(pos, from, target);
      if (screens === 1) return true;
      if (screens === 2) return cannonTwoScreenReady(pos, from);
      return false;
    }
    case PieceType.Pawn: {
      const fwd = forward(color);
      if (tf === ff && tr === fr + fwd) return true;
      if (crossedRiver(color, fr)) {
        if (tr === fr && Math.abs(tf - ff) === 1) return true;
        if (tr === fr + fwd && Math.abs(tf - ff) === 1) return true;
      }
      return false;
    }
    case PieceType.Wolf: {
      const fwd = forward(color);
      if (tf === ff && tr === fr + fwd) return true;
      if (crossedRiver(color, fr)) {
        if (tr === fr && Math.abs(tf - ff) === 1) return true;
        if (tr === fr + fwd && Math.abs(tf - ff) === 1) return true;
      }
      return false;
    }
    case PieceType.Dragon: {
      const df = Math.abs(ff - tf);
      const dr = Math.abs(fr - tr);
      if ((df === 1 && dr === 2) || (df === 2 && dr === 1)) return true;
      const d = diagonalDistance(from, target);
      if (d === 1) return true;
      if (d === 2) {
        return pos.board[square((ff + tf) / 2, (fr + tr) / 2)] === 0;
      }
      return false;
    }
    default:
      return false;
  }
}

/** Is `target` attacked by any piece of `byColor`? */
export function isSquareAttacked(pos: Position, target: number, byColor: Color): boolean {
  for (let from = 0; from < BOARD_SIZE; from++) {
    const p = pos.board[from];
    if (!p || Math.sign(p) !== byColor) continue;
    if (pieceAttacksSquare(pos, from, target)) return true;
  }
  return false;
}

export function isInCheck(pos: Position, color: Color): boolean {
  if (kingsFacing(pos)) return true;
  const king = findKing(pos, color);
  if (king < 0) return true;
  return isSquareAttacked(pos, king, opposite(color));
}

export interface LegalMoveOptions {
  forbidNewPieceMate?: boolean;
  newlyTransformedIds?: ReadonlySet<number> | readonly number[];
}

function isNewlyTransformed(id: number, opts: LegalMoveOptions): boolean {
  if (!opts.forbidNewPieceMate || !opts.newlyTransformedIds) return false;
  const ids = opts.newlyTransformedIds;
  if (ids instanceof Set) return ids.has(id);
  return (ids as readonly number[]).includes(id);
}

export function isLegalMove(pos: Position, move: Move, opts: LegalMoveOptions = {}): boolean {
  const mover = pos.turn;
  const movingId = pos.ids[move.from];
  const undo = applyMove(pos, move);
  let legal = !isInCheck(pos, mover);
  if (legal && isNewlyTransformed(movingId, opts)) {
    const opponent = opposite(mover);
    // A new piece may capture the opponent's last non-king piece (single-king
    // win) even if that also happens to be mate. Only a "normal" mate against
    // a side that still has non-king pieces is forbidden.
    if (countNonKing(pos, opponent) > 0 && isCheckmate(pos, opponent)) {
      legal = false;
    }
  }
  undoMove(pos, undo);
  return legal;
}

export function generateLegalMoves(
  pos: Position,
  color: Color,
  opts: LegalMoveOptions = {},
): Move[] {
  const oldTurn = pos.turn;
  if (pos.turn !== color) pos.turn = color;
  const pseudo = generatePseudoMoves(pos, color);
  const legal: Move[] = [];
  for (const move of pseudo) {
    if (isLegalMove(pos, move, opts)) legal.push(move);
  }
  pos.turn = oldTurn;
  return legal;
}

export function generateAllLegalMoves(pos: Position, opts: LegalMoveOptions = {}): Move[] {
  return generateLegalMoves(pos, pos.turn, opts);
}

export function legalMovesFrom(
  pos: Position,
  from: number,
  opts: LegalMoveOptions = {},
): Move[] {
  return generateAllLegalMoves(pos, opts).filter((m) => m.from === from);
}

export function hasAnyLegalMove(pos: Position, color: Color): boolean {
  const oldTurn = pos.turn;
  if (pos.turn !== color) pos.turn = color;
  const pseudo = generatePseudoMoves(pos, color);
  let found = false;
  for (const move of pseudo) {
    const undo = applyMove(pos, move);
    if (!isInCheck(pos, color)) {
      undoMove(pos, undo);
      found = true;
      break;
    }
    undoMove(pos, undo);
  }
  pos.turn = oldTurn;
  return found;
}

export function isCheckmate(pos: Position, color: Color): boolean {
  return isInCheck(pos, color) && !hasAnyLegalMove(pos, color);
}

export function isStalemate(pos: Position, color: Color): boolean {
  return !isInCheck(pos, color) && !hasAnyLegalMove(pos, color);
}

/** Enumerate IDs of enemy non-king pieces currently attacked by `color`. */
export function threatenedEnemyIds(pos: Position, color: Color): number[] {
  const out: number[] = [];
  for (let sq = 0; sq < BOARD_SIZE; sq++) {
    const p = pos.board[sq];
    if (!p || Math.sign(p) === color) continue;
    if (Math.abs(p) === PieceType.King) continue;
    if (isSquareAttacked(pos, sq, color)) out.push(pos.ids[sq]);
  }
  return out;
}
