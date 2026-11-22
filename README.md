# VIP 视频解析 Pro

> 纯前端的视频解析聚合播放器:粘贴播放页链接选线路观看、片名直搜无损云资源库、`.m3u8` 直连——零构建、零依赖、免安装。

![Pages 部署](https://github.com/cloudy-one1/vip-video-parser-pro/actions/workflows/pages-deploy.yml/badge.svg)
![线路体检](https://github.com/cloudy-one1/vip-video-parser-pro/actions/workflows/line-check.yml/badge.svg)
![解析线路](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/cloudy-one1/vip-video-parser-pro/main/.github/badges/lines.json)
![License](https://img.shields.io/github/license/cloudy-one1/vip-video-parser-pro)

## 快速开始

- **在线使用(推荐)**:[https://cloudy-one1.github.io/vip-video-parser-pro/](https://cloudy-one1.github.io/vip-video-parser-pro/)
- **本地使用**:克隆仓库后双击 `VIP视频解析Pro/index.html`(推荐 Chrome / Edge),或 `python -m http.server` 起个静态服务。

## 功能

- **输入双入口,自动路由**:链接框贴视频平台播放页链接 → 解析线路观看(自动识别平台);片名框搜剧名 → 无损云搜索(非凡/暴风/360/无忧 四源并行聚合,候选标来源+正主前置,同名去重,单源故障不影响其余;经公共 CORS 代理尽力而为,结果缓存 6 小时;误贴链接自动转解析);`.m3u8` 链接 → 直连播放。播放工具栏与观看记录均标注「云播放 / 线路播放」来源。
- **智能换线**:线路 8 秒无响应自动换下一条(最多试 4 条),失败线路 30 分钟内自动绕开,多条可用时按本地**加载成功率**择优(「👎 这条不行」的黑屏反馈双倍计权);换线对**同上游家族**的线路自动降权(如 8090 与 789 同运营者,换过去不算真重试)。
- **状态徽标**:每条线路 🟢 可用 / 🟡 被拦 / 🔴 失效,数据来自深度体检(`tools/line_checker.py`)与 GitHub Actions 每日自动体检;徽标文案自带体检日期,另有**看门狗工作流**在体检停摆超 72 小时时自动开 issue 报警。
- **安全沙箱 + 自建播放器**:解析页 iframe 封死弹窗 / 劫持页面 / 自动下载;云搜索与 m3u8 走仓库内置 hls.js 播放器(`player.html`),不经过任何第三方播放器页面。
- **观看记录与收藏**:最近 50 条,记住上次线路、重播自动切回;支持搜索与「只看收藏」;云端播放显示「剧名 · 集名」。
- **线路管理**:增删改、↑↓ 排序、一键恢复默认;`Alt+1~9` 快速切线,`?url=` 直连解析。

## 增强防护

解析页内部的广告需要浏览器级工具净化。**线上站强制要求拦截器生效**:检测不到会显示引导门(file:// 本地打开不强制——浏览器扩展默认不注入文件页;Android 上 Chrome/Samsung/Edge 等装不了过滤扩展,同样只做顶部提醒、不锁页面,建议换用 Brave / Firefox 打开或装 AdGuard 安卓版)。按省事程度推荐:

1. **[AdGuard 官方浏览器扩展](https://microsoftedge.microsoft.com/addons/detail/adguard-%E5%B9%BF%E5%91%8A%E6%8B%A6%E6%88%AA%E5%99%A8/pdffkfellgipmhklpdmokmckkkfcopbh)**——首选,免费,一步到位;**注意别下成 AdGuard 桌面/手机 App(付费系统级软件,本站场景不需要)**。商店直达:[Edge](https://microsoftedge.microsoft.com/addons/detail/adguard-%E5%B9%BF%E5%91%8A%E6%8B%A6%E6%88%AA%E5%99%A8/pdffkfellgipmhklpdmokmckkkfcopbh) / [Chrome](https://chromewebstore.google.com/detail/adguard-adblocker/adhmjkgkdmnfpadddhnibmmlpghcndhl) / iPhone 装 [App Store 免费版 Safari 拦截](https://apps.apple.com/app/id1047223162);站内提醒会按设备自动跳对地方;
2. **[净化用户脚本](userscript/parse-ad-shield.user.js)**——针对本仓库线路定制的微型过滤引擎,装 [Tampermonkey](https://www.tampermonkey.net/) 后[一键安装](https://raw.githubusercontent.com/cloudy-one1/vip-video-parser-pro/main/userscript/parse-ad-shield.user.js);装它即通过本站检测;
3. **[MV3 扩展壳](extension/README.md)**——同一套规则的 `declarativeNetRequest` 网络层拦截版,本地加载。

## 开发

```bash
# 在 VIP视频解析Pro/ 目录下执行,依赖 Python 3.10+ 与 scrapling[all]>=0.5
python tools/line_checker.py --no-browser    # HTTP-only 体检(CI 同款口径,只装 requests 即可跑)
python tools/line_checker.py --history ..\.github\badges\history.json --trend-svg ..\.github\badges\trend.svg  # 累积健康趋势
python tools/gateway.py                      # 本地线路网关(可选):分钟级体检+播放预检,http://127.0.0.1:8787/ 有仪表盘

# 在仓库根目录执行
python -m unittest discover -s tests -v      # Python 单测(体检归类/文本解析)
node --test tests/                           # 前端纯函数单测(需 Node 18+)
python tools/gen_dnr.py && python tools/gen_engine.py   # 改完净化规则后重新生成扩展产物
```

线路快照、徽标与趋势图由 `.github/workflows/line-check.yml` 每天北京时间 09:00 自动生成并提交回仓库;该工作流同时跑单测并校验 extension 生成物与源头一致。体检运行失败会自动开 issue 报警,`.github/workflows/watchdog.yml` 看门狗独立检查快照新鲜度(停摆 >72h 报警)。Pages 由 push 自动部署。网关开着时页面自动接入(实时状态+免 8 秒盲等),关着也不影响使用。

## License

[MIT](LICENSE);`js/vendor/` 内的 [hls.js](https://github.com/video-dev/hls.js) 为 Apache-2.0 本地化版本。

## 免责声明

本项目仅用于前端技术学习与交流。解析与搜索均由第三方公开接口完成,其可用性、稳定性与内容合法性均与本项目无关;请在支持正版的前提下合理使用。
