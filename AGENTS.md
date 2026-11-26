# AGENTS.md
本项目使用 devflow 工作流。开工前依次阅读：docs/TASKS.md 顶部 → docs/SPEC.md（索引）→ docs/specs/ 里相关 feature → 需要时看 docs/DECISIONS.md。

## 规则
- 文档写 what/why，代码体现 how。文档与代码冲突时先问；无答复则以代码为准，标 ⚠️ 待确认 并记入 DECISIONS。
- 用户改需求时先改 DECISIONS/SPEC/TASKS 并确认，再改代码。
- 每条 F-xx-ACn 都要有测试，测试名含编号；修 bug 先写回归测试。
- 私人数据只放 .env / config.local.*，代码中标 PRIVATE:，登记在 docs/PRIVACY.md。
- 测试全过后可自动 commit；push 前必须问。

## 本项目的额外规则
- **编号**：测试名带 `F-xx-ACn`，注释写 F-xx / F-xx-ACn。代码里已经没有旧设计文档的 `§n` / `Pn`（2026-11-23 换完，D-020）；research 等旧材料里遇到时，在 docs/SPEC.md 的对照表里查。
- **谁跑测试**：`npm test`（L1/L2）、`npm run typecheck`，以及正在改的 bug / feature 相关的 L4（单个 spec 文件或 `-g` 选出的用例）由 AI 自己跑；`npm run test:all`、完整的 `npm run test:e2e` 这种从头到尾走一遍的只由用户跑，AI 把要跑的命令和看什么交代清楚。（D-016、D-021）
- **开发和测试时视频一律静音**：在浏览器层面静音（e2e 的 `--mute-audio`；手动给标签页静音），不改播放器自己的音量。（D-017）
- **贴合官网**：能从 YouTube 拿到的（账号、播放列表、语言等）直接用，不另存、不让用户再设；界面和交互仿官网。成功的标准是用户察觉不到这是非官方功能（VISION）。（D-003）
- **AI 只走 Gemini 网页版**，不内置本地模型，不分析画面。（D-005）
- **本仓库是公开的**：文档、代码、测试数据、截图里不放密钥、邮箱、自己账号里的对话或列表 ID、日志里看过的视频 ID、账号头像和名字，不提交抓来的评论原文。例外：用户自己挑选的 README 截图（D-034）。push 前检查这次要推的改动里有没有这些。（D-032）
- L4 只碰名字以 `YouTube+ e2e` 开头的播放列表。
- L4 失败自动重试一次，重试才过的是 flaky：不算失败，但记进 TASKS，反复出现就修测试；测试账号上 YouTube 行为和官网不同时跳过那一步并注明（D-022）。

## 常用命令
- 安装：`npm install`（会顺带给 WXT 打补丁并生成类型，见 scripts/patch-wxt.mjs）
- 运行：`npm run dev`（开发构建，自动重载）；`npm run build` → `.output/chrome-mv3`，在 chrome://extensions 里「加载已解压的扩展程序」
- 测试：`npm test`（Vitest，L1 纯函数 + L2 controller 集成）；`npm run typecheck`
- L4：先 `npm run e2e:login` 登录（用户做）；AI 跑单个 spec：`npx wxt build && npx playwright test -c tests/e2e/playwright.config.ts specs/<文件>.spec.ts --project=e2e`；全跑 `npm run test:e2e` / `npm run test:all` 由用户跑；`npm run e2e:cleanup` 清测试列表
- 图标：`npm run icons`（从 docs/icon-drafts/ 重新生成）
