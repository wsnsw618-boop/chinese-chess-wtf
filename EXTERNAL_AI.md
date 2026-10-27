# 外部 AI 控制模块

本模块把「专家 AI」和棋谱生成逻辑暴露给外部脚本/调度器，用于批量推演、平衡实验和棋谱生产。它不依赖 DOM，可在 Node 中直接运行。

## 专家 AI

| 档位 | 搜索 | 时间 | 说明 |
|---|---|---|---|
| 困难 | 深度 6 | 2.4 秒 | 原困难档 |
| 专家 | 深度 7 | 6 秒 | 更深搜索 + 杀手着法排序 |

浏览器内选择 **人机对战 → 专家** 即可对战。专家档每步最多约 6 秒，适合复盘和推演，不适合快速对局。

## Node 模块 API

```ts
import { runExternalBatch } from './src/external/control';

const result = runExternalBatch({
  games: 20,
  seed: 20261026,
  red: 'expert',
  black: 'expert',
  maxPlies: 600,
  openingBook: true,
});

// result.records: SavedGameRecord[]，可直接被棋谱观赏导入
// result.bundle:  importable JSON string
// result.raw:     GameRecord[]（含逐步评估）
```

`red` / `black` 支持：

- `random`
- `greedy`
- `hard`
- `expert`
- `hard:20`（困难档 + 20cp 近似同分随机）
- `search:2:60`（固定深度 2，60cp 随机）

## CLI

```powershell
npm run ai:batch -- --config external-batch.example.json --out sim/results/external-batch
```

输出：

```text
sim/results/external-batch/
  records.json   # 棋谱观赏 → 导入棋谱 可直接使用
  games.jsonl    # 原始 GameRecord，含逐步评估
  summary.json   # 胜负、手数、每局结果
```

外部脚本也可以直接引用 `runExternalBatch`，自行决定如何持久化。

## 导入游戏

在游戏首页进入 **棋谱观赏 → 导入棋谱**，选择 `records.json`。

导入前会完整校验：

- 文件格式/版本；
- 每份棋谱的字段与事件结构；
- 完整回放是否能到达记录中的胜负结果；
- 走子数量与事件数量是否一致。

任何一步不合规则都会整体拒绝，并显示具体错误。

## 注意事项

- 专家档每步约 6 秒；生成 100 局、每局 80 手约需 13 小时（单进程）。批量推演建议多进程/多机分片，或先使用 `hard`/`search:3` 做筛选。
- `openingBook` 只影响前两手，用于避免困难档/专家档完全确定性的重复对局。
- 外部生成的 `records.json` 与游戏内导出格式一致，可互相导入导出。
