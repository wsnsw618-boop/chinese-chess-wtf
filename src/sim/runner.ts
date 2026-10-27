import { Game } from '../game/state';
import { evaluate } from '../ai/evaluate';
import {
  Color,
  Move,
  PieceType,
  RED,
  coord,
  pieceName,
  typeName,
  TransformChoice,
} from '../game/types';
import { createAgent, targetLabel } from './agents';
import { mulberry32, pickOne, shuffle, type Rng } from './rng';
import type {
  DuelTriggerLog,
  GameRecord,
  MoveLog,
  SelectionLog,
  SelectionMode,
  Side,
} from './types';

function sideOf(color: Color): Side {
  return color === RED ? 'red' : 'black';
}

/**
 * Reasonable first moves for both sides, used only to diversify the opening of
 * the hard-AI training corpus. All moves after the first two plies use the
 * strict hard agent. Duplicates are intentional weights.
 */
const RED_OPENING_BOOK: readonly string[] = [
  'b3->g3',
  'b3->g3',
  'b3->g3',
  'h3->h5',
  'h3->h5',
  'h3->h5',
  'g1->i3',
  'g1->i3',
  'i1->i3',
  'i1->i3',
  'a1->a2',
  'a1->a2',
  'b1->c3',
  'b1->c3',
  'h1->g3',
  'h1->g3',
  'e4->e5',
  'e4->e5',
  'a4->a5',
  'g4->g5',
  'c4->c5',
  'i4->i5',
  'b3->d3',
  'b3->b4',
  'h3->g3',
  'h3->i3',
  'h3->h4',
  'c1->a3',
  'c1->e3',
  'i1->h2',
  'a1->a3',
];

const BLACK_OPENING_BOOK: readonly string[] = [
  'b8->b6',
  'b8->b6',
  'h8->h9',
  'h8->h9',
  'b10->c8',
  'b10->c8',
  'h10->g8',
  'h10->g8',
  'i10->i8',
  'i10->i8',
  'a10->a8',
  'a10->a8',
  'e7->e6',
  'e7->e6',
  'a7->a6',
  'c7->c6',
  'g7->g6',
  'i7->i6',
  'c10->d9',
  'g10->h9',
  'b8->b1',
  'h8->h1',
  'b10->d9',
  'h10->f9',
  'a10->b9',
  'i10->h9',
];

function pickOpeningBookMove(legal: Move[], color: Color, rng: Rng): Move | null {
  const book = color === RED ? RED_OPENING_BOOK : BLACK_OPENING_BOOK;
  const byKey = new Map(legal.map((move) => [`${coord(move.from)}->${coord(move.to)}`, move]));
  const candidates = book.map((key) => byKey.get(key)).filter((move): move is Move => !!move);
  return candidates.length ? pickOne(rng, candidates) : null;
}

function forcedSelection(
  game: Game,
  selector: Color,
  mode: SelectionMode,
  rng: Rng,
): TransformChoice[] {
  if (mode === 'natural') return [];
  const candidates = game.getSelectionCandidates(selector);
  if (!candidates.length) return [];
  if (mode === 'random') {
    const count = Math.min(2, Math.floor(rng() * (Math.min(2, candidates.length) + 1)));
    return shuffle(rng, candidates)
      .slice(0, count)
      .map(({ square, targets }) => ({
        square,
        target: targets[Math.floor(rng() * targets.length)],
      }));
  }
  const target = mode === 'tiger' ? PieceType.Tiger : PieceType.Dragon;
  return shuffle(
    rng,
    candidates.filter((candidate) => candidate.targets.includes(target)),
  )
    .slice(0, 2)
    .map(({ square }) => ({ square, target }));
}

function describeMove(mover: Color, move: Move, ply: number, legalMoves: number, phase: string): MoveLog {
  return {
    ply,
    notation: '',
    from: coord(move.from),
    to: coord(move.to),
    piece: pieceName(move.piece),
    captured: move.captured ? pieceName(move.captured) : undefined,
    promotion: move.promotion ? typeName(mover, move.promotion) : undefined,
    check: false,
    legalMoves,
    phase,
    evalRed: 0,
  };
}

