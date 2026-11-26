# PRIVACY（仓库是公开的，D-032）

本项目目前没有 `.env` / `config.local.*`：扩展不用密钥，账号都借用浏览器里已登录的 Google 账号（D-002）。代码里没有硬编码的密钥、邮箱或频道 ID（2026-11-22 迁移时 grep 过，2026-11-26 公开前连历史一起扫过）。

不进仓库的东西：密钥、邮箱、自己账号里的对话或列表 ID、日志里看过的视频 ID、抓来的评论原文。2026-11-26 从当前文件里删掉的几项（Gemini 对话 ID、一个视频 ID、评论数据）在旧提交里仍然看得到，提交作者邮箱也保留，用户接受（D-032）。

## 仓库外的
| 数据 | 存放位置 | 配置项 | 代码中使用处 |
|---|---|---|---|
| e2e 用的 Google 账号登录态（Chromium profile） | `~/.cache/ytpp-e2e-profile` | 环境变量 `YTPP_E2E_PROFILE` | tests/e2e/support/env.ts、tests/e2e/tools/login.mjs |
| Gemini 实测对话 | 用户自己的 Gemini 账号 | — | 无 |
| 实测拉下来的评论（本地副本） | `scripts/danmaku/data/`（已 gitignore） | — | `scripts/danmaku/` 里的脚本读写 |

## 扩展运行时碰到的用户数据（不进仓库，上架时要在隐私说明里写）
- 读 `SAPISID` cookie，用来给 Gemini 请求签名；不存、不记日志。
- 身份（频道）和按频道的队列设置存在 `chrome.storage.sync`。
- 日志、TL;DR 缓存、弹幕缓存存在本地 `chrome.storage`，永不上传，日志不记 cookie 和认证头（F-01-AC4）。
