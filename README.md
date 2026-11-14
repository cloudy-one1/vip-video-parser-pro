# VIP 视频解析 Pro

![解析线路](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/cloudy-one1/vip-video-parser-pro/main/.github/badges/lines.json)

> 徽标数据由 GitHub Actions 每日自动体检生成（见下文「自动体检」）；私有仓库下 shields 暂时读不到数据、徽标不渲染，仓库转公开或部署 Pages 后自动显示，Actions 运行摘要即时可见。

基于《VIP视频解析 v1.0.2》思路重构升级的纯前端项目：粘贴各大视频平台的播放页链接，选择一条解析线路，即可通过第三方公开解析接口在页面内观看。

原版只有一个 4.5 KB 的混淆单文件；重构版把逻辑拆分、去混淆、模块化，并补齐了原版缺失/损坏的功能（如回车解析）。

## 仓库结构

```
.
├── VIP视频解析Pro/          重构版主项目（日常使用这个）
├── .github/workflows/       线路自动体检 + Pages 部署（GitHub Actions）
└── README.md
```

## 功能特性

- **多线路解析**：内置 11 条公开解析线路（老默认线路 + 参考 [88lin/video_vip](https://github.com/88lin/video_vip) 维护的接口清单，经深度体检筛选），点击即切换；播放器开着时切换线路会自动用新线路重载当前视频。
- **无损云搜索**：输入框直接敲片名（非链接），自动搜无损云资源库 → 海报候选面板 → 选剧 → 选集 → 内嵌 m3u8 播放器直连观看（详见下文「无损云搜索」）。
- **m3u8 直连**：粘贴任何 `.m3u8` 链接自动识别，直接用内嵌播放器观看，不走解析线路。
- **线路状态徽标**：每条线路前有状态点——🟢 可用 / 🟡 被拦 / 🔴 失效 / ⚪ 未体检，悬停可看延迟与原因；失效线路整条半透明显示。
- **两条体检通道**：
  - **深度体检**（推荐）：本地跑一次 `tools/line_checker.py`（Scrapling 驱动），结果写入 `js/lines-status.js`，页面打开即自动读取；
  - **浏览器快测**：点页面上的「⚡ 体检」，用 `no-cors` 请求粗粒度探测各线路站点可达性（只能区分"可达/不可达"）。
- **智能换线**：播放器工具栏和加载层都有「⇄ 换线重试」，一键切到下一条线路并重载当前视频；换线优先选择体检可用且近期没有失败过的线路。
- **超时自动换线**：线路加载 8 秒无响应时自动换到下一条可用线路重试（最多尝试 4 条），全程无需手动点击；工具栏「⏭ 自动换线」可一键开关。超时的线路会记入失败记忆，30 分钟内智能换线自动绕开它，正常加载后自动解除。
- **线路管理**：支持在页面上添加 / 编辑 / 删除线路，↑↓ 调整排序（决定 `Alt+1~9` 与智能换线的优先顺序），配置保存在浏览器 localStorage，可一键恢复默认。
- **快捷键**：`Enter` 解析 / 搜索、`Esc` 清空输入框（并关闭搜索 / 管理面板）、`Alt+1~9` 快速切换线路。原版的回车解析因调用了不存在的函数而失效，本项目已修复。
- **平台识别**：输入链接时自动识别来源平台（腾讯视频、爱奇艺、优酷、芒果TV、哔哩哔哩等）并显示徽标。
- **观看记录与收藏**：最近 50 条解析记录自动保存，可一键重播、收藏、删除，支持「只看收藏」过滤和按链接 / 平台 / 剧名关键字搜索。每条记录记住上次解析用的线路，重播时自动切回；该线路失效或刚超时过时，只在能换到更优线路的情况下才自动切换，否则留在当前线路。云端搜索的播放记录会显示「剧名 · 集名」。
- **播放器工具栏**：换线重试、刷新、新窗口打开（应对禁止内嵌的线路）、关闭；带加载动画和白屏兜底。
- **URL 直连**：页面地址带 `?url=视频链接` 时自动填充并解析（修复了原版此处对 `?` 截取的错误逻辑）。
- **视觉风格系统**：G4「微光磨砂」——深色单主题、单强调色（青蓝柔光）、磨砂卡片、播放器呼吸微光；全部通过 CSS token 定义（见 `css/style.css` 顶部）。响应 `prefers-reduced-motion` 自动降级动效。
- **零构建**：纯静态 HTML/CSS/JS，无需安装依赖，无需本地服务器。

## 使用方法

双击 `index.html` 用浏览器打开即可（推荐 Chrome / Edge）。

也可以起一个本地静态服务：

```bash
# 任选其一
python -m http.server 8080
npx serve .
```

然后访问 http://localhost:8080

> 提示：直接以 `file://` 打开时，「粘贴」按钮的剪贴板读取在部分浏览器会受限，属正常现象，手动 Ctrl+V 即可。

## 在线访问（GitHub Pages）

**https://cloudy-one1.github.io/vip-video-parser-pro/**

- `.github/workflows/pages-deploy.yml` 把 `VIP视频解析Pro/` 作为站点根发布，每次 push 到 main 自动更新（每日自动体检的快照提交也会顺带刷新线上线路状态）；
- 部署在海外节点，公共搜索代理的可达性通常比本地裸连更好；粘贴按钮、云端搜索在 http(s) 环境下无任何限制。

## 线路体检（REA + Scrapling 工具链）

解析站时效性差——老默认 8 条线路实测只剩 5 条可用。2026-11-14 引入 [88lin/video_vip](https://github.com/88lin/video_vip) 维护的接口清单扩充候选，跑一轮深度体检 15 选 11，只保留通过的线路作默认。工具链 `tools/line_checker.py` 用 [Scrapling](https://github.com/D4Vinci/Scrapling) 批量探测各线路首页，把结果写成前端可直接消费的状态快照：

```bash
# 在 VIP视频解析Pro/ 目录下执行
# 依赖：Python 3.10+，且已 pip install "scrapling[all]>=0.5"
python tools/line_checker.py              # 体检 js/config.js 里的默认线路
python tools/line_checker.py --timeout 12 # 调整单站超时
python tools/line_checker.py --no-browser # 只走 HTTP 层快速体检（CI 同款口径）
```

检测规则（经 REA 真实浏览器捕获校准）：

- HTTP 层优先（curl 指纹 + 隐身头），被拦或异常时自动用无头浏览器复核；
- **nginx 裸 403 页**（真实浏览器里也渲染 403 Forbidden）→ 判「失效：服务器明确拒绝」；
- **Cloudflare 质询特征**（Just a moment 等）→ 判「被拦」，站点可能还活着；
- **跨域跳转/停放页特征**（域名出售、account suspended 等，只扫可见文本防误伤）→ 判「失效」；
- 本机 TLS 证书链报错时（如 OK解析），浏览器复核用自己的证书库兜底。

输出两个文件到 `js/`：`lines-status.json`（供人阅读与 CI/徽标展示，前端实际不读取）和 `lines-status.js`（前端以 `<script>` 动态注入读取，`file://` 与 http 部署均适用，快照不存在则静默跳过）。

> 体检只访问线路站点首页，不携带任何视频链接；「浏览器快测」为 no-cors 粗粒度探测，任何 HTTP 响应都算可达。

## 自动体检（GitHub Actions）

仓库内置 `.github/workflows/line-check.yml`：**每天北京时间 09:00** 自动跑一次 HTTP-only 体检（`--no-browser`），把线路状态快照、徽标数据和趋势历史提交回仓库，本地 `git pull` 后页面线路状态即为最新。也可以到 [Actions](https://github.com/cloudy-one1/vip-video-parser-pro/actions) 页面手动触发（Run workflow），每次运行的结果摘要在运行详情页可见。

两点口径说明：

- Actions 的 runner 位于海外，自动体检是「全球 HTTP 视角」：个别国内解析站可能因跨境网络差异被判超时/异常，个人使用以本地深度体检（默认含无头浏览器复核）为准；
- 徽标数据在 `.github/badges/lines.json`，经 shields.io endpoint 徽标渲染——私有仓库下 shields 读不到、徽标暂不显示，仓库转公开或部署 Pages 后自动生效。

### 线路健康趋势

自动体检每次运行都会把「可用线路数」追加到 `.github/badges/history.json`（保留最近 180 条），并生成趋势曲线 `.github/badges/trend.svg`（青蓝面积图 + 50% 虚线基准 + 当前值标注）：

![线路可用率趋势](https://raw.githubusercontent.com/cloudy-one1/vip-video-parser-pro/main/.github/badges/trend.svg)

- 与徽标一样，私有仓库下该图暂不渲染，仓库转公开或部署 Pages 后自动显示；每次 Actions 运行摘要里有「趋势(最近 7 次)」文字版，即时可见；
- 趋势口径与自动体检一致（CI 海外 runner 的 HTTP-only 视角）；本地手动体检想累积历史的话：`python tools/line_checker.py --no-browser --history ..\.github\badges\history.json --trend-svg ..\.github\badges\trend.svg`。

## 无损云搜索（参考 88lin/video_vip）

输入框敲片名（如 `甄嬛传`）回车，流程：**搜索资源库 → 海报候选面板 → 选剧 → 选集网格 → 内嵌播放**。选集面板保持打开，点集号即可连续换集；历史记录里显示「剧名 · 集名」。

数据链路与可靠性说明（重要）：

- 搜索与选集数据来自无损云资源库的苹果CMS协议接口（`wsyzy.cc` suggest + `api.wsyzy.net` detail），播放内嵌其官方 `wsyzy.vip/m3u8` 播放器；
- 该 API 不带 CORS 头，纯静态页无法直连，只能经**公共 CORS 代理**中转（`js/config.js` 的 `CLOUD.PROXIES` 代理链：直连 → allorigins → cors.eu.org → workers.dev，成功者下次优先）；
- **尽力而为**：公共代理波动大（实测时好时坏），全部失败时搜索面板明确提示并保留「重试」，解析线路与 m3u8 直连不受影响；
- **结果缓存 6 小时**（localStorage）：搜过的剧、取过的选集不再依赖代理，二次观看零代理依赖；
- 受浏览器沙箱限制，油猴脚本式的「页面片名自动识别 / 自动匹配集数」做不到，网页版为人输入片名 + 手动选集。

## 添加解析线路

点击「⚙ 管理线路」，在下方表单填写：

- **线路名称**：随意，如 `我的线路`
- **接口地址**：解析站的地址，视频链接会编码后拼接在末尾；如接口格式特殊，可用 `{url}` 占位符指定位置，例如：
  ```
  https://example.com/vip/?id={url}&type=auto
  ```

## 项目内部目录结构

```
VIP视频解析Pro/
├── index.html           页面结构
├── css/style.css        视觉风格系统（G4 微光磨砂 token 体系、响应式、动效降级）
├── js/config.js         默认线路、无损云搜索配置、平台识别规则（改这里就能换默认配置）
├── js/app.js            主逻辑（解析、无损云搜索、历史、收藏、线路管理、状态徽标、智能换线）
├── js/lines-status.js   线路状态快照（tools/line_checker.py 生成，可随时重跑）
├── js/lines-status.json 同上，http 部署时 fetch 读取
└── tools/line_checker.py  Scrapling 线路体检工具链
```

## 免责声明

本项目仅用于前端技术学习与交流。视频解析与云端资源搜索均由第三方公开接口完成，接口的可用性、稳定性与内容合法性均与本项目无关；解析站可能随时失效或包含广告，资源库搜索经过的公共代理亦不承诺可用性。请在支持正版的前提下合理使用。
