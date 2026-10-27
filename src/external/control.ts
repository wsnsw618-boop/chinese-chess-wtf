import { Game } from '../game/state';
import {
  BLACK,
  Color,
  Difficulty,
  GameResult,
  PieceType,
  RED,
  parseCoord,
  sideName,
  type TransformChoice,
} from '../game/types';
import { parseAgentSpec } from '../sim/agents';
import { playGame } from '../sim/runner';
import type { GameRecord, SelectionMode } from '../sim/types';
import {
  buildRecordBundle,
  type SavedGameRecord,
} from '../ui/records';

export interface ExternalBatchConfig {
  /** Number of games to generate. */
  games: number;
  seed?: number;
  maxPlies?: number;
  /** Agent spec understood by src/sim/agents: expert, hard, search:2:60, ... */
  red?: string;
  black?: string;
  redSelection?: SelectionMode;
  blackSelection?: SelectionMode;
  openingBook?: boolean;
  openingPlies?: number;
  openingMargin?: number;
}

export interface ExternalBatchResult {
  records: SavedGameRecord[];
  /** Importable JSON bundle for the in-game 棋谱观赏 feature. */
  bundle: string;
  raw: GameRecord[];
  config: Required<ExternalBatchConfig>;
}

function targetType(label: string): PieceType.Tiger | PieceType.Dragon {
  return label === '虎' || label === '坦' ? PieceType.Tiger : PieceType.Dragon;
}

function replayRecord(record: GameRecord): Game {
  const game = new Game();
  let selectionIndex = 0;
  const applySelections = () => {
    while (game.duel.phase === 'selection') {
      const selector =
        game.duel.firstChoices === null
          ? game.duel.firstSelector
          : game.duel.secondSelector;
      if (!selector) throw new Error('selection phase without selector');
      const selection = record.selections?.[selectionIndex++];
      if (!selection) throw new Error('missing selection log');
      const choices: TransformChoice[] = selection.accepted
        ? selection.choices.map((choice) => ({
            square: choice.square,
            target: targetType(choice.target),
          }))
        : [];
      game.selectTransformations(selector as Color, choices);
    }
  };
  for (const move of record.moves) {
    applySelections();
    const from = parseCoord(move.from);
    const to = parseCoord(move.to);
    if (!game.makeMove(from, to)) {
      const fallback = game
        .legalMoves()
        .find((candidate) => candidate.from === from && candidate.to === to);
      if (!fallback || !game.makeMove(fallback)) {
        throw new Error(`cannot replay ${move.ply} ${move.from}-${move.to}`);
      }
    }
  }
  applySelections();
  if (!game.result) throw new Error('replayed game has no result');
  return game;
}

function difficultyFromLabel(label: string): Difficulty {
  if (label.startsWith('expert')) return 'expert';
  if (label.startsWith('hard')) return 'hard';
  if (label.startsWith('easy')) return 'easy';
  return 'normal';
}

function toSavedRecord(
  record: GameRecord,
  index: number,
  seed: number,
  difficulty: Difficulty,
): SavedGameRecord {
  const game = replayRecord(record);
  const winner: Color = record.result?.winner === 'black' ? BLACK : RED;
  if (!record.result) throw new Error('game has no result');
  if (game.result?.winner !== winner) {
    throw new Error('replayed winner does not match record');
  }
  const result: GameResult = {
    winner,
    loser: winner === RED ? BLACK : RED,
    reason: record.result.reason as GameResult['reason'],
    message: record.result.message,
  };
  return {
    id: `external-${seed}-${index}`,
    name: `外部推演 ${String(index + 1).padStart(2, '0')} · ${sideName(winner)}胜 · ${record.plies} 手`,
    createdAt: new Date().toISOString(),
    mode: 'ai',
    difficulty,
    humanColor: RED,
    result,
    plies: record.plies,
    events: game.events,
    featured: false,
  };
}

/**
 * Convert a simulator GameRecord into an importable SavedGameRecord.
 * Used by the v1.5.1 recommended-opening selection.
 */
export function gameRecordToSavedRecord(
  record: GameRecord,
  index: number,
  seed: number,
  difficulty: Difficulty = 'hard',
): SavedGameRecord {
  return toSavedRecord(record, index, seed, difficulty);
}

/**
 * External control surface for batch generation.
 *
 * This is intentionally game-logic-only (no DOM/localStorage), so an external
 * Node process, scheduler or research script can call it directly and write the
 * importable bundle through the in-game 棋谱观赏 import feature.
 */
export function runExternalBatch(config: ExternalBatchConfig): ExternalBatchResult {
  const resolved: Required<ExternalBatchConfig> = {
    games: Math.max(1, Math.min(10_000, Math.floor(config.games))),
    seed: config.seed ?? 20261026,
    maxPlies: config.maxPlies ?? 600,
    red: config.red ?? 'expert',
    black: config.black ?? 'expert',
    redSelection: config.redSelection ?? 'natural',
    blackSelection: config.blackSelection ?? 'natural',
    openingBook: config.openingBook ?? false,
    openingPlies: config.openingPlies ?? 0,
    openingMargin: config.openingMargin ?? 20,
  };
  const redSpec = parseAgentSpec(resolved.red);
  const blackSpec = parseAgentSpec(resolved.black);
  const records: SavedGameRecord[] = [];
  const raw: GameRecord[] = [];
  for (let index = 0; index < resolved.games; index++) {
    const record = playGame(
      redSpec.label,
      blackSpec.label,
      redSpec,
      blackSpec,
      resolved.seed,
      index,
      resolved.redSelection,
      resolved.blackSelection,
      resolved.maxPlies,
      resolved.openingPlies,
      resolved.openingMargin,
      resolved.openingBook,
    );
    if (record.error || !record.result) {
      throw new Error(
        `第 ${index + 1} 局未正常结束：${record.error ?? '缺少结果'}`,
      );
    }
    raw.push(record);
    records.push(
      toSavedRecord(
        record,
        index,
        resolved.seed,
        difficultyFromLabel(redSpec.label),
      ),
    );
  }
  return { records, bundle: buildRecordBundle(records), raw, config: resolved };
}
