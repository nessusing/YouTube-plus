# yt++ 设计文档

> 状态：设计已定稿，尚未开始实现
> 日期：2026-11-14（同日加入队列功能，项目从 yt-tl;dr 改名为 yt++）
> 范围：个人自用的 Chrome 扩展（MV3），YouTube 工具合集

## 1. 概览

yt++ 是一个 YouTube 工具合集扩展。仓库名 `yt-tl;dr` 暂不改。目前有两个功能：

- **TL;DR**（第二部分）：点缩略图上的图标，就能看到 Gemini 生成的视频要点，不用点开视频。
- **队列**（第三部分）：用官方的「加入队列」和迷你播放器播放，用你自己的一个私密播放列表长期保存队列。关掉标签页、开新标签页、换设备，队列都还在。另外给你自己的所有播放列表加上「清空全部」和「移除已看完」。

两个功能共用的部分（原则、设置页、日志、自检）见第一部分。

编号说明：第二部分表格里的 Qn 是 TL;DR 讨论时的问题编号；第三部分的「队列 Qn」是队列讨论时的问题编号，两者无关。

---

# 第一部分　共用

## 2. 原则

- 自用：以未打包扩展的方式加载。代码按能上架 Chrome Web Store 的标准来写：有设置页、不硬编码任何凭据、权限最小化。
- 零成本：全部用浏览器里已登录的 Google 账号，不需要 OAuth、API key，也不用官方 YouTube Data API。
- 功能隔离：每个功能在设置页里**单独开关**；每个功能的 content script 和 service worker 模块各自独立，异常都在功能内部捕获并写进日志，一个功能出错不影响另一个。
- 技术栈：WXT + TypeScript，MV3；UI 用原生 DOM 加 Shadow DOM，不引入 React。

## 3. 设置页

一个 options 页，分几个标签：

- **通用**：功能开关（TL;DR、队列，默认都开）、日志（§4）、「自检」按钮（§5）。
- **TL;DR**：见 §15。
- **队列**：见 §27。

首次安装时自动打开设置页，并运行一次全部自检。

## 4. 日志

| 项 | 决定 |
|---|---|
| 位置 | 设置页「通用」标签里的日志视图，整个 yt++ 共用一份 |
| 每一行 | 时间、功能（`tldr` / `queue` / `core`）、级别（debug / info / warn / error）、内容 |
| 存储 | `chrome.storage.local`，环形缓冲区，最多约 **5000 行或 2 MB**，满了丢掉最老的 |
| 写入 | content script 把日志发给 service worker，由它批量写入，避免频繁写存储 |
| 查看 | 可以按功能、按级别筛选；有「复制全部」和「导出 .txt」按钮 |
| 隐私 | **永远不上传**。不记 cookie、认证头（`SAPISIDHASH`、`at` token 等） |

## 5. 自检

每个功能提供自己的自检项（TL;DR 见 §15，队列见 §27）。设置页的「自检」按钮依次运行所有已开启功能的自检，结果显示在页面上，同时写进日志。

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
| Q4/Q12 | 输出语言 | 设置里的下拉框：**跟随视频语言**（默认）、中文、English、日本語 等 |
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
- 设置页的 TL;DR 标签负责：选输出语言、开关标题一致性判断、选账号编号 N、开关预生成、调整上限、清空缓存。

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
| 并发 | **1**，严格串行 |
| 优先级 | 用户点了图标的视频，高于屏幕上可见的，高于页面上其余的。滚走以后只降级，不取消 |
| 间隔 | 每个请求完成后，等 **5–10 秒随机时间**再发下一个 |
| 上限 | 每小时 **40** 个，每天 **200** 个（按本地自然日算）。达到上限后自动预生成暂停，**手动点击仍可生成**，手动点击也计入总数。上限可在设置里改 |
| 前台条件 | 至少有一个 YouTube 标签页在前台（`visibilityState === 'visible'`）时才跑预生成；否则暂停。手动点击不受这条限制 |
| 熔断：额度 | 遇到 1037 就暂停全部请求，**直到用户手动点「恢复」** |
| 熔断：风控 | 遇到 1060、1152、验证码、429 就暂停全部请求（包括手动点击）**30 分钟** |
| 总开关 | 设置里可以关掉预生成，只保留点击生成 |
| Cookie | 绝不轮换 |

估算：一屏 30 个视频大约 5–8 分钟处理完。

实现要点：MV3 的 service worker 空闲约 30 秒后会被回收。打开的 runtime port 和进行中的 fetch 会让它保持活跃。任务队列状态和计数器放在 `chrome.storage.session` 或 `chrome.storage.local` 里，这样 service worker 重启后能恢复。

## 13. 缓存

- 存储：`chrome.storage.local`，key 是 videoId。
- 成功的结果：永久保存，最多约 **2000** 条，满了按 LRU 淘汰。
- `unreadable`（读不到内容）：缓存 **24 小时**。新视频的自动字幕要过一段时间才生成，所以过期后允许再试一次。
- 临时错误和熔断：**不缓存**。
- 用户点「重新生成」时，覆盖原有缓存。
- 缓存里存的是结构化的 `Summary`，以后改 UI 不需要重新生成。

## 14. UI

