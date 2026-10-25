import {
  Position,
  allSuperPiecesCaptured,
  applyMove,
  countNonKing,
  countPieces,
  createInitialPosition,
  findKing,
  hasSuperPiece,
  piecesOf,
} from './board';
import {
  LegalMoveOptions,
  generateAllLegalMoves,
  isCheckmate,
  isInCheck,
  isLegalMove,
  isStalemate,
  threatenedEnemyIds,
} from './moves';
import { notationForMove } from './notation';
import {
  BLACK,
  Color,
  Difficulty,
  DuelChoiceDraft,
  DuelReason,
  DuelState,
  GameMode,
  GameOptions,
  GameResult,
  Move,
  MoveRecord,
  PieceType,
  RED,
  TransformChoice,
  typeOf,
  isPawnLike,
  opposite,
  sideName,
} from './types';

export interface GameSnapshot {
  board: Int8Array;
  ids: Int16Array;
  turn: Color;
  swapLocked: boolean;
  duel: DuelState;
  result: GameResult | null;
  moveRecords: MoveRecord[];
  positionHistory: string[];
  pliesSinceProgress: number;
}

export function freshDuel(): DuelState {
  return {
    phase: 'none',
    count: 0,
    reason: null,
    countdown: 0,
    firstSelector: null,
    secondSelector: null,
    firstChoices: null,
    secondChoices: null,
    restrictionPlies: 0,
    newlyTransformedIds: [],
    lastTransformed: [],
  };
}

export function cloneDuel(duel: DuelState): DuelState {
  return {
    ...duel,
    firstChoices: duel.firstChoices?.map((c) => ({ ...c })) ?? null,
    secondChoices: duel.secondChoices?.map((c) => ({ ...c })) ?? null,
    newlyTransformedIds: [...duel.newlyTransformedIds],
    lastTransformed: duel.lastTransformed.map((entry) => ({
      color: entry.color,
      choices: entry.choices.map((c) => ({ ...c })),
    })),
  };
}

function removeLast<T>(arr: T[]): T | undefined {
  return arr.pop();
}

/**
 * The full game controller. It owns the board, the duel state machine,
 * repetition adjudication, undo snapshots and result state.
 */
export class Game {
  position: Position;
  duel: DuelState;
  result: GameResult | null = null;
  moveRecords: MoveRecord[] = [];
  positionHistory: string[] = [];
  pliesSinceProgress = 0;
  lastMove: Move | null = null;

  mode: GameMode;
  humanColor: Color;
  difficulty: Difficulty;

  private positionCounts = new Map<string, number>();
  private snapshots: GameSnapshot[] = [];
  private listeners = new Set<(game: Game) => void>();

  constructor(options: GameOptions = {}) {
    this.mode = options.mode ?? 'pvp';
    this.humanColor = options.humanColor ?? RED;
    this.difficulty = options.difficulty ?? 'normal';
    this.position = createInitialPosition();
    this.duel = freshDuel();
    this.newGame();
  }

