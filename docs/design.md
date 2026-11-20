# YouTube+ 设计文档

> 状态：三个功能都已实现（2026-11-18）；实测结果见 §17、§21、§38.1。队列在 2026-11-20 重新设计（第三部分），同日按新设计改完代码（含 §24.8 界面同步）。2026-11-20 手测：播放器和队列的控件都正常；TL;DR 待手测
> 日期：2026-11-14（同日加入队列功能和播放器功能）；2026-11-18 复查并加入存储用量管理
> 范围：个人自用的 Chrome 扩展（MV3），YouTube 工具合集

## 1. 概览

YouTube+ 是一个 YouTube 工具合集扩展。目前有三个功能：

- **TL;DR**（第二部分）：点缩略图上的图标，就能看到 Gemini 生成的视频要点，不用点开视频。
- **队列**（第三部分）：在 YouTube 自带的队列和一个播放列表之间二选一。选播放列表时，「加入队列」会变成「加入 <列表名>」，关掉标签页、换设备都还在，看完的自动删掉。另外给你自己的所有播放列表加上「清空全部」和「移除已看完」。
- **播放器**（第四部分）：迷你播放器补上音量和进度条，可以拖到任意位置并记住；观看页往下滚时播放器置顶；所有页面加一个「回到顶部」按钮。

还没开发、只有意向的：迷你播放器弹出到桌面、单个视频循环（§40）；列表面板里一键清空、多选后删除（§30）；评论弹幕（第五部分）。

几个功能共用的部分（原则、设置页、日志、自检）见第一部分。

**开发方式**（2026-11-18 定）：三个功能都实现，能做多少做多少。顺序：共用骨架 → 播放器（最独立）→ 队列 → TL;DR（依赖的 `StreamGenerate` 正在被下线，不确定性最大）。每个功能内部的顺序见各自的「开发顺序」一节。设计里没定下来、实测后才能定的细节，按本文档的原则和已有决定来定，并把结果补进文档。

编号说明：第二部分表格里的 Qn 是 TL;DR 讨论时的问题编号；第三部分的「队列 Qn」是队列讨论时的问题编号；第四部分的「播放器 Qn」是播放器讨论时的问题编号。三者互不相关。

---

# 第一部分　共用

## 2. 原则

- 自用：以未打包扩展的方式加载。代码按能上架 Chrome Web Store 的标准来写：有设置页、不硬编码任何凭据、权限最小化。
- 零成本：全部用浏览器里已登录的 Google 账号，不需要 OAuth、API key，也不用官方 YouTube Data API。
- 功能隔离：每个功能在设置页里**单独开关**；每个功能的 content script 和 service worker 模块各自独立，异常都在功能内部捕获并写进日志，一个功能出错不影响另一个。
- 技术栈：WXT + TypeScript，MV3；UI 用原生 DOM 加 Shadow DOM，不引入 React。

**扩展图标**（2026-11-19 换成 `docs/icon-drafts/d.svg`：上下边微拱的红色底座，里面一个 ▶ 加一个直角 `+`，所有尺寸都从这一张缩放；底座横向占满正方形、上下居中。没按 16 格对齐，16 px 下边缘会有点软）。旧定稿 a16 和其他草稿（A、B、C、C2）保留在 `docs/icon-drafts/` 里。注意：红色播放键的外形取自 YouTube 商标，只能自用；上架 Chrome 应用商店前必须改掉。TL;DR 缩略图上的小图标另外设计（§14.1）。

## 3. 设置页

一个 options 页，样式照着 YouTube 自己的设置页：顶部左上角是 logo，左侧边栏是标签，内容区每页先是标签名、大标题和一句说明，下面是用分隔线隔开的分组，分组里是「左标签列 + 右内容列」的行。开关用 YouTube 的滑动开关，单选用 YouTube 的圆形单选，按钮是药丸形描边按钮。跟随系统深浅色；窄屏时侧边栏变成顶部一排标签。

- **通用**：语言、功能开关（TL;DR、队列、播放器，默认都开）。
- **TL;DR**：见 §15。
- **队列**：见 §27。
- **播放器**：见 §37。
- **存储**：见 §4.1。
- **诊断**：「自检」按钮（§5）、日志（§4）。

设置页顶部（所有标签共用）显示 YouTube 和 Gemini 的登录状态，没登录的提醒去登录，依赖它的功能灰掉（§27）。

首次安装时自动打开设置页的「诊断」标签，并运行一次全部自检。需要 YouTube 标签页的自检项（队列、播放器）在没有打开的 YouTube 标签页时标为「跳过」，并提示先打开一个再重跑。

## 4. 日志

| 项 | 决定 |
|---|---|
| 位置 | 设置页「诊断」标签里的日志视图，整个 YouTube+ 共用一份 |
| 每一行 | 时间、功能（`tldr` / `queue` / `player` / `core`）、级别（debug / info / warn / error）、内容 |
| 存储 | `chrome.storage.local`，环形缓冲区，上限默认 **2 MB**（可在设置里改，见 §4.1），满了丢掉最老的 |
| 写入 | content script 把日志发给 service worker，由它批量写入，避免频繁写存储 |
| 查看 | 可以按功能、按级别筛选；有「复制全部」和「导出 .txt」按钮 |
| 隐私 | **永远不上传**。不记 cookie、认证头（`SAPISIDHASH`、`at` token 等） |

### 4.1 存储用量

扩展申请 `unlimitedStorage` 权限，不受 `chrome.storage.local` 默认 10 MB 配额的限制；用量由扩展自己的上限控制。设置页有一个「存储」标签：

| 类别 | 显示 | 上限（可改） | 操作 |
|---|---|---|---|
| 日志（§4） | 占用大小、行数 | 默认 2 MB，满了丢最老的 | 清空 |
| TL;DR 缓存（§13） | 占用大小、条数 | 默认 5 MB，满了按 LRU 淘汰 | 清空 |
| 队列清空快照（§25） | 占用大小 | 每个身份只存最近一次，无需上限 | 清空 |
| 其他（队列设置、熔断状态、迷你播放器位置等） | 占用大小 | — | — |

最上面显示总用量（`getBytesInUse`）。上限调小后立刻按新上限裁剪。

## 5. 自检

每个功能提供自己的自检项（TL;DR 见 §15，队列见 §27，播放器见 §37）。设置页的「自检」按钮依次运行所有已开启功能的自检，结果显示在页面上，同时写进日志。

---

# 第二部分　TL;DR

## 6. 一句话描述

在 YouTube 有缩略图的页面上，扩展在后台调用**免费的 Gemini 网页版**（逆向内部接口）读取视频内容，生成 TL;DR 要点。用户不用点开视频，点击缩略图上的图标就能在 tooltip 里看到总结。

## 7. 目标与非目标

**目标**
- 共用原则见 §2。
- 零成本：使用浏览器里已登录的 Google 账号访问 gemini.google.com，不需要 API key。
- 刷首页、搜索结果时，总结已经在后台准备好，点开图标基本是秒开。

**非目标（MVP 不做）**
- Shorts、正在直播、直播预告和首映。
- 扩展自己抓字幕（timedtext 现在需要 PO token，属于跟 YouTube 对抗，留作以后可插拔的模块）。
- 读不到字幕时用标题和简介做降级总结。
- 官方 Gemini API。MVP 只预留 Provider 接口，不实现。
- 跨设备同步、E2E 测试。

## 8. 关键决定一览

| # | 主题 | 决定 |
|---|---|---|
| Q1 | 用户与发布 | 自用，以未打包扩展加载；代码按上架标准写 |
| Q3/Q10 | 生效范围 | 所有带缩略图的位置：首页、搜索、观看页右侧推荐、订阅、频道、播放列表等。**排除** Shorts、正在直播、预告和首映。**保留**直播回放 |
| Q4/Q12 | 输出内容 | 3 到 7 条要点（模型按视频长度决定条数）；外加「标题与内容是否一致」的判断，设置里可以关，默认开启 |
| Q4/Q12 | 输出语言 | 2026-11-18 改为跟随扩展的**界面语言**（通用标签里选，目前有 English 和中文，默认按浏览器语言）；缓存按语言分开存，换语言会重新生成 |
| Q5/Q23 | 缓存 | 按 videoId 缓存在本地，见 §13 |
| Q6 | 技术栈 | WXT + TypeScript，MV3；UI 用原生 DOM 加 Shadow DOM，不引入 React |
| Q7 | 内容来源 | Gemini 网页版的 YouTube 应用（逆向调用），由它读取字幕 |
| Q8 | 抽象层 | 定义 `SummaryProvider` 接口。MVP 只实现 `GeminiWebProvider`；以后可以加官方 API 或「自抓字幕」的 Provider |
| Q9 | 账号 | 接受封号风险。默认用 `/u/0`，设置里可以改账号编号 N |
| Q13/Q20 | 对话处理 | **临时对话用不了 YouTube 应用（用户已实测）**。所以用普通对话，生成完立即删除 |
| Q14 | 自检 | 设置页有「自检」按钮；首次安装时自动打开设置页并运行一次 |
| Q15/Q22 | 读不到内容 | 图标变灰、不可点击，悬停提示原因；不做降级总结 |
| Q16 | 协议 | 用 `StreamGenerate`（旧接口）；不发送模型 header，用账号默认模型；token 每次实时从页面抓取（计划改为缓存，见 §10.7） |
| Q17/Q19/Q25 | 预生成与限流 | 整页预生成，但严格节流，见 §12 |
| Q18 | 输出格式 | 要求模型严格输出 JSON；解析失败时把原文当 markdown 显示 |
| Q11/Q21/Q22 | UI | 图标在缩略图右下角、时长标签正上方，常驻显示；点击图标打开 tooltip，见 §14 |
| Q24 | 开发顺序 | 先做最小验证，再写 Provider 和任务队列，然后是 UI，最后是设置页和自检，见 §17 |

## 9. 架构

```
┌─────────────── YouTube 标签页（可能有多个）───────────────┐
│ content script                                             │
│  ├─ ThumbnailScanner  MutationObserver 找出缩略图，并过滤掉 │
│  │                    Shorts、直播、预告                     │
│  ├─ VisibilityTracker IntersectionObserver 判断可见性，     │
│  │                    并上报标签页是否在前台                 │
│  ├─ BadgeIcon         插入缩略图的 DOM，显示状态             │
│  └─ Tooltip           Shadow DOM 渲染总结                    │
└──────────────┬─────────────────────────────────────────────┘
               │ runtime port（入队、提升优先级、状态推送）
┌──────────────▼──────────── service worker ──────────────────┐
│ JobQueue      全局唯一；按 videoId 去重；按优先级排序；       │
│               随机间隔；有上限；熔断                          │
│ SummaryCache  chrome.storage.local                           │
│ SummaryProvider                                              │
│  └─ GeminiWebProvider                                        │
│       └─ GeminiWebClient  只负责协议：抓 token、发请求、     │
│                           解析返回流、删除对话               │
│ PendingDeletes  删除失败的对话 ID，之后重试                   │
└──────────────┬─────────────────────────────────────────────┘
               │ fetch，credentials: 'include'（自动带上浏览器的 Google cookie）
               ▼
        gemini.google.com/u/N/…
```

