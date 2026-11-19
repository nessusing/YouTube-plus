# yt+ 设计文档

> 状态：三个功能都已实现（2026-11-18），待在真实浏览器里手测；实测结果见 §17、§28.1、§38.1
> 日期：2026-11-14（同日加入队列功能和播放器功能）；2026-11-18 复查并加入存储用量管理
> 范围：个人自用的 Chrome 扩展（MV3），YouTube 工具合集

## 1. 概览

yt+ 是一个 YouTube 工具合集扩展。目前有三个功能：

- **TL;DR**（第二部分）：点缩略图上的图标，就能看到 Gemini 生成的视频要点，不用点开视频。
- **队列**（第三部分）：用官方的「加入队列」和迷你播放器播放，用你自己的一个私密播放列表长期保存队列。关掉标签页、开新标签页、换设备，队列都还在。另外给你自己的所有播放列表加上「清空全部」和「移除已看完」。
- **播放器**（第四部分）：迷你播放器补上音量和进度条，可以拖到任意位置并记住；观看页往下滚时播放器置顶；所有页面加一个「回到顶部」按钮。

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

**扩展图标**（2026-11-18 定稿：`docs/icon-drafts/a16.svg`，红色圆角矩形里一个 ▶ 加一个 `+`，所有尺寸都从这一张缩放。红色占满 16×16（工具栏图标的上限），▶ 和 `+` 四周留出红边；线条对齐整像素，16 px 下不发虚）。其他草稿（A、B、C、C2）保留在 `docs/icon-drafts/` 里。注意：红色播放键的外形取自 YouTube 商标，只能自用；上架 Chrome 应用商店前必须改掉。TL;DR 缩略图上的小图标另外设计（§14.1）。

## 3. 设置页

一个 options 页，样式照着 YouTube 自己的设置页：顶部左上角是 logo，左侧边栏是标签，内容区每页先是标签名、大标题和一句说明，下面是用分隔线隔开的分组，分组里是「左标签列 + 右内容列」的行。开关用 YouTube 的滑动开关，单选用 YouTube 的圆形单选，按钮是药丸形描边按钮。跟随系统深浅色；窄屏时侧边栏变成顶部一排标签。

- **通用**：语言、功能开关（TL;DR、队列、播放器，默认都开）。
- **TL;DR**：见 §15。
- **队列**：见 §27。
- **播放器**：见 §37。
- **存储**：见 §4.1。
- **诊断**：「自检」按钮（§5）、日志（§4）。

首次安装时自动打开设置页的「诊断」标签，并运行一次全部自检。需要 YouTube 标签页的自检项（队列、播放器）在没有打开的 YouTube 标签页时标为「跳过」，并提示先打开一个再重跑。

## 4. 日志

| 项 | 决定 |
|---|---|
| 位置 | 设置页「通用」标签里的日志视图，整个 yt+ 共用一份 |
| 每一行 | 时间、功能（`tldr` / `queue` / `player` / `core`）、级别（debug / info / warn / error）、内容 |
| 存储 | `chrome.storage.local`，环形缓冲区，上限默认 **2 MB**（可在设置里改，见 §4.1），满了丢掉最老的 |
| 写入 | content script 把日志发给 service worker，由它批量写入，避免频繁写存储 |
| 查看 | 可以按功能、按级别筛选；有「复制全部」和「导出 .txt」按钮 |
| 隐私 | **永远不上传**。不记 cookie、认证头（`SAPISIDHASH`、`at` token 等） |

### 4.1 存储用量

扩展申请 `unlimitedStorage` 权限，不受 `chrome.storage.local` 默认 10 MB 配额的限制；用量由扩展自己的上限控制。设置页「通用」标签里有一个「存储」区：

