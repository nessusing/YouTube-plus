# 队列测试发现的问题（临时文件）

测试里用 `it.fails` 标出来的问题，等确认后逐个修。修完后把结论并回 `design.md`，然后删掉这个文件。

每条写：场景、预期、实际、原因、对应的测试、建议。「建议」里写这条算 bug（改代码），还是改设计（改 design.md，让测试跟着改）。

## L2（controller 集成测试，`tests/unit/features/queue/controller.*.test.ts`）

### F1　切走以后，关标签页仍会删掉正在看的视频

- **场景**：正在播放列表，剩不到 10 秒（已经预签好关页面时用的删除请求）。这时在设置页切到自带队列，或者换了列表、关掉了队列功能。然后关掉标签页。
- **预期**：已经不归扩展管了，什么都不删。
- **实际**：页面脚本里预签的删除请求（`armed`）还在，`pagehide` 时照样发出去，把视频从列表里删掉了。
- **原因**：`armed` 只在换视频时清；controller 切换模式时不调用 `rpc.disarm()`，也不清 `pending`。
- **测试**：`controller.modes` › an unload removal armed before the switch is disarmed
- **建议**：bug。`apply()` 发现不再是 `take`（或者列表 ID 变了）时，调用 `disarm()` 并清掉 `pending`。

### F2　换列表以后，旧列表最近的修改算进了新列表的数字

- **场景**：在列表 A 里加入一个视频，30 秒内在设置页换成列表 B。
- **预期**：按钮显示 B 的条数。
- **实际**：多出 1，最长持续 30 秒。
- **原因**：`onProfile()` 先执行 `this.profile = p`，再调用 `refresh()`。所以 `refresh()` 里的「列表 ID 变了就清掉 `snap` 和 `overlay`」这个判断永远不成立，A 的 overlay 叠加到了 B 的读取结果上。
- **测试**：`controller.modes` › edits and panel updates of A do not touch B's count
- **建议**：bug。在 `onProfile` 里比较新旧列表 ID，不一样就清掉；或者 `onProfile` 不再提前改 `this.profile`。

### F3　来回切换模式后，切走前的修改还残留在数字里

- **场景**：在播放列表模式下加入视频 x，然后切到自带队列。这期间 x 在别处被删掉了。30 秒内再切回播放列表模式。
- **预期**：数字等于服务器上的真实条数。
- **实际**：多出 1（x 仍然算在「应该有」里），最长持续 30 秒。
- **原因**：overlay 不随模式切换清掉，`refresh()` 读到的新数据也不会覆盖它。
- **测试**：`controller.modes` › edits made in playlist mode do not linger into a later switch back
- **建议**：bug。离开 `take` 时清掉 overlay（F2、F3 可以一起修）。

### F4　自带队列模式下删掉的条目，切回播放列表模式后数字多 1

- **场景**：在自带队列模式下，从正在播的列表面板里删掉一条（页面自己删）。删除后几秒内读到的还是旧列表，就在这段时间里切回播放列表模式。
- **预期**：数字等于真实条数。
- **实际**：多出 1，并且一直不更新，要等到下一次切回这个标签页（距离上次读取超过 5 秒）才会更新。
- **原因**：不接管时 `onEdited` 直接忽略修改，所以切回来时 `refresh()` 只读一次。读到的是旧数据，之后也不再重读。
- **测试**：`controller.modes` › a removal made while native shows in the count when switching back, even while reads lag
- **建议**：bug，影响小。两种修法任选：不接管时也记下对选中列表的修改（只记，不刷新面板）；或者 `refresh()` 读完后，如果离最近一次已知修改不到 10 秒，就照 1.5、3、5 秒再读几次。

### F5　列表在别处被删掉，切回标签页时发现不了

- **场景**：列表在手机或别的标签页上被删掉了，然后切回这个标签页。
- **预期**：按 §24.5 清空这个身份的选择，停止接管，隐藏按钮。
- **实际**：按钮显示「<列表名> · 0」，菜单里还是「加入 <已删的列表>」，要等到下一次点「加入」才发现。
- **原因**：`readItems()` 不检查 `exists`，`recheck()` 和 `recountUntil()` 都把「列表不存在」当成「空列表」处理。
- **测试**：`controller.sync` › the list deleted elsewhere: noticed on the way back to the tab
- **建议**：bug。`readItems()` 读到 `exists: false` 时，走 `listGone()` 再 `apply()`，并提示 `queue.listGone`。

### F6　看完以后删除失败（网络错误、页面脚本没应答）时没有提示

- **场景**：看完后删除那一条时，请求本身失败了：抛出异常，而不是返回 4xx/5xx。
- **预期**：按 §26 提示「删除失败」并写日志。
- **实际**：只写了一条 error 日志，没有提示。返回 500 时有提示。
- **原因**：`remove()` 只处理返回的 `ok:false`；抛出的异常被 `onPlayer` 里的 `run()` 接住，只写日志。
- **测试**：`controller.watched` › removal request lost (no answer / network error): says so
- **建议**：bug，影响小。`remove()` 捕获异常时也弹提示。

