import fs from 'node:fs';
import path from 'node:path';
import { parseAgentSpec } from './agents';
import { summarize } from './metrics';
import { renderReport } from './report';
import { playGame } from './runner';
import type { GameRecord, RunConfig } from './types';

function usage(): string {
  return `中国象棋WTF版 batch simulator

Usage:
  npm run simulate -- [options]

Options:
  --games <n>        Number of games (default: 200)
  --seed <n>         Base random seed (default: 20261025)
  --red <agent>      red agent: random | greedy | search:2 | search:2:60
  --black <agent>    black agent (default: same as red)
  --max-plies <n>    Guard against unfinished games (default: 600)
  --out <dir>        Output directory (default: sim/results/pilot)
  --report <file>    Markdown report path (default: reports/pilot-latest.md)
  --from <file>      Rebuild summary/report from an existing games.jsonl
  --quiet            No per-game progress
  --help             Show this help
`;
}

interface Args {
  games: number;
  seed: number;
  maxPlies: number;
  red: string;
  black: string;
  outDir: string;
  reportPath: string;
  from?: string;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args | null {
  const args: Args = {
    games: 200,
    seed: 20261025,
    maxPlies: 600,
    red: 'search:2:60',
    black: 'search:2:60',
    outDir: 'sim/results/pilot',
    reportPath: 'reports/pilot-latest.md',
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--help' || key === '-h') return null;
    if (key === '--quiet') {
      args.quiet = true;
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    i += 1;
    switch (key) {
      case '--games':
        args.games = Number(value);
        break;
      case '--seed':
        args.seed = Number(value);
        break;
      case '--red':
        args.red = value;
        break;
      case '--black':
        args.black = value;
        break;
      case '--max-plies':
        args.maxPlies = Number(value);
        break;
      case '--out':
        args.outDir = value;
        break;
      case '--report':
        args.reportPath = value;
        break;
      case '--from':
        args.from = value;
        break;
      default:
        throw new Error(`Unknown option: ${key}`);
    }
  }
  if (!Number.isInteger(args.games) || args.games <= 0) throw new Error('--games must be a positive integer');
  if (!Number.isFinite(args.seed)) throw new Error('--seed must be a number');
  if (!Number.isInteger(args.maxPlies) || args.maxPlies <= 0) {
    throw new Error('--max-plies must be a positive integer');
  }
  return args;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}

function main(): void {
  let args: Args | null;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
    return;
  }
  if (!args) {
    console.log(usage());
    return;
  }

  if (args.from) {
    const from = path.resolve(args.from);
    const dir = path.dirname(from);
    const config = JSON.parse(
      fs.readFileSync(path.join(dir, 'config.json'), 'utf8'),
    ) as RunConfig;
    const records: GameRecord[] = fs
      .readFileSync(from, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as GameRecord);
    const summary = summarize(records, config);
    fs.writeFileSync(path.join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    const report = renderReport(summary);
    fs.writeFileSync(args.reportPath, report, 'utf8');
    console.log(`Rebuilt ${summary.total} records from ${from}`);
    console.log(`  summary: ${path.join(dir, 'summary.json')}`);
    console.log(`  report:  ${args.reportPath}`);
    return;
  }

  const red = parseAgentSpec(args.red);
  const black = args.black === args.red ? red : parseAgentSpec(args.black);
  const config: RunConfig = {
    games: args.games,
    seed: args.seed,
    maxPlies: args.maxPlies,
    red,
    black,
    outDir: args.outDir,
    reportPath: args.reportPath,
  };

  fs.mkdirSync(config.outDir, { recursive: true });
  fs.mkdirSync(path.dirname(config.reportPath), { recursive: true });
  fs.writeFileSync(
    path.join(config.outDir, 'config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(config.outDir, 'games.jsonl'), '', 'utf8');

  console.log(
    `Simulating ${config.games} games | red=${red.label} black=${black.label} seed=${config.seed}`,
  );
  const started = Date.now();
  const records: GameRecord[] = [];
  for (let index = 0; index < config.games; index++) {
    const record = playGame(
      red.label,
      black.label,
      red,
      black,
      config.seed,
      index,
      config.maxPlies,
    );
    records.push(record);
    fs.appendFileSync(
      path.join(config.outDir, 'games.jsonl'),
      `${JSON.stringify(record)}\n`,
      'utf8',
    );
    if (!args.quiet && (index < 5 || (index + 1) % 10 === 0 || index + 1 === config.games)) {
      const elapsed = Date.now() - started;
      const perGame = elapsed / (index + 1);
      const eta = perGame * (config.games - index - 1);
      console.log(
        `  ${String(index + 1).padStart(4)}/${config.games} | ${record.result?.winner ?? 'unfinished'} ${record.result?.reason ?? record.error ?? ''} | ${record.plies} plies | ETA ${fmtDuration(eta)}`,
      );
    }
  }

  const summary = summarize(records, config);
  const summaryPath = path.join(config.outDir, 'summary.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  const report = renderReport(summary);
  fs.writeFileSync(config.reportPath, report, 'utf8');

  console.log('');
  console.log(`Finished in ${fmtDuration(Date.now() - started)}`);
  console.log(`  games:  ${path.join(config.outDir, 'games.jsonl')}`);
  console.log(`  config: ${path.join(config.outDir, 'config.json')}`);
  console.log(`  summary:${summaryPath}`);
  console.log(`  report: ${config.reportPath}`);
  console.log(
    `  result:  red ${summary.result.redWins} / black ${summary.result.blackWins} | red rate ${(summary.result.redRate * 100).toFixed(1)}%`,
  );
  console.log(`  errors:  ${summary.errors.length}`);
}

main();
