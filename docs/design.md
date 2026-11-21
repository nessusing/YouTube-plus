# YouTube+ 设计文档

> 状态（2026-11-21）：三个功能都已实现并手测通过；播放器、队列另有真实 YouTube 上的自动测试（L4）。
> 范围：个人自用的 Chrome 扩展（MV3），YouTube 工具合集。
> 本文只记**已经做完**的功能，只留结论；完整的设计讨论和实测细节见 git 历史（`4c99a87` 及之前的 `docs/design.md`）。
> 想做、还没做完的功能（设计、状态、进度）都在 [plans.md](plans.md)。做完后按那里的规则移进本文。
> 章节号固定不变，代码注释里的 §n 一直有效。空号：§18、§30、§40.1、§41–43（原来是计划，已移到 plans.md），不再使用；新章节从 §44 开始接着编。

## 1. 概览

- **TL;DR**（第二部分）：缩略图上的图标，点开看 Gemini 生成的视频要点。
- **队列**（第三部分）：自带队列 / 播放列表二选一；播放列表模式下「加入队列」变成「加入 <列表名>」，看完自动删。另给自己的播放列表加「清空全部」「移除已看完」。
- **播放器**（第四部分）：迷你播放器控件、自由拖动并记位置、观看页滚动置顶、回到顶部按钮。

**计划**：见 [plans.md](plans.md)。**完成记录**：见文末。

---

# 第一部分　共用

## 2. 原则

自用（未打包加载），但按能上架的标准写；零成本（用浏览器已登录的账号，不用 API key / OAuth）；每个功能单独开关、互相隔离；WXT + TypeScript + 原生 DOM / Shadow DOM。

扩展图标用 `docs/icon-drafts/d.svg`。红色播放键取自 YouTube 商标，**上架前必须改掉**（plans.md P1）。

已完成（2026-11-21，手测通过）：工具栏图标只跟「Turn on this extension」走：打开就是彩色，关闭就是灰色（`public/icon/gray-*.png`，`npm run icons` 生成），跟当前活动标签页是哪个网站无关。做法是在 manifest 里声明 `action`（不声明的话 Chrome 会在扩展不运行的网站上把图标变灰），后台每次唤醒和设置变化时 `action.setIcon`；点图标打开设置页。

## 3. 设置页

已完成：仿 YouTube 设置页样式；标签为通用、TL;DR、队列、播放器、存储、诊断；顶部显示 YouTube / Gemini 登录状态；首次安装自动打开「诊断」并跑一次自检。

已完成（2026-11-21，手测通过）：除首次安装（`#install`，打开「诊断」）和链接里指定了标签（`#<tab>`、`#log=`）外，打开设置页总是显示「通用」，不再记住上次的标签。

## 4. 日志

已完成：全扩展共用一份，存 `chrome.storage.local` 环形缓冲（默认 2 MB），可筛选、复制、导出；永不上传，不记 cookie 和认证头。

### 4.1 存储用量

已完成：申请 `unlimitedStorage`；「存储」标签显示各类用量（日志、TL;DR 缓存、队列快照、其他），可调上限、可清空。

## 5. 自检

已完成：各功能提供自检项，设置页「自检」按钮依次运行并写日志。

---

# 第二部分　TL;DR

## 6. 一句话描述

后台调用免费的 Gemini 网页版（逆向内部接口）读视频，生成要点；点缩略图上的图标在 tooltip 里看。

## 7. 目标与非目标

不做：Shorts、直播中、预告和首映；自抓字幕；读不到字幕时的降级总结；官方 API（只留接口）。

## 8. 关键决定一览

已实现：所有带缩略图的位置都生效；3–7 条要点 + 标题一致性判断（可关）；输出语言跟随扩展界面语言；用普通对话（临时对话用不了 YouTube 应用），生成完立即删除；接受封号风险，账号编号 N 可设。

## 9. 架构

