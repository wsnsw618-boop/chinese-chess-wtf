# Simulation lab

无界面自对弈工具，用于批量测试规则平衡、开局多样性、节奏和异常。

## 快速运行

```powershell
npm run simulate -- --games 200 --red search:2:60 --black search:2:60 --seed 20261025 --out sim/results/pilot-002 --report reports/pilot-002.md
```

旧规则基线见 `reports/pilot-001.md`；新规则对照见 `reports/comparison-001-002.md`。

或：

```powershell
npm run simulate:pilot
```

## Agent

| 写法 | 说明 |
|---|---|
| `random` | 随机合法着法 |
| `greedy` | 一层静态评估 |
| `hard` | 游戏内困难档：深度 6、2400ms、无近似同分随机 |
| `expert` | 游戏内专家档：深度 7、6000ms、无近似同分随机、杀手着法排序 |
| `hard:20` | 困难档 + 20cp 近似同分随机，用于生成多样化的训练棋谱 |

### 开局多样化

批量生成困难档训练棋谱时，严格困难档是确定性的，容易产生完全相同的对局。可用：

```powershell
npm run simulate -- --games 200 --red hard --black hard --opening-book --out sim/results/hard-200 --report reports/hard-200.md
```

`--opening-book` 只让双方的第一手从一组经过筛选的合理着法中按种子选取（红方首着、黑方应着）；之后所有着法仍使用严格困难档。`--opening-random <n>` 会让前 n 个半回合使用近似同分随机，容易产生明显坏着，正式训练棋谱建议优先用 `--opening-book`。
| `search:2` | 固定最大深度 2 |
| `search:2:60` | 深度 2，60cp 内随机选择 |
| `search:3:20` | 深度 3，20cp 内随机选择 |

批量实验优先使用固定深度，避免纯时间限制导致结果不可复现。

## 升变选子策略

`--selection` 用于实验 C：

| 值 | 说明 |
|---|---|
| `natural` | 使用 agent 的自然选子（默认） |
| `random` | 随机 0–2 个棋子/目标 |
| `tiger` | 强制选车+斜一步（红虎/黑坦） |
| `dragon` | 强制选龙/仙 |

示例：

```powershell
npm run simulate -- --games 200 --red search:2:60 --black search:2:60 --selection tiger --out sim/results/selection-tiger --report reports/selection-tiger.md
```

强制选子仍会经过“第一选方不能将军未行棋方”的合法性检查；被拒绝的选择会记入 `rejectedSelections`。

非对称实验使用：

```powershell
npm run simulate -- --games 200 --red search:2:60 --black search:2:60 --red-selection tiger --black-selection dragon --out sim/results/selection-redtiger-blackdragon --report reports/selection-redtiger-blackdragon.md
```

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