## 假服务器的假设（需要在 L4 里确认）

L2 的假服务器（`tests/support/fake-youtube.ts`）有几处行为是推测的。L4 跑完后在这里写结论，跟真实页面不一致的话要改假服务器，再重跑 L2。

- **A1**（2026-11-20 实测确认）：用 `yt-playlist-manager` 把列表挂到单个视频上以后，`player.getPlaylistId()` 返回这个列表的 ID，`getPlaylistIndex()` 是 0。面板里当前视频在最上面，后面是列表，不重新载入。跟假服务器的假设一致。
- **A5**（2026-11-20 实测，跟原来的假设**不一致**）：官方队列在迷你播放器里播放时，`player.getPlaylistId()` 返回空，只有 `yt-playlist-manager.getPlaylistData().playlistId` 是 `TLPQ…`。迷你播放器下面的信息栏显示「队列 • 1 / 3」。假服务器已经改成这样（`playNativeQueue()`），由此发现了 F8。
- **A2**：页面在面板里删掉一条以后，自己会重新请求 `next` 并重画面板（2026-11-20 实测）。假服务器假设大约 200 毫秒后，用当时读到的（可能还是旧的）数据重画。
- **A3**：删除后读取延迟的实际长度。假服务器测了 0、1、4、12 秒。

## L4（真实 YouTube，`tests/e2e/`）

### F8　官方队列在播时切到播放列表模式再点「加入」，官方队列被我们的列表顶掉

- **场景**：自带队列模式下，迷你播放器在放官方队列（「队列 • 1 / 3」）。切到播放列表模式（立即生效），然后点某个视频的「加入 <列表名>」。
- **预期**：视频进了列表，提示一下；官方队列保持原样（§24.2「正在播别的列表时不挂」，§24.6「已有的官方队列保持原样」）。
- **实际**：`attachIfIdle()` 用 `playing().playlistId` 判断有没有在播列表，但官方队列播放时它是空的（A5）。于是扩展把当前视频当成「不在任何列表里」，调用 `syncList(attach)`，用我们的列表替换了面板，官方队列里后面的视频就没了。main-world 的 `syncList()` 也是只看 `getPlaylistId()`。
- **测试**：`controller.takeover` › the native queue playing in the miniplayer: leaves it；`controller.modes` › ③ native queue: Add leaves the native queue playing（L2，用改过的假服务器）。L4 `modes.spec.ts` › ③ native queue in the miniplayer 在真实页面上复现：官方队列 `[a, DXK2…, qmI0…]` 点「加入」后变成 `[a, 9bZk…(我们的列表), sizw…(刚加的)]`。
- **建议**：bug。main-world 判断「正在播列表」时，`getPlaylistId()` 为空的话再看 `yt-playlist-manager.getPlaylistData().playlistId`；`playing()` 也一起改，这样 controller 能看到 `TLPQ…`。

### F7　读列表时把列表下面的「推荐视频」也算进去了（严重，2026-11-20 已修）

- **场景**：任何一个比较短的列表（实测 2 条）。
- **预期**：`readPlaylist()` 只返回列表里的条目。
- **实际**：返回 7 条，2 条真的，加 5 条推荐视频。顶栏按钮显示 7。
- **原因**：小列表的 `browse` 返回里，`sectionListRenderer.contents[0]` 是列表本身（`playlistVideoListRenderer`），`contents[1]` 是一个 `continuationItemRenderer`，它加载的是列表下面的「推荐视频」区。推荐视频也是 `playlistVideoRenderer`，而且带 `setVideoId`。`readPlaylist()` 用 `walk()` 找到第一个 `continuationCommand` 就跟着翻页，于是把推荐视频当成了条目。2026-11-20 实测。
- **影响**：
  - 数字错；
  - 最后一条看完后，「下一条」是推荐视频：扩展会跳过去播，再试图删掉它；
  - 「已在列表中」、`meetsExpect` 重试、清空和撤销的计划都会被带偏。
- **测试**：`tests/e2e/specs/smoke.spec.ts`（数字应为 2）
- **已修**（经确认提前修）：新增纯函数 `core.ts` 的 `playlistPage()`，只读 `playlistVideoListRenderer` 里的条目，只跟随它最后一项的 continuation（列表超过 100 条时才有）；continuation 返回里只认 `continuationItems` 的直接子项，跳过 `targetId` 为 `VL…` 或 `recommended_videos_shelf` 的推荐区。L1 测试用实测录下来的 2 条和 105 条列表的返回（裁剪后放在 `tests/unit/features/queue/fixtures/`）。修完后，L4 smoke 测试数字正确。

### F9　列表最后一条放完后，YouTube 自己的自动播放会接着放推荐视频（设计跟实际不一致）