已实现：content script（扫描缩略图、可见性、图标、tooltip）↔ service worker（`JobQueue`、`SummaryCache`、`GeminiWebProvider` → `GeminiWebClient`、`PendingDeletes`）。协议细节只在 `GeminiWebClient` 里。

### 9.1 Provider 接口

`SummaryProvider` 已定义，见代码。以后加官方 API Provider 只需新增一个实现（plans.md P3）。

## 10. Gemini 网页版协议

已实现，见 `src/features/tldr/client.ts`、`protocol.ts`。要点：

### 10.1 抓取 token
从 `/u/N/app` 页面取 `SNlM0e`（`at`）、`cfb2h`（`bl`）、`FdrFJe`（`f.sid`）；拿不到 `SNlM0e` 即未登录或第三方 cookie 被屏蔽。

### 10.2 发起生成
`StreamGenerate`，不发模型 header。

### 10.3 解析返回
按长度前缀切帧（UTF-16 长度），取最后一帧即全文。

### 10.4 删除对话
`batchexecute`，RPC `GzXR5e`；失败的进 `PendingDeletes` 重试。

### 10.5 鉴权
`credentials:'include'` 带浏览器 cookie；**不轮换 cookie**；Origin/Referer 用 declarativeNetRequest 改成 gemini.google.com。

### 10.6 YouTube 应用的前提条件
需要开启 Gemini 应用活动记录、在 gemini.google.com/apps 启用 YouTube 应用；没字幕的视频读不了。

### 10.7 现状（2026-11-21）

- 用 `StreamGenerate`。网页前端从 2026-10 中旬起按账号分批改用 `processSession`，但旧接口没下线：2026-11-18 实测能用，参考项目到 2026-11-21 也都还默认走它。
- 协议都关在 `GeminiWebClient` 里，接口变了自检会报 `protocol`。
- 每次请求前都实时抓一次 `/app` 页面取凭证（`generate()` 和 `deleteConversation()` 各抓一次）。
- 还没有后备：`StreamGenerate` 下线 TL;DR 就整个失效。计划见 plans.md：P2 凭证缓存、P3 官方 API Provider、P4 `processSession`。

## 11. Prompt 与输出格式

已实现：要求严格输出 JSON；读不到内容时输出 `{"status":"no_transcript"}`，禁止编造；解析失败时把原文当 markdown 显示并缓存。

## 12. 预生成、任务队列与限流

已实现：全局唯一队列、串行、一次请求最多合并 5 个视频；优先级 点击 > 可见 > 其余；请求间隔 5–10 秒；上限每小时 40 / 每天 200（手动点击不受暂停影响但计数）；只在有 YouTube 标签页在前台时预生成；熔断：1037 暂停到手动恢复，1060 / 1152 / 验证码 / 429 暂停 30 分钟；未登录时全部停。参数都可在设置里改。

## 13. 缓存

已实现：按 videoId 存 `chrome.storage.local`；成功结果永久（默认 5 MB，LRU）；`unreadable` 缓存 24 小时；错误不缓存。

## 14. UI

### 14.1 缩略图上的图标
已实现：插在缩略图容器里，右下角时长标签上方，常驻；按状态变色（未处理、排队、生成中、就绪按标题判断着色、读不到灰色、出错红色、暂停）。z-index 低于顶栏和迷你播放器。

### 14.2 Tooltip
已实现：Shadow DOM；顶部是标题一致性判断，下面是要点；有「重新生成」「复制」。

### 14.3 识别缩略图
已实现：MutationObserver；选择器集中在 `src/features/tldr/selectors.ts`；排除 Shorts、直播、预告。

## 15. 设置与自检

已实现：设置项（标题判断开关、账号 N、预生成开关、上限、清空缓存、计数和熔断状态）；自检（能否拿到 token、跑一次真实总结、删除对话）。

### 15.1 登录 Gemini 的引导
已实现：全局 `gemini: unknown | ok | signedOut`；未登录时什么都不跑，图标显示「需要登录」，tooltip 给「登录 Gemini」「我已登录」；Gemini / Google 账号页加载完成时及每 10 分钟自动重测。

