import { describe, expect, it } from 'vitest';
import { Game } from '../game/state';
import { customPosition } from './helpers';
import {
  BLACK,
  PieceType,
  RED,
  parseCoord,
} from '../game/types';
import {
  FEATURED_RECORDS,
  buildRecordBundle,
  buildReplayFrames,
  parseRecordBundle,
  type SavedGameRecord,
} from '../ui/records';

describe('game archive events', () => {
  it('records moves and undo restores the event log', () => {
    const game = new Game();
    expect(game.makeMove(parseCoord('a1'), parseCoord('a2'))).toBe(true);
    expect(game.events).toHaveLength(1);
    expect(game.events[0].type).toBe('move');
    expect(game.undo()).toBe(true);
    expect(game.events).toHaveLength(0);
  });

  it('records both duel selection events', () => {
    const pos = customPosition([
      ['e1', RED, PieceType.King],
      ['e10', BLACK, PieceType.King],
      ['e5', RED, PieceType.Pawn],
      ['c5', RED, PieceType.Pawn],
      ['c6', BLACK, PieceType.Pawn],
    ]);
    const game = new Game();
    game.loadPosition(pos);
    expect(game.startDuelByAgreement()).toBe(true);
    game.selectTransformations(RED, [
      { square: parseCoord('c5'), target: PieceType.Tiger },
    ]);
    game.selectTransformations(BLACK, [
      { square: parseCoord('c6'), target: PieceType.Dragon },
    ]);
    expect(game.events).toHaveLength(2);
    expect(game.events[0].type).toBe('selection');
    expect(game.events[1].type).toBe('selection');
    expect(game.duel.phase).toBe('restriction');
  });

  it('builds replay frames for a simple saved game', () => {
    const game = new Game();
    expect(game.makeMove(parseCoord('a1'), parseCoord('a2'))).toBe(true);
    expect(game.makeMove(parseCoord('a10'), parseCoord('a9'))).toBe(true);
    const record: SavedGameRecord = {
      id: 'test',
      name: 'test',
      createdAt: new Date().toISOString(),
      mode: 'pvp',
      difficulty: 'normal',
      humanColor: RED,
      result: { winner: RED, loser: BLACK, reason: 'resign', message: 'test' },
      plies: game.moveRecords.length,
      events: game.events,
    };
    const frames = buildReplayFrames(record);
    expect(frames).toHaveLength(3);
    expect(frames[0].label).toBe('开局');
    expect(frames[1].label).toContain('虎');
    expect(frames[2].position.turn).toBe(RED);
  });

  it('replays all preloaded featured records to their recorded result', () => {
    for (const record of FEATURED_RECORDS) {
      const frames = buildReplayFrames(record);
      expect(frames.length).toBe(record.events.length + 1);
      expect(frames[frames.length - 1].result?.winner).toBe(record.result.winner);
      expect(frames[frames.length - 1].result?.reason).toBe(record.result.reason);
    }
    expect(FEATURED_RECORDS).toHaveLength(10);
    expect(new Set(FEATURED_RECORDS.map((record) => record.result.winner)).size).toBe(2);
  });

  it('round-trips an export bundle and rejects an invalid format', () => {
    const game = new Game();
    expect(game.makeMove(parseCoord('a1'), parseCoord('a2'))).toBe(true);
    const record: SavedGameRecord = {
      id: 'bundle-test',
      name: 'bundle-test',
      createdAt: new Date().toISOString(),
      mode: 'pvp',
      difficulty: 'normal',
      humanColor: RED,
      result: { winner: RED, loser: BLACK, reason: 'resign', message: 'test' },
      plies: 1,
      events: game.events,
    };
    const parsed = parseRecordBundle(buildRecordBundle([record]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('bundle-test');
    expect(buildReplayFrames(parsed[0])).toHaveLength(2);

    expect(() =>
      parseRecordBundle(JSON.stringify({ format: 'wrong', version: 1, records: [] })),
    ).toThrow(/format/);
    expect(() => parseRecordBundle('not json')).toThrow(/JSON/);
  });

  it('rejects a bundle whose recorded plies do not match its events', () => {
    const game = new Game();
    expect(game.makeMove(parseCoord('a1'), parseCoord('a2'))).toBe(true);
    const record: SavedGameRecord = {
      id: 'bad-bundle',
      name: 'bad',
      createdAt: new Date().toISOString(),
      mode: 'pvp',
      difficulty: 'normal',
      humanColor: RED,
      result: { winner: RED, loser: BLACK, reason: 'resign', message: 'test' },
      plies: 99,
      events: game.events,
    };
    expect(() => parseRecordBundle(buildRecordBundle([record]))).toThrow(/plies/);
  });
});
