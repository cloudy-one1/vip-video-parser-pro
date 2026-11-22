/* ========= VIP 视频解析 Pro · 纯函数核心库 =========
 * 不依赖 DOM 的纯逻辑，供 app.js 与 tests/core.test.js（node --test）共用。
 * UMD 包装：浏览器挂 window.VVPRO_CORE，Node 走 module.exports。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VVPRO_CORE = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* ---------- 链接处理 ---------- */
  function normalizeUrl(raw) {
    let url = (raw || '').trim();
    if (!url) return null;
    // 没写协议时，形如域名的自动补 https://
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
      if (!/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|\?|#|$)/i.test(url)) return null;
      url = 'https://' + url;
    }
    try {
      const u = new URL(url);
      return /^https?:$/.test(u.protocol) ? u.href : null;
    } catch (e) { return null; }
  }

  /* ---------- 苹果CMS 剧集解析 ----------
   * 格式：多播放组以 $$$ 分隔（同源常带 share页组 + m3u8 直链组两组），
   * 组内 第1集$url1#第2集$url2…。自家播放器只吃 m3u8 直链，
   * 所以优选 m3u8 直链最多的组；都不含时退回集数最多的组。
   */
  function parseEpisodes(playUrl) {
    let best = null;
    String(playUrl || '').split('$$$').forEach(g => {
      const eps = [];
      g.split('#').forEach(seg => {
        const p = seg.split('$');
        const url = (p[1] || p[0] || '').trim();
        if (!/^https?:\/\//i.test(url)) return;
        // 有「集名$url」形态才用集名;裸链接不再拿 URL 当按钮文字,按组内序号命名
        let name = (p.length > 1 && p[0]) ? p[0].trim() : '';
        if (!name) name = '第' + (eps.length + 1) + '集';
        eps.push({ name: name, url: url });
      });
      if (!eps.length) return;
      const m3u8n = eps.filter(ep => /\.m3u8([?#]|$)/i.test(ep.url)).length;
      if (!best || m3u8n > best.m3u8n || (m3u8n === best.m3u8n && eps.length > best.eps.length)) {
        best = { m3u8n: m3u8n, eps: eps };
      }
    });
    return best ? best.eps : [];
  }

  /* ---------- 云搜索正主前置 ----------
   * 精确片名 > 正主+季/部/版本后缀 > 含片名 > 其他。
   * 资源站的模糊搜索无相关性排序，「狂飙」之类查询会被同名蹭名短剧淹没，
   * 正主经常掉出前 12 条——纯前端重排，不动 API。
   */
  function rankCloudResults(list, kw) {
    const key = String(kw || '').replace(/\s+/g, '');
    const seasonTail = /^(第.{1,3}[季部弹]|[上下]|[（(][上下][）)]|(特别|最终|完整|重映|加长|导演)版|番外|OVA|大电影|电影版|剧场版)+$/i;
    const rank = name => {
      const n = String(name).replace(/\s+/g, '');
      if (n === key) return 0;
      if (n.startsWith(key) && seasonTail.test(n.slice(key.length))) return 1;
      if (n.includes(key)) return 2;
      return 3;
    };
    return list
      .map(x => {
        const r = rank(x.name);
        return Object.assign({}, x, { rank: r, main: r <= 1 });
      })
      .sort((a, b) => a.rank - b.rank)   // sort 稳定，同档内保持资源站原序
      .slice(0, 12);
  }

  /* ---------- 上游家族 ----------
   * 2026-11-15 家族指纹分析：12 条线 ≈ 7-8 个独立上游（如 8090 与 789 同运营者）。
   * 换线换到同族 = 换汤不换药，还烧掉一次重试预算——择线时同族降权。
   */
  function familyOf(line) {
    return line.up || line.id;
  }

  /* ---------- 智能换线（分层择线 + 同上游家族降权） ----------
   * 纯函数：所有外部状态经 linesArr 与 deps 注入，便于单测。
   * deps: { statusOf(id)->{status}, recentlyFailed(id)->bool, scoreOf(id, platform)->0..1|null }
   */
  function nextHealthyLine(linesArr, fromId, excludeIds, avoidDown, platform, deps) {
    const exclude = excludeIds || [];
    const idx = linesArr.findIndex(l => l.id === fromId);
    if (idx === -1) return null;
    const curFamily = familyOf(linesArr[idx]);
    const candidates = (pred) => {
      const out = [];
      for (let step = 1; step <= linesArr.length; step++) {
        const cand = linesArr[(idx + step) % linesArr.length];
        if (!exclude.includes(cand.id) && pred(cand)) out.push(cand);
      }
      return out;
    };
    // 同上游家族降权：有异族候选时优先异族；只剩同族时仍作兜底
    const pick = (cands) => {
      if (!cands.length) return null;
      const diff = cands.filter(c => familyOf(c) !== curFamily);
      const pool = diff.length ? diff : cands;
      return pool.sort((a, b) => (deps.scoreOf(b.id, platform) ?? -1) - (deps.scoreOf(a.id, platform) ?? -1))[0];
    };
    // 第一优先：体检可用、且近期没失败过的线路；多条命中时按成功率择优
    let cands = candidates(c => deps.statusOf(c.id).status === 'up' && !deps.recentlyFailed(c.id));
    if (cands.length) return pick(cands);
    // 第二优先：可用但近期失败过的线路
    cands = candidates(c => deps.statusOf(c.id).status === 'up');
    if (cands.length) return pick(cands);
    // 第三优先：非失效线路（自动换线/重播兜底用，避免撞上已知失效的线）
    if (avoidDown) {
      cands = candidates(c => deps.statusOf(c.id).status !== 'down');
      if (cands.length) return pick(cands);
    }
    // 兜底：顺序换下一条没试过的
    cands = candidates(() => true);
    return cands.length ? pick(cands) : null;
  }

  return { normalizeUrl, parseEpisodes, rankCloudResults, familyOf, nextHealthyLine };
});