## 16. 风险

主要风险是 `StreamGenerate` 被下线（现状见 §10.7，应对见 plans.md P3、P4）；其余（封号、额度、YouTube 改版、无字幕、只能用 Flash-Lite）已接受或已有应对。

## 17. 开发顺序与测试

已完成（2026-11-18 最小验证通过，2026-11-21 手测通过）。单元测试覆盖帧解析、错误码、JSON 解析、任务队列和熔断、缓存。

## 19. 参考来源

- Sophomoresty/gemini-web2api（MIT）：https://github.com/Sophomoresty/gemini-web2api
- ntthanh2603/gemini-web-to-api（MIT）：https://github.com/ntthanh2603/gemini-web-to-api
- HanaokaYuzu/Gemini-API（AGPL-3.0，只参考协议）：https://github.com/HanaokaYuzu/Gemini-API
- zexadev/gemini-web2api-go（MIT，有 `processSession` 实现）：https://github.com/zexadev/gemini-web2api-go

---

# 第三部分　队列

> 2026-11-20 重新设计并实现、手测通过。原来的「官方队列 ↔ 播放列表双向同步」已整套删除（见 `77c5d00` 及之前）。

## 20. 一句话描述

设置里二选一：用 YouTube 自带的队列（扩展不管），或者用一个播放列表当队列（接管「加入队列」，顶栏一键播放，看完自动删）。「清空全部」「移除已看完」两种模式都能用。

## 21. 背景（实测结论）

### 21.1 官方队列（TLPQ）
服务器上的临时列表（`TLPQ…`），ID 只存在当前标签页的 sessionStorage，新标签页、其他设备看不到。

### 21.2 「加入队列」是怎么触发的
所有入口都从被点元素冒泡一个 `yt-action`（`yt-add-to-playlist-command`，`listType: PLAYLIST_EDIT_LIST_TYPE_QUEUE`）；在 `document` capture 阶段 `stopImmediatePropagation()` 能完全拦下。例外：标签页已有官方队列且迷你播放器开着时，点缩略图会直接写 TLPQ，不经过这个事件。

### 21.3 改菜单文字
按图标 `ADD_TO_QUEUE_TAIL` 或命令识别，不看文字。新版菜单（`yt-list-item-view-model`）直接改 `textContent`，菜单 DOM 跨页面复用，每次打开都要改、关掉模式要改回；旧版菜单（`ytd-menu-service-item-renderer`）必须设 `ytFormattedString.text`，不能改 `textContent`。

### 21.4 播放列表的读写和播放
- 列出可编辑列表：`playlist/get_add_to_playlist`；读：`browse`（`VL<ID>`，约 100 条一页）；写：`browse/edit_playlist`（每批 100 个操作）；新建：`playlist/create`（ID 可能只有 13 位，不按长度校验）。
- **`DEDUPE_OPTION_SKIP` 不起作用**；写后几秒内读到的可能是旧数据。新建的列表最初 1–2 秒里读起来是「不存在」，`get_add_to_playlist` 里也还没有它，所以读到「不存在」要隔 1.5、3 秒复查，三次都不存在才算被删（2026-11-21 实测）。
- `browse` 返回里列表的条目只看 `playlistVideoListRenderer` 那一块，下面的「推荐视频」也是 `playlistVideoRenderer`，不能算进去。标题在 `metadata.playlistMetadataRenderer.title`（2026-11 起没有 `playlistHeaderRenderer` 了）；空列表没有 `isEditable`，能不能编辑以 `get_add_to_playlist` 为准。
- 「正在播哪个列表」：官方队列在迷你播放器里播放时 `getPlaylistId()` 是空的，要看 `yt-playlist-manager.getPlaylistData().playlistId`（`TLPQ…`）。
- 把列表挂到正在播的视频上：请求 `next` 后依次调 `yt-playlist-manager` 的 `setAutoplayRenderer`、`setPlaylistData`、`setPlayerPlaybackControlData`（只调第二个不够）；本地把当前视频插到最前、自动播放改指第一条。退路是导航到 `watch?v=…&list=…`。
- 正在播的列表被删条目后，官方自动播放会出错，所以由扩展自己切下一条。

