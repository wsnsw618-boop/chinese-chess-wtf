import { Position } from '../game/board';
import { Game, cloneDuel } from '../game/state';
import {
  Color,
  Difficulty,
  DuelState,
  GameEvent,
  GameMode,
  GameResult,
  Move,
  PieceType,
  TransformChoice,
  coord,
  makePiece,
  pieceName,
  sideName,
} from '../game/types';
import featuredJson from '../data/featuredRecords.json';

const STORAGE_KEY = 'wtf-chess-saved-games-v1';
const SEED_KEY = 'wtf-chess-featured-seeded-v5';

export interface SavedGameRecord {
  id: string;
  name: string;
  createdAt: string;
  mode: GameMode;
  difficulty: Difficulty;
  humanColor: Color;
  result: GameResult;
  plies: number;
  events: GameEvent[];
  featured?: boolean;
  order?: number;
}

export type ReplayFrameKind = 'start' | 'move' | 'selection';

export interface ReplayFrame {
  position: Position;
  duel: DuelState;
  result: GameResult | null;
  lastMove: Move | null;
  label: string;
  detail: string;
  kind: ReplayFrameKind;
}

export const FEATURED_RECORDS = featuredJson as unknown as SavedGameRecord[];

export const RECORD_BUNDLE_FORMAT = 'wtf-chess-records';
export const RECORD_BUNDLE_VERSION = 1;

export interface RecordBundle {
  format: typeof RECORD_BUNDLE_FORMAT;
  version: typeof RECORD_BUNDLE_VERSION;
  exportedAt: string;
  records: SavedGameRecord[];
}

export function buildRecordBundle(records: SavedGameRecord[]): string {
  const bundle: RecordBundle = {
    format: RECORD_BUNDLE_FORMAT,
    version: RECORD_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    records,
  };
  return JSON.stringify(bundle, null, 2);
}

const VALID_REASONS = new Set([
  'checkmate',
  'stalemate',
  'singleKing',
  'perpetualCheck',
  'perpetualChase',
  'resign',
  'duelMate',
  'noMoves',
]);

