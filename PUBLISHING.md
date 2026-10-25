# 发布到 GitHub

这份清单用于把本地仓库发布为公开的 GitHub 项目。发布前请先把 `<GITHUB_USERNAME>` 替换成你的 GitHub 用户名。

## 1. 发布前检查

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

如果要发布离线包和 PDF：

```powershell
npm run package
```

生成物在 `dist/` 和项目根目录。`dist/` 已被 `.gitignore` 忽略，不作为源码提交；用 GitHub Pages 或 Release 附件分发。

确认不要提交：

- `node_modules/`
- `dist/`
- 日志、临时文件、`.env`
- 任何 token、密码或私人路径

## 2. 配置 Git

如果系统还没有 Git，可以安装 Git for Windows，或使用 GitHub Desktop。当前项目已经可以用 `git --version` 检查。

```powershell
git config --global user.name "剧毒术士（离谱暗封剑）"
git config --global user.email "你的 GitHub noreply 邮箱"
git config --global init.defaultBranch main
git config --global core.quotepath false
```

> 第一次提交如果使用临时邮箱，可以在推送前用 `git commit --amend --reset-author` 改成你的 GitHub 邮箱。

## 3. 创建 GitHub 仓库

在 GitHub 上新建一个 **Public** 仓库，例如：

```text
chinese-chess-wtf
```

不要勾选自动生成 README、LICENSE 或 .gitignore，因为本地已经有这些文件。

## 4. 推送

在项目根目录执行：

```powershell
git remote add origin https://github.com/<GITHUB_USERNAME>/chinese-chess-wtf.git
git branch -M main
git push -u origin main
```

如果是第一次向 GitHub 推送，Git 会要求登录；可以使用 Git Credential Manager、GitHub CLI 或 Personal Access Token。

## 5. 仓库设置

- Description：`中国象棋WTF版：狼/勇、虎/坦、生死斗、三档 AI 的奇幻象棋变体`
- Topics：`xiangqi`、`chinese-chess`、`game`、`typescript`、`vite`、`web-game`、`variant`
- 开启 Issues；可选开启 Discussions。
- Security → 开启 Private vulnerability reporting。
- Actions → 允许 GitHub Actions 运行。

## 6. 开启 GitHub Pages

仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。

`.github/workflows/deploy-pages.yml` 会在每次推送到 `main` 时：

1. `npm ci`
2. `npm run build`
3. 把 `dist/` 上传为 Pages artifact
4. 部署到 `https://<GITHUB_USERNAME>.github.io/chinese-chess-wtf/`

第一次部署完成后，在 README 顶部加上在线试玩链接。

## 7. 发布 Release

```powershell
git tag -a v1.2.2 -m "中国象棋WTF版 v1.2.2"
git push origin v1.2.2
```

在 GitHub 的 Releases 页面创建 `v1.2.2`，附加：

- `dist/game.html`
- `dist/中国象棋WTF版.html`
- `中国象棋WTF版-规则说明书.pdf`
- `release/Chinese-Chess-WTF-v1.2.2-Windows.zip`（如果生成了分享包）
- 可选：`启动游戏.bat`

这些文件适合不想安装 Node.js 的玩家。

## 8. 发布后

- 把 README 里的在线试玩、CI badge、仓库链接补齐。
- 确认 LICENSE、CONTRIBUTING、CODE_OF_CONDUCT、SECURITY 在仓库根目录可见。
- 如需自定义域名，在 Pages 设置中配置，并添加 `CNAME`。
- 如果发现有人违反 MIT 以外的品牌使用规则，先沟通；商标问题不属于 MIT 授权范围。

## 9. 版本发布流程

1. 更新 `CHANGELOG.md`。
2. 更新 `package.json` 的版本号。
3. 运行 `npm ci && npm test && npm run build`。
4. 运行 `npm run package` 生成离线包和 PDF。
5. 提交、打 tag、推送。
6. 创建 Release 并上传附件。