### 21.5 认证和身份
在页面里调 `/youtubei/v1/*`，`SAPISIDHASH` + `SAPISID3PHASH`；品牌频道必须带 `X-Goog-PageId`（不带会悄悄按主频道执行）。身份用 `ytcfg` 的 `DATASYNC_ID`。

## 22. 关键决定一览

已实现。要点：自带队列模式扩展完全不管；播放列表模式接管所有走 `yt-action` 的入口；加入时如在看不属于列表的视频，就把列表挂到当前播放上；「播放完后删除」默认勾选，由扩展切下一条再删；设置按身份（频道）分开存；没选列表或无权编辑时不接管；切换模式不迁移数据，已开的标签页提示刷新。

## 23. 架构

已实现：MAIN world（`InnerTubeClient`、`QueueTakeover`、`Identity`、`PlayerWatch`）↔ 固定 tag 的 `postMessage` ↔ isolated（`QueueMode`、`PlayButton`、`WatchedRemover`、`PlaylistTools`）。写操作都在 MAIN world；设置页通过最近使用的 YouTube 标签页读写；纯逻辑不碰 DOM、依赖注入，便于单测。

## 24. 播放列表模式

### 24.1 什么时候接管
同时满足：队列功能开、当前身份选了播放列表模式、YouTube 已登录、选了列表、列表可编辑。没选列表时提示去设置；不可编辑时提示但不清空选择。

### 24.2 加入
已实现：拦下事件 → 先读列表去重 → `ACTION_ADD_VIDEO` → 提示「已加入 · 查看」/「已在 <列表名> 中」；需要时把列表挂到当前播放（§21.4）。失败只提示和写日志，不重试。

### 24.3 改文字
已实现：菜单打开时改成「加入 <列表名>」，不接管时改回。缩略图上的悬停按钮：新版（`toggle-button-view-model`，图标 `ADD_TO_QUEUE_TAIL`）改内层按钮的 `aria-label` 并加 `title`；旧版换 `data.untoggledTooltip`。

### 24.4 播放和看完删除
已实现：顶栏「▶ <列表名> · N」按钮；只在播这个列表时算看完（`ended`，或剩不到 10 秒时切走 / 关标签页）；勾选删除时扩展跳到下一条再删刚看完的；不勾选时交给官方自动播放。最后一条看完后（删掉后列表空了）不再管，接下来放什么照 YouTube 自己的自动播放设置走（开着时结束画面后会放推荐视频，2026-11-21 定）。

### 24.5 选列表、新建、列表被删
已实现：下拉框列出可编辑列表 + 「新建…」（默认名 `YouTube+`，私密）；存列表 ID；列表不存在时（复查后确认，§21.4）清空该身份的选择，并提示去设置。不论是检查、加入还是切回标签页时读到的，都这样处理。复查要几秒，期间用户可能已经换了列表：只有选中的仍是复查的那个列表时才清空、才提示（2026-11-20）。

### 24.6 切换模式
已实现：不迁移数据。已开的标签页立刻按新模式走（拦截、菜单文字、顶栏按钮、看完删除），并提示「刷新页面后完全生效」：这个标签页里已有的官方队列保持原样。切回自带队列时，正在播的列表扩展不再管；这时原生的「加入队列」会把视频直接加进这个列表，是原生行为，不拦（2026-11-20 定）。

### 24.7 身份
已实现：按 `DATASYNC_ID` 的 SHA-256 前 16 位区分；`chrome.storage.sync` 存 `queue/profile/<哈希>`（模式、列表 ID 和名字、看完删除），`chrome.storage.local` 存 `queue/snapshot/<哈希>`。

