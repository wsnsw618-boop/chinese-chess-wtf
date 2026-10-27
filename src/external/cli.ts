import fs from 'node:fs';
import path from 'node:path';
import { runExternalBatch, type ExternalBatchConfig } from './control';

function usage(): string {
  return `中国象棋WTF版 · External AI batch

Usage:
  npm run ai:batch -- --config <batch.json> [--out <dir>]

Config example:
{
  "games": 20,
  "seed": 20261026,
  "red": "expert",
  "black": "expert",
  "maxPlies": 600,
  "openingBook": true
}

Output:
  <out>/records.json   importable in 棋谱观赏 → 导入棋谱
  <out>/games.jsonl    raw GameRecord JSONL
  <out>/summary.json   basic result summary
`;
}

function parseArgs(argv: string[]): { config?: string; out: string } {
  let config: string | undefined;
  let out = 'sim/results/external-batch';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--config') {
      config = argv[++i];
      continue;
    }
    if (arg === '--out') {
      out = argv[++i] ?? out;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  if (!config) throw new Error('Missing --config');
  return { config, out };
}

const args = parseArgs(process.argv.slice(2));
const configPath = path.resolve(args.config!);
const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) as ExternalBatchConfig;
if (!Number.isFinite(rawConfig.games) || rawConfig.games < 1) {
  throw new Error('config.games must be a positive integer');
}

const outDir = path.resolve(args.out);
fs.mkdirSync(outDir, { recursive: true });
const started = Date.now();
const result = runExternalBatch(rawConfig);
fs.writeFileSync(path.join(outDir, 'records.json'), result.bundle, 'utf8');
fs.writeFileSync(
  path.join(outDir, 'games.jsonl'),
  result.raw.map((record) => JSON.stringify(record)).join('\n') + '\n',
  'utf8',
);

const redWins = result.records.filter((record) => record.result.winner === 1).length;
const blackWins = result.records.length - redWins;
const summary = {
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - started,
  games: result.records.length,
  red: result.config.red,
  black: result.config.black,
  redWins,
  blackWins,
  avgPlies:
    result.records.reduce((sum, record) => sum + record.plies, 0) /
    Math.max(1, result.records.length),
  records: result.records.map((record) => ({
    id: record.id,
    name: record.name,
    plies: record.plies,
    result: record.result,
  })),
};
fs.writeFileSync(
  path.join(outDir, 'summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
  'utf8',
);

console.log(`External batch finished in ${(summary.durationMs / 1000).toFixed(1)}s`);
console.log(`  records: ${path.join(outDir, 'records.json')}`);
console.log(`  raw:     ${path.join(outDir, 'games.jsonl')}`);
console.log(`  summary: ${path.join(outDir, 'summary.json')}`);
console.log(`  result:  red ${redWins} / black ${blackWins}, avg ${summary.avgPlies.toFixed(1)} plies`);
