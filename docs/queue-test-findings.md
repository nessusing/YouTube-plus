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

- **A1**：用 `yt-playlist-manager` 把列表挂到单个视频上以后，`player.getPlaylistId()` 是否返回这个列表的 ID。假服务器假设是。如果不是，挂上以后再加入会按「没在播列表」重新挂一次，当前视频放完时也不会触发 `onPlayer`。
- **A2**：页面在面板里删掉一条以后，自己会重新请求 `next` 并重画面板（2026-11-20 实测）。假服务器假设大约 200 毫秒后，用当时读到的（可能还是旧的）数据重画。
- **A3**：删除后读取延迟的实际长度。假服务器测了 0、1、4、12 秒。

## L4（真实 YouTube，`tests/e2e/`）

### F7　读列表时把列表下面的「推荐视频」也算进去了（严重）

- **场景**：任何一个比较短的列表（实测 2 条）。
- **预期**：`readPlaylist()` 只返回列表里的条目。
- **实际**：返回 7 条，2 条真的，加 5 条推荐视频。顶栏按钮显示 7。
- **原因**：小列表的 `browse` 返回里，`sectionListRenderer.contents[0]` 是列表本身（`playlistVideoListRenderer`），`contents[1]` 是一个 `continuationItemRenderer`，它加载的是列表下面的「推荐视频」区。推荐视频也是 `playlistVideoRenderer`，而且带 `setVideoId`。`readPlaylist()` 用 `walk()` 找到第一个 `continuationCommand` 就跟着翻页，于是把推荐视频当成了条目。2026-11-20 实测。
- **影响**：
  - 数字错；
  - 最后一条看完后，「下一条」是推荐视频：扩展会跳过去播，再试图删掉它；
  - 「已在列表中」、`meetsExpect` 重试、清空和撤销的计划都会被带偏。
- **测试**：`tests/e2e/specs/smoke.spec.ts`（数字应为 2）
- **建议**：bug，要先修，否则大部分 L4 结果都没有意义。只跟随 `playlistVideoListRenderer` 自己的 continuation（列表超过 100 条时，它在 `playlistVideoListRenderer.contents` 的最后一项），以及 continuation 返回里接在列表后面的那一段；推荐区一概不跟。

### A4（实测）　新建列表加入视频后，立刻读是空的

- 新建的私密列表加入 2 个视频后，立刻 `browse` 读到 0 条，约 3 秒后才读到。这跟 §21.4「加入是立刻可见的」不一致，至少对刚建的列表是这样。还不确定已有的列表是不是也这样，后面的 L4 测试会顺带观察。
- 影响：`onAdd()` 加入后数字靠 overlay 先加上，读到的旧数据不会把数字改回去，所以问题不大；但 §24.8「加入立刻可见」这句要改。
- 测试辅助代码里，建列表后会等到读得到再开始测。