- `JobQueue` 是 TL;DR 内部生成总结用的任务队列，跟第三部分的视频队列无关。
- 只有 `GeminiWebClient` 知道协议细节。Google 把协议迁到 `processSession` 时，只需要改这一个模块。
- 设置页的 TL;DR 标签负责：开关标题一致性判断、选账号编号 N、开关预生成、调整上限、清空缓存。

### 9.1 Provider 接口（草案）

```ts
interface SummaryProvider {
  summarize(input: { videoId: string; url: string; title: string; lang: LangSetting; titleCheck: boolean }):
    Promise<SummaryResult>;
}

type SummaryResult =
  | { kind: 'ok'; data: Summary }
  | { kind: 'unreadable'; reason: string }          // 读不到内容：灰色图标，缓存 24 小时
  | { kind: 'error'; error: ProviderError };        // 临时错误或需要熔断的错误：不缓存

interface Summary {
  points: string[];                                  // 3–7 条
  titleMatch?: { verdict: 'match' | 'partial' | 'mismatch'; reason: string };
  lang: string;
  raw?: string;                                      // JSON 解析失败时保存的原文
}

type ProviderError =
  | { code: 'quota' }           // 1037：额度用完
  | { code: 'blocked' }         // 1060 / 1152 / 验证码 / 429：触发熔断
  | { code: 'auth' }            // 访客模式 / 拿不到 SNlM0e / xsrf 错误
  | { code: 'protocol' }        // 协议变了，返回格式无法解析
  | { code: 'transient' };      // 1013 / 网络错误
```

## 10. Gemini 网页版协议（来自调研，截至 2026-11）

主要参考：Sophomoresty/gemini-web2api（MIT 许可，`cloudflare/worker.js` 是纯 JS 实现）、ntthanh2603/gemini-web-to-api（MIT，Go）、HanaokaYuzu/Gemini-API（**AGPL**，只参考协议，不复制代码）。

### 10.1 抓取 token
`GET https://gemini.google.com/u/N/app`，用正则从 HTML 中提取：
- `"SNlM0e":"…"` → 表单字段 `at`（CSRF token）。**拿不到就说明是访客模式**，也就是没登录或第三方 cookie 被屏蔽。
- `"cfb2h":"…"` → `bl`（构建版本号）。**不能写死**，过期后会返回 405。
- `"FdrFJe":"…"` → `f.sid`

`/u/N` 必须和发请求时用的 N 一致，否则会报 xsrf 400。

### 10.2 发起生成
```
POST https://gemini.google.com/u/N/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate
     ?bl=<cfb2h>&f.sid=<FdrFJe>&hl=en&_reqid=<随机 5 位数，每次请求 +100000>&rt=c
Content-Type: application/x-www-form-urlencoded;charset=utf-8
X-Same-Domain: 1
x-goog-ext-525005358-jspb: ["<UUID>",1]
body: at=<SNlM0e>&f.req=JSON.stringify([null, JSON.stringify(inner)])
```
- `inner` 是一个约 81 个元素的稀疏数组：`[0]=[prompt,0,null,null,null,null,0]`；`[2]` 填空字符串表示新对话；`[59]` 填和 header 里相同的 UUID；**不设置 `[45]`**，因为临时对话用不了 YouTube。其余固定位按参考实现填。
- 不发送模型 header（`x-goog-ext-525001261-jspb`）。截至 2026-10，免费账号基本只能用 Flash-Lite，也就是 Auto。

### 10.3 解析返回
1. 去掉开头的 `)]}'`。
2. 按长度前缀切分帧。长度单位是 UTF-16 码元，正好等于 JS 的 `string.length`。
3. 每一帧是 `["wrb.fr", null, "<json>"]`，把 `part[2]` 解析成 JSON：`[1] = [cid, rid]`，`[4]` 是候选回答；正文在 `candidate[1][0]`。如果正文是 `googleusercontent.com/card_content/N` 这种占位符，就改取 `candidate[22][0]`。
4. 每一帧都是**到目前为止的全文**，不是增量。所以直接取最后一帧即可，不需要流式渲染。
5. 错误码：1037 额度用完；1060 IP 被封；1152 会话异常、限流或验证码；1013 暂时性错误；1050 / 1052 模型不匹配。

### 10.4 删除对话
`batchexecute` 接口，RPC ID 为 `GzXR5e`，payload 是 `[cid]`。删除失败时把 cid 存进 `PendingDeletes`，下次空闲时重试。

### 10.5 鉴权
- 扩展在 `host_permissions` 里声明 `https://gemini.google.com/*`，service worker 用 `credentials:'include'` 发请求，会自动带上浏览器的 Google cookie。
- **不要轮换 cookie**（不调用 RotateCookies），否则可能把浏览器本身的登录踢掉。登录态由浏览器自己维护。
- 前提是用户**没有屏蔽第三方 cookie**，否则请求会变成访客模式。自检要能识别这种情况。
- 备用方案（暂不实现）：在 gemini.google.com 标签页的 content script 里同源发请求，或者用 `chrome.cookies` 读取 cookie 再用 declarativeNetRequest 注入。

### 10.6 YouTube 应用的前提条件
- 必须开启「Gemini 应用活动记录」（myactivity.google.com/product/gemini）。
- 必须在 gemini.google.com/apps 启用 YouTube 应用。
- 它基本靠字幕工作，没有字幕的视频会读取失败。
- 只能在普通对话里用（用户已实测临时对话不行）。

### 10.7 现状评估（2026-11-20）

**结论：短期内继续用 `StreamGenerate`，暂不迁 `processSession`。**
- 2026-11-18 实测旧接口还能用（§17）。
- §19 列的参考实现全是基于 `StreamGenerate` 的；`processSession` 得从零逆向，没有可参考的实现。
- 协议全关在 `GeminiWebClient` 里。接口一变，自检会报 `protocol` 错误，到时只改这一个模块。

**缺后备。** `StreamGenerate` 一下线，TL;DR 就整个失效。逆向 `processSession` 也只是换一个随时可能再变的内部接口。更稳的后备是官方 Gemini API Provider（§18）：
- 接口有文档；用 AI Studio 的免费 key，可以直接把 YouTube URL 交给模型。
- 没有封号风险，不需要 YouTube 应用和活动记录，也不用删对话。
- `SummaryProvider` 接口已经留好，加一个实现就行。
- 代价：用户要自己填 key，不再是零配置，但仍然免费。

**凭证抓取太勤（计划改，2026-11-20 决定先不做）。**
- 这里说的「token」是 §10.1 从 `/u/N/app` 页面里取出的凭证 `SNlM0e` / `cfb2h` / `FdrFJe`，不是模型的 token 用量。所以它浪费的是 HTTP 请求，不是 Gemini 额度。额度要靠减少 prompt 次数来省，这一点已经靠批量请求在做。
- 现状：`generate()` 和 `deleteConversation()` 各自先 GET 一次完整的 `/app` 页面（`src/features/tldr/client.ts`）。每批任务 4 个请求：2 次抓页面、1 次生成、1 次删除。多出来的抓页面增加延迟，也让流量更不像正常用户，提高被风控的风险。
- 改法：把 `at` / `bl` / `sid` 缓存几分钟，按账号编号 N 分开存，改 N 时清掉。请求返回 400 / 405（xsrf 错、`bl` 过期）时清缓存、重新抓一次、重试一次；还失败就按现有的错误映射处理。这样大部分批次只剩生成和删除 2 个请求。§8 Q16 的「token 每次实时抓取」随之改掉。自检和「我已登录」的检测（§15.1）照旧实时抓，不走缓存。
- **跟 `processSession` 基本独立。** 缓存管的是凭证从哪来、什么时候刷新，`generate()` 调哪个接口都不影响它。删对话用的 `batchexecute`（`GzXR5e`）跟生成接口无关，迁移后也照样需要这组凭证。没验证的一点：`processSession` 是否还用同样这三个字段。同一网页里的其他内部接口都用 `at` / `bl` / `f.sid`，大概率不变；就算变了，也只改 `extractTokens` 里取哪几个字段，缓存和失败后刷新的逻辑不用动。

## 11. Prompt 与输出格式

prompt 模板（实现时再细调），要点：
- 给出完整的 `https://www.youtube.com/watch?v=<id>` 和视频标题。
- 要求**严格只输出 JSON**，不要代码围栏，也不要额外文字：
  ```json
  {"status":"ok","lang":"zh","points":["…","…"],"titleMatch":{"verdict":"match|partial|mismatch","reason":"…"}}
  ```
- 如果无法读取视频内容（没有字幕、工具调用失败等），**只输出** `{"status":"no_transcript"}`，禁止根据标题编造内容。
- 语言：「跟随视频语言」时要求用视频的口播语言输出；否则用指定的语言输出。
- 要点数量：按视频长度在 3 到 7 条之间决定。
- 关闭标题一致性判断时，从 schema 里去掉 `titleMatch`。

解析顺序：先直接 `JSON.parse`；失败的话提取第一个 `{…}` 再试；还失败就把原文作为 `raw`，以 markdown 显示，这种结果也缓存。拿到 `status:"no_transcript"` 时归为 `unreadable`。

## 12. 预生成、任务队列与限流（保守的初始值）

| 规则 | 初始值 |
|---|---|
| 队列 | service worker 里**只有一条全局任务队列**，多个标签页共用；按 videoId 去重 |
| 并发 | **1**，严格串行（一次一个请求；一个请求可以包含多个视频，见下一行） |
| 合并请求 | 一次请求最多带 **5** 个视频（设置里可改，1–10；1 就是逐个）。先按优先级挑出第一个，再按同样顺序补满；预生成不允许时（上限、后台、关掉了）只补点击过的。一次请求只计 1 次上限。回答是一个 JSON 数组，按 `id` 对应；漏掉的视频标为暂时出错，点击重试。2026-11-18 实测：4 个约 14 秒，8 个约 15 秒（单个 10–20 秒）；顺序正确，假 ID 和没有人声的视频各自返回 `no_transcript`，没有串内容 |
| 优先级 | 用户点了图标的视频，高于屏幕上可见的，高于页面上其余的。滚走以后只降级，不取消 |
| 间隔 | 每个请求完成后，等 **5–10 秒随机时间**再发下一个 |
| 上限 | 每小时 **40** 个，每天 **200** 个（按本地自然日算）。达到上限后自动预生成暂停，**手动点击仍可生成**，手动点击也计入总数。上限可在设置里改 |
| 前台条件 | 至少有一个 YouTube 标签页在前台（`visibilityState === 'visible'`）时才跑预生成；否则暂停。手动点击不受这条限制 |
| 熔断：额度 | 遇到 1037 就暂停全部请求，**直到用户手动点「恢复」** |
| 熔断：风控 | 遇到 1060、1152、验证码、429 就暂停全部请求（包括手动点击）**30 分钟** |
| 总开关 | 设置里可以关掉预生成，只保留点击生成 |
| 未登录 | 遇到 `auth` 错误（拿不到 `SNlM0e`）后，什么都不跑（包括手动点击），等检测到登录再恢复，见 §15.1 |
| Cookie | 绝不轮换 |