| 类别 | 显示 | 上限（可改） | 操作 |
|---|---|---|---|
| 日志（§4） | 占用大小、行数 | 默认 2 MB，满了丢最老的 | 清空 |
| TL;DR 缓存（§13） | 占用大小、条数 | 默认 5 MB，满了按 LRU 淘汰 | 清空 |
| 队列清空快照（§25） | 占用大小 | 只存最近一次，无需上限 | 清空 |
| 其他（outbox、熔断状态、迷你播放器位置等） | 占用大小 | — | — |

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
| Q16 | 协议 | 用 `StreamGenerate`（旧接口）；不发送模型 header，用账号默认模型；token 每次实时从页面抓取 |
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
| 未登录 | 遇到 `auth` 错误（拿不到 `SNlM0e`）后，预生成暂停 10 分钟；手动点击不受影响（2026-11-18 加，免得没登录时对每个缩略图都请求一次） |
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
| `StreamGenerate` 被下线（网页版自 2026-10 中旬起已改用 `processSession`） | 整个功能失效 | 协议全部封装在 `GeminiWebClient` 里；自检能给出明确报错；必要时逆向新协议，或者加官方 API Provider |
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

- `processSession` 新协议的迁移。
- 官方 Gemini API Provider（免费的 AI Studio key，可以直接把 YouTube URL 交给模型）。
- 「自抓字幕」Provider（需要 PO token 或其他 innertube 客户端），抓到后贴进 prompt，就可以用临时对话。
- 一个请求同时处理多个视频（目前不划算：额度按算力算，而且容易互相干扰）。
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

## 20. 一句话描述

播放用官方的「加入队列」和迷你播放器，长期保存用你自己的一个私密播放列表（默认叫 `yt+`）。扩展在两者之间双向同步，所以关掉标签页、开新标签页、换一台设备，队列都还在。另外，给你自己的所有播放列表加上「清空全部」和「移除已看完」。

## 21. 背景：官方队列与 TLPQ（调研，2026-11-14 在浏览器里实测）

- **官方队列是服务器上的一个临时播放列表**，ID 以 `TLPQ` 开头，共 26 个字符，标题是「Queue」。第一次「加入队列」时页面调用 `playlist/create` 建出来；之后再加视频，就是对它调用 `browse/edit_playlist`。
- 它的 ID 只存在当前标签页的 sessionStorage 里：`yt-queue<账号>::TLPQplaylist`，另有 `::TLPQindex`（当前播放到第几个）和 `::TLPQtimestamp`。所以**刷新后队列还在，新标签页里没有**（用户实测与此一致）。它在服务器上能存多久，目前不知道。
- 它不会出现在你的「播放列表」里，手机上看不到，yt-dlp 也读不到。所以它只能当作每个标签页的**工作副本**。
- Watch Later 和普通播放列表都长期存在你的账号里。官方 Data API 不适合用：从 2016 年起读不到 Watch Later；`playlistItems.insert` 每次花 50 单位，默认每天只有 10,000 单位；上架还需要通过 Google 的敏感权限审核。在页面里调内部接口没有这些限制。
- **往官方队列里加任意视频**：在 `ytd-app` 上派发 `yt-action` 事件，`actionName: 'yt-add-to-playlist-command'`，`args: [command, ytdApp]`。`command` 是 `addToPlaylistCommand`，其中 `listType: 'PLAYLIST_EDIT_LIST_TYPE_QUEUE'`、`videoIds: [...]`、`openMiniplayer`，以及一个用于「还没有队列时」建队列的 `onCreateListCommand`（`playlist/create`，`params: 'CAQ%3D'`）。官方菜单里的「加入队列」带的也是同一个命令。参考 Trinovantes 的 `addVideosToQueue.ts`。
- **读队列**：内部接口 `next`，参数 `playlistId: <TLPQ>`，从 `contents.twoColumnWatchNextResults.playlist.playlist.contents[].playlistPanelVideoRenderer.videoId` 读。
- **写播放列表**：`browse/edit_playlist`，请求体是 `{context, playlistId, actions: [...]}`，**一个请求可以带多个操作**（参考实现每批 100 个）。
  - 加入：`{action: 'ACTION_ADD_VIDEO', addedVideoId, dedupeOption: 'DEDUPE_OPTION_SKIP'}`
  - 删除：`{action: 'ACTION_REMOVE_VIDEO', setVideoId}`，或者按视频 ID 删除：`ACTION_REMOVE_VIDEO_BY_VIDEO_ID`
  - 移动：`{action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId, movedSetVideoIdPredecessor}`
