# 贡献指南

感谢你愿意改进《中国象棋WTF版》。这是一个纯前端、可离线运行的中国象棋变体项目。

## 先讨论，再改代码

- **规则已冻结**：规则改动请先开 Issue 说明动机、边界情况和测试方案，不要直接改代码和规则书。
- Bug、兼容性、UI、AI、文档、性能优化可以直接开 Issue 或 PR。
- 涉及规则的行为变更，必须同时更新：
  - `src/game/` 的规则实现；
  - `src/tests/` 的测试；
  - `src/rulebook/rulebook.html`；
  - 必要时重新生成 PDF。

## 开发环境

- Node.js 20+（推荐 24，见 `.nvmrc`）
- npm
- Windows 启动器和 PDF 生成脚本目前优先支持 Windows + Edge/Chrome；macOS/Linux 可用 `npm run dev` 和 `npm run build`。

```powershell
npm ci
npm run dev
```

打开 `http://127.0.0.1:8000/`。

## 提交前检查

```powershell
npm run typecheck
npm test
npm run build
```

可选的浏览器冒烟测试：

```powershell
# 先在一个终端运行 npm run dev
npm run smoke
```

如果 Edge/Chrome 不在默认路径，设置：

```powershell
$env:EDGE_PATH = "C:\path\to\msedge.exe"
```

PDF 生成：

```powershell
npm run pdf
```

它需要 Edge/Chrome；也可以通过 `EDGE_PATH` 指定浏览器。

## PR 要求

- 一个 PR 只做一件事，说明“为什么”而不只是“改了什么”。
- 行为改动必须带测试；修 Bug 最好先写能复现的测试。
- UI 改动请附截图或短视频。
- 不要提交 `node_modules/`、`dist/`、日志或本地环境文件。
- 不要修改 `package-lock.json` 以外的锁文件；依赖变更请说明原因。
- 保持 TypeScript 严格模式通过，不引入不必要的运行时依赖。

## 代码风格

- TypeScript，2 空格缩进。
- 规则逻辑尽量放在 `src/game/`，AI 放在 `src/ai/`，DOM/Canvas 放在 `src/ui/`。
- 规则函数保持纯函数优先；状态变更集中在 `Game` 控制器。
- 新增规则必须考虑：将军、飞将、单王、困毙、生死斗、三次重复、长将/长捉。
- 不引入外部图片、字体或网络请求；单文件构建必须继续可用。

## 提交信息

建议使用清晰的祈使句，例如：

```text
fix: correct king swap cooldown after duel
feat: add board coordinate toggle
docs: clarify wolf river movement
```

## 贡献许可

本项目使用 **MIT License**。提交 PR 即表示你同意你的贡献以 MIT License 授权，并确认你有权提交该内容。

## 行为准则

参与本项目即表示同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