- **场景**：在放列表的最后一条，「自动播放」开着（默认开），视频放完。
- **§24.4 写的**：「最后一条看完后列表空了，就停在结束画面」。
- **实际**（2026-11-20 实测，勾不勾「播放完后删除」都一样）：结束画面停大约 6 秒，然后 YouTube 自动播放一个推荐视频，离开了列表（URL 里没有 `list=` 了）。这是 YouTube 自己的行为，不是扩展造成的；勾选「播放完后删除」时，扩展确实删掉了最后一条。
- **测试**：`tests/e2e/specs/watched.spec.ts` › the last entry: removed, stays on the end screen（用 `test.fail` 标出）
- **要你定**：
  - (a) 改设计：接受 YouTube 的行为，把 §24.4 这句改成「之后照 YouTube 的自动播放设置走」，测试也跟着改；
  - (b) 改代码：播放列表模式下列表放完时，扩展取消这次自动播放（比如在结束画面上点取消，或者暂停），停在结束画面。
  - 我倾向 (a)：用户自己开着自动播放，扩展不应该替他关掉；而且 (b) 要跟 YouTube 的倒计时界面较劲，容易坏。

### F10　迷你播放器里没有「上一个 / 下一个」（YouTube 改版，设计前提不成立）

- **场景**：迷你播放器里在放官方队列或播放列表，鼠标悬停。
- **预期**（Q6 第 6 条，§35.1 的前提）：控件栏里有上一个 / 下一个；如果没有，就保留迷你播放器中间那一排（`data-ytpp-keep-mid`）。
- **实际**（2026-11-21 实测）：控件栏里和中间那一排的 `.ytp-prev-button`、`.ytp-next-button` 都是 `display:none`。**把扩展的播放器功能关掉后也一样**，是 YouTube 自己藏的。所以在迷你播放器里没法跳到下一条，只能展开或者在列表面板里点。
- **测试**：`mini-controls.spec.ts` › the native queue: previous / next；our list: previous / next（用 `test.fail` 标出）
- **其他 7 项都通过**（单个视频、官方队列、我们的列表三种状态）：悬停出现、离开后隐藏；进度条上只有一个圆点；播放 / 暂停不会被 scrim 吃掉；进度条点击和拖动都能跳转，窗口不跟着动；静音和音量滑块；齿轮菜单能打开、子菜单能点；展开和关闭。官方队列在关闭时 YouTube 会先弹「待播列表将会清空」的确认框，这是正常的。
- **要你定**：
  - (a) 接受：改 §35.1 的前提说明，删掉 `data-ytpp-keep-mid` 那段逻辑（现在永远不会生效），这条测试改成只断言「没有上一个 / 下一个」，以后 YouTube 加回来时能发现；
  - (b) 扩展自己在迷你播放器控件栏里加上一个 / 下一个按钮（调播放器的 `previousVideo()` / `nextVideo()`），算新功能。
  - 我倾向先 (a)，(b) 记进 §40「以后再做」。

### A6（实测，待确认）　关掉播放器功能后，迷你播放器悬停时也显示底部控件栏

- 排查 F10 时，把设置里的播放器功能整个关掉，迷你播放器悬停时照样显示了播放、音量、时间、「<」、齿轮这一栏。如果 YouTube 现在自己就会显示，§35.1 的「用 CSS 让 `.ytp-chrome-bottom` 显示出来」可能已经多余了。只看了一次，还要确认：关掉功能是否真的对那个页面生效（设置是在打开页面前改的）。

### F11　缩略图上的悬停按钮「添加到待播列表」没有改文字（点击是对的）

- **场景**：播放列表模式，频道视频页上把鼠标移到缩略图上，右上角出现「稍后观看」「添加到待播列表」两个按钮。
- **实际**（2026-11-21 实测）：点它**能正确接管**，加进我们的列表，提示「Added to …」。但按钮的 `aria-label` 和提示还是「添加到待播列表」。
- **原因**：`onHover()` 只认旧的 `ytd-thumbnail-overlay-toggle-button-renderer`，改它的 `data.untoggledTooltip`；现在这个按钮是新版的 view model（`…ThumbnailHoverOverlayToggleActions…` 里面的 `button`），不经过那段代码。
- **测试**：`entries.spec.ts` › hover button label says where it goes（用 `test.fail` 标出）。点击加入的测试（hover button on a thumbnail: adds to the list and says so）是通过的。
- **建议**：bug，影响小（只是文字不对）。§28.1 第 1 条本来就是推测的写法；照新版按钮改文字，或者接受「悬停按钮不改文字」，把 §24.3 写清楚。

### A4（实测）　新建列表加入视频后，立刻读是空的

- 新建的私密列表加入 2 个视频后，立刻 `browse` 读到 0 条，约 3 秒后才读到。这跟 §21.4「加入是立刻可见的」不一致，至少对刚建的列表是这样。还不确定已有的列表是不是也这样，后面的 L4 测试会顺带观察。
- 影响：`onAdd()` 加入后数字靠 overlay 先加上，读到的旧数据不会把数字改回去，所以问题不大；但 §24.8「加入立刻可见」这句要改。
- 测试辅助代码里，建列表后会等到读得到再开始测。