- **读播放列表**：`browse`，参数 `browseId: 'VL<列表 ID>'`，每一条是 `playlistVideoRenderer`，带 `videoId` 和 `setVideoId`。分页用 `continuationItemRenderer` 里的 token，大约每页 100 条。Watch Later 的 ID 是 `WL`，读写方式相同。
- **认证**：在页面里 `POST /youtubei/v1/<endpoint>`，`credentials: 'include'`；请求头有 `Authorization: SAPISIDHASH <ts>_<sha1("<ts> <SAPISID> https://www.youtube.com")>`、`X-Origin`、`X-Goog-AuthUser`（来自 `ytcfg` 的 `SESSION_INDEX`），品牌账号还要加 `X-Goog-PageId`；`context` 来自 `ytcfg.get('INNERTUBE_CONTEXT')`。实测返回 200。另一种做法是派发 `yt-action` 的 `yt-service-request`，让页面自己处理认证。
- **`setVideoId`** 是列表里每一条的唯一编号（每加入一次就是一个新编号），跟视频 ID 不是一回事。官方修改播放列表也只发操作、按 `setVideoId` 定位，而且不实时推送：两个标签页同时改同一个列表时，旧标签页对已经删掉的条目再做操作，引用的编号已经不存在，不会让那个条目复活。

## 22. 关键决定一览

| 队列 # | 主题 | 决定 |
|---|---|---|
| Q8/Q12 | 定位 | 合并进 yt+，作为一个可以单独开关的功能 |
| Q1 | 接口 | 用你自己的登录态调页面内部接口；不用 OAuth，不用 Data API，没有配额问题 |
| Q2 | 存储 | 一个私密播放列表是唯一的长期存储；每个标签页的 TLPQ 只是工作副本 |
| Q4/Q17/Q21 | 用哪个列表 | 设置里填列表**名字**，默认 `yt+`。同名列表已存在就直接用，不管是不是扩展建的；不存在就建一个私密列表 |
| Q2/Q9 | 同步方式 | 双向。**同步操作，不同步状态**；拉取时以播放列表为准，覆盖本地 |
| Q6 | 恢复 | 每个新标签页都自动恢复队列，**不自动播放**，要你自己点 |
| Q3 | 什么时候离开列表 | 在队列里删掉 → 列表里也删；看完 → 自动从列表删除 |
| Q11/Q18 | 怎么算看完 | 本标签页：播到结尾，或者剩不到 10 秒时切走。其他设备：恢复或拉取时，进度条 ≥ 90% |
| Q19 | 官方自动塞进队列的视频 | 在观看页上加入队列时，如果官方把当前视频自动放进队列，这个视频**不写进列表** |
| Q10/Q14 | 播放规则 | 单个视频放完接着放什么、哪些视频能进队列，都照官方的，扩展不干预 |
| Q7/Q16 | 清空 | 你自己的所有播放列表：「清空全部」和「移除已看完」。先确认，10 秒内可以撤销，最近一次清掉的内容一直保留到下一次清空 |
| Q13 | 失败 | 失败的操作存起来重试；连续失败时页面角落提示；写日志 |
| Q5 | 跟 tesla-video-streamer 打通 | 先不做 |
| Q20 | 测试 | 核心逻辑写单元测试，页面部分用手测清单，再加一项自检 |

## 23. 架构

