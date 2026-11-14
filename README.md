# VIP 视频解析 Pro

> 纯前端的视频解析聚合播放器——粘贴播放页链接选线路观看、片名直搜无损云资源库、`.m3u8` 直连。零构建、零依赖、免安装。

![Pages 部署](https://github.com/cloudy-one1/vip-video-parser-pro/actions/workflows/pages-deploy.yml/badge.svg)
![线路体检](https://github.com/cloudy-one1/vip-video-parser-pro/actions/workflows/line-check.yml/badge.svg)
![解析线路](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/cloudy-one1/vip-video-parser-pro/main/.github/badges/lines.json)
![License](https://img.shields.io/github/license/cloudy-one1/vip-video-parser-pro)

**在线使用(推荐)**:[https://cloudy-one1.github.io/vip-video-parser-pro/](https://cloudy-one1.github.io/vip-video-parser-pro/)——线路状态、徽标与趋势图由 GitHub Actions 每日自动体检更新,无需本地任何操作。

## 目录

- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [使用方法](#使用方法)
- [无损云搜索](#无损云搜索)
- [线路体检与自动监控](#线路体检与自动监控)
- [反解析站弊端](#反解析站弊端)
- [增强防护(推荐顺序)](#增强防护推荐顺序)
- [添加解析线路](#添加解析线路)
- [常见问题](#常见问题)
- [仓库结构](#仓库结构)
- [参与贡献](#参与贡献)
- [License](#license)
- [免责声明](#免责声明)

## 功能特性

### 三种观看方式

- **链接解析**:粘贴腾讯视频、爱奇艺、优酷、芒果TV、哔哩哔哩等平台的播放页链接,选择一条解析线路在页面内观看;自动识别平台并显示徽标。播放器开着时切换线路,自动用新线路重载当前视频。
- **无损云搜索**:输入框直接敲片名(非链接),自动搜无损云资源库 → 海报候选面板 → 选剧 → 选集 → 自家播放器直连观看,详见[无损云搜索](#无损云搜索)。
- **m3u8 直连**:粘贴任何 `.m3u8` 链接自动识别,直接用自家播放器观看,不走解析线路。

云端搜索与 m3u8 播放由仓库内置的 `player.html`(本地化 hls.js)完成,**完全不经过任何第三方播放器页面**;解析线路则加载在带安全沙箱的 iframe 里,详见[反解析站弊端](#反解析站弊端)。

### 智能线路系统

- **状态徽标**:每条线路前有状态点 🟢 可用 / 🟡 被拦 / 🔴 失效 / ⚪ 未体检,悬停可看延迟与原因;失效线路整条半透明显示。
- **智能换线**:工具栏与加载层都有「⇄ 换线重试」,一键切到下一条线路并重载当前视频;换线优先选体检可用且近期没失败过的线路。
- **超时自动换线**:线路加载 8 秒无响应自动换下一条可用线路重试(最多尝试 4 条),全程无需手动点击;工具栏「⏭ 自动换线」可开关。
- **失败记忆**:超时或手动标记「👎 这条不行」的线路记入失败记忆,30 分钟内智能换线自动绕开,正常加载后自动解除。
- **本地质量学习**:每条线路的成功/失败持续累计,多条可用时按**本地成功率**择优,悬浮 chip 可看「本地成功率」;越用越准。
- **线路管理**:页面上添加 / 编辑 / 删除线路,↑↓ 调整排序(决定 `Alt+1~9` 与智能换线的优先级),配置存 localStorage,可一键恢复默认。
- **两条体检通道**:本地深度体检(`tools/line_checker.py`,Scrapling 驱动,见[线路体检与自动监控](#线路体检与自动监控))+ 页面「⚡ 体检」浏览器快测(no-cors 粗粒度探测可达性)。

### 体验细节

- **观看记录与收藏**:最近 50 条解析记录自动保存,一键重播、收藏、删除,支持「只看收藏」过滤和按链接 / 平台 / 剧名搜索;每条记录记住上次用的线路,重播自动切回——该线路刚失效或超时过时,只在能换到**更优**线路时才自动切换,避免越换越差;云端播放记录显示「剧名 · 集名」。
- **快捷键**:`Enter` 解析 / 搜索,`Esc` 清空输入框(并关闭搜索 / 管理面板),`Alt+1~9` 快速切换线路。原版的回车解析因调用了不存在的函数而失效,本项目已修复。
- **URL 直连**:页面地址带 `?url=视频链接` 时自动填充并解析(修复了原版对 `?` 的错误截取逻辑)。
- **播放器工具栏**:换线重试、刷新、新窗口打开(应对禁止内嵌的线路)、关闭;带加载动画与白屏兜底。
- **「深夜值班室」视觉系统**:暖色深夜暗调(oklch 设计 token 体系)、楷体展示字、台灯柔光、磨砂卡片;响应 `prefers-reduced-motion` 自动降级动效。
- **零构建**:纯静态 HTML/CSS/JS,无需安装依赖,无需本地服务器,`file://` 双击即用。

## 快速开始

**方式一:在线使用(推荐)**

直接打开 **[https://cloudy-one1.github.io/vip-video-parser-pro/](https://cloudy-one1.github.io/vip-video-parser-pro/)**。部署在 GitHub Pages 海外节点,公共搜索代理的可达性通常比本地裸连更好;粘贴按钮、云端搜索在 http(s) 环境下无任何限制。

**方式二:本地使用**

```bash
git clone https://github.com/cloudy-one1/vip-video-parser-pro.git
cd vip-video-parser-pro
```

双击 `VIP视频解析Pro/index.html` 用浏览器打开即可(推荐 Chrome / Edge)。也可以起一个本地静态服务:

```bash
# 任选其一
python -m http.server 8080
npx serve VIP视频解析Pro
```

> 以 `file://` 打开时,「粘贴」按钮的剪贴板读取在部分浏览器会受限,属正常现象,手动 Ctrl+V 即可。

## 使用方法

输入框支持三种内容,回车后自动路由:

| 输入内容 | 行为 |
| --- | --- |
| 平台播放页链接 | 走解析线路观看,`Alt+1~9` 或工具栏换线 |
| 片名(如 `甄嬛传`) | 无损云搜索 → 选剧 → 选集播放 |
| `.m3u8` 链接 | 自家播放器直连播放 |

页面功能分区:输入框上方为线路状态 chips 与体检入口,右侧「⚙ 管理线路」维护线路库,播放后自动展开工具栏(换线 / 刷新 / 新窗口 / 关闭),历史与收藏面板支持搜索过滤。

## 无损云搜索

输入框敲片名(如 `甄嬛传`)回车,流程:**搜索资源库 → 海报候选面板 → 选剧 → 选集网格 → 内嵌播放**。选集面板保持打开,点集号即可连续换集;历史记录里显示「剧名 · 集名」。

数据链路与可靠性说明(重要):

- 搜索与选集数据来自无损云资源库的苹果CMS协议接口(`wsyzy.cc` suggest + `api.wsyzy.net` detail),播放走自家 `player.html` 直连其 m3u8 资源;
- 该 API 不带 CORS 头,纯静态页无法直连,只能经**公共 CORS 代理**中转(`js/config.js` 的 `CLOUD.PROXIES` 代理链:直连 → allorigins → cors.eu.org → workers.dev,成功者下次优先);
- **尽力而为**:公共代理波动大,全部失败时搜索面板明确提示并保留「重试」,解析线路与 m3u8 直连不受影响;
- **结果缓存 6 小时**(localStorage):搜过的剧、取过的选集不再依赖代理,二次观看零代理依赖;
- 受浏览器沙箱限制,油猴脚本式的「页面片名自动识别 / 自动匹配集数」做不到,网页版为人输入片名 + 手动选集。

## 线路体检与自动监控

解析站时效性差是这类工具最大的痛点——老默认 8 条线路实测只剩 5 条可用。本仓库为线路库建立了持续的体检机制:参考 [88lin/video_vip](https://github.com/88lin/video_vip) 维护的接口清单扩充候选,深度体检 15 选 11;随后因播放页出现成人广告插页,**按内容政策除名 BD解析(bd.jx.cn)**,当前内置 **10 条**默认线路。存量设备打开页面时会自动迁移清除被除名线路,不影响用户自定义线路。

### 深度体检工具(本地)

`VIP视频解析Pro/tools/line_checker.py` 用 [Scrapling](https://github.com/D4Vinci/Scrapling) 批量探测各线路首页,把结果写成前端可直接消费的状态快照。依赖 Python 3.10+,`pip install "scrapling[all]>=0.5"`:

```bash
# 在 VIP视频解析Pro/ 目录下执行
python tools/line_checker.py              # 体检 js/config.js 里的默认线路
python tools/line_checker.py --timeout 12 # 调整单站超时
python tools/line_checker.py --no-browser # 只走 HTTP 层快速体检(CI 同款口径)
python tools/line_checker.py --history ..\.github\badges\history.json --trend-svg ..\.github\badges\trend.svg  # 累积健康趋势
```

检测规则(经真实浏览器捕获校准):

- HTTP 层优先(curl 指纹 + 隐身头),被拦或异常时自动用无头浏览器复核;
- **nginx 裸 403 页**(真实浏览器里也渲染 403 Forbidden)→ 判「失效:服务器明确拒绝」;
- **Cloudflare 质询特征**(Just a moment 等)→ 判「被拦」,站点可能还活着;
- **跨域跳转/停放页特征**(域名出售、account suspended 等,只扫可见文本防误伤)→ 判「失效」;
- 本机 TLS 证书链报错时,浏览器复核用自己的证书库兜底。

输出两个文件到 `js/`:`lines-status.js`(前端以 `<script>` 动态注入读取,`file://` 与 http 部署均适用,快照不存在则静默跳过)和 `lines-status.json`(供人阅读与 CI / 徽标展示)。

> 体检只访问线路站点首页,不携带任何视频链接;页面「⚡ 体检」为 no-cors 粗粒度探测,任何 HTTP 响应都算可达。

### 自动体检(GitHub Actions)

仓库内置 `.github/workflows/line-check.yml`:**每天北京时间 09:00** 自动跑一次 HTTP-only 体检(`--no-browser`),把线路状态快照、徽标数据和趋势历史提交回仓库,线上页面随之刷新。也可到 [Actions](https://github.com/cloudy-one1/vip-video-parser-pro/actions) 页面手动触发(Run workflow),每次运行的结果摘要在运行详情页可见。

口径说明:Actions runner 位于海外,自动体检是「全球 HTTP 视角」,个别国内解析站可能因跨境网络差异被判超时/异常;个人使用以本地深度体检(默认含无头浏览器复核)为准。

### 线路健康趋势

每次自动体检把「可用线路数」追加到 `.github/badges/history.json`(保留最近 180 条),并生成趋势曲线 `.github/badges/trend.svg`(面积图 + 50% 虚线基准 + 当前值标注):

![线路可用率趋势](https://raw.githubusercontent.com/cloudy-one1/vip-video-parser-pro/main/.github/badges/trend.svg)

本地手动体检想累积同一口径的历史:`python tools/line_checker.py --no-browser --history ..\.github\badges\history.json --trend-svg ..\.github\badges\trend.svg`。

## 反解析站弊端

解析站的弊端(广告、骗点击、劫持、不稳定)里,纯静态页能管的都管了:

1. **iframe 安全沙箱**:播放器 iframe 加了 `sandbox`,第三方解析页**无法**弹窗、劫持/跳转当前页面、自动下载文件、弹出 alert/confirm 对话框——主流骗点击套路直接失效;
2. **自建播放器**:片名搜索与 m3u8 播放走本地 `player.html`(hls.js 本地化),不经过任何第三方播放器页面,无广告无水印逻辑;
3. **线路质量本地学习**:每条线路的成功/失败持续累计,智能换线按本地成功率择优,配合「👎 这条不行」手动反馈与失败记忆,越用越准;
4. **诚实的边界**:往第三方 iframe 里注入广告拦截是静态页做不到的(需要浏览器扩展),解析页内部的残余骚扰请搭配下文的增强防护;项目不做 DRM 破解。

## 增强防护(推荐顺序)

解析页内的广告需要浏览器级工具才能净化。按省事程度推荐:

1. **AdGuard 官方扩展(首选,一步到位)**:网络层+行为层+视觉层全套,规则表每日云端更新,对解析站广告的覆盖最全。站内线路行与播放提示都提供了[官方安装引导跳转](https://adguard.com/zh_cn/adguard-browser-extension/extension.html)(自动识别浏览器与平台,含手机版 App);与本项目完全兼容,可叠加。
2. **本项目净化用户脚本(精准定制替代)**:不想全局装拦截器、只要「解析时净化」的人选它,详见下节。
3. **MV3 扩展壳(网络层拦截版)**:把用户脚本规则升级为 `declarativeNetRequest` 网络拦截,本地加载,见 [extension/README.md](extension/README.md)。

### 解析页净化用户脚本(可选增强)

伴生用户脚本 [`userscript/parse-ad-shield.user.js`](userscript/parse-ad-shield.user.js)(v2,规则驱动的微型过滤引擎):

- **机制来源**:深拆 AdGuard 扩展的过滤引擎(`tsurlfilter`/`agtree`),蒸馏其 scriptlet 分发机制、别名表与实战规则形态;再用渲染级侦察(含带视频地址的播放页)确认广告在播放时动态注入、壳站点存在嵌套播放器域——两路证据共同驱动规则表;
- **微型 scriptlet 引擎**:实现 9 个与 AdGuard/uBO 同名的脚本注入单元(`prevent-window-open`、`set-constant`、`abort-on-property-read`、`abort-current-inline-script`、`prevent-addEventListener`、`prevent-refresh`、`remove-class`、`remove-attr`、`hide-in-shadow-dom`)+ 广告资源断供(MutationObserver 动态拦截)+ 化妆品过滤;**规则用 AdGuard 兼容语法写在脚本内**(`域名##选择器` / `域名#$+js(...)`),以后补规则不改代码;
- **嵌套覆盖**:`@match` 覆盖全部内置线路站 + aibox 的嵌套真播放器域(`1ljx.com`)+ 无损云播放器域,默认注入所有帧——站内解析 iframe 里的每一层都被净化;
- **与站内联动**:脚本在本站写入激活标记,页面线路行显示「🛡 净化已启用」徽标;
- **诚实的边界**:无网络层拦截权限(那是扩展特权),对广告的打击面以「挂钩+断供+藏匿」为上限;统计类脚本(51.la 等)刻意不拦;不碰视频流。代码为独立 MIT 实现。

安装方法:装好 [Tampermonkey](https://www.tampermonkey.net/) 或 Violentmonkey 后,打开下面这个链接按提示安装即可(也可手动新建脚本粘贴全文):

```
https://raw.githubusercontent.com/cloudy-one1/vip-video-parser-pro/main/userscript/parse-ad-shield.user.js
```

**要网络层拦截?** 仓库还提供 [MV3 扩展壳](extension/README.md)(本地加载,Chrome/Edge):`declarativeNetRequest` 在网络栈直接掐断广告请求(含弹窗导航),scriptlet 引擎与用户脚本同源,规则仅对解析站生效、不影响日常浏览。

## 添加解析线路

点击「⚙ 管理线路」,在下方表单填写:

- **线路名称**:随意,如 `我的线路`
- **接口地址**:解析站的地址,视频链接会编码后拼接在末尾;如接口格式特殊,可用 `{url}` 占位符指定位置,例如:

  ```
  https://example.com/vip/?id={url}&type=auto
  ```

## 常见问题

**Q:解析一直白屏 / 转圈?**
A:等 8 秒会自动换线(最多试 4 条);也可点「⇄ 换线重试」手动换,或「👎 这条不行」直接反馈并换线。线路前的状态徽标可作参考,🔴 基本失效、🟡 可能被 Cloudflare 拦。

**Q:片名搜索失败?**
A:搜索依赖公共 CORS 代理,尽力而为,失败请点重试或稍后再试;搜过的剧有 6 小时缓存,二次观看不依赖代理;解析线路与 m3u8 直连不受影响。

**Q:为什么和原版《VIP视频解析 v1.0.2》长得不一样?**
A:原版只有 4.5 KB 的混淆单文件,本仓库把它去混淆、模块化重构,修复了失效功能(回车解析、`?url=` 直连),并在此基础上加了解析线路体检、云搜索、自建播放器等能力。

**Q:想换掉默认线路?**
A:页面「⚙ 管理线路」改完存在 localStorage;想改出厂默认直接编辑 `js/config.js` 的 `DEFAULT_LINES`。

**Q:解析页里还是有广告?**
A:静态页的沙箱只能从外面封住弹窗 / 劫持 / 下载,iframe 内部的净化需要浏览器级工具——见[增强防护](#增强防护推荐顺序)。

## 仓库结构

```
.
├── VIP视频解析Pro/            重构版主项目(Pages 站点根,日常使用这个)
│   ├── index.html               页面结构
│   ├── player.html              自建 hls.js 播放器(云搜索 / m3u8 直连专用)
│   ├── css/
│   │   ├── tokens.css           设计 token(色彩 / 字体 / 间距 / 动效)
│   │   ├── base.css             基础样式与动效降级
│   │   └── style.css            组件样式
│   ├── js/
│   │   ├── config.js            默认线路、云搜索配置、平台识别规则(改这里换默认配置)
│   │   ├── app.js               主逻辑(解析、云搜索、历史、换线、质量学习)
│   │   ├── lines-status.js      线路状态快照(体检工具生成,<script> 注入读取)
│   │   ├── lines-status.json    同上 JSON 版(供人阅读与 CI / 徽标展示)
│   │   └── vendor/              本地化 hls.js(Apache-2.0,无 CDN 依赖)
│   └── tools/line_checker.py    Scrapling 线路体检工具链
├── userscript/
│   └── parse-ad-shield.user.js  解析页净化用户脚本(微型 scriptlet 引擎)
├── extension/                   MV3 扩展壳(DNR 网络层拦截 + 同源 scriptlet)
│   ├── manifest.json
│   ├── rules/dnr.json           28 条 DNR 静态规则(tools/gen_dnr.py 生成)
│   └── content/engine.js        scriptlet 引擎(tools/gen_engine.py 从用户脚本生成)
├── tools/
│   ├── gen_dnr.py               用户脚本规则 → DNR 规则生成器
│   └── gen_engine.py            用户脚本 → 扩展壳引擎生成器(单一事实源=用户脚本)
├── .github/
│   ├── workflows/               line-check.yml 每日体检 · pages-deploy.yml Pages 部署
│   └── badges/                  徽标数据 lines.json · 健康趋势 history.json / trend.svg
├── LICENSE
└── README.md
```

## 参与贡献

欢迎提 Issue 与 PR:

- **线路失效反馈**最有价值:附上线路名称与现象(白屏 / 弹窗 / 广告),或跑一次本地体检贴结果;
- **广告域名反馈**:净化规则用 AdGuard 兼容语法写在 `userscript/parse-ad-shield.user.js` 内,补规则不改代码;
- 改用户脚本后请跑 `python tools/gen_engine.py` 同步 MV3 扩展壳(单一事实源);改默认线路后跑 `python tools/line_checker.py` 重新体检;
- 前端保持零构建零依赖,不要引入打包流程或 CDN 外链。

## License

本项目代码以 [MIT](LICENSE) 发布。第三方组件:`VIP视频解析Pro/js/vendor/hls.light.min.js` 为 [hls.js](https://github.com/video-dev/hls.js) 的本地化版本(Apache-2.0,保留其许可声明)。

## 免责声明

本项目仅用于前端技术学习与交流。视频解析与云端资源搜索均由第三方公开接口完成,接口的可用性、稳定性与内容合法性均与本项目无关;解析站可能随时失效或包含广告,资源库搜索经过的公共代理亦不承诺可用性。请在支持正版的前提下合理使用。