### 14.1 缩略图上的图标
- 作为**子元素插入缩略图容器的 DOM**，用 absolute 定位，滚动时自然跟着缩略图走，不用 fixed 定位。
- 位置：右下角、**时长标签的正上方**。常驻显示，不需要悬停；z-index 高于 YouTube 悬停时出现的内嵌播放器。
- 要专门设计一个 icon。

| 状态 | 外观 | 能否点击 |
|---|---|---|
| 未处理 | 品牌图标，偏淡 | 可以，点击会插到队首 |
| 排队中 | 图标带等待标记 | 可以，点击会插到队首并打开 tooltip 显示进度 |
| 生成中 | 转圈 | 可以，tooltip 显示「生成中」 |
| 已就绪 | 高亮 | 可以，打开 tooltip |
| 读不到 | **灰色** | **不可以**，悬停提示原因 |
| 出错 | 红色 | 可以，点击重试 |
| 暂停 | 暂停标记 | 不可以，悬停显示原因和剩余时间 |

### 14.2 Tooltip
- 点击图标后打开，出现在缩略图旁边，空间不够时自动翻到另一侧；同一时间只开一个；点击外部或按 Esc 关闭。
- 用 Shadow DOM 隔离样式，适配 YouTube 的深色和浅色主题。
- 内容：要点列表；标题一致性判断（按 match / partial / mismatch 用颜色区分，并附理由）。
- 操作：「重新生成」和「复制」。
- 对话生成后会立即删除，所以**没有**「在 Gemini 中打开」。

### 14.3 识别缩略图
- 用 MutationObserver 应对 YouTube 的单页应用路由和无限滚动。
- 目标元素包括新旧两套布局（例如 `ytd-rich-item-renderer`、`ytd-video-renderer`、`ytd-compact-video-renderer`、`yt-lockup-view-model` 等，实现时以实际 DOM 为准）。**所有选择器集中放在一个文件里**，YouTube 改版时只改这一处。
- 根据 `/shorts/` 链接排除 Shorts；根据缩略图上的「LIVE」「即将开始」「首映」等标签排除直播中和预告。

## 15. 设置与自检

**设置项**（设置页的 TL;DR 标签）：输出语言、标题一致性判断开关、账号编号 N、预生成开关、每小时和每天的上限、清空缓存、当前计数和熔断状态。

**自检**：
1. 抓取 `/u/N/app`，检查能否拿到 `SNlM0e`。拿不到就提示「未登录 Gemini，或者第三方 cookie 被屏蔽」，并附上修复方法。
2. 检查 `bl` 和 `f.sid` 能否提取到。提取不到就说明协议可能变了。
3. 用一个已知有字幕的短视频实际跑一次总结，验证活动记录已开启、YouTube 应用已启用；失败时给出 myactivity 页面和 gemini.google.com/apps 的链接。
4. 验证删除对话是否成功。

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

播放用官方的「加入队列」和迷你播放器，长期保存用你自己的一个私密播放列表（默认叫 `yt++`）。扩展在两者之间双向同步，所以关掉标签页、开新标签页、换一台设备，队列都还在。另外，给你自己的所有播放列表加上「清空全部」和「移除已看完」。

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
| Q8/Q12 | 定位 | 合并进 yt++，作为一个可以单独开关的功能 |
| Q1 | 接口 | 用你自己的登录态调页面内部接口；不用 OAuth，不用 Data API，没有配额问题 |
| Q2 | 存储 | 一个私密播放列表是唯一的长期存储；每个标签页的 TLPQ 只是工作副本 |
| Q4/Q17/Q21 | 用哪个列表 | 设置里填列表**名字**，默认 `yt++`。同名列表已存在就直接用，不管是不是扩展建的；不存在就建一个私密列表 |
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

- **为什么要有 MAIN world 脚本**：派发 `yt-action` 要用页面里的 `ytd-app` 对象；包住 `fetch` 只能在页面的 JS 环境里做；读 `SAPISID` 和 `ytcfg` 也在页面里。WXT 支持 `world: 'MAIN'` 的 content script。
- **为什么读写都在页面里做，不放在 service worker**：认证要的东西（cookie、`ytcfg`）在页面里，而且同源请求最像用户自己的操作。
- `QueueSync` 不碰 DOM，也不直接 `fetch`。它依赖的接口从外面注入，方便用假的 YouTube 接口做单元测试。
- 所有 DOM 选择器和 InnerTube 字段路径各集中在一个文件里，YouTube 改版时只改那一处（跟 §14.3 一样）。

## 24. 同步

### 24.1 找到队列用的列表
- 设置里的列表名字，默认 `yt++`。
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
- 列表名字（默认 `yt++`）
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

## 29. 开发顺序与测试

1. **最小验证**：逐条跑通 §28，把真实的请求和返回录下来作为测试数据。
2. 共用部分：设置页框架、功能开关、日志（TL;DR 已经做了的话就跳过）。
3. `InnerTubeClient` 和按名字查找列表。
4. `QueueSync` 核心逻辑和它的单元测试。
5. 接入页面：恢复队列、`FetchTap`、`PlayerWatch`、切回前台时拉取。
6. 清空全部、移除已看完、撤销。
7. 设置页的队列标签、自检、失败提示。

TL;DR 和队列先做哪一个，开工前再定。

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
