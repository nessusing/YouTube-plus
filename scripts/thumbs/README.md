# 列表页缩略图实测脚本

F-22 实测用的脚本，结论见 [docs/research/2026-11-22-列表页缩略图动起来.md](../../docs/research/2026-11-22-列表页缩略图动起来.md)。
用 e2e 测试账号的 Chromium（`npm run e2e:login` 登录过的 profile），无头、静音，只读页面。跑的时候不能同时跑 L4（同一个 profile）。

| 脚本 | 做什么 |
|---|---|
| `probe.mjs <输出.json> <路径>...` | 各页面的数据里有多少卡片带官方动图链接 |
| `probe-home.mjs [--headed]` | 首页、订阅页：数据里有什么、悬停时请求什么、截帧和动图链接能不能用 |
| `probe-board.mjs` | storyboard 拿不拿得到；混合样本里截帧的覆盖率 |
| `probe-check.mjs` | 换普通浏览器 UA 复查首页；storyboard 的大小；大图截帧的覆盖率 |
| `probe-dom.mjs <截图.png> ["路径 路径…"]` | 动图链接挂在页面的哪个元素上、缩略图的 DOM 结构、动图循环次数 |
