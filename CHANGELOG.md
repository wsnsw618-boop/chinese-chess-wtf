# Changelog

本项目的重要变更记录在此。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/)。

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