估算：逐个时一屏 30 个视频大约 5–8 分钟处理完；每次 5 个大约 1.5 分钟。

实现要点：MV3 的 service worker 空闲约 30 秒后会被回收。打开的 runtime port 和进行中的 fetch 会让它保持活跃。任务队列状态和计数器放在 `chrome.storage.session` 或 `chrome.storage.local` 里，这样 service worker 重启后能恢复。

## 13. 缓存

- 存储：`chrome.storage.local`，key 是 videoId。
- 成功的结果：永久保存，总大小上限默认 **5 MB**（约几千条，可在设置里改，§4.1），满了按 LRU 淘汰。
- `unreadable`（读不到内容）：缓存 **24 小时**。新视频的自动字幕要过一段时间才生成，所以过期后允许再试一次。
- 临时错误和熔断：**不缓存**。
- 用户点「重新生成」时，覆盖原有缓存。
- 缓存里存的是结构化的 `Summary`，以后改 UI 不需要重新生成。

## 14. UI

### 14.1 缩略图上的图标
- 作为**子元素插入缩略图容器的 DOM**，用 absolute 定位，滚动时自然跟着缩略图走，不用 fixed 定位。
- 位置：右下角、**时长标签的正上方**。常驻显示，不需要悬停；z-index 高于 YouTube 悬停时出现的内嵌播放器，但低于顶栏（2020）和迷你播放器（2030）：悬停时浮起来的那份副本用 2010，鼠标在迷你播放器或顶栏上时不浮起（2026-11-18 修复：原来是 2200，会盖在迷你播放器上面）。
- 要专门设计一个 icon。

| 状态 | 外观 | 能否点击 |
|---|---|---|
| 未处理 | 品牌图标，偏淡 | 可以，点击会插到队首 |
| 排队中 | 图标带等待标记 | 可以，点击会插到队首并打开 tooltip 显示进度 |
| 生成中 | 转圈 | 可以，tooltip 显示「生成中」 |
| 已就绪 | 按标题判断着色：相符绿、部分相符琥珀、不符红；没有判断时蓝 | 可以，打开 tooltip |
| 读不到 | **灰色** | **不可以**，悬停提示原因 |
| 出错 | 红色 | 可以，点击重试 |
| 暂停 | 暂停标记 | 不可以，悬停显示原因和剩余时间 |

### 14.2 Tooltip
- 点击图标后打开，出现在缩略图旁边，空间不够时自动翻到另一侧；同一时间只开一个；点击外部或按 Esc 关闭。
- 用 Shadow DOM 隔离样式，适配 YouTube 的深色和浅色主题。
- 内容：**最上面**是标题一致性判断（按 match / partial / mismatch 用颜色区分，并附理由），下面是要点列表。复制的文本也是这个顺序。
- 操作：「重新生成」和「复制」。
- 对话生成后会立即删除，所以**没有**「在 Gemini 中打开」。

### 14.3 识别缩略图
- 用 MutationObserver 应对 YouTube 的单页应用路由和无限滚动。
- 目标元素包括新旧两套布局（例如 `ytd-rich-item-renderer`、`ytd-video-renderer`、`ytd-compact-video-renderer`、`yt-lockup-view-model` 等，实现时以实际 DOM 为准）。**所有选择器集中放在一个文件里**，YouTube 改版时只改这一处。
- 根据 `/shorts/` 链接排除 Shorts；根据缩略图上的「LIVE」「即将开始」「首映」等标签排除直播中和预告。

## 15. 设置与自检

**设置项**（设置页的 TL;DR 标签；输出语言在通用标签）：标题一致性判断开关、账号编号 N、预生成开关、每小时和每天的上限、清空缓存、当前计数和熔断状态。

**自检**：
1. 抓取 `/u/N/app`，检查能否拿到 `SNlM0e`。拿不到就提示「未登录 Gemini，或者第三方 cookie 被屏蔽」，并附上修复方法。
2. 检查 `bl` 和 `f.sid` 能否提取到。提取不到就说明协议可能变了。
3. 用一个已知有字幕的短视频实际跑一次总结，验证活动记录已开启、YouTube 应用已启用；失败时给出 myactivity 页面和 gemini.google.com/apps 的链接。
4. 验证删除对话是否成功。

### 15.1 登录 Gemini 的引导

前提：用户已经登录 YouTube，也就有 Google 账号，可以用 Gemini。所以只需要处理一种情况：**这个浏览器访问 Gemini 时还没有登录**（没登录、账号编号 N 不对、第一次用 Gemini 还没过欢迎页、第三方 cookie 被屏蔽）。

- **全局状态**：service 维护 `gemini: unknown | ok | signedOut`。任何一次请求返回 `auth`（拿不到 `SNlM0e`）就进入 `signedOut`；任何一次成功就回到 `ok`。
- **未登录时什么都不跑**：任务留在队列里，不发请求，也不按缩略图逐个报错。所有排队的图标都显示「需要登录」（黄色 `!`）。
- **图标与 tooltip**：点「需要登录」的图标，tooltip 说明原因，给出「登录 Gemini」（新标签页打开 `gemini.google.com/u/N/app`，由 Gemini 自己显示登录或欢迎页）和「我已登录」（马上检测一次）两个按钮。
- **自动恢复**：gemini.google.com 或 accounts.google.com 的页面加载完成时（`tabs.onUpdated`）检测一次；兜底每 10 分钟检测一次（只在有排队任务时）。检测就是 GET 一次 `/u/N/app`。检测通过后，所有排队任务恢复，并且马上开始跑。
- **设置页**：打开时检测一次。没登录时每个标签顶部都显示横幅和「登录 Gemini」按钮；TL;DR 标签里有「连接」一行，显示状态，带「登录 Gemini」「重新检测」两个按钮。改了账号编号 N 也会重新检测。

## 16. 风险

| 风险 | 影响 | 应对 |
|---|---|---|
| `StreamGenerate` 被下线（网页版自 2026-10 中旬起已改用 `processSession`） | 整个功能失效 | 协议全部封装在 `GeminiWebClient` 里；自检能给出明确报错；必要时逆向新协议，或者加官方 API Provider；倾向先做官方 API Provider 当后备，见 §10.7 |
| 账号被风控或封禁 | 用户已接受 | 串行、随机间隔、设上限、熔断、不轮换 cookie；在用户真实的浏览器、IP、TLS 指纹下低频使用 |
| 免费额度（5 小时滑动窗口加每周上限，数字没有公开） | 预生成把额度耗光 | 设上限；遇到 1037 熔断；只在前台运行 |
| 删除对话前，对话会短暂出现在活动记录里 | 隐私方面的小问题 | 生成完立即删除；失败的删除会重试 |
| YouTube 改版 | 图标注入失效 | 选择器集中管理 |
| 没有字幕的视频 | 读不到内容 | 图标变灰；以后可以加「自抓字幕」Provider |
| 免费账号只能用 Flash-Lite | 总结质量有限 | 接受 |

## 17. 开发顺序与测试

1. **最小验证**：在 service worker 里打通「抓 token → StreamGenerate（普通对话加 YouTube 链接）→ 解析返回 → 用 GzXR5e 删除」，把真实的返回内容录下来作为测试数据。
2. `GeminiWebClient`、`GeminiWebProvider`、`JobQueue`（优先级、随机间隔、上限、熔断）、`SummaryCache`。
3. content script：识别缩略图、过滤、注入图标、跟踪可见性、渲染 tooltip。
4. 设置页和自检。

**第 1 步结果（2026-11-18）**：`StreamGenerate` 仍然可用（一个 18 秒的视频约 14 秒返回 15 帧）；长度前缀包含紧跟其后的换行，按 JS `string.length` 计；最后一帧就是完整回答，模型按要求输出了纯 JSON；`GzXR5e` 删除成功，侧栏里不再出现。请求里不设 `[79]`（模型）也能用。扩展从 service worker 发请求时 Origin 是 `chrome-extension://…`，所以用一条只作用于本扩展、只针对 gemini.google.com 的 declarativeNetRequest 会话规则把 Origin / Referer 改成 gemini.google.com（权限 `declarativeNetRequestWithHostAccess`）。缩略图结构见 `src/features/tldr/selectors.ts`。

**测试**
- 单元测试（Vitest）：返回帧的切分与解析、`wrb.fr` 提取、错误码映射、模型输出的 JSON 解析、任务队列与熔断的状态机、缓存的 LRU 和 TTL。测试数据用第 1 步录下来的真实响应。
- 和 YouTube DOM 相关的部分靠手动测试；MVP 不做 E2E。

## 18. 以后再做

- 凭证缓存（§10.7），独立于协议迁移，可以先做。
- 官方 Gemini API Provider（免费的 AI Studio key，可以直接把 YouTube URL 交给模型）。倾向在 `processSession` 迁移之前做，当 `StreamGenerate` 下线时的后备（§10.7）。
- `processSession` 新协议的迁移。
- 「自抓字幕」Provider（需要 PO token 或其他 innertube 客户端），抓到后贴进 prompt，就可以用临时对话。
- 根据实际使用情况调整 §12 的参数。

## 19. 参考来源

- Sophomoresty/gemini-web2api（MIT）：https://github.com/Sophomoresty/gemini-web2api ，issues #45 #63 #69 #82 #110
- ntthanh2603/gemini-web-to-api（MIT）：https://github.com/ntthanh2603/gemini-web-to-api ，issues #46 #66 #82
- HanaokaYuzu/Gemini-API（AGPL-3.0，只参考协议）：https://github.com/HanaokaYuzu/Gemini-API ，issues #94 #297 #323 #360 #365
- Chrome 扩展的 cookie 规则：https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
- Gemini 临时对话的限制：https://support.google.com/gemini/answer/13275745
- Gemini 用量限制：https://9to5google.com/2026/05/21/gemini-usage
- TypeScript 先例：chathub-dev/chathub `src/app/bots/bard/api.ts`；Ethan7778/ai-helper `extension/background/gemini-session.ts`
- 同类扩展：Hover-Tube（https://github.com/SukhdevThukral/Hover-Tube ）、yt-quickgist（https://github.com/M1RAK/yt-quickgist ）
- 自抓字幕的现状：https://github.com/jdepoix/youtube-transcript-api/issues/592 ，https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide

---

# 第三部分　队列

> 2026-11-20 重新设计。原方案是官方队列（TLPQ）和私密播放列表双向同步，实测下来 bug 一直修不完，用户也搞不清两者的关系，所以整套同步作废。现在改成让用户在两种模式里选一种，扩展只管选中的那一种。原方案见 git 历史（`77c5d00` 及之前）。

## 20. 一句话描述

在设置里二选一：**用 YouTube 自带的队列**（扩展完全不管），或者**用一个播放列表当队列**。选了播放列表，页面上所有的「加入队列」都会变成「加入 <列表名>」，视频存进你账号里的那个列表，关掉页面、换设备都不会丢；顶栏有一个按钮可以一键播放这个列表，看完的视频自动从列表里删掉。另外，给你自己的所有播放列表加上「清空全部」和「移除已看完」，两种模式下都能用。

