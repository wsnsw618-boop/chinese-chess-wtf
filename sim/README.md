# Simulation lab

无界面自对弈工具，用于批量测试规则平衡、开局多样性、节奏和异常。

## 快速运行

```powershell
npm run simulate -- --games 200 --red search:2:60 --black search:2:60 --seed 20261025 --out sim/results/pilot-001 --report reports/pilot-001.md
```

或：

```powershell
npm run simulate:pilot
```

## Agent

| 写法 | 说明 |
|---|---|
| `random` | 随机合法着法 |
| `greedy` | 一层静态评估 |
| `search:2` | 固定最大深度 2 |
| `search:2:60` | 深度 2，60cp 内随机选择 |
| `search:3:20` | 深度 3，20cp 内随机选择 |

批量实验优先使用固定深度，避免纯时间限制导致结果不可复现。

## 输出

```text
sim/results/<run>/
  config.json
  games.jsonl
  summary.json
reports/<run>.md
```

- `games.jsonl`：每局完整走法、评估、生死斗选择、错误信息；
- `summary.json`：聚合指标；
- `reports/*.md`：可读报告。

`sim/results/` 不提交；有价值的报告放在 `reports/` 并提交。

## 注意

- AI 自对弈不能直接证明“人类觉得好玩”；
- 200 局 pilot 只用于发现明显异常；
- 正式平衡结论至少需要 2000+ 局、多档 agent 和人类试玩。
