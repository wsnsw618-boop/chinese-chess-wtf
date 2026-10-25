import type { GameRecord, RunConfig, Side } from './types';

export interface Interval {
  low: number;
  high: number;
}

export interface ChoiceStat {
  selected: number;
  selectorWins: number;
}

export interface RepeatSequenceStat {
  sample: number;
  unique: number;
  repeatRate: number;
  topShare: number;
  entropy: number;
  top: Array<[string, number]>;
}

export interface OpeningRepeatSummary {
  wins: number;
  firstMove: RepeatSequenceStat;
  first3Plies: RepeatSequenceStat;
  first5Plies: RepeatSequenceStat;
  redFirst3Moves: RepeatSequenceStat;
  redFirst5Moves: RepeatSequenceStat;
}

export interface Summary {
  config: {
    games: number;
    seed: number;
    maxPlies: number;
    red: string;
    black: string;
    selection: string;
    selectionRed: string;
    selectionBlack: string;
  };
  total: number;
  finished: number;
  unfinished: number;
  errors: string[];
  result: {
    redWins: number;
    blackWins: number;
    redRate: number;
    redInterval: Interval;
  };
  reasons: Record<string, number>;
  lengths: {
    mean: number;
    median: number;
    p10: number;
    p90: number;
    min: number;
    max: number;
  };
  averages: {
    captures: number;
    checks: number;
    promotions: number;
    selfCaptures: number;
    branching: number;
    uniquePositions: number;
  };
  firstEvents: {
    capture: number | null;
    check: number | null;
    promotion: number | null;
    duel: number | null;
  };
  duel: {
    games: number;
    rate: number;
    triggers: number;
    triggerReasons: Record<string, number>;
    firstSelectorWins: number;
    firstSelectorTotal: number;
    firstSelectorRate: number;
    firstSelectorInterval: Interval;
    selections: number;
    rejectedSelections: number;
    multiDuelGames: number;
    maxTriggersPerGame: number;
    triggersPerDuelGame: number;
  };
  transformations: {
    total: number;
    byTarget: Record<string, ChoiceStat>;
    byPiece: Record<string, ChoiceStat>;
    byColor: Record<string, number>;
  };
  diversity: {
    firstMoves: Record<string, number>;
    firstMoveEntropy: number;
    uniqueOpenings4: number;
    uniqueOpenings8: number;
    uniqueOpeningRate4: number;
    uniqueOpeningRate8: number;
    avgUniquePositions: number;
    avgPositionsTotal: number;
  };
  openingRepeat: OpeningRepeatSummary;
  dynamics: {
    evalVolatility: number;
    maxEvalSwing: number;
    closeGames: number;
    closeRate: number;
    leadChanges: number;
    snowballGames: number;
    snowballWins: number;
    snowballRate: number;
    comebackWins: number;
    comebackRate: number;
  };
}

export function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[index];
}