## 21. 背景（调研，2026-11-14 / 11-18 / 11-20 在浏览器里实测）

### 21.1 官方队列（TLPQ）

- **官方队列是服务器上的一个临时播放列表**，ID 以 `TLPQ` 开头，共 26 个字符，标题是「Queue」。第一次「加入队列」时页面调用 `playlist/create` 建出来；之后再加视频，就是对它调用 `browse/edit_playlist`。
- 它的 ID 只存在当前标签页的 sessionStorage 里（`yt-queue<账号>::TLPQplaylist`），所以**刷新后队列还在，新标签页里没有**。它不会出现在你的「播放列表」里，手机上看不到。这就是两种模式的根本区别。

### 21.2 「加入队列」是怎么触发的（2026-11-20 实测）

- 所有测过的入口都派发 `yt-action` 事件，`actionName: 'yt-add-to-playlist-command'`，`args[0]` 里是 `addToPlaylistCommand`，`listType: 'PLAYLIST_EDIT_LIST_TYPE_QUEUE'`，带 `videoId`、`videoIds`、`openMiniplayer: true`、`onCreateListCommand`（`playlist/create`）。在菜单数据里它包在 `signalServiceEndpoint{signal:'CLIENT_SIGNAL', actions:[{addToPlaylistCommand}]}` 里。
- **事件不是在 `ytd-app` 上派发的**，而是从被点的那个元素冒泡上去。所以要在 `document` 上用 capture 阶段监听。

  | 入口 | 菜单组件 |
  |---|---|
  | 首页缩略图 ⋯ | 新版 `yt-list-item-view-model` |
  | 观看页侧栏 ⋯ | 新版 `yt-list-item-view-model` |
  | Shorts 架子 ⋯ | 新版 `yt-list-item-view-model` |
  | 搜索结果 ⋯ | 旧版 Polymer `ytd-menu-service-item-renderer`；**会派发两次**（第二次从 `ytd-menu-renderer` 重发），但只发一个请求 |
  | 播放列表页每一行 ⋯ | 旧版 Polymer `ytd-menu-service-item-renderer` |
  | 缩略图悬停按钮 | `ytd-thumbnail-overlay-toggle-button-renderer`，`untoggledIcon.iconType: 'ADD_TO_QUEUE_TAIL'`，文字在 `untoggledTooltip` |

- **capture 监听里 `stopImmediatePropagation()` 能完全拦下**：没有队列时不会建 TLPQ、不弹迷你播放器；已有队列时队列不变、没有提示；搜索结果的两次派发，拦第一次就够了。菜单照常关闭。悬停按钮因为不好重现没直接测，走的是同一个事件。
- **不经过这个事件的路径**：标签页里已有官方队列、迷你播放器开着时，直接点缩略图或标题，页面会直接对 TLPQ 发 `edit_playlist`（提示「已加入队列」）。播放列表模式下扩展不让 TLPQ 建出来，所以这种情况只出现在中途切换模式的标签页里（§24.6）。
- 播放列表观看页右侧面板的 ⋯ 里没有「加入队列」。

### 21.3 改菜单文字（2026-11-20 实测）

- **识别这一项不看文字**：图标是 `ADD_TO_QUEUE_TAIL`（`iconType` 或 `imageName`），命令里有 `addToPlaylistCommand.listType === 'PLAYLIST_EDIT_LIST_TYPE_QUEUE'`。
- **新版菜单**（`yt-list-item-view-model`）：文字在 `button[role=menuitem]` 里的 `span.ytListItemViewModelTitle`。元素上没有 `.data`，数据在祖先的 sheet 上：`ytSheetViewModel.componentProps.data().content.listViewModel.listItems[i].listItemViewModel`（`title.content`、`leadingImage.sources[0].clientResource.imageName`、`rendererContext.commandContext.onTap.innertubeCommand`）。直接改 `textContent` 能留住，点击照常。**弹出菜单的 DOM 在不同菜单、不同页面之间是复用的**，只有标题值变了才重新渲染，所以每次打开菜单都要重新改，关掉播放列表模式时要改回去。
- **旧版菜单**（`ytd-menu-service-item-renderer`）：数据在 `el.data`（`text.runs`、`icon.iconType`、`serviceEndpoint`），文字在 `yt-formatted-string.title`。**不能改 `textContent`**，再打开时 Polymer 会在旁边再加一段，变成「加入 YouTube+加入队列」。要设 `ytFormattedString.text = {runs:[{text}]}`，可以来回切换。
- 悬停按钮的文字是 `data.untoggledTooltip`（tooltip 和 aria-label），没实测改写。

### 21.4 播放列表的读写和播放（2026-11-18 / 11-20 实测）

- **列出能编辑的列表**：`playlist/get_add_to_playlist`（参数随便给一个 `videoIds`），返回的 `playlistAddToOptionRenderer` 就是当前频道能编辑的全部列表，含「稍后观看」（ID 是 `WL`），带 `playlistId`、`title`、`privacy`。
- **读列表**：`browse`，`browseId: 'VL<列表 ID>'`，每一条是 `playlistVideoRenderer`（`videoId`、16 位的 `setVideoId`）；分页用 `continuationItemRenderer` 的 token，每页约 100 条。`playlistVideoListRenderer.isEditable` 表示能不能编辑；观看进度在 `thumbnailOverlays[].thumbnailOverlayResumePlaybackRenderer.percentDurationWatched`。
- **写列表**：`browse/edit_playlist`，`{context, playlistId, actions: [...]}`，一个请求可以带多个操作（每批 100 个）：`ACTION_ADD_VIDEO`（`addedVideoId`，`dedupeOption: 'DEDUPE_OPTION_SKIP'`）、`ACTION_REMOVE_VIDEO`（`setVideoId`）、`ACTION_REMOVE_VIDEO_BY_VIDEO_ID`、`ACTION_MOVE_VIDEO_AFTER`（`setVideoId`、`movedSetVideoIdPredecessor`）。引用已经不存在的 `setVideoId` 返回 400「Precondition check failed」，列表不变。
- **新建列表**：`playlist/create`。**新列表的 ID 可能很短**（实测 13 个字符：`PL` 加 11 位），不要按长度校验列表 ID。
- **正在播放列表时往里加视频**：在同一个标签页里加，页面会发 `edit_playlist` → 派发 `yt-refresh-playlist-command` → 重新请求 `next`，右侧面板和 `player.getPlaylist()` 实时变长，当前播放不受影响。从别的标签页加，要等下一次 `next`（切到下一个视频或刷新）才显示。
- **官方队列怎么挂到正在播的视频上**（2026-11-20 实测，迷你播放器里加入队列）：`playlist/create` 之后在 `yt-playlist-manager` 上依次调 `setAutoplayRenderer(autoplay)`、`setPlaylistData(playlistPanel 数据，当前视频在第 0 条)`、`setPlayerPlaybackControlData({playlistPanelRenderer: 同一份})`；再请求 `next`，用返回的 `playlist.playlist` 和 `autoplay.autoplay` 把这三个再调一遍。**只调 `setPlaylistData` 不够**：信息栏变了，播放器的 `getPlaylistId()` 仍是空；第三个方法才让播放器知道这个列表。
- 用自己的列表照做：`next`（`videoId` = 当前视频、`playlistId` = 列表）返回的 `currentIndex` 是 0、自动播放指向**第二条**（当前视频不在列表里）；本地把当前视频插到最前、把 `autoplay.sets[].autoplayVideo/nextButtonVideo` 换成第一条的 `navigationEndpoint`、删掉 `modifiedSets` 再交给那三个方法：迷你播放器和观看页右侧面板都出现列表，视频不重新载入，放完官方自动播放接列表第一条，仍在迷你播放器里。迷你播放器展开成观看页后面板还在。
- 退回方案（导航）：观看页上导航到 `watch?v=<当前视频>&list=<ID>`，`watchEndpoint` 带 `startTimeSeconds`：从同一秒接着播（重新载入约 1 秒），面板出现列表、没有选中项，`getPlaylistIndex()` 是 0，官方自动播放跳到第二条。从迷你播放器派发 `yt-navigate` 会展开成观看页。
- **`DEDUPE_OPTION_SKIP` 不起作用**：对已经在列表里的视频 `ACTION_ADD_VIDEO` 会再加一条重复的。写操作后几秒内读列表可能还是旧的。
- **正在播放列表时删除（会出错）**：
  - 在另一个标签页删掉下一条：这个标签页不刷新，当前视频播完后照旧播已经删掉的那条，然后面板才按服务器重新同步，选中状态和 `getPlaylistIndex()` 都不对。
  - 在面板里删掉正在播的这一条：播放不中断，但播放器的位置指到了它后面那条，面板里还留着一行隐藏的重复项；**播完后直接停在结束画面，不播下一条**。
  - 结论：扩展删了正在播的列表里的东西以后，不能再指望官方的自动播放，要自己切下一条（§24.4）。

### 21.5 认证和身份

- **认证**：在页面里 `POST /youtubei/v1/<endpoint>`，`credentials: 'include'`。`document.cookie` 里看不到 `SAPISID`，只有 `__Secure-3PAPISID`；请求头是 `Authorization: SAPISIDHASH <ts>_<sha1> SAPISID3PHASH <ts>_<sha1>`，两个哈希都用 `"<ts> <cookie> https://www.youtube.com"` 算，另加 `X-Goog-AuthUser`（`ytcfg` 的 `SESSION_INDEX`）、`X-Origin`、`X-Youtube-Client-Name/Version`。品牌频道必须带 `X-Goog-PageId`（`DELEGATED_SESSION_ID`）。**少了 `X-Goog-PageId` 不会报错，而是悄悄地按主频道执行**。
- **`ytcfg` 里的身份字段**：

  | 字段 | 形状 |
  |---|---|
  | `LOGGED_IN` | 布尔 |
  | `SESSION_INDEX` | 1 位数字的字符串 |
  | `DELEGATED_SESSION_ID` | 21 位数字的字符串（频道） |
  | `USER_SESSION_ID` | 21 位数字的字符串（Google 账号） |
  | `DATASYNC_ID` | `"<DELEGATED_SESSION_ID>\|\|<USER_SESSION_ID>"` |
  | `USER_ACCOUNT_NAME` | 短字符串（显示名） |

  没有 `CHANNEL_ID`、`LOGGED_IN_CHANNEL_ID`；「你的频道」链接用的是 `/@handle`。

## 22. 关键决定一览

本节的「队列 Qn」是 2026-11-20 重新设计讨论时的问题编号（跟原方案的编号无关）。

