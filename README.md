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

- **三种输入,自动路由**:视频平台播放页链接 → 解析线路观看(自动识别平台);片名 → 无损云搜索选剧选集(经公共 CORS 代理,尽力而为,结果缓存 6 小时);`.m3u8` 链接 → 直连播放。
- **智能换线**:线路 8 秒无响应自动换下一条(最多试 4 条),失败线路 30 分钟内自动绕开,多条可用时按本地成功率择优;「👎 这条不行」手动反馈立即换线。
- **状态徽标**:每条线路 🟢 可用 / 🟡 被拦 / 🔴 失效,数据来自 Scrapling 深度体检(`tools/line_checker.py`)与 GitHub Actions 每日自动体检。
- **安全沙箱 + 自建播放器**:解析页 iframe 封死弹窗 / 劫持页面 / 自动下载;云搜索与 m3u8 走仓库内置 hls.js 播放器(`player.html`),不经过任何第三方播放器页面。
- **观看记录与收藏**:最近 50 条,记住上次线路、重播自动切回;支持搜索与「只看收藏」;云端播放显示「剧名 · 集名」。
- **线路管理**:增删改、↑↓ 排序、一键恢复默认;`Alt+1~9` 快速切线,`?url=` 直连解析。

## 增强防护(可选)

解析页内部的广告需要浏览器级工具净化,按省事程度推荐:

1. **[AdGuard 官方扩展](https://adguard.com/zh_cn/adguard-browser-extension/extension.html)**——首选,与本项目完全兼容、可叠加;
2. **[净化用户脚本](userscript/parse-ad-shield.user.js)**——针对本仓库线路定制的微型过滤引擎,装 [Tampermonkey](https://www.tampermonkey.net/) 后[一键安装](https://raw.githubusercontent.com/cloudy-one1/vip-video-parser-pro/main/userscript/parse-ad-shield.user.js);
3. **[MV3 扩展壳](extension/README.md)**——同一套规则的 `declarativeNetRequest` 网络层拦截版,本地加载。

## 开发

```bash
# 在 VIP视频解析Pro/ 目录下执行,依赖 Python 3.10+ 与 scrapling[all]>=0.5
python tools/line_checker.py --no-browser    # HTTP-only 体检(CI 同款口径)
python tools/line_checker.py --history ..\.github\badges\history.json --trend-svg ..\.github\badges\trend.svg  # 累积健康趋势
```

线路快照、徽标与趋势图由 `.github/workflows/line-check.yml` 每天北京时间 09:00 自动生成并提交回仓库;Pages 由 push 自动部署。

## License

[MIT](LICENSE);`js/vendor/` 内的 [hls.js](https://github.com/video-dev/hls.js) 为 Apache-2.0 本地化版本。

## 免责声明

本项目仅用于前端技术学习与交流。解析与搜索均由第三方公开接口完成,其可用性、稳定性与内容合法性均与本项目无关;请在支持正版的前提下合理使用。
