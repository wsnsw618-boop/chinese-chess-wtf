# 安全政策

## 支持范围

当前维护的是 `main` 分支和最新的 1.x 版本。

## 报告安全问题

请优先使用 GitHub 仓库的 **Private vulnerability reporting**（Security → Report a vulnerability）私下报告。

如果该功能不可用，请先通过维护者的 GitHub 主页联系维护者，不要在公开 Issue 中发布可直接利用的细节。

报告时请尽量包含：

- 受影响的版本/提交；
- 浏览器与操作系统；
- 复现步骤；
- 影响说明；
- 如有可能，提供最小复现或 PoC。

## 项目安全边界

本项目是**纯静态前端游戏**：

- 没有后端、账号系统、数据库或支付；
- 不收集遥测，不上传对局数据；
- 仅在浏览器 `localStorage` 中保存音效和棋盘坐标等本地设置；
- AI 在 Web Worker 中运行，单文件构建会内联 Worker；
- 没有运行时第三方网络请求。

因此主要风险面是浏览器端的 XSS、拒绝服务、恶意构造的本地存档/URL，以及构建依赖供应链。请不要在 Issue 中粘贴真实 token、密码或私人路径。

## 依赖

依赖均为开发依赖，详见 `package.json` 和 `THIRD_PARTY_NOTICES.md`。建议通过 Dependabot 或 `npm audit` 关注上游安全公告。