```
┌──────────────────── YouTube 标签页（可能有多个）────────────────────┐
│ MAIN world 脚本（和页面同一个 JS 环境）                              │
│  ├─ InnerTubeClient 用页面的 ytcfg 和 cookie 调 next / browse /      │
│  │                  browse/edit_playlist / playlist/create           │
│  ├─ QueueDriver     派发 yt-action 往 TLPQ 里加视频；读 TLPQ          │
│  ├─ FetchTap        包住 window.fetch，只看不改：页面发往 TLPQ 的     │
│  │                  edit_playlist / playlist/create = 你对队列的操作  │
│  └─ PlayerWatch     监听 <video> 的 timeupdate / ended，判断看完      │
│            ▲ window.postMessage（带每次加载随机生成的 nonce）          │
│            ▼                                                         │
│ isolated content script                                              │
│  ├─ QueueSync       同步核心，纯逻辑：操作翻译、待发送队列（outbox）、│
│  │                  拉取后的覆盖计划、看完规则                        │
│  ├─ PlaylistTools   播放列表页的「⋯」菜单、确认框、撤销提示           │
│  └─ StatusBadge     同步失败时页面角落的小提示                        │
└──────────────┬───────────────────────────────────────────────────────┘
               │ chrome.storage（outbox、列表 ID、清空快照）；日志发给 service worker
┌──────────────▼──────── service worker ──────────┐
│ Log（§4）、Settings                              │
└──────────────────────────────────────────────────┘
```

- MAIN world 脚本以 `run_at: 'document_start'` 注入，保证 `FetchTap` 在页面自己的脚本之前包住 `fetch`，不漏掉早期请求。
- **为什么要有 MAIN world 脚本**：派发 `yt-action` 要用页面里的 `ytd-app` 对象；包住 `fetch` 只能在页面的 JS 环境里做；读 `SAPISID` 和 `ytcfg` 也在页面里。WXT 支持 `world: 'MAIN'` 的 content script。
- **为什么读写都在页面里做，不放在 service worker**：认证要的东西（cookie、`ytcfg`）在页面里，而且同源请求最像用户自己的操作。
- `QueueSync` 不碰 DOM，也不直接 `fetch`。它依赖的接口从外面注入，方便用假的 YouTube 接口做单元测试。
- 所有 DOM 选择器和 InnerTube 字段路径各集中在一个文件里，YouTube 改版时只改那一处（跟 §14.3 一样）。

## 24. 同步

### 24.1 找到队列用的列表
- 设置里的列表名字，默认 `yt+`。
- 查找方法：列出你的所有播放列表（用哪个内部接口要实测，见 §28），**第一个**标题完全相同的就用它；一个都没有，就用 `playlist/create` 建一个同名的**私密**列表。
- 找到的列表 ID 跟名字一起存在 `chrome.storage.sync` 里。名字改了，或者用这个 ID 读不到列表了（比如被你在别处删掉），就重新按名字查找。
- 在设置里改名字就等于换一个列表，原来的列表不动。

### 24.2 新标签页恢复队列
1. 分页读完整个列表。
2. 进度条 ≥ 90% 的条目（在其他设备上看完的）先从列表里批量删掉。
3. 如果这个标签页还没有 TLPQ（sessionStorage 里没有），就把剩下的视频按顺序加入官方队列，`openMiniplayer: false`，**不自动播放**。如果已经有（比如刷新过的标签页），就按 §24.4 拉取并覆盖。
4. 记下 TLPQ 里每一条和列表里每一条（`setVideoId`）的对应关系。

列表是空的就什么都不做。

### 24.3 本地 → 列表（转发操作）
- **捕获**：`FetchTap` 看页面发往当前 TLPQ 的 `edit_playlist` 和 `playlist/create` 请求，这些就是你在队列里做的事，包括在任何页面点「加入队列」。扩展自己发的请求带标记，不会被当成你的操作。
- **翻译**：

  | 你在队列里做的 | 发给列表的 |
  |---|---|
  | 加入 X | `ACTION_ADD_VIDEO` X，重复的跳过 |
  | 删除某一条 | 按对应的 `setVideoId` 删除列表里那一条 |
  | 拖动排序 | `ACTION_MOVE_VIDEO_AFTER`，用列表里的 `setVideoId` |
  | 看完某一条（§24.5） | 删除列表里那一条 |
  | 官方自动塞进去的当前视频（队列 Q19） | 不发 |