### 24.8 界面跟列表保持同步
已实现：MAIN world 包一层 `window.fetch` 只读监听页面的 `edit_playlist`，扩展自己的写操作直接发同样的事件；300 ms 合并后重读列表、更新数字和面板；读不到预期结果时 1.5 / 3 / 5 秒重读；数字 = 最新列表数据 + 30 秒内已知修改；切回标签页时（距上次 >5 秒）重读。加入和删除一样，几秒内都可能读不到（刚建的列表约 3 秒）。

「30 秒内已知修改」只属于当前选中的列表：换列表、离开接管时清掉；不接管时这个标签页里对选中列表的修改也照记，切回来时叠上去。离开接管或换列表时，为「剩 10 秒关标签页」预签的删除也一并撤掉。

## 25. 清空全部与移除已看完

已实现：自己的列表页头部「⋯」菜单；确认 → 每批 100 个删除 → 「已删除 N 个 · 撤销」（10 秒，撤销时用 `ACTION_MOVE_VIDEO_AFTER` 放回原位，等读得到再刷新页面）；最近一次快照按身份存，设置页可恢复。

「⋯」放在看得见的那个头部里（页面上还有隐藏的头部副本），新版头部放在「全部播放」那一排下面单独一行（挤进那一排会把「全部播放」压成半截），旧版放在「随机播放」旁边；YouTube 重画头部后会重新挂上。删除后页面上的行按视频链接去掉（isolated world 读不到行元素的 `data`）。

## 26. 失败处理

已实现：失败只提示和写日志、不重试；识别不到菜单或命令结构对不上时不拦、退回原生；`get_add_to_playlist` 一个列表都不返回视为协议错误，停止接管并在设置页显示。

## 27. 设置与自检

已实现：顶部 YouTube / Gemini 登录状态；队列标签显示「正在设置：<头像 + 名字>」、模式单选（默认自带队列）、列表下拉框、「播放完后删除」、快照恢复。自检：页面和 `ytcfg` 正常、选中列表可编辑、capture 监听已装。

## 28. 写代码前要实测的

已全部按推测写法实现并手测通过（悬停按钮、跳下一条用 `yt-navigate` 1.5 秒内无响应则整页跳转、头像名字、Gemini 登录状态复用 `tldr-status`）。

### 28.1 实现时定的细节
见代码；剩 10 秒时关标签页的删除用预签名请求 + `pagehide` 时 `fetch(..., {keepalive: true})`。

## 29. 开发顺序与测试

已完成，2026-11-20 手测通过；2026-11-21 L4 覆盖了加入的各入口、列表面板、看完删除、切换模式、清空 / 撤销 / 快照恢复、设置页选列表和新建。测试都在 `tests/`：L1 纯函数和 L2 controller 集成（内存里的假 YouTube，`tests/support/fake-youtube.ts`）跑 `npm test`；L4 在真实 YouTube 上跑（Playwright，`tests/e2e/`），第一次先 `npm run e2e:login`，然后 `npm run test:e2e`（`npm run test:all` 依次跑类型检查、L1/L2 和 L4），只碰名字以 `YouTube+ e2e` 开头的列表。测试列表是跨运行保留的一个小池（`YouTube+ e2e pool 1`、`2`），每条测试清空后重新装入：YouTube 限制一个账号每天能新建的播放列表数，每条新建一个会碰到上限（2026-11-21 一天跑了几轮后，`playlist/create` 不再返回 ID）。窗口默认不显示（`YTPP_E2E_WINDOW=normal` 显示）。测试中发现的问题（F1–F17）都已修或已定，结论已写进本文各节；逐条的场景、原因和修法见 git 历史里的 `docs/queue-test-findings.md`（2026-11-21 删除前的最后一版）。还在观察的 F12 移到了 plans.md P11。

## 31. 参考来源

- Trinovantes/userscript-youtube-playlist-organizer：https://github.com/Trinovantes/userscript-youtube-playlist-organizer
- YouTube.js `PlaylistManager.ts`：https://github.com/LuanRT/YouTube.js/blob/main/src/core/managers/PlaylistManager.ts
- PlaylistPlus（批量删除、分页）：https://greasyfork.org/scripts/574930-playlistplus/code

