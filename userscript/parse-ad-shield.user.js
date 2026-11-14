// ==UserScript==
// @name         VIP视频解析 Pro · 解析页净化
// @namespace    cloudy-one1/vip-video-parser-pro
// @version      2.0.0
// @description  解析站净化引擎 v2：AdGuard 兼容语法的规则驱动微型 scriptlet 引擎。消弹窗、断属性、拒通知、藏广告位、断广告资源。机制经 REA 逆向 AdGuard 扩展引擎(tsurlfilter/agtree)蒸馏，代码为独立 MIT 实现。自动注入站内解析 iframe(含嵌套播放器域)。
// @author       cloudy-one1
// @match        *://*.lxyy.club/*
// @match        *://*.aibox.eu.org/*
// @match        *://*.1ljx.com/*
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
 * 解析页净化引擎 v2
 *
 * 上游依据(REA 逆向 AdGuard 扩展得出，详见仓库 README)：
 *  - scriptlet 分发机制与别名表：vendors/tsurlfilter.js
 *  - 规则语法：AGTree(`##` 化妆品 / `#$+js(...)` 脚本注入)
 *  - 实战规则形态：AdGuard 过滤表中的解析/影视站规则样例
 *
 * 本文件结构：
 *  1. RULES  —— AdGuard 兼容语法的规则表(数据驱动，补规则不改代码)
 *  2. SCRIPTLETS —— 微型 scriptlet 实现(名称与 AdGuard/uBO 对齐)
 *  3. 引擎   —— 域名匹配、化妆品注入、document-start 挂钩、MutationObserver
 *
 * 边界(与扩展不同处)：无网络层拦截权限，靠"断供+挂钩"近似；
 * 视频流与播放逻辑一律不碰。
 * ============================================================ */
