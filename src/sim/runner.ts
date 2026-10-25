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
import { createAgent, targetLabel, type AgentContext } from './agents';
import { mulberry32 } from './rng';
import type {
  DuelTriggerLog,
  GameRecord,
  MoveLog,
  SelectionLog,
  Side,
} from './types';

function sideOf(color: Color): Side {
  return color === RED ? 'red' : 'black';
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
  maxPlies: number,
): GameRecord {
  const game = new Game();
  const red = createAgent(redSpec);
  const black = createAgent(blackSpec);
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
      const opponentChoices = first ? undefined : (duel.firstChoices ?? []);
      const opponentColor = first ? undefined : (duel.firstSelector ?? undefined);
      let proposed: TransformChoice[] = [];
      try {
        proposed = agent.chooseTransformations(
          game.position.clone(),
          selector,
          opponentChoices,
          opponentColor,
          { rng, ply },
        );
        game.selectTransformations(selector, proposed);
        selections.push({
          duelIndex: duel.count,
          selector: sideOf(selector),
          first,
          accepted: true,
          choices: proposed.map((choice) => ({
            square: choice.square,
            coordinate: coord(choice.square),
            piece: pieceName(game.position.board[choice.square]),
            target: targetLabel(choice.target, selector),
          })),
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
    const agent = mover === RED ? red : black;
    const restriction =
      game.duel.phase === 'restriction'
        ? {
            forbidNewPieceMate: true,
            newlyTransformedIds: [...game.duel.newlyTransformedIds],
          }
        : undefined;
    let move: Move;
    try {
      move = agent.chooseMove(game.position, legal, { rng, ply }, restriction);
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
