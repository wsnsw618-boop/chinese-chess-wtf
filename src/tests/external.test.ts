import { describe, expect, it } from 'vitest';
import { runExternalBatch } from '../external/control';
import { buildReplayFrames, parseRecordBundle } from '../ui/records';

describe('external AI batch control', () => {
  it('generates an importable bundle with replayed results', () => {
    const result = runExternalBatch({
      games: 1,
      seed: 12345,
      red: 'greedy',
      black: 'greedy',
      maxPlies: 600,
      openingBook: true,
    });
    expect(result.records).toHaveLength(1);
    expect(result.bundle).toContain('wtf-chess-records');
    const parsed = parseRecordBundle(result.bundle);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].mode).toBe('ai');
    expect(parsed[0].result.reason).toBeTruthy();
    expect(buildReplayFrames(parsed[0]).length).toBe(parsed[0].events.length + 1);
  }, 30_000);
});