| 队列 # | 主题 | 决定 |
|---|---|---|
| Q1 | 自带队列模式 | 扩展完全不管，就是原生行为 |
| Q2/Q7 | 播放列表模式怎么加视频 | **接管**所有「加入队列」入口，文字一起改成「加入 <列表名>」；加入后提示「已加入 · 查看」。没走 `yt-action` 的入口保持原样，不硬改 |
| Q8 | 加入后播什么 | 存进列表。正在看一个不属于任何列表的视频时（观看页或迷你播放器），像官方队列一样把列表挂到当前播放上：右侧面板 / 迷你播放器下面出现列表，当前视频在最上面，放完接着播列表第一条，不重新载入（2026-11-20 改，原来是完全不动当前播放）。正在播别的列表时不动。顶栏有「播放 <列表名>」按钮，从头连续播放 |
| Q9/Q18/Q28 | 看完删除 | 「播放完后从列表中删除」，默认勾选。只在播放这个列表时才算；由扩展负责切到下一条再删，不依赖官方自动播放 |
| Q19/Q25 | 播放入口 | 顶栏头像左边一个小按钮，显示视频数。迷你播放器下面的列表面板用官方自带的 |
| Q6/Q10/Q15 | 用哪个列表 | 设置页下拉框选：当前频道能编辑的列表（含「稍后观看」）加一项「新建…」。保存**列表 ID** |
| Q16 | 新建 | 默认名 `YouTube+`，可以改，私密，不检查重名 |
| Q14 | 没选列表 / 列表被删了 | 清空选择，不猜；不接管，第一次点「加入队列」时提示「还没有选择播放列表 · 去设置」 |
| Q17/Q23 | 多账号 / 多频道 | 按右上角当前的身份（频道）分开存队列设置，切换后原来的保留、不带到新身份里。当前身份不能编辑选中的列表时不接管、不清空选择 |
| Q22 | 哪些设置按频道分开 | 只有队列：模式、列表 ID、看完删除、清空快照。其他设置全局 |
| Q24 | 设置页为谁设置 | 以最近获得焦点的 YouTube 标签页的身份为准，显示「正在设置：<头像 + 名字>」 |
| Q12/Q13/Q21/Q26 | 登录 | 设置页顶部统一显示 YouTube 和 Gemini 的登录状态（可以是不同账号）。没登录时依赖它的功能灰掉并说明原因，不需要登录的功能照常。播放列表模式下没登录就退回原生行为 |
| Q4 | 同步 | **整套删掉** |
| Q11 | 切换模式 | 不迁移数据 |
| Q29 | 中途切换的标签页 | 不处理，提示「刷新页面后生效」 |
| — | 清空全部 / 移除已看完 | 保留（§25），两种模式都能用 |

## 23. 架构

```
┌──────────────────── YouTube 标签页（可能有多个）────────────────────┐
│ MAIN world 脚本（和页面同一个 JS 环境）                              │
│  ├─ InnerTubeClient 用页面的 ytcfg 和 cookie 调 browse /             │
│  │                  browse/edit_playlist / playlist/create /         │
│  │                  playlist/get_add_to_playlist                     │
│  ├─ QueueTakeover   document 上 capture 监听 yt-action，拦下 QUEUE   │
│  │                  类型的 yt-add-to-playlist-command，转交给         │
│  │                  isolated 一侧；菜单打开时改写文字                 │
│  ├─ Identity        读 ytcfg 的 LOGGED_IN / DATASYNC_ID / 名字头像    │
│  └─ PlayerWatch     播放列表时监听 ended / 剩 10 秒切走，判断看完     │
│            ▲ window.postMessage（固定 tag，见下）                     │
│            ▼                                                         │
│ isolated content script                                              │
│  ├─ QueueMode       按当前身份读设置，决定接不接管；加入、提示        │
│  ├─ PlayButton      顶栏「播放 <列表名>」按钮                         │
│  ├─ WatchedRemover  看完 → 切下一条 → 删掉刚看完的                    │
│  └─ PlaylistTools   播放列表页的「⋯」菜单、确认框、撤销提示（§25）    │
└──────────────┬───────────────────────────────────────────────────────┘
               │ chrome.storage（按身份存的队列设置、清空快照）；日志发给 service worker
┌──────────────▼──────── service worker ──────────┐
│ Log（§4）、Settings、最近获得焦点的 YouTube 标签页 │
└──────────────────────────────────────────────────┘
```

- 写操作都在 MAIN world 里做：认证要的 cookie 和 `ytcfg` 在页面里，同源请求也最像用户自己的操作。
- 设置页要读列表、新建列表、读身份时，交给最近使用的 YouTube 标签页去做：设置页自己用 `tabs.sendMessage` 发给那个标签页的 content script（按 `active`、再按 `lastAccessed` 选标签页，自检也用同一个规则），不用 service worker 记焦点。
- MAIN world 和 isolated 之间的消息只带一个固定的 tag，没有做 nonce：MAIN world 就是页面自己的 JS 环境，nonce 放在哪儿页面都读得到，防不了什么。
- 纯逻辑（按身份取设置、判断接不接管、看完后的下一条、清空和撤销的计划）不碰 DOM、不直接 `fetch`，依赖从外面注入，方便单元测试。
- 所有 DOM 选择器和 InnerTube 字段路径各集中在一个文件里，YouTube 改版时只改那一处（跟 §14.3 一样）。

## 24. 播放列表模式

### 24.1 什么时候接管

全部满足才接管，否则「加入队列」保持原生行为：

1. 队列功能开着，当前身份选的是播放列表模式；
2. YouTube 已登录（`LOGGED_IN`）；
3. 当前身份选了列表；
4. 这个列表当前身份能编辑。

不满足 3 时，第一次点「加入队列」弹提示「还没有选择播放列表 · 去设置」（这一次不拦，照原生加进官方队列）。不满足 4 时提示「当前账号不能编辑 <列表名>」，**不清空**选择，切回原来的身份就恢复。

### 24.2 加入

- QueueTakeover 在 `document` 上 capture 监听 `yt-action`：`actionName === 'yt-add-to-playlist-command'` 且 `listType === 'PLAYLIST_EDIT_LIST_TYPE_QUEUE'` 时 `stopImmediatePropagation()`，把 `videoIds` 交给 QueueMode。
- QueueMode 对列表发 `ACTION_ADD_VIDEO`（`DEDUPE_OPTION_SKIP`），成功后底部提示「已加入 <列表名> · 查看」，「查看」打开列表页。已经在列表里的提示「已在 <列表名> 中」。
- 如果当前正在播放这个列表，加完后右侧面板 / 迷你播放器下面的列表按 §24.8 重设。
- **把列表挂到当前播放上**（跟官方队列一样能看到）：正在看一个不属于任何列表的视频（观看页，或者迷你播放器开着）时，加完后照官方队列的做法（§21.4）：用当前视频和列表 ID 请求一次 `next`，在本地把当前视频插到列表最前面（不写进服务器上的列表），自动播放改指列表第一条，然后交给 `yt-playlist-manager` 的三个方法。不重新载入，右侧面板 / 迷你播放器下面马上出现列表，当前视频放完由官方自动播放接列表第一条。正在播别的列表或者在放广告时不挂，只有提示。
- 加入前先读一遍列表，已经在里面的视频不再发 `ACTION_ADD_VIDEO`，提示「已在 <列表名> 中」（服务器不认 `DEDUPE_OPTION_SKIP`，见 §21.4）。
- 加入之后数字和已经显示列表的面板怎么更新见 §24.8。
- 那三个方法不在了（YouTube 改版）或者 `next` 的结构对不上时退回：只在观看页上用 SPA 导航到 `watch?v=<当前视频>&list=<ID>&t=<秒数>s`（重新载入约 1 秒）。这样挂上后播放器的位置是 0，官方自动播放会跳过列表第一条，所以这个视频放完时不管勾没勾「播放完后删除」，都由扩展切到第一条。迷你播放器里不退回（导航会把它展开成观看页）。
- 发送失败：提示「加入失败」，写日志，不重试、不排队（没有 outbox 了）。返回结果说明列表不存在时，按 §24.5 处理。

### 24.3 改文字

- 菜单每次打开时，找到 §21.3 说的那一项，改成「加入 <列表名>」；新版菜单改 `textContent`，旧版菜单设 `ytFormattedString.text`。悬停按钮改 `untoggledTooltip`（实现时再确认）。
- 不接管时（§24.1 不满足、或关掉了播放列表模式）把文字改回原样。因为菜单 DOM 是复用的，不改回去会一直显示旧文字。

### 24.4 播放和看完删除

- **播放按钮**：顶栏头像左边，「▶ <列表名> · N」。点了打开 `watch?v=<第一条>&list=<ID>`。列表是空的时按钮变灰。
- **看完**：只在播放这个列表时才算（URL 里 `list` 是选中的列表 ID）。视频触发 `ended`，或者剩不到 10 秒时切到别的视频、关掉标签页，就算看完。单独打开同一个视频看完不算。
- **勾选「播放完后删除」时**：看完后由扩展算出列表里的下一条，跳到 `watch?v=<下一条>&list=<ID>`，然后再删掉刚看完的那一条（按 `setVideoId`）。每次跳转页面都会重新请求 `next`，别的标签页、手机上的改动也顺带同步过来。剩不到 10 秒切走、关标签页的情况只删，不跳。最后一条看完后列表空了，就停在结束画面。
- **不勾选时**：完全交给官方自动播放，扩展不插手。

### 24.5 选列表、新建、列表被删

- 设置页的下拉框列出当前身份 `playlist/get_add_to_playlist` 返回的全部列表（含「稍后观看」），最后一项是「新建…」。
- 选「新建…」出现输入框，默认 `YouTube+`，可以改；建出来是私密列表，不检查重名，建好后自动选中。
- 保存的是列表 ID。读列表或加入时发现这个 ID 已经不存在（被你在别处删了），就清空这个身份的选择，按 §24.1 第 3 条处理。

### 24.6 切换模式

- 不迁移任何数据：官方队列里的视频不搬进列表，列表也不动。
- 已经打开的标签页：从自带队列切到播放列表时，这个标签页里已有的官方队列保持原样，点缩略图仍可能加进官方队列（§21.2 那个绕过事件的路径）。在这个标签页弹一次提示「已切换到播放列表模式，刷新页面后生效」。反过来切也一样提示。

### 24.7 身份

- 用 `DATASYNC_ID` 区分身份：不管是另一个 Google 账号，还是同一账号下的另一个频道，都算不同的身份。存储时只存它的哈希（SHA-256 的前 16 位十六进制，在页面里算）。
- 按身份存的只有：模式、列表 ID 和列表名（显示用）、看完删除、清空快照。前四项存在 `chrome.storage.sync` 的 `queue/profile/<哈希>`，快照存在 `chrome.storage.local` 的 `queue/snapshot/<哈希>`。
- 页面上身份变了（切换账号后页面会整页重新加载），重新读这个身份的设置。

### 24.8 界面跟列表保持同步

列表不管被谁改了，顶栏按钮的数字和正在显示的列表面板（观看页右侧、迷你播放器下面）都要跟上。