- 要操作的条目在列表里已经不存在了（另一个标签页或手机上已经删掉），就丢掉这个操作并写一条日志，跟官方的处理方式一样。
- 发送失败的操作留在 outbox（`chrome.storage.local`）里，按 5 秒、30 秒、2 分钟……逐步拉长间隔重试。标签页关掉时没发出去的，下次任何一个 YouTube 标签页打开时接着发。

### 24.4 列表 → 本地（拉取并覆盖）
- **时机**：标签页从后台切回前台（`visibilitychange` 变成 `visible`）时，跟上次拉取至少间隔 10 秒。不做定时轮询。
- **先发再拉**：outbox 发完之后才拉取，免得旧数据覆盖掉自己还没发出去的操作。
- **覆盖**：算出要让 TLPQ 跟列表一致需要哪些增、删、移操作，对 TLPQ 执行（带扩展标记，不会被转发回列表）。**正在播放的那一条不动。**
- 拉取时同样应用「其他设备看完」的规则。

### 24.5 看完
- **本标签页**：当前播放的是队列里的视频，并且触发了 `ended`，或者在剩不到 10 秒时切到别的视频、关掉标签页，就算看完。关标签页时来不及发出的删除操作会留在 outbox 里（§24.3）。
- **其他设备**：恢复或拉取时读每一条的观看进度（具体字段要实测，见 §28），≥ 90% 就算看完。

## 25. 清空全部与移除已看完

- **范围**：你自己的任何播放列表页（怎么判断列表是不是你的，要实测，见 §28）。
- **入口**：列表头部，跟「全部播放」「随机播放」并排的「⋯」菜单，里面有「清空全部」和「移除已看完」（「已看完」的标准跟 §24.5 一样，进度条 ≥ 90%）。
- **流程**：读出所有条目 → 弹出确认框：「将从『<列表名>』删除 N 个视频」→ 每批最多 100 个 `ACTION_REMOVE_VIDEO` → 刷新页面上的列表 → 底部提示「已删除 N 个 · 撤销」，显示 10 秒。
- **撤销**：按原来的顺序加回去。「移除已看完」删掉的条目，加回后用 `ACTION_MOVE_VIDEO_AFTER` 放回原来的位置。
- **最近一次快照**：`{列表 ID、列表名、时间、删掉的视频 ID 和原来的位置}`，存在 `chrome.storage.local`，下一次清空时覆盖。设置页的队列标签里可以一键恢复。
- 如果清的是队列用的列表，已经打开的标签页会在下次拉取时跟着变（§24.4）。

## 26. 失败处理

- 发送失败的操作重试（§24.3）。连续失败 3 次，页面角落显示一个小提示「队列同步失败」，点开就打开设置页的日志，自动筛选 `queue`。
- 官方队列照常能用：扩展不阻止页面的任何操作；`FetchTap` 只看不改，自己出的异常一律捕获并写进日志。
- 内部接口返回的结构对不上（YouTube 改版）时，记为协议错误，暂停同步，并显示提示。

## 27. 设置与自检

**设置项**（设置页的队列标签）：
- 列表名字（默认 `yt+`）
- 当前对应的列表：链接和条目数
- outbox 里待发送的操作数
- 最近一次清空的内容，以及「恢复」按钮

**自检**（需要一个打开着的 YouTube 标签页；没有的话提示先打开一个）：
1. 按名字找到列表（或者能建出来），并读一次条目。
2. 页面上能拿到 `ytd-app` 和 `ytcfg`，认证请求返回 200。
3. `FetchTap` 已经装上。

