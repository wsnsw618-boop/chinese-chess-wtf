export type Color = 1 | -1;

export const RED: Color = 1;
export const BLACK: Color = -1;

export const FILES = 9;
export const RANKS = 10;
export const BOARD_SIZE = FILES * RANKS;

export enum PieceType {
  King = 1,
  Tiger = 2,
  Leopard = 3,
  Elephant = 4,
  Advisor = 5,
  Cannon = 6,
  Pawn = 7,
  Wolf = 8,
  Dragon = 9,
}

export type Piece = number;

export function makePiece(color: Color, type: PieceType): Piece {
  return color === RED ? type : -type;
}

export function colorOf(piece: Piece): Color | 0 {
  if (piece > 0) return RED;
  if (piece < 0) return BLACK;
  return 0;
}

export function typeOf(piece: Piece): PieceType | 0 {
  return Math.abs(piece) as PieceType | 0;
}

export function isEnemy(a: Piece, b: Piece): boolean {
  return a !== 0 && b !== 0 && Math.sign(a) !== Math.sign(b);
}

export function isFriend(a: Piece, b: Piece): boolean {
  return a !== 0 && b !== 0 && Math.sign(a) === Math.sign(b);
}

export function square(file: number, rank: number): number {
  return rank * FILES + file;
}

export function fileOf(sq: number): number {
  return sq % FILES;
}

export function rankOf(sq: number): number {
  return Math.floor(sq / FILES);
}

export function inBoard(file: number, rank: number): boolean {
  return file >= 0 && file < FILES && rank >= 0 && rank < RANKS;
}

export function opposite(color: Color): Color {
  return color === RED ? BLACK : RED;
}

export function inPalace(color: Color, file: number, rank: number): boolean {
  if (file < 3 || file > 5) return false;
  return color === RED ? rank >= 0 && rank <= 2 : rank >= 7 && rank <= 9;
}

export function crossedRiver(color: Color, rank: number): boolean {
  return color === RED ? rank >= 5 : rank <= 4;
}

/** The rank a pawn starts on. */
export function pawnStartRank(color: Color): number {
  return color === RED ? 3 : 6;
}

/** The enemy baseline rank. */
export function enemyBaseline(color: Color): number {
  return color === RED ? 9 : 0;
}

/** Forward direction in rank units. */
export function forward(color: Color): number {
  return color === RED ? 1 : -1;
}

export function coord(sq: number): string {
  return `${String.fromCharCode(97 + fileOf(sq))}${rankOf(sq) + 1}`;
}

export function parseCoord(text: string): number {
  const file = text.charCodeAt(0) - 97;
  const rank = Number(text.slice(1)) - 1;
  return square(file, rank);
}

export function sideName(color: Color): string {
  return color === RED ? '红方' : '黑方';
}

export function sideShort(color: Color): string {
  return color === RED ? '红' : '黑';
}

const RED_NAMES: Record<PieceType, string> = {
  [PieceType.King]: '霸',
  [PieceType.Tiger]: '虎',
  [PieceType.Leopard]: '豹',
  [PieceType.Elephant]: '象',
  [PieceType.Advisor]: '奴',
  [PieceType.Cannon]: '妖',
  [PieceType.Pawn]: '兵',
  [PieceType.Wolf]: '狼',
  [PieceType.Dragon]: '龙',
};

const BLACK_NAMES: Record<PieceType, string> = {
  [PieceType.King]: '王',
  [PieceType.Tiger]: '坦',
  [PieceType.Leopard]: '骑',
  [PieceType.Elephant]: '牛',
  [PieceType.Advisor]: '卫',
  [PieceType.Cannon]: '巫',
  [PieceType.Pawn]: '卒',
  [PieceType.Wolf]: '勇',
  [PieceType.Dragon]: '仙',
};

export function pieceName(piece: Piece): string {
  const type = typeOf(piece);
  if (!type) return '空';
  return colorOf(piece) === RED ? RED_NAMES[type as PieceType] : BLACK_NAMES[type as PieceType];
}

export function typeName(color: Color, type: PieceType): string {
  return pieceName(makePiece(color, type));
}

export type MoveKind = 'normal' | 'eatSlave' | 'swapGuard';

export interface Move {
  from: number;
  to: number;
  kind: MoveKind;
  piece: Piece;
  /** For normal captures: the enemy piece. For eatSlave: the own advisor. */
  captured?: Piece;
  capturedId?: number;
  /** Promotion applied at the destination. */
  promotion?: PieceType;
}

export function moveKey(move: Move): string {
  return `${move.from}-${move.to}-${move.kind}-${move.promotion ?? 0}`;
}

export type DuelPhase = 'none' | 'countdown' | 'selection' | 'restriction';
export type DuelReason = 'pieces' | 'repetition' | 'superpieces' | 'agreement' | 'noProgress';

export interface TransformChoice {
  square: number;
  target: PieceType.Tiger | PieceType.Dragon;
}

export interface DuelState {
  phase: DuelPhase;
  count: number;
  reason: DuelReason | null;
  countdown: number;
  firstSelector: Color | null;
  secondSelector: Color | null;
  firstChoices: TransformChoice[] | null;
  secondChoices: TransformChoice[] | null;
  restrictionPlies: number;
  newlyTransformedIds: number[];
  /** For the UI: last completed duel choices. */
  lastTransformed: { color: Color; choices: TransformChoice[] }[];
}

export type GameResultReason =
  | 'checkmate'
  | 'stalemate'
  | 'singleKing'
  | 'perpetualCheck'
  | 'perpetualChase'
  | 'resign'
  | 'duelMate'
  | 'noMoves';

export interface GameResult {
  winner: Color;
  loser: Color;
  reason: GameResultReason;
  message: string;
}

export interface MoveRecord {
  move: Move;
  mover: Color;
  notation: string;
  check: boolean;
  threatenedIds: number[];
}

export type GameMode = 'pvp' | 'ai';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface GameOptions {
  mode?: GameMode;
  humanColor?: Color;
  difficulty?: Difficulty;
}

export interface DuelChoiceDraft {
  square: number;
  target: PieceType.Tiger | PieceType.Dragon;
}

export function isSuperPiece(piece: Piece): boolean {
  const type = typeOf(piece);
  return type === PieceType.Tiger || type === PieceType.Dragon;
}

export function isMajorPiece(piece: Piece): boolean {
  const type = typeOf(piece);
  return type === PieceType.King || type === PieceType.Tiger || type === PieceType.Dragon;
}

export function isPawnLike(piece: Piece): boolean {
  const type = typeOf(piece);
  return type === PieceType.Pawn || type === PieceType.Wolf;
}
