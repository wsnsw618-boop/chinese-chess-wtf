# 第三方组件说明

本项目在构建和测试阶段使用以下开源工具。它们都是 **开发依赖**，不会作为独立运行时依赖随游戏发布；单文件构建中只包含本项目自己的代码。

| 组件 | 用途 | 许可证 |
|---|---|---|
| [Vite](https://vite.dev/) | 开发服务器与构建 | MIT |
| [Vitest](https://vitest.dev/) | 单元测试 | MIT |
| [vite-plugin-singlefile](https://github.com/richardtallent/vite-plugin-singlefile) | 单文件 HTML 构建 | MIT |
| [TypeScript](https://www.typescriptlang.org/) | 类型检查与编译 | Apache-2.0 |
| [playwright-core](https://playwright.dev/) | 浏览器 UI 冒烟测试 | Apache-2.0 |

完整依赖树和版本锁定见 `package-lock.json`。各依赖的完整许可证文本位于对应的 `node_modules/<package>/LICENSE*` 文件中。

游戏中的棋盘、棋子绘制、规则书、截图和 UI 均为本项目原创内容；没有引入第三方图片、字体或音频素材。