export function wilson(wins: number, total: number, z = 1.96): Interval {
  if (!total) return { low: 0, high: 0 };
  const p = wins / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

export function entropy(counts: Record<string, number>): number {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return 0;
  let value = 0;
  for (const count of Object.values(counts)) {
    if (!count) continue;
    const p = count / total;
    value -= p * Math.log2(p);
  }
  return value;
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function bumpChoice(
  map: Record<string, ChoiceStat>,
  key: string,
  selectorWon: boolean,
): void {
  const entry = (map[key] ??= { selected: 0, selectorWins: 0 });
  entry.selected += 1;
  if (selectorWon) entry.selectorWins += 1;
}

function averageNullable(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? mean(present) : null;
}

function repeatStat(sequences: string[]): RepeatSequenceStat {
  const counts: Record<string, number> = {};
  for (const sequence of sequences) {
    if (!sequence) continue;
    bump(counts, sequence);
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const sample = entries.reduce((sum, [, count]) => sum + count, 0);
  const unique = entries.length;
  return {
    sample,
    unique,
    repeatRate: sample ? 1 - unique / sample : 0,
    topShare: sample ? (entries[0]?.[1] ?? 0) / sample : 0,
    entropy: entropy(counts),
    top: entries.slice(0, 5),
  };
}

export function summarize(records: GameRecord[], config: RunConfig): Summary {
  const total = records.length;
  const finishedRecords = records.filter((record) => record.result);
  const redWins = finishedRecords.filter((record) => record.result?.winner === 'red').length;
  const blackWins = finishedRecords.filter((record) => record.result?.winner === 'black').length;
  const reasons: Record<string, number> = {};
  for (const record of records) {
    bump(reasons, record.result?.reason ?? 'unfinished');
  }

  const lengths = records.map((record) => record.plies);
  const firstMoves: Record<string, number> = {};
  const openings4 = new Set<string>();
  const openings8 = new Set<string>();
  const triggerReasons: Record<string, number> = {};
  const byTarget: Record<string, ChoiceStat> = {};
  const byPiece: Record<string, ChoiceStat> = {};
  const byColor: Record<string, number> = {};

  let firstSelectorTotal = 0;
  let firstSelectorWins = 0;
  let selections = 0;
  let rejectedSelections = 0;
  let duelGames = 0;
  let multiDuelGames = 0;
  let maxTriggersPerGame = 0;
  let triggers = 0;
  let closeGames = 0;
  let leadChanges = 0;
  let snowballGames = 0;
  let snowballWins = 0;
  let comebackWins = 0;
  let transformationTotal = 0;

  for (const record of records) {
    if (record.triggers.length) duelGames += 1;
    if (record.triggers.length > 1) multiDuelGames += 1;
    maxTriggersPerGame = Math.max(maxTriggersPerGame, record.triggers.length);
    triggers += record.triggers.length;
    if (record.result) {
      for (const trigger of record.triggers) bump(triggerReasons, trigger.reason);
      for (const trigger of record.triggers) {
        const firstSelection = record.selections.find(
          (selection) => selection.duelIndex === trigger.duelIndex && selection.first,
        );
        if (!firstSelection) continue;
        firstSelectorTotal += 1;
        if (record.result.winner === firstSelection.selector) firstSelectorWins += 1;
      }
    }

    for (const selection of record.selections) {
      selections += 1;
      if (!selection.accepted) rejectedSelections += 1;
      if (!selection.accepted) continue;
      const selectorWon = record.result?.winner === selection.selector;
      for (const choice of selection.choices) {
        transformationTotal += 1;
        bumpChoice(byTarget, choice.target, selectorWon);
        bumpChoice(byPiece, choice.piece, selectorWon);
        byColor[selection.selector] = (byColor[selection.selector] ?? 0) + 1;
      }
    }

    if (record.opening.length) {
      bump(firstMoves, record.opening[0]);
      openings4.add(record.opening.slice(0, 4).join(' '));
      openings8.add(record.opening.slice(0, 8).join(' '));
    }
    if (record.stats.closeGame) closeGames += 1;
    leadChanges += record.stats.leadChanges;

    const swings = record.moves;
    let firstLeadIndex = -1;
    for (let i = 0; i < swings.length; i++) {
      if (swings[i].ply >= 10 && Math.abs(swings[i].evalRed) >= 200) {
        firstLeadIndex = i;
        break;
      }
    }
    if (firstLeadIndex >= 0 && record.result) {
      snowballGames += 1;
      const leader: Side = swings[firstLeadIndex].evalRed > 0 ? 'red' : 'black';
      if (record.result.winner === leader) snowballWins += 1;
      else comebackWins += 1;
    }
  }

  const firstDuel = records
    .map((record) => record.stats.firstDuelPly)
    .filter((ply): ply is number => ply !== null);

  const redWinningRecords = finishedRecords.filter(
    (record) => record.result?.winner === 'red',
  );
  const redWinningMoveLists = redWinningRecords.map((record) =>
    record.moves.filter((_, index) => index % 2 === 0),
  );
  const openingRepeat: OpeningRepeatSummary = {
    wins: redWinningRecords.length,
    firstMove: repeatStat(
      redWinningRecords
        .map((record) => record.moves[0]?.notation ?? '')
        .filter((value): value is string => Boolean(value)),
    ),
    first3Plies: repeatStat(
      redWinningRecords
        .map((record) => record.moves.slice(0, 3).map((move) => move.notation).join(' '))
        .filter((value): value is string => Boolean(value)),
    ),
    first5Plies: repeatStat(
      redWinningRecords
        .map((record) => record.moves.slice(0, 5).map((move) => move.notation).join(' '))
        .filter((value): value is string => Boolean(value)),
    ),
    redFirst3Moves: repeatStat(
      redWinningMoveLists
        .map((moves) => moves.slice(0, 3).map((move) => move.notation).join(' '))
        .filter((value): value is string => Boolean(value)),
    ),
    redFirst5Moves: repeatStat(
      redWinningMoveLists
        .map((moves) => moves.slice(0, 5).map((move) => move.notation).join(' '))
        .filter((value): value is string => Boolean(value)),
    ),
  };

  const result: Summary = {
    config: {
      games: config.games,
      seed: config.seed,
      maxPlies: config.maxPlies,
      red: config.red.label,
      black: config.black.label,
      selection: config.selection ?? 'natural',
      selectionRed: config.selectionRed ?? config.selection ?? 'natural',
      selectionBlack: config.selectionBlack ?? config.selection ?? 'natural',
    },
    total,
    finished: finishedRecords.length,
    unfinished: total - finishedRecords.length,
    errors: records
      .filter((record) => record.error)
      .map((record) => `#${record.index}: ${record.error}`),
    result: {
      redWins,
      blackWins,
      redRate: finishedRecords.length ? redWins / finishedRecords.length : 0,
      redInterval: wilson(redWins, finishedRecords.length),
    },
    reasons,
    lengths: {
      mean: mean(lengths),
      median: quantile(lengths, 0.5),
      p10: quantile(lengths, 0.1),
      p90: quantile(lengths, 0.9),
      min: lengths.length ? Math.min(...lengths) : 0,
      max: lengths.length ? Math.max(...lengths) : 0,
    },
    averages: {
      captures: mean(records.map((record) => record.stats.captures)),
      checks: mean(records.map((record) => record.stats.checks)),
      promotions: mean(records.map((record) => record.stats.promotions)),
      selfCaptures: mean(records.map((record) => record.stats.selfCaptures)),
      branching: mean(records.map((record) => record.stats.branchingAverage)),
      uniquePositions: mean(records.map((record) => record.stats.uniquePositions)),
    },
    firstEvents: {
      capture: averageNullable(records.map((record) => record.stats.firstCapturePly)),
      check: averageNullable(records.map((record) => record.stats.firstCheckPly)),
      promotion: averageNullable(records.map((record) => record.stats.firstPromotionPly)),
      duel: averageNullable(firstDuel),
    },
    duel: {
      games: duelGames,
      rate: total ? duelGames / total : 0,
      triggers,
      triggerReasons,
      firstSelectorWins,
      firstSelectorTotal,
      firstSelectorRate: firstSelectorTotal ? firstSelectorWins / firstSelectorTotal : 0,
      firstSelectorInterval: wilson(firstSelectorWins, firstSelectorTotal),
      selections,
      rejectedSelections,
      multiDuelGames,
      maxTriggersPerGame,
      triggersPerDuelGame: duelGames ? triggers / duelGames : 0,
    },
    transformations: {
      total: transformationTotal,
      byTarget,
      byPiece,
      byColor,
    },
    diversity: {
      firstMoves,
      firstMoveEntropy: entropy(firstMoves),
      uniqueOpenings4: openings4.size,
      uniqueOpenings8: openings8.size,
      uniqueOpeningRate4: total ? openings4.size / total : 0,
      uniqueOpeningRate8: total ? openings8.size / total : 0,
      avgUniquePositions: mean(records.map((record) => record.stats.uniquePositions)),
      avgPositionsTotal: mean(records.map((record) => record.stats.positionsTotal)),
    },
    openingRepeat,
    dynamics: {
      evalVolatility: mean(records.map((record) => record.stats.evalVolatility)),
      maxEvalSwing: mean(records.map((record) => record.stats.maxEvalSwing)),
      closeGames,
      closeRate: total ? closeGames / total : 0,
      leadChanges: total ? leadChanges / total : 0,
      snowballGames,
      snowballWins,
      snowballRate: snowballGames ? snowballWins / snowballGames : 0,
      comebackWins,
      comebackRate: snowballGames ? comebackWins / snowballGames : 0,
    },
  };

  return result;
}
