// ==UserScript==
// @name         VIP视频解析 Pro · 解析页净化
// @namespace    cloudy-one1/vip-video-parser-pro
// @version      1.0.0
// @description  解析站广告/骗点击净化脚本：消弹窗、拒通知、断广告资源、藏广告位。机制参考 AdGuard 扩展的 scriptlet 思路（经逆向分析其规则引擎蒸馏而来），代码为独立实现。配合 vip-video-parser-pro 使用，会自动注入到站内解析 iframe。
// @author       cloudy-one1
// @match        *://*.lxyy.club/*
// @match        *://*.aibox.eu.org/*
// @match        *://*.maccms.xyz/*
// @match        *://*.im1907.top/*
// @match        *://*.yemu.xyz/*
// @match        *://*.8090g.cn/*
// @match        *://*.aidouer.net/*
// @match        *://*.bd.jx.cn/*
// @match        *://*.txnp.cn/*
// @match        *://*.789jiexi.com/*
// @match        *://*.okjx.cc/*
// @match        *://*.wsyzy.vip/*
// @match        https://cloudy-one1.github.io/vip-video-parser-pro/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

/* ============================================================
 * 解析页净化脚本（Parse Ad Shield）
 *
 * 设计取舍（与 AdGuard scriptlet 的对应关系，仅取思路）：
 *  - window.open 消弹窗          ≈ prevent-window-open / window.open-defuser
 *  - Notification 权限自动拒绝    ≈ 通知钓鱼类 scriptlet 的意图
 *  - meta refresh 移除           ≈ prevent-refresh
 *  - 广告资源断供（脚本/iframe）  ≈ 网络拦截规则在无网络权限环境下的近似
 *  - 广告位 CSS 藏匿            ≈ 化妆品过滤（cosmetic filtering）
 *
 * 明确不做：不碰视频流本身、不改播放逻辑、不拦截任何非广告请求。
 * ============================================================ */
(function () {
  'use strict';

  var VERSION = '1.0.0';

  /* ---------- 站点联动：在我们自己的站点上只做标记 ---------- */
  if (location.hostname === 'cloudy-one1.github.io') {
    try {
      localStorage.setItem('vvpro.adShield', JSON.stringify({ v: VERSION, t: Date.now() }));
    } catch (e) { /* 隐私模式忽略 */ }
    return;
  }

  var log = function () {
    try { console.log.apply(console, ['[parse-ad-shield]'].concat([].slice.call(arguments))); } catch (e) {}
  };
  log('v' + VERSION, 'activated on', location.hostname);

  /* ---------- 1. 消弹窗：window.open 一律返回无害壳 ----------
   * 解析站的弹窗广告/跳转广告几乎都走 window.open。
   * 返回一个带常用成员的哑对象，避免调用方拿到 undefined 后崩溃。
   */
  var stubWindow = {
    closed: false,
    close: function () {},
    focus: function () {},
    blur: function () {},
    print: function () {},
    stop: function () {},
    postMessage: function () {},
    opener: null,
    location: { href: '', assign: function () {}, replace: function () {}, reload: function () {} },
    document: { write: function () {}, writeln: function () {}, close: function () {} }
  };
  try {
    var nativeOpen = window.open;
    window.open = function (url) {
      log('blocked window.open ->', url);
      return Object.assign({}, stubWindow);
    };
    window.open.toString = function () { return nativeOpen.toString(); };
  } catch (e) { /* 某些环境不可写则跳过 */ }

  /* ---------- 2. 拒绝通知权限："允许通知看视频"钓鱼的解法 ---------- */
  try {
    if (window.Notification) {
      window.Notification.requestPermission = function (cb) {
        log('blocked Notification.requestPermission');
        if (typeof cb === 'function') cb('denied');
        return Promise.resolve('denied');
      };
    }
  } catch (e) {}

  /* ---------- 3. 断掉 meta refresh 刷新跳转链 ---------- */
  function killMetaRefresh() {
    var metas = document.querySelectorAll('meta[http-equiv="refresh" i]');
    for (var i = 0; i < metas.length; i++) {
      log('removed meta refresh:', metas[i].getAttribute('content'));
      metas[i].remove();
    }
  }
  killMetaRefresh();

  /* ---------- 4. 广告资源断供：已知广告/统计域名关键词 ----------
   * 只处理 script / iframe 的 src（不碰视频流、不碰站内资源）。
   */
  var AD_SRC_PATTERNS = [
    'googlesyndication', 'doubleclick', 'googletagservices', 'google-analytics',
    'popads', 'popcash', 'propellerads', 'propeller', 'clickadu', 'exoclick',
    'hilltopads', 'adskeeper', 'mgid', 'adsterra', 'adcash', 'adplexity',
    'trafficstars', 'juicyads', 'onclckds', 'rollernetwork', 'rollercdn',
    'zeropark', 'bidvertiser', 'adcash-re', 'revenuecat', 'adservice',
    '/ads.js', '/ad.js', 'adserver', 'adsystem', '/pagead/', 'popunder'
  ];
  function isAdSrc(src) {
    if (!src) return false;
    var s = String(src).toLowerCase();
    for (var i = 0; i < AD_SRC_PATTERNS.length; i++) {
      if (s.indexOf(AD_SRC_PATTERNS[i]) !== -1) return true;
    }
    return false;
  }
  function purge(node) {
    if (!node || node.nodeType !== 1) return 0;
    var n = 0;
    var tag = node.tagName;
    if ((tag === 'SCRIPT' || tag === 'IFRAME') && isAdSrc(node.getAttribute && node.getAttribute('src'))) {
      node.remove();
      n++;
    }
    // 顺带清扫该节点内部
    if (node.querySelectorAll) {
      var bad = node.querySelectorAll('script[src], iframe[src]');
      for (var i = 0; i < bad.length; i++) {
        if (isAdSrc(bad[i].getAttribute('src'))) {
          bad[i].remove();
          n++;
        }
      }
    }
    return n;
  }

  /* ---------- 5. 化妆品过滤：常见广告位藏匿 ---------- */
  var CSS = [
    'ins.adsbygoogle', '[id^="google_ads"]', '[id*="google_ad_"]',
    '[class*="adsbygoogle"]', '[id^="ad_banner"]', '[id^="adbox"]',
    'iframe[width="300"][height="250"]', 'iframe[width="728"][height="90"]',
    'iframe[width="970"][height="90"]', 'div[id$="_ads"]', 'div[class$="_ads"]'
  ].join(',');
  function injectCosmetic() {
    var style = document.createElement('style');
    style.setAttribute('data-parse-ad-shield', VERSION);
    style.textContent = CSS + ' { display: none !important; }';
    (document.head || document.documentElement).appendChild(style);
  }

  /* ---------- 6. MutationObserver：动态注入的广告也拦 ---------- */
  function startObserver() {
    var mo = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (purge(added[j]) > 0) log('purged ad node(s)');
        }
      }
    });
    mo.observe(document, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      injectCosmetic();
      killMetaRefresh();
    });
    startObserver();
  } else {
    injectCosmetic();
    startObserver();
  }
})();