- **谁会改列表**：扩展自己（加入、看完删除、清空、撤销）；页面自己（右侧面板 ⋯「从播放列表中删除」、「保存到播放列表」、迷你播放器里已经有这个列表时页面直接往里加）；别的标签页和手机。
- **怎么知道**：MAIN world 在 document_start 包一层 `window.fetch`，只读不改：看到页面发的 `browse/edit_playlist` 并且成功了，就读出请求体（页面传的是 `Request` 对象，要先 `clone()`）里的列表 ID 和增删内容，发给 isolated 一侧。扩展自己的请求不经过这里（`prepare()` 出来的 init 记在一个 WeakSet 里，监听时跳过），而是在 `editPlaylist` 成功后直接发同样的事件。2026-11-20 实测：页面删除走 `fetch`，删完页面会自己再请求一次 `next`。
- **收到以后**：300 毫秒内的连续修改合并成一次（清空每 100 个一批）。然后两件事并行：重读列表更新按钮数字；如果正在播这个列表，用 §21.4 的办法（`next` + `yt-playlist-manager` 的三个方法）重设面板。`yt-refresh-playlist-command` 在迷你播放器里不发 `next`，不用它（只在那三个方法不在时作为退路）。
- **读取延迟**：删除后几秒内读到的可能还是旧列表（加入是立刻可见的）。所以带上「应该出现哪些视频、哪些条目应该不见了」去读，没满足就在 1.5 / 3 / 5 秒后再读，最后一次不管满不满足都用。
- **数字从哪来**（2026-11-20 修：面板 2 条、数字 3）：只有一个来源，就是「最新一份列表数据 + 最近的已知修改」。最新一份是扩展自己读到的列表，或者页面刚交给面板的列表（页面每次 `setPlaylistData` 都会在 document 上派发 `yt-playlist-data-updated`，MAIN world 这时读 `getPlaylistData()` 报上来；扩展插在最前面的那条没有 `playlistSetVideoId`，不算），比较时间，晚的那份为准。已知修改（自己的和页面的增删）收到就立刻算进数字，并在 30 秒内一直叠加在任何读取结果上，所以读到旧数据也不会把数字改回去。加进去又按条目删掉的，从「应该有」里去掉。
- **别的标签页、手机上改的**：没有事件。切回这个标签页时（距上次读超过 5 秒）重读一次，跟上次的顺序指纹不一样就更新数字和面板。

## 25. 清空全部与移除已看完

- **范围**：你自己的任何播放列表页（`playlistVideoListRenderer.isEditable`）。两种模式下都能用。
- **入口**：列表头部，跟「全部播放」「随机播放」并排的「⋯」菜单，里面有「清空全部」和「移除已看完」（「已看完」指进度条 ≥ 90%）。
- **流程**：读出所有条目 → 弹出确认框：「将从『<列表名>』删除 N 个视频」→ 每批最多 100 个 `ACTION_REMOVE_VIDEO` → 刷新页面上的列表 → 底部提示「已删除 N 个 · 撤销」，显示 10 秒。
- **撤销**：按原来的顺序加回去。「移除已看完」删掉的条目，加回后用 `ACTION_MOVE_VIDEO_AFTER` 放回原来的位置。
- **最近一次快照**：`{列表 ID、列表名、时间、删掉的视频 ID 和原来的位置}`，存在 `chrome.storage.local`，**按身份存**，下一次清空时覆盖。设置页的队列标签里可以一键恢复（恢复到当前身份的快照）。

## 26. 失败处理

- 加入、删除失败：提示并写日志，不重试。扩展不阻止页面的任何其他操作；自己出的异常一律捕获并写进日志。
- 接管时如果识别不到菜单项或命令结构对不上（YouTube 改版），这一次不拦，照原生处理，写一条 warn 日志。宁可退回原生，也不能让「加入队列」点了没反应。
- 内部接口返回的结构对不上时，记为协议错误，暂停接管，并在设置页显示。

## 27. 设置与自检

**设置页顶部（所有标签共用）**：登录状态，两行：
- YouTube：「已登录 <名字>」或「未登录 · 去登录」
- Gemini：「已登录」或「未登录 · 去登录」

两个可以是不同的 Google 账号。没登录时，依赖它的功能区灰掉，并写明原因（TL;DR 写「需要登录 Gemini」，队列的播放列表模式写「需要登录 YouTube」）。不需要登录的功能（播放器）照常可用。

**队列标签**：
- 顶部：「正在设置：<头像 + 名字>」，以最近获得焦点的 YouTube 标签页为准。没有打开的 YouTube 标签页时显示「请先打开一个 YouTube 页面」和「打开 YouTube」按钮，打开后自动刷新。
- 模式，二选一（默认自带队列）：

  > **◉ 使用 YouTube 自带的队列**
  > 点「加入队列」后视频在迷你播放器里排队，当前视频放完自动播下一个。**队列只存在于当前标签页**：关掉标签页、换个标签页或换台设备，队列就没了。YouTube+ 不会改动它。
  >
  > **◉ 使用播放列表（推荐）**
  > 「加入队列」会变成「加入 <列表名>」，视频存进你账号里的一个播放列表。**关掉页面、换设备都不会丢**，手机上也能看到。加入后不会马上排在下一个播放；点顶栏的「播放 <列表名>」才会连续播放。勾选「播放完后删除」时，由 YouTube+ 负责切到下一条。
  > 列表：[下拉框 ▾]　☑ 播放完后从列表中删除

- 最近一次清空的内容，以及「恢复」按钮。

**自检**（需要一个打开着的 YouTube 标签页；没有的话提示先打开一个）：
1. 页面上能拿到 `ytd-app` 和 `ytcfg`，已登录，`playlist/get_add_to_playlist` 返回 200，并且读到的是当前频道的数据。
2. 播放列表模式下：选中的列表存在、能编辑，读一次条目数。
3. QueueTakeover 的 capture 监听已经装上。

## 28. 写代码前要实测的

1. 悬停按钮：拦截是否生效、`untoggledTooltip` 能不能改写。
2. 扩展自己跳到下一条（`watch?v=&list=`）时，用 SPA 导航（派发 `yt-navigate` 或点面板里那一项）还是整页跳转；要保证 `next` 被重新请求、面板选中状态正确。
3. 从页面上读当前身份的头像和名字（给设置页的「正在设置」用）。
4. 在设置页判断 Gemini 是否登录，用 TL;DR 现有的检查能不能直接复用。

前三轮实测（2026-11-14、11-18、11-20）的结果已经写进 §21。

### 28.1 实现时定的细节（2026-11-20，手测通过）

上面四项没来得及先实测，按下面的做法写了，2026-11-20 手测正常：

1. **悬停按钮**：拦截走的是同一个 `yt-action`，不另外处理。改文字是在鼠标移到按钮上时把 `data` 换成一个 `untoggledTooltip` 改过的副本（Polymer 会重新渲染）；不接管时换回原来的。
2. **跳到下一条**：在 `ytd-app` 上派发 `yt-navigate`（带 `watchEndpoint{videoId, playlistId}`），1.5 秒内没看到 `yt-navigate-start` 就整页跳转。顶栏按钮和「查看」（打开列表页，用 `browseEndpoint`）也走这条路。
3. **头像和名字**：名字用 `ytcfg` 的 `USER_ACCOUNT_NAME`，头像读顶栏 `#avatar-btn img` 的 `src`，读不到就只显示名字。
4. **Gemini 登录状态**：直接用 TL;DR 已有的 `tldr-status`（打开设置页时先 `tldr-recheck` 一次）。TL;DR 关掉时不显示 Gemini 那一行。

另外几处也是推测的写法：

- **新版菜单的数据**：从菜单项往上找祖先元素上的 `componentProps`（元素本身、`ytSheetViewModel`、或者元素的任一属性下面），`data` 是函数就调用，再在结果里找 `listItems`。按菜单项在 sheet 里的序号取对应那一项，用标题核对序号对得上，再按图标 `ADD_TO_QUEUE_TAIL` 或命令判断是不是「加入队列」。找不到数据就不改文字（拦截不受影响）。
- **刷新右侧面板**：列表改了以后用 `next` 加 `yt-playlist-manager` 的三个方法重设（§24.8）；`yt-refresh-playlist-command`（在 `ytd-app` 上派发 `yt-action`）只在那三个方法不在时作为退路。
- **「已在列表中」**：加入前先读列表比对（`DEDUPE_OPTION_SKIP` 实测不起作用，§21.4）。
- **剩不到 10 秒时关掉标签页**：剩 10 秒时扩展先读一次列表，算好下一条和要删的那一条，并让页面脚本预先签好一个删除请求（每分钟重签一次）；`pagehide` 时页面脚本直接用 `fetch(..., {keepalive: true})` 发出去，不经过 isolated 一侧。
- **协议错误**（§26）：目前只认一种：`playlist/get_add_to_playlist` 一个列表都没返回（「稍后观看」总该在）。出现时这个页面停止接管，记一条 error 日志，设置页队列标签里显示，可以手动关掉提示。

## 29. 开发顺序与测试

以下 1–6 步 2026-11-20 都已完成，同日手测通过。

1. **删掉同步**：`sync.ts`、`outbox.ts`、`core.ts` 里 TLPQ 的翻译和覆盖逻辑、FetchTap 对 TLPQ 的抓取、对应的自检项和设置项（列表名字输入框、outbox 计数）、存储里的 outbox、列表 ID 和映射。§25 的代码保留。
2. 身份：`DATASYNC_ID` 哈希，按身份存取队列设置；把旧的全局设置迁成「没选列表」（旧的按名字找到的 ID 不沿用，§24.5）。实现：扩展更新时删掉旧的 `queue/list`、`queue/outbox`、`queue/outbox-lock`、`queue/state`、`queue/snapshot`；`settings.queue.listName` 不再读，下次保存设置时自然消失。
3. 设置页：顶部登录状态、「正在设置」、模式单选和说明、下拉框和新建。
4. QueueTakeover 和改文字。
5. 顶栏播放按钮、看完后切下一条并删除。
6. 自检、失败提示。

**测试**
- 单元测试（Vitest）：按身份取设置；§24.1 的接管判断；识别「加入队列」命令（用实测录下来的新旧两种菜单数据）；看完后的下一条（中间、最后一条、列表在别处被改过）；清空和撤销的计划（按 100 个分批、放回原位置）。
- 手测清单：各个入口的接管和文字（首页、搜索、观看页侧栏、Shorts、播放列表页、悬停按钮）；关掉播放列表模式后文字恢复；正在播放列表时加入；看完删除并切下一条、最后一条、剩 10 秒切走；列表在别处被删；切换频道和 Google 账号；没登录；中途切换模式；清空和撤销。
- 不做 E2E。

## 30. 以后再做

- 跟 tesla-video-streamer 打通：加一个「送到车上」按钮，或者桌面和车共用一个列表。
- 播放列表模式下的「插到下一个播放」（需要扩展自己维护播放顺序，先不做）。
- **列表面板里一键清空**（意向，2026-11-20）：§25 的「清空全部」现在只在播放列表页头部的「⋯」里。想在正在显示列表的面板（观看页右侧、迷你播放器下面）头部也加一个入口，不用先跳到列表页。确认框、分批删除、撤销和快照全部沿用 §25。清空的是正在播的列表时，删完停在当前视频，不再自动播下一条（§21.4 说过删正在播的列表会让官方自动播放出错），面板按 §24.8 更新。
- **多选后删除**（意向，2026-11-20）：在你自己的播放列表页（`isEditable`）每一行前面加勾选框，支持按住 Shift 选一段、「全选 / 全不选」；选了以后头部出现「删除所选（N）」。删除按 `setVideoId` 每批 100 个 `ACTION_REMOVE_VIDEO`，确认框、撤销（加回后用 `ACTION_MOVE_VIDEO_AFTER` 放回原位）、快照都跟 §25 共用一套。列表面板里要不要也能多选，做的时候再定。待实测：列表页是虚拟滚动还是分页加载（没加载出来的行怎么「全选」）；勾选框加在 `ytd-playlist-video-renderer` 上会不会被 Polymer 重新渲染时冲掉。