---

# 第四部分　播放器

> 已实现，2026-11-20 手测通过。

## 32. 一句话描述

迷你播放器补上音量和进度条；迷你播放器可拖到任意位置并记住；观看页往下滚时播放器置顶（影院模式自动切换）；所有页面加「回到顶部」按钮。

## 33. 背景

迷你播放器和大播放器是同一个 `#movie_player`（迷你时加 `ytp-player-minimized`，官方控件栏被隐藏）；官方只吸附四个角，没有音量。

## 34. 关键决定一览

已实现：总开关 + 四个子开关（迷你播放器控件、自由拖动、滚动置顶、回到顶部），默认都开。第五个子开关「循环播放按钮」默认关（§40.2）。

## 35. 迷你播放器

### 35.1 控件
已实现：悬停时用 CSS 重新显示官方控件栏，并藏掉迷你播放器自带的重复控件（保留展开、关闭）。迷你播放器里没有上一个 / 下一个（YouTube 2026-11 改版后自己藏掉的），不补（2026-11-21 定）。控件栏 z-index 要提到 68、齿轮菜单 69，否则点击落在 scrim 上。

### 35.2 拖动与吸附
已实现：只从视频区域开始拖（拖进度条、音量不会拖动窗口）；松手时离边缘 <24 px 吸边、在角落吸角，否则停在原地。

### 35.3 记住位置和大小
已实现：存 `{corner, dx, dy, width, height}` 到 `chrome.storage.local`。大小不能直接写 inline（YouTube 会覆盖），所以只记宽度差、用 CSS 变量 `!important` 叠加，视频本身由 MAIN world 的 `player-main.ts` 调 `setInternalSize` 跟着变。

## 36. 观看页

### 36.1 普通模式下置顶
已实现：`#player` 上 `position: sticky`，`#primary-inner` 加 `min-height: 100%` 让它一直置顶。

### 36.2 影院模式
已实现：往下滚自动切到普通模式，回到顶端切回；只切回自己切过去的；切换后把 cookie `wide` 写回原值，不改用户偏好；切换后 400 ms 内不响应滚动。

### 36.3 置顶时按 `t` 或点影院模式按钮
已实现：回到顶端、进入影院模式，并保存为偏好。

### 36.4 置顶时点时间戳
已实现：capture 阶段拦下，只设 `video.currentTime`，不滚动页面。

## 37. 回到顶部按钮

已实现：48 px 半透明深灰圆、浅蓝箭头，Shadow DOM；滚过 300 px 出现，点了直接跳到顶端；迷你播放器重叠时盖在按钮上面（先这样用，以后再看）。设置项：子开关（§34）、「重置迷你播放器位置」。自检：能找到播放器、迷你播放器拖动组件、影院模式按钮。

## 38. 写代码前要实测的

已全部实测（2026-11-18），结论已用在 §35–§36 的实现里。

### 38.1 实测结果
见 §35、§36 各节；细节见 git 历史。

## 39. 开发顺序与测试

已完成，2026-11-20 手测通过。单元测试覆盖位置计算和影院模式切换的状态机。L4（2026-11-21）：迷你播放器控件（三种状态，`mini-controls.spec.ts`）；拖动、吸边吸角、记住位置和重置；普通模式置顶、影院模式自动切换和偏好不变、置顶时按 `t`、时间戳不滚动；回到顶部（`player.spec.ts`）。

## 40. 后加的功能

（§40.1 是空号。）

### 40.2 单个视频循环（2026-11-21 手测通过）

**想要什么**：播放器里一个看得见的循环按钮，一个按钮来回切换开 / 关（官方只在右键菜单里有「循环播放」）。

**设置**：「设置 → 播放器 → 子功能」第五项「循环播放按钮」，默认关。没打开（或播放器功能、「启用 YouTube+」关着）时播放器里完全没有这个按钮。循环正开着时去设置里关掉：按钮消失，循环也一起停。

