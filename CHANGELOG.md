# Changelog

本项目的重要变更记录在此。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/)。

## [1.2.3] - 2026-10-26

### Fixed

- **普通 AI 反而变笨**：根节点 `randomize` 会在 alpha-beta 的近似分数中挑到“看似接近、实际很差”的着法。v1.2.2 把余量从 20 降到 8 仍然会触发；v1.2.3 将普通档 `randomize` 设为 0，优先走搜索最佳着。
- 保留普通档 depth 5 / 1400ms 的搜索强度；简单档仍保留随机，困难档本来就不随机。

## [1.2.2] - 2026-10-26

### Changed

- **普通 AI 调强**：从 `maxDepth 4 / 1000ms / randomize 20` 调整为 `maxDepth 5 / 1400ms / randomize 8`，减少“突然走坏棋”的观感，同时保持与困难档的差距。
- 简单档、困难档不变；AI 说明和 README 的难度表同步。

## [1.2.1] - 2026-10-26

### Added

- 先攻（红方）获胜局的开局重复率指标：首步、前 3/5 半回合、红方前 3/5 手的唯一数、重复率、最高频占比、熵。
- `--selection` / `--red-selection` / `--black-selection`：natural / random / tiger / dragon 升变策略，用于实验 C。
- 1000 局 pilot-003、multi-agent screen、强制升变 A/B、第二轮汇总报告。

### Fixed

- 限制回合过滤掉所有合法着法时，不再出现“无合法着法但无结果”的挂起状态；现在立即按 `duelMate` 判负。
- Simulation 选子日志记录的是升变前的棋子，而不是升变后的目标。

## [1.2.0] - 2026-10-25

### Changed

- **生死斗重复触发规则**：第一次生死斗之后，只有双方虎/坦/龙/仙全部阵亡才能再次触发；双方≤5 子、三次重复、无进展都不再重复触发。第一次生死斗的触发方式不变。
- 规则说明书升级到 v1.1，并同步 PDF。

### Added

- 新规则 200 局 pilot：[reports/pilot-002.md](reports/pilot-002.md)。
- 旧规则 vs 新规则对照：[reports/comparison-001-002.md](reports/comparison-001-002.md)。
- 实验 A 结果与后续计划已更新到 [reports/next-experiments.md](reports/next-experiments.md)。

## [1.1.0] - 2026-10-25

### Added

- **棋盘直接选子 + 可最小化面板**：生死斗升变不再使用遮挡棋盘的全屏弹窗；玩家点击棋盘上的己方棋子，再在可收起面板中选择目标，棋子旁显示选中序号和目标标签。
- **Simulation lab**：`npm run simulate` / `npm run simulate:pilot`，支持 random / greedy / search agent、确定性 seed、JSONL 对局记录、生死斗自动处理和 Markdown 报告。
- 首份 200 局 AI pilot 报告：[reports/pilot-001.md](reports/pilot-001.md)。
- 下一轮实验设计：[reports/next-experiments.md](reports/next-experiments.md)。

### Changed

- 升变面板支持折叠/展开，移动端默认折叠；选子状态同步显示在棋盘标题和状态栏。
- `scripts/make-pdf.mjs` 与 `scripts/ui-smoke.mjs` 支持 `EDGE_PATH` 和 macOS/Linux 浏览器路径。

## [1.0.0] - 2026-10-25

### Added

- 中国象棋WTF版：9×10 棋盘、狼/勇、虎/坦、豹/骑、象/牛、奴/卫、妖/巫、霸/王、龙/仙。
- 双人对战与人机对战，人机支持执红/执黑和三档难度。
- 生死斗：≤5 子、三次重复、超级子全灭触发；3 步倒计时、选子、限制回合。
- 单王判负、将军/应将/飞将/困毙、长将/长捉、三次重复、120 半回合防僵死。
- Negamax + Alpha-Beta + 迭代加深 + 静态搜索 + Web Worker AI。
- Canvas 棋盘、合法落点提示、音效、悔棋、翻转棋盘、设置、规则书 iframe。
- 独立规则说明书 HTML、10 页 PDF、单文件离线构建。
- Vitest 单元测试和 Edge/Chrome UI 冒烟测试。
- 开源文档：MIT License、贡献指南、行为准则、安全政策、Issue/PR 模板、CI 和 GitHub Pages 部署配置。

### Changed

- 初始棋子由兵/卒改为狼/勇；过河前只向前一步，过河后获得 5 向，名称不变。
- 开发者署名为“剧毒术士（离谱暗封剑）”。
- 项目名由“中国象棋IMBA版”改为“中国象棋WTF版”。