## 31. 参考来源

- Trinovantes/userscript-youtube-playlist-organizer（往队列里加视频、`editPlaylist.ts`）：https://github.com/Trinovantes/userscript-youtube-playlist-organizer
- YouTube.js `PlaylistManager.ts`：https://github.com/LuanRT/YouTube.js/blob/main/src/core/managers/PlaylistManager.ts
- ytmusicapi `playlists.py`：https://github.com/sigma67/ytmusicapi/blob/main/ytmusicapi/mixins/playlists.py
- PlaylistPlus（批量删除、分页）：https://greasyfork.org/scripts/574930-playlistplus/code
- 官方「加入队列」介绍：https://www.howtogeek.com/447419/how-to-use-youtube%E2%80%99s-queue-feature/
- 官方迷你播放器：https://support.google.com/youtube/answer/9162927

---

# 第四部分　播放器

## 32. 一句话描述

对官方播放器做几处小改进：迷你播放器补上音量和可拖动的进度条；迷你播放器可以拖到任意位置，并记住位置和大小；在观看页往下滚动时，播放器固定在顶部（影院模式会自动切换）；所有页面加一个半透明的「回到顶部」按钮。

## 33. 背景：官方迷你播放器（2026-11-14 在浏览器里实测）

- 迷你播放器和大播放器是**同一个** `#movie_player`。变小以后，它会加上 `ytp-player-minimized` 类，官方的底部控件栏 `.ytp-chrome-bottom` 被设成 `display: none`。
- 默认大小是 400×300（下面另有约 76 px 的标题栏）。外面是 `ytd-miniplayer`；拖动靠 `yt-draggable`（`ytdMiniplayerComponentDraggable`），**四条边、四个角都可以拉着调大小**（`ytdMiniplayerComponentResizer*`）。松手时只会吸附到四个角。
- 它自带的控件（`.ytp-miniplayer-ui`）有：关闭、展开（`i`）、上一个 / 播放 / 下一个、时间，以及底部一条 5 px 的细进度条。**没有音量，也没有速度。**
- 用 CSS 让 `.ytp-chrome-bottom` 在迷你状态下重新显示出来，400 px 宽能放下：播放、音量、时间，右边是收起的「<」和齿轮。打开齿轮菜单，高 190 px，没有被截掉，菜单里有「播放速度」。

## 34. 关键决定一览

| 播放器 # | 主题 | 决定 |
|---|---|---|
| Q1 | 定位 | YouTube+ 的第三个功能「播放器」，有总开关；下面四项各有子开关，默认都开：迷你播放器控件、自由拖动、滚动时置顶、回到顶部 |
| Q2/Q14 | 迷你播放器加什么 | 音量、可拖动的进度条加时间。播放速度不专门做（齿轮菜单里本来就有） |
| Q3 | 控件怎么做 | 不自己画，鼠标悬停时把官方底部控件栏重新显示出来 |
| Q15 | 重复的控件 | 悬停时藏掉迷你播放器自带的中间一排、时间和细进度条，只保留「展开」和「关闭」 |
| Q4 | 吸附 | 松手时离边缘或角落小于约 24 px 就吸过去，否则停在松手的地方 |
| Q5 | 记住 | 存「离哪个角最近 + 离这个角多远」和大小，放在 `chrome.storage.local`，每台电脑各存各的 |
| Q6/Q8 | 普通模式置顶 | 播放器固定在原位，下面的内容往上滚，被它盖住；暂停时也置顶；没有 × 按钮 |
| Q6/Q9 | 影院模式 | 往下滚自动切到普通模式并置顶，回到最顶端自动切回；不改你保存的偏好 |
| Q10 | 置顶时按 `t` | 回到最顶端，进入影院模式，并保存为你的偏好 |
| Q11 | 置顶时点时间戳 | 只跳到那个时间点，不滚动页面 |
| Q12/Q13 | 回到顶部按钮 | 所有 YouTube 页面都有；半透明深灰圆形加浅蓝色箭头；点了直接跳到最顶端 |

## 35. 迷你播放器

### 35.1 控件
- 鼠标悬停在迷你播放器上时，用 CSS 让 `.ytp-chrome-bottom` 显示出来（跟大播放器一样，会自动隐藏）。显示出来以后，就有了音量（静音键加横向滑块）、进度条、时间和齿轮菜单。窗口太窄时，官方会自己把右边的按钮收进「<」里。
- `.ytp-miniplayer-ui`（z-index 67，里面的 scrim 点一下就暂停）盖在控件栏（59）上面，所以控件栏要提到 68、弹出菜单（`.ytp-popup`，齿轮菜单）提到 69，否则点击全落在 scrim 上（2026-11-18 实测修复）。
- 悬停时藏掉重复的部分：`.ytp-miniplayer-ui` 里中间的上一个 / 播放 / 下一个和时间，还有 5 px 细进度条（2026-11 起它是 `#movie_player` 的直接子元素，不在 `.ytp-miniplayer-ui` 里了；没藏掉时进度条上会出现两个圆点）。左上角的「展开」和右上角的「关闭」保留。
- 前提：在队列里播放时，控件栏里会出现上一个和下一个（§38 第 1 条）。如果不会，就保留中间那一排，只藏掉时间和细进度条。
- 键盘快捷键（方向键调音量、`m` 静音等）照官方的，不改。

### 35.2 拖动与吸附
- 拖动的方式跟官方一样，只改松手时的行为：离视口边缘小于约 24 px，就贴到那条边（跟官方一样留 16 px 间隔；上边以 YouTube 顶栏的下沿为准）；同时离两条边都这么近（也就是在角落），就贴到那个角；其他位置就停在松手的地方。
- 拖动只从视频区域开始。在控件栏上按下鼠标不会拖动窗口，这样拖进度条和音量条不会把整个窗口拖走。
- 调大小沿用官方的边和角。

### 35.3 记住位置和大小
- 每次拖动或调大小结束时保存：`{corner: 'tl'|'tr'|'bl'|'br', dx, dy, width, height}`。`corner` 是离窗口中心最近的那个角，`dx`、`dy` 是离那个角的距离。
- 放在 `chrome.storage.local`，每台电脑各存各的，不跨设备同步（屏幕大小不一样）。
- 迷你播放器出现时，以及浏览器窗口大小变化时，按保存的角和距离重新摆放，并保证整个窗口都在视口里面（放不下就往那个角里推）。
- 还没有保存过的时候，用官方的默认位置。
- 大小怎么恢复（2026-11-18 实测）：YouTube 把迷你播放器的大小存在组件内部状态里（默认宽 400），每次渲染都把它写回 inline style，只有它自己的调整手柄（真实鼠标事件）能改；合成事件无效，也不存进 localStorage。所以不能直接写 inline 宽高：第一次打开时画面框变大了，视频还是 400×225；展开队列面板一重新渲染，又缩回 400。做法是：
  - 只记宽度差 `dW = 保存的宽 − YouTube 的宽`（高度会因队列面板开合而变，不能用）。
  - 用 CSS 变量加 `!important` 显示「YouTube 的大小 + 差值」：外框宽 +dW；视频区宽 +dW，高按视频区原来的比例算，外框高加上同样的高度差。YouTube 每写一次 inline（渲染、官方调整大小），就重新算一遍，所以官方手柄照常能用，从当前显示的大小开始，不会跳。
  - 视频本身要靠播放器的 `setInternalSize(w, h)` 才会跟着变，这只能在页面的 JS 环境里调：`player-main.ts`（MAIN world）在 `html[data-ytpp-mini-sized]` 存在并且播放器处于迷你状态时，发现播放器框和 `getPlayerSize()` 不一致就调用它。回到观看页时不插手，由 YouTube 自己排版。

## 36. 观看页

### 36.1 普通模式下置顶
- 播放器滚到要出屏幕的时候固定住，留在原来的位置（YouTube 顶栏下面，左栏原来的横向位置和大小）；下面的标题、简介、评论继续往上滚，滚到它那里就被盖住。右边的推荐栏照常滚动。
- 用 `position: sticky` 实现（实测可行，§38 第 5 条），不需要占位，页面不会跳。
- 只要页面还能往下滚（比如右边推荐栏比评论长），播放器就一直置顶。sticky 出不了父元素，而 `#primary-inner` 只到评论结束，所以要给它 `min-height: 100%`，撑满和页面一样高的 `#primary`（2026-11-18 实测修复：原来滚过评论底部，播放器就被顶上去）。
- 视频暂停时也照样置顶。没有 × 按钮；不想要这个功能，就在设置里把子开关关掉。
- 只在观看页生效；Shorts 不管。

### 36.2 影院模式
- 页面在最顶端、开着影院模式时，**一开始往下滚**，就切到普通模式并按 §36.1 置顶。
- 页面回到 `scrollY === 0` 时，切回影院模式。
- 只有扩展自己切过去的，才会自动切回来（记一个「是我切的」的标记）。你在中途自己切过模式，这个标记就清掉，不再自动切回。
- 自动切换**不改**你在 YouTube 保存的偏好：即使在已经切到普通模式的时候关掉标签页，下次打开视频还是影院模式。偏好存在哪里、怎么做到不改，见 §38 第 3 条。
- 切换会让页面高度变化，可能马上又触发反方向的切换，所以要加缓冲：切到普通模式以后，必须真正回到 `scrollY === 0` 才切回去；切换后的短时间内不响应由切换本身引起的 scroll 事件。

### 36.3 置顶时按 `t` 或点影院模式按钮
你多半是想看大画面。所以：回到最顶端，进入影院模式，并把它保存成你在 YouTube 的偏好（这次是你自己的选择）。

### 36.4 置顶时点时间戳
官方点简介或评论里的时间戳时，会跳到那个时间点，同时把页面滚回最顶端。置顶时播放器本来就看得见，所以只跳时间，**不滚动页面**，你停在原来那条评论那里。没有置顶时照官方的做。

## 37. 回到顶部按钮

- 所有 YouTube 页面都有（Shorts 除外）。
- 样子：直径 48 px 的圆，离右边和下边各 24 px。背景 `rgba(32,33,36,.55)`，亮色主题和深色主题都用这一种；中间是浅蓝色 `#8ab4f8` 的向上箭头。鼠标悬停时背景更不透明。用 Shadow DOM，样式不受页面影响。
- 往下滚超过 300 px 时淡入出现；回到最顶端时淡出。
- 点了以后**直接跳**到最顶端，不做平滑滚动（平滑滚动的话，影院模式要等滚到一半才切回来）。到了顶端，§36.2 的规则会自动切回影院模式。
- 迷你播放器跟按钮重叠时，迷你播放器盖在按钮上面，按钮不避让（2026-11-18 定：先这样用，实际看过以后再决定怎么处理）。