**出现在哪**（都只有一个按钮）：
- 观看页普通、影院、全屏：底部左侧控件栏，紧贴在 ▶ 右边（▶ 和 ⏮⏭ / 🔊 之间）。
- 迷你播放器，「迷你播放器控件」开着：悬停后的底部控件栏里，同上（▶ 和 🔊 之间）。
- 迷你播放器，「迷你播放器控件」关着：画面正中大 ▶ 的右边，跟大 ▶ 一样大；▶ 本身位置不动。
- 不做：频道页预告片、Shorts（本来就循环）、悬停预览、站外嵌入播放器。

**样子**：圆环箭头里一个 ▶（24×24，线宽 2，圆角线头，跟官方新版图标一样）。控件栏里跟 🔊 一样是 30% 黑的圆底，40 px（全屏的大控件模式 48 px，图标不放大），上下跟官方按钮对齐。开：图标纯白；关：图标 50% 透明；没有红线。悬停提示用官方提示的样式：关着时「循环播放」，开着时「关闭循环播放」，跟随设置页语言。不加快捷键。

**行为**：只对当前视频有效，换视频 YouTube 自己就关（实测）。按钮和右键菜单「循环播放」是同一个状态，两边同步。播放列表里、开着自动播放时也一直重播当前视频，不跳下一条。

**跟队列（§24.4）**，只在接管并播放选中的列表时：
- 循环开着时这个视频不算看完：不预签删除（已预签的，关标签页时也不发），「剩不到 10 秒时切走 / 关标签页」不算。
- 视频自动从结尾跳回开头算循环一次；自己把进度条拖回开头不算。
- 循环过至少一次后，在列表里切到另一个视频（列表面板里点别的、⏭ 下一个）：把刚才循环的视频当看完删掉。去看列表外的视频、关标签页：不删。
- 没勾选「看完删除」时都不删。

**实测（2026-11-21）**：右键菜单的「循环播放」改的就是 `<video>` 的 `loop` 属性；播放器接口 `setLoopVideo(b)` 改同一个属性，菜单勾选也跟着变；直接写 `video.loop` 菜单勾选不变，所以按钮要经 MAIN world 调 `setLoopVideo`。`loop` 属性的变化在 isolated world 里用 MutationObserver 看得到。站内跳到别的视频后 `loop` 回到 false。官方按钮不会给我们的按钮显示提示，提示要自己建（`div.ytp-tooltip.ytp-bottom` 放在 `#movie_player` 下，套官方样式，按钮上方 22 px）。迷你播放器正中那排是 `.ytp-miniplayer-controls` 里三个容器（上一个 / ▶ / 下一个，两边是空的），按钮挂在 ▶ 容器右侧、绝对定位。新视频刚开始时 `getPlaylistId()` 会空一会儿：循环过的视频离开时，等读到新视频的列表（或用网址里的 `list=`）再判断，最多等 5 秒。

---

# 完成记录

新的写在最上面。

| 完成日期 | 条目 | 章节 |
|---|---|---|
| 2026-11-21 | 单个视频循环按钮：▶ 右边一个开关，所有播放器形态都有；循环过再切走算看完 | §40.2 |
| 2026-11-21 | 设置页默认打开「通用」（首次安装和链接里指定了标签的除外） | §3 |
| 2026-11-21 | 工具栏图标跟总开关走：开着是彩色，关了是灰色，跟当前网站无关；点图标打开设置页 | §2 |
| 2026-11-21 | TL;DR 手测通过 | §17 |
| 2026-11-21 | 队列 L4 测试；测试发现的 F1–F17 除 F12 外都已修或已定 | §29 |
| 2026-11-21 | 播放器 L4 测试 | §39 |
| 2026-11-20 | 队列重新设计并实现，手测通过 | 第三部分 |
| 2026-11-20 | 播放器，手测通过 | 第四部分 |
| 2026-11-18 | TL;DR 最小验证通过 | 第二部分 |