/**
 * Plays one deterministic self-play game. The runner owns duel selection,
 * countdown and restriction handling, so no UI is needed.
 */
export function playGame(
  redLabel: string,
  blackLabel: string,
  redSpec: ReturnType<typeof createAgent>['spec'],
  blackSpec: ReturnType<typeof createAgent>['spec'],
  seed: number,
  gameIndex: number,
  selectionRed: SelectionMode,
  selectionBlack: SelectionMode,
  maxPlies: number,
  openingPlies = 0,
  openingMargin = 20,
  openingBook = false,
): GameRecord {
  const game = new Game();
  const red = createAgent(redSpec);
  const black = createAgent(blackSpec);
  // Opening diversity: use a near-best search profile for the first few plies,
  // then switch to the exact main agents. This keeps the middlegame at full
  // strength while avoiding 200 identical deterministic games.
  const redOpening =
    openingPlies > 0 ? createAgent({ ...redSpec, randomize: openingMargin }) : null;
  const blackOpening =
    openingPlies > 0 ? createAgent({ ...blackSpec, randomize: openingMargin }) : null;
  const rng = mulberry32((seed + gameIndex * 0x9e3779b9) >>> 0);
  const started = performance.now();
  const moves: MoveLog[] = [];
  const selections: SelectionLog[] = [];
  const triggers: DuelTriggerLog[] = [];
  let lastDuelCount = 0;
  let ply = 0;
  let error: string | undefined;

  let captures = 0;
  let selfCaptures = 0;
  let checks = 0;
  let promotions = 0;
  let firstCapturePly: number | null = null;
  let firstCheckPly: number | null = null;
  let firstPromotionPly: number | null = null;
  const pieceUsage: Record<string, number> = {};

  while (!game.result && ply < maxPlies) {
    if (game.duel.phase === 'selection' && game.duel.count > lastDuelCount) {
      lastDuelCount = game.duel.count;
      triggers.push({
        duelIndex: game.duel.count,
        reason: game.duel.reason ?? 'unknown',
        firstSelector: sideOf(game.duel.firstSelector ?? game.position.turn),
        ply,
      });
    }

    if (game.duel.phase === 'selection') {
      const duel = game.duel;
      const selector =
        duel.firstChoices === null ? duel.firstSelector : duel.secondSelector;
      if (!selector) {
        error = 'selection phase without selector';
        break;
      }
      const first = selector === duel.firstSelector;
      const agent = selector === RED ? red : black;
      const selectionMode = selector === RED ? selectionRed : selectionBlack;
      const opponentChoices = first ? undefined : (duel.firstChoices ?? []);
      const opponentColor = first ? undefined : (duel.firstSelector ?? undefined);
      let proposed: TransformChoice[] = [];
      try {
        proposed =
          selectionMode === 'natural'
            ? agent.chooseTransformations(
                game.position.clone(),
                selector,
                opponentChoices,
                opponentColor,
                { rng, ply },
              )
            : forcedSelection(game, selector, selectionMode, rng);
        const beforeChoices = proposed.map((choice) => ({
          square: choice.square,
          coordinate: coord(choice.square),
          piece: pieceName(game.position.board[choice.square]),
          target: targetLabel(choice.target, selector),
        }));
        game.selectTransformations(selector, proposed);
        selections.push({
          duelIndex: duel.count,
          selector: sideOf(selector),
          first,
          accepted: true,
          choices: beforeChoices,
        });
      } catch (err) {
        const selectionError = err instanceof Error ? err.message : String(err);
        try {
          game.selectTransformations(selector, []);
          selections.push({
            duelIndex: duel.count,
            selector: sideOf(selector),
            first,
            accepted: false,
            choices: [],
            error: selectionError,
          });
        } catch (fallbackError) {
          error =
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          break;
        }
      }
      continue;
    }

    const legal = game.legalMoves();
    if (!legal.length) {
      error = 'no legal moves but game has no result';
      break;
    }

    const phase = game.duel.phase;
    const mover = game.position.turn;
    const useOpening = openingPlies > 0 && ply < openingPlies;
    const bookMove = openingBook && ply < 2 ? pickOpeningBookMove(legal, mover, rng) : null;
    const agent =
      mover === RED
        ? useOpening && redOpening
          ? redOpening
          : red
        : useOpening && blackOpening
          ? blackOpening
          : black;
    const restriction =
      game.duel.phase === 'restriction'
        ? {
            forbidNewPieceMate: true,
            newlyTransformedIds: [...game.duel.newlyTransformedIds],
          }
        : undefined;
    let move: Move;
    try {
      move = bookMove ?? agent.chooseMove(game.position, legal, { rng, ply }, restriction);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      break;
    }

    const ok = game.makeMove(move);
    if (!ok) {
      error = `illegal move rejected: ${coord(move.from)}-${coord(move.to)}`;
      break;
    }

    const record = game.moveRecords[game.moveRecords.length - 1];
    const log = describeMove(mover, move, ply + 1, legal.length, phase);
    log.notation = record.notation;
    log.check = record.check;
    log.evalRed = evaluate(game.position);

    if (move.captured) {
      if (Math.sign(move.captured) === mover) selfCaptures += 1;
      else captures += 1;
      if (firstCapturePly === null) firstCapturePly = ply + 1;
    }
    if (record.check) {
      checks += 1;
      if (firstCheckPly === null) firstCheckPly = ply + 1;
    }
    if (move.promotion) {
      promotions += 1;
      if (firstPromotionPly === null) firstPromotionPly = ply + 1;
    }
    const used = pieceName(move.piece);
    pieceUsage[used] = (pieceUsage[used] ?? 0) + 1;

    moves.push(log);
    ply += 1;
  }

  if (!game.result && !error) {
    error = `max plies (${maxPlies}) reached`;
  }

  const evals = moves.map((move) => move.evalRed);
  let evalVolatility = 0;
  let maxEvalSwing = 0;
  let leadChanges = 0;
  let lastLead = 0;
  for (let i = 1; i < evals.length; i++) {
    const delta = Math.abs(evals[i] - evals[i - 1]);
    evalVolatility += delta;
    maxEvalSwing = Math.max(maxEvalSwing, delta);
    const lead = Math.abs(evals[i]) >= 100 ? Math.sign(evals[i]) : 0;
    if (lead !== 0 && lastLead !== 0 && lead !== lastLead) leadChanges += 1;
    if (lead !== 0) lastLead = lead;
  }
  evalVolatility = evals.length > 1 ? evalVolatility / (evals.length - 1) : 0;
  const finalEval = evaluate(game.position);

  return {
    id: `${seed}-${gameIndex}`,
    index: gameIndex,
    seed,
    red: redLabel,
    black: blackLabel,
    result: game.result
      ? {
          winner: sideOf(game.result.winner),
          reason: game.result.reason,
          message: game.result.message,
        }
      : null,
    plies: ply,
    durationMs: performance.now() - started,
    moves,
    selections,
    triggers,
    opening: moves.slice(0, 8).map((move) => move.notation),
    stats: {
      captures,
      selfCaptures,
      checks,
      promotions,
      firstCapturePly,
      firstCheckPly,
      firstPromotionPly,
      firstDuelPly: triggers[0]?.ply ?? null,
      uniquePositions: new Set(game.positionHistory).size,
      positionsTotal: game.positionHistory.length,
      branchingAverage:
        moves.length > 0
          ? moves.reduce((sum, move) => sum + move.legalMoves, 0) / moves.length
          : 0,
      evalVolatility,
      maxEvalSwing,
      leadChanges,
      finalEval,
      closeGame: Math.abs(finalEval) <= 300,
      pieceUsage,
    },
    error,
  };
}