**设置项**（设置页的播放器标签）：四个子开关（§34 Q1）、「重置迷你播放器位置」按钮。

**自检**（需要一个打开着的 YouTube 标签页）：
1. 页面上能找到 `#movie_player`、`.ytp-chrome-bottom` 和 `ytd-miniplayer`。
2. 能找到迷你播放器的拖动组件，§38 第 2 条里定下来的拦截点还在。
3. 能找到影院模式按钮，能读到当前的影院模式偏好。

## 38. 写代码前要实测的

1. 在队列里播放时，迷你状态下的官方控件栏会不会出现上一个和下一个（决定 §35.1 要不要保留中间那一排）。
2. 官方的四角吸附是在哪里实现的（`yt-draggable` 的事件、松手后的回调还是 CSS），怎么拦掉它、换成 §35.2 的规则，同时保留拖动和调大小。官方会不会自己记位置，跟我们的记录冲不冲突。
3. 影院模式的偏好存在哪里（cookie `wide` 还是别的地方），用什么方式切换（点按钮、派发 `yt-action`、还是直接改 `ytd-watch-flexy` 的属性），才能做到自动切换时不改偏好。
4. 官方点时间戳时的「滚回顶端」能不能单独拦掉，同时保留跳转（比如在 capture 阶段拦截后自己调 `seekTo`，这时可能需要 MAIN world 脚本）。
5. 普通模式置顶时，播放器用 `position: sticky` 还是 `fixed` 加占位，哪种不会跟 `ytd-watch-flexy` 的布局计算打架（窗口大小变化、打开或收起聊天栏、打开或收起章节面板）。
6. 从影院模式切到普通模式时，页面高度和 `scrollY` 实际怎么变，用来定 §36.2 的缓冲。

### 38.1 实测结果（2026-11-18）

1. 不在播放列表里时，迷你状态下的官方控件栏没有上一个 / 下一个。实现：悬停时如果迷你播放器自己那一排里有可见的上一个 / 下一个，而控件栏里没有，就保留中间那一排；否则藏掉。队列里的实际情况等做队列时再看。
2. 官方拖动在 `pointerdown` / `mousedown` 上开始，拖动中用 `transform` 移动，松手后改 `ytd-miniplayer` 行内样式的 `right` / `bottom`（大小是行内的 `width` / `height`），只吸附四个角。实现：在捕获阶段拦掉视频区域上的按下事件，自己做拖动；位置用样式表里的 `left` / `top !important` 盖过官方的行内样式；大小沿用官方调整，从左边或上边拉的时候，我们保持对边不动。迷你播放器出现时 `ytd-app` 上有 `miniplayer-is-active` 属性。
3. 影院模式的偏好是 cookie `wide`（`1` / `0`）。点 `.ytp-size-button` 后约 40–75 ms，`ytd-watch-flexy` 的 `theater` 属性和 cookie 一起变，再过约 70 ms 页面会滚回 `y = 0`。实现：自动切换时点这个按钮，等属性变了以后把 cookie 写回原值，并把页面滚回切换前的位置。
4. 官方点时间戳：立刻跳到那个时间，约 0.8 秒后平滑滚回顶端。在捕获阶段拦下点击，自己设 `video.currentTime`，就只跳时间不滚动；isolated world 就能做，不需要 MAIN world。
5. `#primary-inner > #player` 上用 `position: sticky` 可行：`#primary-inner` 占满左栏全高，祖先都没有裁剪。
6. 影院模式和普通模式之间切换时，页面会被滚回顶端（见第 3 条），所以缓冲就是：切换后 400 ms 内不响应滚动，并把位置恢复。

## 39. 开发顺序与测试

以下 1–6 步都已完成，2026-11-20 手测通过。

1. **最小验证**：逐条跑通 §38（结果见 §38.1）。
2. 回到顶部按钮（最独立）。
3. 迷你播放器控件（纯 CSS 为主）。
4. 迷你播放器的拖动、吸附和记位置。位置计算（找最近的角、限制在视口里）写成纯函数。
5. 普通模式置顶，然后是影院模式自动切换、`t` 键、时间戳。
6. 设置页的播放器标签和自检。

**测试**
- 单元测试（Vitest）：位置计算（吸附判断、最近的角、窗口缩小后限制在视口里）；影院模式自动切换的状态机（「是我切的」标记、手动切换后清掉标记、缓冲）。
- 手测清单：迷你播放器在四个角和中间各拖一次，刷新、换窗口大小后看位置；在迷你播放器上拖进度条和音量条，窗口不跟着动；普通模式和影院模式下往下滚、滚回顶端、按 `t`、点时间戳；看完以后关掉标签页，再打开视频还是影院模式；回到顶部按钮在首页、搜索、观看页出现，迷你播放器拖到右下角时盖在按钮上面；亮色和深色主题下都看一遍。
- 不做 E2E。

## 40. 以后再做

### 40.1 迷你播放器弹出到桌面（意向，2026-11-20，未实测）

**想要什么**：迷你播放器不只能在页面里拖，还能放到整个桌面上随便挪，切到别的标签页或别的程序时也一直浮在最上面。

**只能用浏览器的画中画（PiP）**：页面里的任何元素都出不了浏览器窗口，§35.2 的拖动做不到这一点。可选的做法：

| | 做法 | 能放什么 | 问题 |
|---|---|---|---|
| 0 | 视频画中画：`video.requestPictureInPicture()` | 只有画面；控件由浏览器给，只有播放/暂停、上一个/下一个、回到标签页 | YouTube 已经有了（连按两次右键 → 画中画），扩展再做没有新东西 |
| A | Document PiP（`documentPictureInPicture.requestWindow()`），把整个 `#movie_player` 搬进去 | 官方完整控件，§35.1 的改造也跟过去 | YouTube 在观看页和迷你播放器之间切换时会把 `#movie_player` 搬回自己的容器，跟我们抢；播放器按主窗口算大小，PiP 窗口改大小它不知道 |
| B | Document PiP，只搬 `<video>`，控件自己画 | 画面加我们自己的控件（播放、进度条、音量、上一个/下一个），以后还能放队列/播放列表面板 | 要多写一套控件，但不太跟 YouTube 抢东西 |

Document PiP 是一个永远置顶的小窗口，里面可以放任意 HTML，只有桌面版 Chrome/Edge 116 以上支持，Firefox 不支持。把正在播放的 `<video>` 从一个文档搬到另一个文档，播放不会停（Google 的官方示例就是这么做的）。

**改不了的限制**：
- 只能由用户点击打开（比如迷你播放器上加一个「弹出到桌面」按钮），不能在滚动或切标签页时自动弹出。
- 窗口位置只能用户自己拖，脚本设不了（`moveTo` 被禁用），所以 §35.3 的记位置不适用。会不会记住上次的位置由 Chrome 决定。
- 整个浏览器同时只能有一个 PiP 窗口。打开它的标签页关掉或整页跳转时窗口跟着关；YouTube 站内切换页面不受影响。
- YouTube 的快捷键绑在主页面的 `document` 上，焦点在 PiP 窗口时不起作用，要自己接；样式表也要复制到新窗口里。
- Linux 的 Wayland 下 PiP 窗口可能不置顶（看桌面合成器，GNOME 最可疑）；X11 下应该没问题。

**真要做时的顺序**：
1. 先花半天做原型，在自己的 Chrome 上验证：A 能不能稳定用（切视频、广告、回到观看页）；搬过去以后控件正不正常；窗口在自己的桌面环境里是否一直置顶。
2. A 稳定就用 A（代码最少）；不稳就用 B。
3. §35.2 的页面内拖动保持不变；「弹出到桌面」作为单独一项，加到 §34 Q1 的子开关里。

### 40.2 单个视频循环（意向，2026-11-20，未实测）

**想要什么**：一个看得见的按钮，让当前视频放完从头再放，不用每次去右键菜单里找。

- 官方已经有：在播放器上点右键 →「循环播放」（应该就是设 `<video>.loop`）。所以只是把它做成控件栏上的一个按钮，开着时高亮。迷你播放器悬停时显示的就是官方控件栏（§35.1），按钮会一起出现。
- 待定：只对当前这一个视频有效（换视频就关掉，跟官方右键菜单一致），还是一直开着直到手动关。倾向前者。
- 跟队列的关系：循环时 `<video>` 不会触发 `ended`，所以不算看完，不会被「播放完后删除」删掉，也不会切到下一条，这正是想要的。但 §24.4 的「剩不到 10 秒时切走算看完」要注意：循环时从结尾跳回开头不能被当成「切走」。
- 待实测：右键菜单的「循环播放」到底改的是什么（`video.loop` 还是播放器内部状态），我们的按钮和右键菜单要显示同一个状态；在播放列表里循环时，官方的自动播放会不会抢先切到下一条。

---

# 第五部分　评论弹幕（意向，2026-11-20，未实测）

> 只是意向，还没讨论细节，也没实测。下面的编号接着第四部分。

## 41. 一句话描述

把视频的评论做成弹幕，在画面上从右往左飘过。评论里带时间戳的，就在那个时间点出现；赞多的评论优先显示。

## 42. 初步想法

- **评论从哪来**：跟页面一样调 InnerTube 的 `next`，用评论区的 continuation token 往下翻页。只读，不改。翻多少页要有上限（比如前几百条），按需加载，不一次拉完。
- **时间戳**：评论文字里的时间戳 YouTube 已经解析成链接了（`commandRuns` / `navigationEndpoint` 里的 `watchEndpoint.startTimeSeconds`），直接用，不自己用正则匹配。一条评论有多个时间戳时，每个时间点各出现一次（只显示那个时间戳附近的一段文字，还是整条评论，待定）。
- **优先级**：同一时间段里要显示的评论太多时，按赞数排序，赞多的先上，其余丢掉。置顶评论、作者回复可以加权。
- **没有时间戳的评论**：两个选择，待定：① 不显示，只放带时间戳的；② 按赞数挑一部分，均匀撒在整个视频上。前者更「对得上画面」，后者弹幕更多。可能做成设置项。
- **显示**：一层盖在 `#movie_player` 上的透明层，`pointer-events: none`，不挡播放器的点击。控件栏上一个开关按钮。可调：密度（同屏最多几条）、透明度、字号、只用上半屏。暂停时弹幕停住，拖进度条时按新的时间重排。全屏、影院模式、迷你播放器（太小时要不要关）都要考虑。
- **回复**：先只用一级评论。
- **不做的视频**：直播和直播回放本来就有聊天回放，不处理；Shorts 不处理。

## 43. 要先想清楚 / 实测的

1. 带时间戳的评论平均有多少。如果大部分视频只有几条，只放带时间戳的会很冷清，就决定了上面「没有时间戳的评论」选哪个。
2. 评论排序：`next` 默认给「热门评论」，翻页能拿到多少条、赞数字段在哪（`likeCount` 是「1.2K」这种缩写还是精确数字）。
3. 翻评论的频率会不会被限流，要不要像 TL;DR 一样做缓存（按视频 ID 缓存一段时间）。
4. 透明层盖在播放器上面以后，官方的悬停显示控件栏、双击全屏、字幕位置会不会受影响。
5. 跟官方字幕重叠时怎么避让。