function fail(index: number, message: string): never {
  throw new Error(`第 ${index + 1} 份棋谱：${message}`);
}

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function validateRecordShape(raw: unknown, index: number): SavedGameRecord {
  if (!raw || typeof raw !== 'object') fail(index, '不是对象');
  const record = raw as Partial<SavedGameRecord>;
  if (typeof record.id !== 'string' || !record.id) fail(index, '缺少 id');
  if (typeof record.name !== 'string' || !record.name.trim()) fail(index, '缺少名称');
  if (record.name.length > 200) fail(index, '名称过长');
  if (typeof record.createdAt !== 'string') fail(index, '缺少导出时间');
  if (record.mode !== 'pvp' && record.mode !== 'ai') fail(index, 'mode 必须是 pvp/ai');
  if (!['easy', 'normal', 'hard', 'expert'].includes(String(record.difficulty))) {
    fail(index, 'difficulty 不合法');
  }
  if (record.humanColor !== 1 && record.humanColor !== -1) fail(index, 'humanColor 不合法');
  if (!record.result || typeof record.result !== 'object') fail(index, '缺少结果');
  const result = record.result;
  if (result.winner !== 1 && result.winner !== -1) fail(index, 'result.winner 不合法');
  if (result.loser !== -result.winner) fail(index, 'result.loser 与 winner 不匹配');
  if (!VALID_REASONS.has(String(result.reason))) fail(index, 'result.reason 不合法');
  if (typeof result.message !== 'string') fail(index, 'result.message 不合法');
  if (!isInt(record.plies, 0, 5000)) fail(index, 'plies 不合法');
  if (!Array.isArray(record.events) || record.events.length > 5000) fail(index, 'events 不合法');

  let moveCount = 0;
  record.events.forEach((event, eventIndex) => {
    if (!event || typeof event !== 'object') fail(index, `第 ${eventIndex + 1} 个事件不是对象`);
    if (event.type === 'move') {
      const move = (event as { move?: any }).move;
      if (!move || typeof move !== 'object') fail(index, `第 ${eventIndex + 1} 个事件缺少 move`);
      if (!isInt(move.from, 0, 89) || !isInt(move.to, 0, 89)) {
        fail(index, `第 ${eventIndex + 1} 个事件的坐标不合法`);
      }
      if (!['normal', 'eatSlave', 'swapGuard'].includes(String(move.kind))) {
        fail(index, `第 ${eventIndex + 1} 个事件的 kind 不合法`);
      }
      if (!isInt(move.piece, -9, 9) || move.piece === 0) {
        fail(index, `第 ${eventIndex + 1} 个事件的棋子不合法`);
      }
      if (event.mover !== 1 && event.mover !== -1) {
        fail(index, `第 ${eventIndex + 1} 个事件的 mover 不合法`);
      }
      if (typeof event.notation !== 'string') {
        fail(index, `第 ${eventIndex + 1} 个事件缺少 notation`);
      }
      if (move.promotion !== undefined && !isInt(move.promotion, 1, 9)) {
        fail(index, `第 ${eventIndex + 1} 个事件的升变不合法`);
      }
      moveCount += 1;
    } else if (event.type === 'selection') {
      if (event.color !== 1 && event.color !== -1) {
        fail(index, `第 ${eventIndex + 1} 个选子事件的颜色不合法`);
      }
      if (!Array.isArray(event.choices) || event.choices.length > 2) {
        fail(index, `第 ${eventIndex + 1} 个选子事件不合法`);
      }
      for (const choice of event.choices) {
        if (!choice || !isInt(choice.square, 0, 89)) {
          fail(index, `第 ${eventIndex + 1} 个选子事件的坐标不合法`);
        }
        if (choice.target !== PieceType.Tiger && choice.target !== PieceType.Dragon) {
          fail(index, `第 ${eventIndex + 1} 个选子事件的目标不合法`);
        }
      }
    } else {
      fail(index, `第 ${eventIndex + 1} 个事件类型不合法`);
    }
  });

  if (moveCount !== record.plies) {
    fail(index, `plies=${record.plies}，但实际有 ${moveCount} 个走子事件`);
  }

  const typed = raw as SavedGameRecord;
  let frames: ReplayFrame[];
  try {
    frames = buildReplayFrames(typed);
  } catch (error) {
    fail(index, `无法回放：${error instanceof Error ? error.message : String(error)}`);
  }
  const final = frames[frames.length - 1]?.result;
  if (result.reason !== 'resign') {
    if (!final) fail(index, '回放没有产生与记录一致的结果');
    if (final.winner !== result.winner || final.reason !== result.reason) {
      fail(index, `回放结果 ${final.reason}/${final.winner} 与记录 ${result.reason}/${result.winner} 不一致`);
    }
  }
  return typed;
}

/** Parse and fully validate an exported/imported record bundle. */
export function parseRecordBundle(text: string): SavedGameRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是合法 JSON');
  }
  const bundle =
    Array.isArray(parsed)
      ? { format: RECORD_BUNDLE_FORMAT, version: RECORD_BUNDLE_VERSION, records: parsed }
      : (parsed as Partial<RecordBundle>);
  if (!bundle || typeof bundle !== 'object') throw new Error('文件内容不是棋谱包');
  if (bundle.format !== RECORD_BUNDLE_FORMAT) throw new Error('不是本游戏的棋谱文件（format 不匹配）');
  if (bundle.version !== RECORD_BUNDLE_VERSION) {
    throw new Error(`不支持的棋谱格式版本：${String(bundle.version)}`);
  }
  if (!Array.isArray(bundle.records) || bundle.records.length === 0) {
    throw new Error('棋谱包里没有棋谱');
  }
  if (bundle.records.length > 2000) throw new Error('棋谱包过大（最多 2000 份）');
  const ids = new Set<string>();
  return bundle.records.map((raw, index) => {
    const record = validateRecordShape(raw, index);
    if (ids.has(record.id)) fail(index, `id 重复：${record.id}`);
    ids.add(record.id);
    return record;
  });
}

function isRecord(value: unknown): value is SavedGameRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<SavedGameRecord>;
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.createdAt === 'string' &&
    !!record.result &&
    Array.isArray(record.events)
  );
}

export function loadSavedRecords(): SavedGameRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