## 28. 写代码前要实测的

1. `openMiniplayer: false` 能不能做到恢复队列、但不弹出迷你播放器也不播放。
2. 在迷你播放器里删除或拖动时，页面会不会对 TLPQ 发 `edit_playlist` 请求。如果不会，捕获方式改成定期读 TLPQ，跟上次的结果比较。
3. 在观看页上加入队列时，官方是不是真的会把当前视频塞进队列第一项；如果会，在请求上怎么区分它和你主动加的视频。
4. 两个标签页同时改同一个列表时，服务器是不是真的会忽略已经不存在的 `setVideoId`。
5. 对 TLPQ 直接执行增、删、移以后，迷你播放器的界面会不会跟着刷新。如果不会，改成用新列表重建队列。
6. 列出「我的播放列表」用哪个内部接口；怎么判断一个播放列表是不是自己的、能不能编辑；`playlistVideoRenderer` 上表示观看进度的字段是什么。
7. 从 isolated world 派发的 `CustomEvent`，页面能不能读到 `detail`。这决定了 `yt-action` 是不是一定要从 MAIN world 派发。
8. TLPQ 在服务器上能存多久（会影响刷新过的标签页）。

### 28.1 实测结果（2026-11-18，品牌账号）

1. `openMiniplayer: false` 可以：派发 `yt-add-to-playlist-command` 后建出 TLPQ（26 个字符，存在 sessionStorage `…::TLPQplaylist`，值就是裸的 ID 字符串），迷你播放器不出现，也不播放。
2. 会。在迷你播放器的队列面板里：删除 → `browse/edit_playlist`，`ACTION_REMOVE_VIDEO` + TLPQ 里的 `setVideoId`，而且**发两次**（第二次多一个 `params: "CAE%3D"`），要去重；拖动排序 → `ACTION_MOVE_VIDEO_AFTER`，移到最前面时没有 `movedSetVideoIdPredecessor`；加入 → `ACTION_ADD_VIDEO` + `addedVideoId`。还没有队列时加入 → `playlist/create`，`{title:"Queue", videoIds, params:"CAQ%3D"}`。**请求体是 gzip 压缩的**（`Request` 对象，`Content-Encoding: gzip`），`FetchTap` 要先解压。
3. 在观看页上第一次加入队列时，面板上会把当前视频显示成第一项，但它只在本地：`playlist/create` 和服务器上的 TLPQ 里都只有你加的视频。所以队列 Q19 在请求层面不用特殊处理。
4. 引用已经不存在的 `setVideoId`：删除返回 400「Precondition check failed」，移动返回 400，列表都不变。所以 outbox 遇到 400 就丢掉这个操作并写日志，不重试；一批里有一个失效会整批失败，所以失败后逐个重发。
5. 直接用接口改 TLPQ，服务器上变了，**面板不刷新**。但：通过 `yt-action` 加入视频会让页面重新读取 `next`，面板整个按服务器刷新；把 `playlistEditEndpoint`（删除）用 `yt-service-request` 派发到面板里那一项上，面板会跟着删掉；移动没有走界面的办法。实现：拉取覆盖时，删除走 `yt-service-request`，加入走 `yt-action`，移动直接调接口（面板要等下一次刷新才显示新顺序，已知限制）。
6. 「我的播放列表」用 `playlist/get_add_to_playlist`（参数随便给一个 `videoIds`），返回的 `playlistAddToOptionRenderer` 就是你能编辑的全部列表（含 Watch Later），有 `playlistId`、`title`、`privacy`。读列表 `browse` `VL<id>` 返回 `playlistVideoRenderer`（`videoId`、16 位的 `setVideoId`），`playlistVideoListRenderer.isEditable` 表示能不能编辑；观看进度在 `thumbnailOverlays[].thumbnailOverlayResumePlaybackRenderer.percentDurationWatched`。读 TLPQ 用 `next`，`playlistPanelVideoRenderer` 带 `videoId` 和 `playlistSetVideoId`。
7. 不需要了：写操作都在 MAIN world 里做。
8. 没测（要等很久）。刷新过的标签页如果读不到 TLPQ，就当作没有队列，重新恢复。