(function () {
  'use strict';

  var VERSION = '2.0.0';

  /* ---------- 站点联动：在我们自己的站点上只写激活标记 ---------- */
  if (location.hostname === 'cloudy-one1.github.io') {
    try { localStorage.setItem('vvpro.adShield', JSON.stringify({ v: VERSION, t: Date.now() })); } catch (e) {}
    return;
  }

  /* ============================================================
   * 1. 规则表(AdGuard 兼容语法)
   *    `域名##选择器`            → 化妆品(藏匿)
   *    `域名#$+js(名, 参数...)`  → scriptlet
   *    域名逗号分隔；缺省域名 = 全部匹配站生效
   * ============================================================ */
  var RULES = [
    // —— 全局：影视/解析站的行业通病(AdGuard 过滤表大量同款) ——
    '#$+js(prevent-window-open)',
    '#$+js(prevent-refresh)',
    '##ins.adsbygoogle',
    '##[id^="google_ads"]',
    '##[id*="google_ad_"]',
    '##[class*="adsbygoogle"]',
    '##iframe[width="300"][height="250"]',
    '##iframe[width="728"][height="90"]',
    '##iframe[width="970"][height="90"]',
    '##div[id$="_ads"]',
    '##div[class$="_ads"]',

    // —— aibox：壳站点,真播放器嵌套在 1ljx.com 的 _player/_panel iframe 内 ——
    'aibox.eu.org,1ljx.com##[class*="banner" i]',
    'aibox.eu.org,1ljx.com##div[id$="_ad"]',

    // —— yemu / bdjx：51.la 统计与推荐位(仅藏匿,不断流) ——
    'yemu.xyz,bd.jx.cn##[class*="recommend-ad"]',

    // —— maccms：麒麟播放器常见悬浮推广位 ——
    'maccms.xyz##[id*="float"] [href*="promotion"]'
  ];

  /* 广告资源域名关键词(断供用)。统计类(51.la/cloudflareinsights)刻意不拦。 */
  var AD_SRC_PATTERNS = [
    'googlesyndication', 'doubleclick', 'googletagservices',
    'popads', 'popcash', 'propellerads', 'propeller', 'clickadu', 'exoclick',
    'hilltopads', 'adskeeper', 'mgid', 'adsterra', 'adcash', 'adplexity',
    'trafficstars', 'juicyads', 'onclckds', 'rollernetwork', 'rollercdn',
    'zeropark', 'bidvertiser', 'adservice', 'adserver', 'adsystem',
    '/ads.js', '/ad.js', '/pagead/', 'popunder'
  ];

  /* ============================================================
   * 2. SCRIPTLETS(名称对齐 AdGuard/uBO,独立实现)
   * ============================================================ */
  var log = function () {
    try { console.log.apply(console, ['[parse-ad-shield v' + VERSION + ']'].concat([].slice.call(arguments))); } catch (e) {}
  };

  function setChain(obj, path, def) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] === 'undefined') {
        try { Object.defineProperty(cur, parts[i], { value: {}, configurable: true }); } catch (e) { return false; }
      }
      cur = cur[parts[i]];
      if (!cur || (typeof cur !== 'object' && typeof cur !== 'function')) return false;
    }
    try {
      Object.defineProperty(cur, parts[parts.length - 1], def);
      return true;
    } catch (e) { return false; }
  }

  var SCRIPTLETS = {
    /* 消弹窗:无参=全拦;第 1 参=仅拦 URL 匹配的;第 2 参=仅前 N 秒内 */
    'prevent-window-open': function (match, delay) {
      var re = match ? new RegExp(match) : null;
      var until = delay ? Date.now() + parseInt(delay, 10) * 1000 : Infinity;
      var stub = {
        closed: false, close: function () {}, focus: function () {}, blur: function () {},
        print: function () {}, stop: function () {}, postMessage: function () {}, opener: null,
        location: { href: '', assign: function () {}, replace: function () {}, reload: function () {} },
        document: { write: function () {}, writeln: function () {}, close: function () {} }
      };
      var native = window.open;
      var fake = function (url) {
        var blocked = Date.now() < until && (!re || re.test(String(url)));
        if (blocked) { log('prevent-window-open ->', url); return Object.assign({}, stub); }
        return native.apply(window, arguments);
      };
      fake.toString = function () { return native.toString(); };
      window.open = fake;
    },

    /* 属性链设为常量:破解广告脚本的"检测到拦截器"分支,如 set-constant checkAdvert false */
    'set-constant': function (path, value) {
      var v = value === 'true' ? true : value === 'false' ? false : value === 'noopFunc' ? function () {} : value === 'emptyArr' ? [] : value === 'emptyStr' ? '' : value;
      setChain(window, path, { value: v, writable: false, configurable: false });
      log('set-constant', path, '=', v);
    },

    /* 读取属性链即抛错:让依赖该属性的广告脚本直接断电 */
    'abort-on-property-read': function (path) {
      var thrower = function () { throw new Error('[parse-ad-shield] abort-on-property-read: ' + path); };
      setChain(window, path, { get: thrower, set: thrower, configurable: false });
      log('abort-on-property-read', path);
    },

    /* 内联脚本读取属性即抛错(只打击无 src 的内联脚本) */
    'abort-current-inline-script': function (path, search) {
      var thrower = function () {
        var cs = document.currentScript;
        if (!cs || !cs.src) {
          throw new Error('[parse-ad-shield] abort-current-inline-script: ' + path);
        }
        return undefined;
      };
      setChain(window, path, { get: thrower, configurable: true });
      log('abort-current-inline-script', path, search || '');
    },

    /* 拦指定类型的事件监听(防点击劫持/防弹窗触发器) */
    'prevent-addEventListener': function (type, selector) {
      var orig = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (t, fn, opts) {
        if (t === type && (!selector || this.matches && this.matches(selector))) {
          log('prevent-addEventListener', t, selector || '');
          return;
        }
        return orig.call(this, t, fn, opts);
      };
    },

    /* 防刷新循环:meta refresh 移除 + reload 短路(3 秒内重复 reload 视为循环) */
    'prevent-refresh': function () {
      var kill = function () {
        var metas = document.querySelectorAll('meta[http-equiv="refresh" i]');
        for (var i = 0; i < metas.length; i++) { log('removed meta refresh'); metas[i].remove(); }
      };
      kill();
      var last = 0;
      var origReload = window.location.reload;
      try {
        window.location.reload = function () {
          if (Date.now() - last < 3000) { log('prevent-refresh: reload loop blocked'); return; }
          last = Date.now();
          return origReload.call(window.location);
        };
      } catch (e) {}
    },

    /* 移除类名/属性(化妆品辅助) */
    'remove-class': function (name, selector) {
      var run = function () {
        var els = document.querySelectorAll(selector || ('.' + name));
        for (var i = 0; i < els.length; i++) els[i].classList.remove(name);
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
    },
    'remove-attr': function (name, selector) {
      var run = function () {
        var els = document.querySelectorAll(selector || ('[' + name + ']'));
        for (var i = 0; i < els.length; i++) els[i].removeAttribute(name);
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
    },

    /* 穿透 shadow DOM 藏匿节点 */
    'hide-in-shadow-dom': function (selector) {
      var style = document.createElement('style');
      style.textContent = ':host(' + selector + ') { display: none !important; }';
      (document.head || document.documentElement).appendChild(style);
      var walk = function (root) {
        var els = root.querySelectorAll('*');
        for (var i = 0; i < els.length; i++) {
          if (els[i].shadowRoot) {
            var m = els[i].shadowRoot.querySelectorAll(selector);
            for (var j = 0; j < m.length; j++) m[j].style.display = 'none';
            walk(els[i].shadowRoot);
          }
        }
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { walk(document); });
      else walk(document);
    }
  };

  /* 广告资源断供(自定义净手 scriptlet) */
  function purgeAd(node) {
    if (!node || node.nodeType !== 1) return 0;
    var n = 0;
    if ((node.tagName === 'SCRIPT' || node.tagName === 'IFRAME') && isAdSrc(node.getAttribute && node.getAttribute('src'))) {
      node.remove(); n++;
    }
    if (node.querySelectorAll) {
      var bad = node.querySelectorAll('script[src], iframe[src]');
      for (var i = 0; i < bad.length; i++) {
        if (isAdSrc(bad[i].getAttribute('src'))) { bad[i].remove(); n++; }
      }
    }
    return n;
  }
  function isAdSrc(src) {
    if (!src) return false;
    var s = String(src).toLowerCase();
    for (var i = 0; i < AD_SRC_PATTERNS.length; i++) {
      if (s.indexOf(AD_SRC_PATTERNS[i]) !== -1) return true;
    }
    return false;
  }

  /* 拒绝通知权限 */
  function denyNotifications() {
    try {
      if (window.Notification) {
        window.Notification.requestPermission = function (cb) {
          log('blocked Notification.requestPermission');
          if (typeof cb === 'function') cb('denied');
          return Promise.resolve('denied');
        };
      }
    } catch (e) {}
  }

  /* ============================================================
   * 3. 引擎:规则解析 + 域名匹配 + 应用
   * ============================================================ */
  function hostMatches(host, domains) {
    if (!domains || !domains.length) return true;   // 无域名 = 全局
    for (var i = 0; i < domains.length; i++) {
      var d = domains[i];
      if (host === d || host.slice(-(d.length + 1)) === '.' + d) return true;
    }
    return false;
  }

  function parseRules() {
    var cosmetic = [], scriptlets = [];
    for (var i = 0; i < RULES.length; i++) {
      var rule = RULES[i];
      var jsIdx = rule.indexOf('#$+js(');
      var cosIdx = rule.indexOf('##');
      if (jsIdx !== -1) {
        var domains = rule.slice(0, jsIdx) ? rule.slice(0, jsIdx).split(',').map(function (s) { return s.trim(); }) : [];
        var inner = rule.slice(jsIdx + 6, -1);   // 去掉 `#$+js(` 和尾部 `)`
        var parts = inner.split(',').map(function (s) { return s.trim().replace(/^['"]|['"]$/g, ''); });
        scriptlets.push({ domains: domains, name: parts[0], args: parts.slice(1) });
      } else if (cosIdx !== -1) {
        var d2 = rule.slice(0, cosIdx) ? rule.slice(0, cosIdx).split(',').map(function (s) { return s.trim(); }) : [];
        cosmetic.push({ domains: d2, selector: rule.slice(cosIdx + 2) });
      }
    }
    return { cosmetic: cosmetic, scriptlets: scriptlets };
  }

  var parsed = parseRules();
  var host = location.hostname;

  /* --- 应用 scriptlets(document-start,挂钩必须赶在页面脚本前) --- */
  for (var i = 0; i < parsed.scriptlets.length; i++) {
    var r = parsed.scriptlets[i];
    if (hostMatches(host, r.domains) && SCRIPTLETS[r.name]) {
      try { SCRIPTLETS[r.name].apply(null, r.args); } catch (e) { log('scriptlet error', r.name, e); }
    }
  }
  denyNotifications();

  /* --- 应用化妆品 --- */
  var sel = [];
  for (var c = 0; c < parsed.cosmetic.length; c++) {
    if (hostMatches(host, parsed.cosmetic[c].domains)) sel.push(parsed.cosmetic[c].selector);
  }
  function injectCosmetic() {
    if (!sel.length) return;
    var style = document.createElement('style');
    style.setAttribute('data-parse-ad-shield', VERSION);
    style.textContent = sel.join(',') + ' { display: none !important; }';
    (document.head || document.documentElement).appendChild(style);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectCosmetic);
  } else {
    injectCosmetic();
  }

  /* --- MutationObserver:动态广告断供(全站默认启用) --- */
  var mo = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        if (purgeAd(added[j]) > 0) log('purged ad node(s)');
      }
    }
  });
  mo.observe(document, { childList: true, subtree: true });

  log('v' + VERSION, 'active on', host, '| scriptlets:', parsed.scriptlets.filter(function (r) { return hostMatches(host, r.domains); }).length, '| cosmetic:', sel.length);
})();