export function persistSavedRecords(records: SavedGameRecord[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

function mergeFeatured(records: SavedGameRecord[]): SavedGameRecord[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  let changed = false;
  for (const featured of FEATURED_RECORDS) {
    if (byId.has(featured.id)) continue;
    byId.set(featured.id, JSON.parse(JSON.stringify(featured)) as SavedGameRecord);
    changed = true;
  }
  return changed ? [...byId.values()] : records;
}

function pruneFeatured(records: SavedGameRecord[]): SavedGameRecord[] {
  const currentIds = new Set(FEATURED_RECORDS.map((record) => record.id));
  return records.filter((record) => !record.featured || currentIds.has(record.id));
}

/** First launch: add the 10 built-in teaching records once. */
export function seedFeaturedRecords(records: SavedGameRecord[]): {
  records: SavedGameRecord[];
  changed: boolean;
} {
  const pruned = pruneFeatured(records);
  try {
    if (localStorage.getItem(SEED_KEY) === '1') {
      return { records: pruned, changed: pruned !== records };
    }
    const merged = mergeFeatured(pruned);
    localStorage.setItem(SEED_KEY, '1');
    return { records: merged, changed: merged !== records };
  } catch {
    // Private mode / file:// may block localStorage: still expose the built-in
    // records for this session.
    const merged = mergeFeatured(pruned);
    return { records: merged, changed: merged !== records };
  }
}

/** Explicit user action: restore any deleted built-in records. */
export function restoreFeaturedRecords(records: SavedGameRecord[]): {
  records: SavedGameRecord[];
  changed: boolean;
} {
  const pruned = pruneFeatured(records);
  const merged = mergeFeatured(pruned);
  return { records: merged, changed: merged !== records };
}

export function makeRecordId(): string {
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultRecordName(
  mode: GameMode,
  difficulty: Difficulty,
  result: GameResult,
  date = new Date(),
): string {
  const modeLabel = mode === 'ai' ? `人机·${difficultyLabel(difficulty)}` : '双人';
  const side = sideName(result.winner);
  const stamp = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
  return `${modeLabel} · ${side}胜 · ${stamp}`;
}

export function difficultyLabel(difficulty: Difficulty): string {
  return difficulty === 'easy'
    ? '简单'
    : difficulty === 'hard'
      ? '困难'
      : difficulty === 'expert'
        ? '专家'
        : '普通';
}

function targetLabel(choice: TransformChoice, color: Color): string {
  return pieceName(makePiece(color, choice.target));
}

function selectionText(
  game: Game,
  color: Color,
  choices: TransformChoice[],
): string {
  if (!choices.length) return '不升变';
  return choices
    .map((choice) => {
      const piece = game.position.board[choice.square];
      return `${piece ? pieceName(piece) : '棋子'} ${coord(choice.square)}→${targetLabel(choice, color)}`;
    })
    .join('、');
}

function frameOf(
  game: Game,
  label: string,
  detail: string,
  kind: ReplayFrameKind,
): ReplayFrame {
  return {
    position: game.position.clone(),
    duel: cloneDuel(game.duel),
    result: game.result ? { ...game.result } : null,
    lastMove: game.lastMove ? { ...game.lastMove } : null,
    label,
    detail,
    kind,
  };
}

/**
 * Replay a record from the standard initial position. Selection events are
 * exposed as their own steps so the viewer can see the transformation moment.
 */
export function buildReplayFrames(record: SavedGameRecord): ReplayFrame[] {
  const game = new Game();
  const frames: ReplayFrame[] = [
    frameOf(game, '开局', '红方先行 · 点“下一步”开始', 'start'),
  ];

  for (const event of record.events) {
    if (event.type === 'selection') {
      if (game.duel.phase !== 'selection') {
        throw new Error('棋谱与当前规则不一致：选子事件不在选子阶段');
      }
      const text = selectionText(game, event.color, event.choices);
      game.selectTransformations(event.color, event.choices);
      frames.push(
        frameOf(
          game,
          '生死斗选子',
          `${sideName(event.color)}：${text}`,
          'selection',
        ),
      );
      continue;
    }

    const applied = game.makeMove(event.move);
    if (!applied) {
      const fallback = game
        .legalMoves()
        .find(
          (move) =>
            move.from === event.move.from && move.to === event.move.to,
        );
      if (!fallback || !game.makeMove(fallback)) {
        throw new Error(
          `棋谱第 ${frames.length} 步无法回放：${event.notation}`,
        );
      }
    }
    frames.push(
      frameOf(game, event.notation, `${sideName(event.mover)}行棋`, 'move'),
    );
  }

  return frames;
}
