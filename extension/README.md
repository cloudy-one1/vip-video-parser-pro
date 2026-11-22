# 解析页净化 · MV3 扩展壳

把「解析页净化」从用户脚本升级为**本地加载的 MV3 扩展**,补上用户脚本够不到的最后一层:**网络层广告拦截**(declarativeNetRequest)。

## 三层能力

| 层 | 机制 | 来源文件 |
|---|---|---|
| 网络层 | DNR 静态规则:广告域名请求在发出前被拦(含弹窗导航 main_frame) | `rules/dnr.json`(由 `tools/gen_dnr.py` 生成) |
| 行为层 | 9 个 scriptlet:消弹窗/断属性/防劫持/防刷新循环 | `content/engine.js` |
| 视觉层 | 化妆品过滤 + 动态广告节点清扫 | 同上 |

**精准防御原则**:全部规则的 `initiatorDomains` 限定为 10 条线路站 + 嵌套播放器域(`1ljx.com`) + 无损云播放器(`wsyzy.vip`)——**只在你解析视频时生效,日常上网零影响**;统计类脚本(51.la 等)刻意不拦;视频流绝不触碰。

## 安装(Chrome / Edge)

1. 下载/克隆本仓库,记住 `extension/` 文件夹的位置;
2. 打开 `chrome://extensions`(Edge: `edge://extensions`);
3. 右上角开启「开发者模式」;
4. 点「加载已解压的扩展程序」,选择本仓库的 `extension/` 文件夹;
5. 刷新 VIP视频解析 Pro 页面,线路行出现「🛡 净化已启用」即生效。

> Firefox 113+ 理论兼容(MV3 DNR),未充分测试;建议 Chrome/Edge。

## 维护

- **改广告域名/子串**:编辑**仓库根目录** `tools/gen_dnr.py` 的 `LISTED_AD_DOMAINS` / `URL_FILTER_PATTERNS`,重跑 `python tools/gen_dnr.py`;
- **改 scriptlet / 化妆品规则**:编辑 `userscript/parse-ad-shield.user.js`(单一事实源),重跑**仓库根目录**的 `python tools/gen_engine.py` 同步到扩展(CI 的 line-check 会自动校验生成物未漂移);
- 版本号在 `manifest.json` 与用户脚本头部,改动时同步。

## 为什么要扩展层

用户脚本运行在页面上下文,只能"挂钩 + 断供 + 藏匿";广告请求本身仍会发出(加载、耗流量、触发跳转意图)。MV3 的 `declarativeNetRequest` 在**浏览器网络栈里直接拒绝**这些请求——这是扩展与用户脚本的本质分界,也是本扩展存在的唯一理由。