  subscribe(listener: (game: Game) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this);
  }

  newGame(options: Partial<GameOptions> = {}): void {
    if (options.mode !== undefined) this.mode = options.mode;
    if (options.humanColor !== undefined) this.humanColor = options.humanColor;
    if (options.difficulty !== undefined) this.difficulty = options.difficulty;
    this.position = createInitialPosition();
    this.duel = freshDuel();
    this.result = null;
    this.moveRecords = [];
    this.positionHistory = [this.position.key()];
    this.positionCounts = new Map([[this.positionHistory[0], 1]]);
    this.pliesSinceProgress = 0;
    this.lastMove = null;
    this.snapshots = [];
    this.emit();
  }

  /**
   * Load a custom position. Primarily for tests, scenario setup and debugging.
   * It resets all history; it does not attempt to continue an existing game.
   */
  loadPosition(position: Position, duelOverrides: Partial<DuelState> = {}): void {
    this.position = position.clone();
    this.duel = cloneDuel({ ...freshDuel(), ...duelOverrides });
    this.result = null;
    this.moveRecords = [];
    this.positionHistory = [this.position.key()];
    this.positionCounts = new Map([[this.positionHistory[0], 1]]);
    this.pliesSinceProgress = 0;
    this.lastMove = null;
    this.snapshots = [];
    this.emit();
  }

  get gameOver(): boolean {
    return this.result !== null;
  }

  get legalOptions(): LegalMoveOptions {
    if (this.duel.phase === 'restriction') {
      return {
        forbidNewPieceMate: true,
        newlyTransformedIds: this.duel.newlyTransformedIds,
      };
    }
    return {};
  }

  canOfferDuel(): boolean {
    return !this.result && this.duel.count === 0 && this.duel.phase === 'none';
  }

  legalMoves(): Move[] {
    if (this.result || this.duel.phase === 'selection') return [];
    return generateAllLegalMoves(this.position, this.legalOptions);
  }

  legalMovesFrom(from: number): Move[] {
    return this.legalMoves().filter((m) => m.from === from);
  }

  findMove(from: number, to: number): Move | undefined {
    return this.legalMoves().find((m) => m.from === from && m.to === to);
  }

  makeMove(fromOrMove: number | Move, to?: number): boolean {
    if (this.result || this.duel.phase === 'selection') return false;
    const move =
      typeof fromOrMove === 'number'
        ? this.findMove(fromOrMove, to ?? -1)
        : fromOrMove;
    if (!move) return false;
    if (!isLegalMove(this.position, move, this.legalOptions)) return false;

    this.snapshots.push(this.captureSnapshot());
    if (this.snapshots.length > 400) this.snapshots.shift();

    const mover = this.position.turn;
    const notation = notationForMove(this.position, move);
    const beforeThreats = new Set(threatenedEnemyIds(this.position, mover));
    applyMove(this.position, move);

    const check = isInCheck(this.position, opposite(mover));
    const afterThreats = threatenedEnemyIds(this.position, mover);
    // A "chase" is a threat newly created by this move, not a static attack
    // that existed before the move (otherwise any untouched pawn attack would
    // make every shuffle look like perpetual chasing).
    const threatenedIds = afterThreats.filter((id) => !beforeThreats.has(id));
    this.moveRecords.push({ move, mover, notation, check, threatenedIds });
    this.lastMove = move;

    const progressed =
      !!move.captured ||
      !!move.promotion ||
      isPawnLike(move.piece) ||
      typeOf(move.piece) === PieceType.Pawn;
    this.pliesSinceProgress = progressed ? 0 : this.pliesSinceProgress + 1;

    const key = this.position.key();
    this.positionHistory.push(key);
    this.positionCounts.set(key, (this.positionCounts.get(key) ?? 0) + 1);

    this.afterMove(mover, key);
    this.emit();
    return true;
  }

  private afterMove(mover: Color, key: string): void {
    if (this.checkTerminal(mover)) return;

    const repetition = this.handleRepetition(key);
    if (repetition === 'ended' || this.result) return;
    if (repetition === 'started') return;

    if (this.duel.phase === 'countdown') {
      if (this.duel.count > 0 && allSuperPiecesCaptured(this.position)) {
        this.startSelection('superpieces');
        return;
      }
      this.duel.countdown -= 1;
      if (this.duel.countdown <= 0) {
        this.startSelection(this.duel.reason ?? 'pieces');
      }
      return;
    }

    if (this.duel.phase === 'restriction') {
      this.duel.restrictionPlies -= 1;
      if (this.duel.restrictionPlies <= 0) {
        this.duel.phase = 'none';
        this.duel.newlyTransformedIds = [];
        this.duel.reason = null;
        const lastKey = this.positionHistory[this.positionHistory.length - 1];
        const pending = this.handleRepetition(lastKey);
        if (pending === 'ended' || pending === 'started') return;
        this.checkTriggers();
      }
      return;
    }

    if (this.duel.phase === 'none') {
      this.checkTriggers();
    }
  }

  private checkTerminal(mover: Color): boolean {
    const opponent = opposite(mover);
    if (countNonKing(this.position, opponent) === 0) {
      this.setResult(mover, 'singleKing', `${sideName(opponent)}只剩单王/单霸，判负`);
      return true;
    }
    if (countNonKing(this.position, mover) === 0) {
      this.setResult(opponent, 'singleKing', `${sideName(mover)}只剩单王/单霸，判负`);
      return true;
    }
    if (isCheckmate(this.position, opponent)) {
      this.setResult(mover, 'checkmate', `${sideName(opponent)}被将死`);
      return true;
    }
    if (isStalemate(this.position, opponent)) {
      this.setResult(mover, 'stalemate', `${sideName(opponent)}无子可走，困毙判负`);
      return true;
    }
    // During the restriction round, normal legal moves may all be removed by
    // "new piece may not deliver mate". In that case the side to move has no
    // legal move under the active rules and loses by stalemate-like logic.
    if (this.duel.phase === 'restriction') {
      const restricted = generateAllLegalMoves(this.position, this.legalOptions);
      if (!restricted.length) {
        this.setResult(
          opponent,
          'duelMate',
          `${sideName(opponent)}在限制回合无合法着法`,
        );
        return true;
      }
    }
    return false;
  }

  private setResult(winner: Color, reason: GameResult['reason'], message: string): void {
    this.result = {
      winner,
      loser: opposite(winner),
      reason,
      message,
    };
    this.duel.phase = 'none';
    this.duel.countdown = 0;
  }

  private checkTriggers(): void {
    if (this.result || this.duel.phase !== 'none') return;

    // After the first duel, the ONLY way to trigger another one is the
    // complete extinction of all 虎/坦/龙/仙. The old ≤5-piece, repetition
    // and no-progress loops must not re-open the selection phase.
    if (this.duel.count > 0) {
      if (allSuperPiecesCaptured(this.position)) {
        this.startSelection('superpieces');
      }
      return;
    }

    if (
      countPieces(this.position, RED) <= 5 &&
      countPieces(this.position, BLACK) <= 5
    ) {
      this.startCountdown('pieces');
      return;
    }

    if (this.pliesSinceProgress >= 120) {
      this.pliesSinceProgress = 0;
      this.startCountdown('noProgress');
    }
  }

  private startCountdown(reason: DuelReason): void {
    if (this.result || this.duel.phase !== 'none') return;
    this.duel.phase = 'countdown';
    this.duel.reason = reason;
    this.duel.countdown = 3;
    this.duel.firstSelector = null;
    this.duel.secondSelector = null;
    this.duel.firstChoices = null;
    this.duel.secondChoices = null;
    this.duel.restrictionPlies = 0;
    this.duel.newlyTransformedIds = [];
    this.duel.lastTransformed = [];
  }

  startSelection(reason: DuelReason): void {
    if (this.result || this.duel.phase === 'selection') return;
    this.duel.phase = 'selection';
    this.duel.count += 1;
    this.duel.reason = reason;
    this.duel.countdown = 0;
    this.duel.firstSelector = this.position.turn;
    this.duel.secondSelector = opposite(this.position.turn);
    this.duel.firstChoices = null;
    this.duel.secondChoices = null;
    this.duel.restrictionPlies = 0;
    this.duel.newlyTransformedIds = [];
    this.duel.lastTransformed = [];
    this.pliesSinceProgress = 0;
    this.emit();
  }

  startDuelByAgreement(): boolean {
    if (!this.canOfferDuel()) return false;
    this.startSelection('agreement');
    return true;
  }

  getSelectionCandidates(color: Color): {
    square: number;
    piece: number;
    targets: Array<PieceType.Tiger | PieceType.Dragon>;
  }[] {
    return piecesOf(this.position, color)
      .filter(({ piece }) => typeOf(piece) !== PieceType.King)
      .map(({ sq, piece }) => {
        const current = typeOf(piece);
        const targets: Array<PieceType.Tiger | PieceType.Dragon> = [];
        if (current !== PieceType.Tiger) targets.push(PieceType.Tiger);
        if (current !== PieceType.Dragon) targets.push(PieceType.Dragon);
        return { square: sq, piece, targets };
      })
      .filter((c) => c.targets.length > 0);
  }

  selectTransformations(color: Color, choices: TransformChoice[]): void {
    if (this.result || this.duel.phase !== 'selection') {
      throw new Error('当前不在生死斗选子阶段');
    }
    if (color === this.duel.secondSelector && !this.duel.firstChoices) {
      throw new Error('必须先由先选方完成选择');
    }
    if (color === this.duel.firstSelector && this.duel.firstChoices) {
      throw new Error('先选方已经完成选择');
    }
    if (color === this.duel.secondSelector && this.duel.secondChoices) {
      throw new Error('后选方已经完成选择');
    }
    this.validateChoices(color, choices);

    if (color === this.duel.firstSelector) {
      // A transformation is not a move; it must not leave the side that is
      // not to move in check (which would make the position illegal).
      const test = this.position.clone();
      for (const choice of choices) {
        test.board[choice.square] =
          color === RED ? choice.target : -choice.target;
      }
      if (isInCheck(test, opposite(color))) {
        throw new Error('升变不能使尚未行棋的一方处于将军状态');
      }
      this.duel.firstChoices = choices.map((c) => ({ ...c }));
      this.emit();
      return;
    }
    if (color === this.duel.secondSelector) {
      this.duel.secondChoices = choices.map((c) => ({ ...c }));
      this.completeSelection();
      this.emit();
      return;
    }
    throw new Error('当前不是选子方');
  }

  private validateChoices(color: Color, choices: TransformChoice[]): void {
    if (choices.length > 2) throw new Error('最多只能选择两个棋子升变');
    const seen = new Set<number>();
    for (const choice of choices) {
      if (seen.has(choice.square)) throw new Error('不能重复选择同一个棋子');
      seen.add(choice.square);
      const piece = this.position.board[choice.square];
      if (!piece || Math.sign(piece) !== color) {
        throw new Error('只能选择自己的棋子');
      }
      if (typeOf(piece) === PieceType.King) throw new Error('霸/王不能升变');
      const current = typeOf(piece);
      if (current === choice.target) throw new Error('该棋子已经是目标类型');
      if (choice.target !== PieceType.Tiger && choice.target !== PieceType.Dragon) {
        throw new Error('升变目标只能是虎/坦或龙/仙');
      }
    }
  }

  private completeSelection(): void {
    const first = this.duel.firstChoices ?? [];
    const second = this.duel.secondChoices ?? [];
    const firstSelector = this.duel.firstSelector;
    const secondSelector = this.duel.secondSelector;
    if (!firstSelector || !secondSelector) return;

    const newly: number[] = [];
    const last: { color: Color; choices: TransformChoice[] }[] = [];

    for (const [color, choices] of [
      [firstSelector, first],
      [secondSelector, second],
    ] as Array<[Color, TransformChoice[]]>) {
      for (const choice of choices) {
        const piece = this.position.board[choice.square];
        if (!piece || Math.sign(piece) !== color) continue;
        this.position.board[choice.square] = color === RED ? choice.target : -choice.target;
        newly.push(this.position.ids[choice.square]);
      }
      last.push({ color, choices: choices.map((c) => ({ ...c })) });
    }

    this.duel.newlyTransformedIds = newly;
    this.duel.lastTransformed = last;
    this.duel.restrictionPlies = 2;
    this.duel.phase = 'restriction';
    this.pliesSinceProgress = 0;

    // Literal rule: if the transformation itself checkmates the side to move,
    // the transforming side wins immediately.
    const toMove = this.position.turn;
    if (countNonKing(this.position, toMove) === 0) {
      this.setResult(opposite(toMove), 'singleKing', `${sideName(toMove)}只剩单王/单霸，判负`);
      return;
    }
    if (isCheckmate(this.position, toMove)) {
      this.setResult(opposite(toMove), 'duelMate', `${sideName(toMove)}在升变后即被将死`);
      return;
    }
    if (isStalemate(this.position, toMove)) {
      this.setResult(opposite(toMove), 'duelMate', `${sideName(toMove)}在升变后无子可走`);
      return;
    }
    // Restriction can remove all otherwise-legal moves; make that a loss now
    // instead of leaving the game with no legal move and no result.
    this.checkTerminal(opposite(toMove));
  }

  resign(color: Color): void {
    if (this.result) return;
    this.setResult(opposite(color), 'resign', `${sideName(color)}认输`);
    this.emit();
  }

  canUndo(): boolean {
    return this.snapshots.length > 0 && this.duel.phase !== 'selection';
  }

  undo(): boolean {
    if (!this.canUndo()) return false;
    const snapshot = removeLast(this.snapshots);
    if (!snapshot) return false;
    this.restoreSnapshot(snapshot);
    this.result = null;
    this.emit();
    return true;
  }

  private captureSnapshot(): GameSnapshot {
    return {
      board: new Int8Array(this.position.board),
      ids: new Int16Array(this.position.ids),
      turn: this.position.turn,
      swapLocked: this.position.swapLocked,
      duel: cloneDuel(this.duel),
      result: this.result,
      moveRecords: this.moveRecords.slice(),
      positionHistory: this.positionHistory.slice(),
      pliesSinceProgress: this.pliesSinceProgress,
    };
  }

  private restoreSnapshot(snapshot: GameSnapshot): void {
    this.position.board.set(snapshot.board);
    this.position.ids.set(snapshot.ids);
    this.position.turn = snapshot.turn;
    this.position.swapLocked = snapshot.swapLocked;
    this.duel = cloneDuel(snapshot.duel);
    this.result = snapshot.result;
    this.moveRecords = snapshot.moveRecords.slice();
    this.positionHistory = snapshot.positionHistory.slice();
    this.pliesSinceProgress = snapshot.pliesSinceProgress;
    this.positionCounts = new Map();
    for (const key of this.positionHistory) {
      this.positionCounts.set(key, (this.positionCounts.get(key) ?? 0) + 1);
    }
    this.lastMove = this.moveRecords.length
      ? this.moveRecords[this.moveRecords.length - 1].move
      : null;
  }

  private handleRepetition(key: string): 'none' | 'started' | 'ended' {
    const count = this.positionCounts.get(key) ?? 0;
    if (count !== 3) return 'none';

    const indices: number[] = [];
    for (let i = 0; i < this.positionHistory.length; i++) {
      if (this.positionHistory[i] === key) indices.push(i);
    }
    if (indices.length < 3) return 'none';
    const start = indices[indices.length - 3];
    const end = indices[indices.length - 1];
    const cycle = this.moveRecords.slice(start, end);
    if (!cycle.length) return 'none';

    const offenders: { color: Color; check: boolean }[] = [];
    for (const color of [RED, BLACK] as Color[]) {
      const sideMoves = cycle.filter((m) => m.mover === color);
      if (!sideMoves.length) continue;
      const allCheck = sideMoves.every((m) => m.check);
      if (allCheck) {
        offenders.push({ color, check: true });
        continue;
      }
      let intersection: Set<number> | null = null;
      for (const record of sideMoves) {
        const ids = new Set(record.threatenedIds);
        if (intersection === null) intersection = ids;
        else {
          for (const id of [...intersection]) {
            if (!ids.has(id)) intersection.delete(id);
          }
        }
      }
      if (intersection && intersection.size > 0) {
        offenders.push({ color, check: false });
      }
    }

    if (offenders.length) {
      let offender = offenders[0];
      if (offenders.length > 1) {
        const firstMover = cycle[0].mover;
        offender = offenders.find((o) => o.color === firstMover) ?? offender;
      }
      const winner = opposite(offender.color);
      const reason = offender.check ? 'perpetualCheck' : 'perpetualChase';
      this.setResult(
        winner,
        reason,
        `${sideName(offender.color)}${offender.check ? '长将' : '长捉'}，判负`,
      );
      return 'ended';
    }

    if (this.duel.phase === 'none') {
      // A repetition after the first duel does not re-trigger. If all
      // superpieces are gone, checkTriggers() handles the immediate duel.
      if (this.duel.count > 0) return 'none';
      this.startCountdown('repetition');
      return 'started';
    }
    return 'none';
  }

  /** Debug/testing helper. */
  kingSquare(color: Color): number {
    return findKing(this.position, color);
  }
}
