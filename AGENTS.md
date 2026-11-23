# AGENTS.md
本项目使用 devflow 工作流。开工前依次阅读：docs/TASKS.md 顶部 → docs/SPEC.md（索引）→ docs/specs/ 里相关 feature → 需要时看 docs/DECISIONS.md。

## 规则
- 文档写 what/why，代码体现 how。文档与代码冲突时先问；无答复则以代码为准，标 ⚠️ 待确认 并记入 DECISIONS。
- 用户改需求时先改 DECISIONS/SPEC/TASKS 并确认，再改代码。
- 每条 F-xx-ACn 都要有测试，测试名含编号；修 bug 先写回归测试。
- 私人数据只放 .env / config.local.*，代码中标 PRIVATE:，登记在 docs/PRIVACY.md。
- 测试全过后可自动 commit；push 前必须问。

## 本项目的额外规则
- **代码注释里的 `§n`**（如 `§24.4`）是旧设计文档的章节号，现在是 SPEC 的别名：在 docs/SPEC.md 的对照表里查它属于哪个 F-xx。新写的注释用 F-xx / F-xx-ACn。改到哪个 feature，就顺手把它的测试名补上 AC 编号、把它相关注释里的 `§n` 换掉，不单独开一轮做。（D-018、D-020）
- **谁跑测试**：`npm test`（L1/L2）和 `npm run typecheck` 由 AI 跑；`npm run test:e2e`、`npm run test:all`（L4，真实 YouTube、要登录）只由用户跑，AI 把要跑的命令和看什么交代清楚。（D-016）
- **开发和测试时视频一律静音**：在浏览器层面静音（e2e 的 `--mute-audio`；手动给标签页静音），不改播放器自己的音量。（D-017）
- **贴合官网**：能从 YouTube 拿到的（账号、播放列表、语言等）直接用，不另存、不让用户再设；界面和交互仿官网。成功的标准是用户察觉不到这是非官方功能（VISION）。（D-003）
- **AI 只走 Gemini 网页版**，不内置本地模型，不分析画面。（D-005）
- L4 只碰名字以 `YouTube+ e2e` 开头的播放列表。

## 常用命令
- 安装：`npm install`（会顺带给 WXT 打补丁并生成类型，见 scripts/patch-wxt.mjs）
- 运行：`npm run dev`（开发构建，自动重载）；`npm run build` → `.output/chrome-mv3`，在 chrome://extensions 里「加载已解压的扩展程序」
- 测试：`npm test`（Vitest，L1 纯函数 + L2 controller 集成）；`npm run typecheck`
- L4（用户跑）：先 `npm run e2e:login` 登录，再 `npm run test:e2e`；`npm run test:all` 全跑；`npm run e2e:cleanup` 清测试列表
- 图标：`npm run icons`（从 docs/icon-drafts/ 重新生成）