**认证（重要）**：`document.cookie` 里看不到 `SAPISID`，只有 `__Secure-3PAPISID`；页面发的是 `Authorization: SAPISIDHASH <ts>_<sha1> SAPISID3PHASH <ts>_<sha1>`，两个哈希都用 `"<ts> <cookie> https://www.youtube.com"` 算（没有 `SAPISID` 就用 `__Secure-3PAPISID` 的值），另加 `X-Goog-AuthUser`、`X-Origin`、`X-Youtube-Client-Name/Version`，品牌账号必须带 `X-Goog-PageId`（`ytcfg` 的 `DELEGATED_SESSION_ID`）。**少了 `X-Goog-PageId` 不会报错，而是悄悄地按主账号执行**，所以自检要确认读到的是当前频道的数据。

## 29. 开发顺序与测试

1. **最小验证**：逐条跑通 §28，把真实的请求和返回录下来作为测试数据。
2. 共用部分：设置页框架、功能开关、日志（按 §1 的总体顺序，开始做队列时已经有了，跳过）。
3. `InnerTubeClient` 和按名字查找列表。
4. `QueueSync` 核心逻辑和它的单元测试。
5. 接入页面：恢复队列、`FetchTap`、`PlayerWatch`、切回前台时拉取。
6. 清空全部、移除已看完、撤销。
7. 设置页的队列标签、自检、失败提示。

**测试**
- 单元测试（Vitest），针对 `QueueSync`：操作翻译；忽略扩展自己发的请求和官方自动塞进去的视频；outbox 的重试和间隔；丢弃已经失效的操作；拉取后的覆盖计划（列表 → TLPQ 的增删移）；看完规则；清空和撤销的计划（按 100 个分批、放回原位置）。用第 1 步录下来的真实响应做假接口。
- 手测清单：两个标签页同时开着；在手机上改了列表；刷新；开新标签页；看完和剩 10 秒切走；关掉标签页时还有操作没发完；断网或接口报错；清空和撤销；在设置里改列表名字。
- 不做 E2E。

## 30. 以后再做

- 跟 tesla-video-streamer 打通：加一个「送到车上」按钮，或者桌面和车共用一个列表。tesla SPEC 里 Phase 10 的待定问题 1（车上删除时要不要同步删播放列表）也可以用这里在页面里写列表的方法来解决。
- 用 Watch Later 当队列的列表。
- 打开着的多个标签页之间实时同步（目前只在切回前台时拉取）。

## 31. 参考来源

- Trinovantes/userscript-youtube-playlist-organizer（往队列里加视频、`editPlaylist.ts`）：https://github.com/Trinovantes/userscript-youtube-playlist-organizer
- YouTube.js `PlaylistManager.ts`：https://github.com/LuanRT/YouTube.js/blob/main/src/core/managers/PlaylistManager.ts
- ytmusicapi `playlists.py`：https://github.com/sigma67/ytmusicapi/blob/main/ytmusicapi/mixins/playlists.py
- PlaylistPlus（批量删除、分页）：https://greasyfork.org/scripts/574930-playlistplus/code
- 靠点界面来清空的脚本（作为对照）：https://gist.github.com/astamicu/eb351ce10451f1a51b71a1287d36880f
- Data API 读不到 Watch Later（2016-09-15）：https://developers.google.com/youtube/v3/revision_history
- Data API 配额：https://developers.google.com/youtube/v3/determine_quota_cost
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
| Q1 | 定位 | yt+ 的第三个功能「播放器」，有总开关；下面四项各有子开关，默认都开：迷你播放器控件、自由拖动、滚动时置顶、回到顶部 |
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
