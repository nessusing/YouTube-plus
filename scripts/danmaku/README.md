# 评论弹幕实测脚本

评论弹幕（docs/specs/F-12-评论弹幕.md）实测用的脚本。都是匿名调 InnerTube，不需要登录，也不打开视频。Node 18 以上直接跑。

| 脚本 | 做什么 |
|---|---|
| `pull.mjs <videoId> <标题> <输出目录> [页数=10] [每批=100] <时长秒>` | 拉「热门」评论，去掉时间戳，生成给 Gemini 的 `prompt.txt` 和标准答案 `truth.json` |
| `score.mjs <目录>` | 把 Gemini 的回答（手动贴进 `<目录>/answer.txt`）和标准答案比，算误差 |
| `find.mjs <搜索词>...` | 搜视频，只留有中文字幕的，数前 300 条评论里带一个时间戳的有几条 |
| `caps.mjs <videoId>...` | 列出视频的字幕轨 |

流程：`pull.mjs` 生成 prompt → 贴进 gemini.google.com 新对话 → 回答贴进 `answer.txt` → `score.mjs`。

`data/` 里是 2026-11-22 那几次的输入和回答，结论见 docs/research/2026-11-22-评论弹幕实测.md 和 docs/specs/F-12-评论弹幕.md：

| 目录 | 视频 | prompt |
|---|---|---|
| `apollo-v1` | E7uGvsT_nnM（英文，13 分钟） | 第一版 |
| `apollo-v2` | 同上 | 第二版（定义置信度各档） |
| `gao` | wraBVnAfunc（中文，没有字幕轨） | 第二版 + 时长；回答是 `no_transcript` |
| `hetongxue` | -tHdM8dOeAc（中文，12 分钟） | 第二版 + 时长 |

注意：`pull.mjs` 现在生成的是「第二版 + 时长」的 prompt；`apollo-v1` 的 prompt 是当时的旧版。
