# PRIVACY（公开前脱敏用）

本项目目前没有 `.env` / `config.local.*`：扩展不用密钥，账号都借用浏览器里已登录的 Google 账号（D-002）。代码里没有硬编码的密钥、邮箱或频道 ID（2026-11-22 迁移时 grep 过）。

## 仓库里的
| 数据 | 存放位置 | 配置项 | 代码中使用处 |
|---|---|---|---|
| 测试用的 Gemini 对话 ID（用户自己账号里的对话） | docs/research/2026-11-22-评论弹幕实测.md | — | 无（只在文档里）；公开前删掉 |
| 实测拉下来的 YouTube 公开评论（含评论者 @handle） | scripts/danmaku/data/ | — | 无；公开评论，但公开仓库前考虑删掉或去掉 handle |

## 仓库外的
| 数据 | 存放位置 | 配置项 | 代码中使用处 |
|---|---|---|---|
| e2e 用的 Google 账号登录态（Chromium profile） | `~/.cache/ytpp-e2e-profile` | 环境变量 `YTPP_E2E_PROFILE` | tests/e2e/support/env.ts、tests/e2e/tools/login.mjs、scripts/thumbs/ |

## 扩展运行时碰到的用户数据（不进仓库，上架时要在隐私说明里写）
- 读 `SAPISID` cookie，用来给 Gemini 请求签名；不存、不记日志。
- 身份（频道）和按频道的队列设置存在 `chrome.storage.sync`。
- 日志、TL;DR 缓存、弹幕缓存存在本地 `chrome.storage`，永不上传，日志不记 cookie 和认证头（F-01-AC4）。
