/* ========= VIP 视频解析 Pro - 主逻辑 ========= */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  /* ---------- 本地存储 ---------- */
  const LS = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 隐私模式下忽略 */ }
    }
  };

  const KEYS = {
    lines: 'vvpro.lines',
    active: 'vvpro.activeLine',
    history: 'vvpro.history',
    favFilter: 'vvpro.favFilter',
    autoSwitch: 'vvpro.autoSwitch',
    failMemo: 'vvpro.failMemo',
    cloudCache: 'vvpro.cloudCache',
    proxyIdx: 'vvpro.proxyIdx',
    lineStats: 'vvpro.lineStats'
  };

  const AUTO_SWITCH_MAX = 3;        // 加载超时后最多自动换线次数
  const FAIL_MEMO_TTL = 30 * 60e3;  // 线路失败记忆有效期（30 分钟）

  /* ---------- 提示气泡 ---------- */
  function toast(msg, type) {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    $('#toastBox').appendChild(el);
    setTimeout(() => {
      el.classList.add('hide');
      setTimeout(() => el.remove(), 350);
    }, 2400);
  }

  /* ---------- 状态 ---------- */
  let lines = LS.get(KEYS.lines, null);
  if (!Array.isArray(lines) || !lines.length) lines = window.DEFAULT_LINES.map(l => Object.assign({}, l));
  let activeLineId = LS.get(KEYS.active, null);
  if (!lines.some(l => l.id === activeLineId)) activeLineId = lines[0].id;

  let history = LS.get(KEYS.history, []);
  if (!Array.isArray(history)) history = [];

  let filterFav = !!LS.get(KEYS.favFilter, false);
  let autoSwitch = LS.get(KEYS.autoSwitch, true);  // 超时自动换线开关
  let failMemo = LS.get(KEYS.failMemo, {});        // 线路近期失败记录：id -> 时间戳
  if (!failMemo || typeof failMemo !== 'object') failMemo = {};
  let historyQuery = '';
  let currentUrl = '';
  let cloudCache = LS.get(KEYS.cloudCache, {});    // 无损云搜索缓存：{search:{kw:...}, detail:{id:...}}
  if (!cloudCache || typeof cloudCache !== 'object') cloudCache = {};
  if (!cloudCache.search) cloudCache.search = {};
  if (!cloudCache.detail) cloudCache.detail = {};
  let cloudProxyIdx = LS.get(KEYS.proxyIdx, 0) | 0;
  let lineStats = LS.get(KEYS.lineStats, {});      // 线路长期质量: id -> {ok, fail}
  if (!lineStats || typeof lineStats !== 'object') lineStats = {};

  const saveLines = () => { LS.set(KEYS.lines, lines); LS.set(KEYS.active, activeLineId); };
  const saveHistory = () => LS.set(KEYS.history, history);

  /* ---------- 线路状态（体检） ----------
   * 数据来源两路：
   * 1) tools/line_checker.py（Scrapling 深度体检）生成的 js/lines-status.js 快照
   * 2) 页面内「⚡ 体检」按钮的浏览器快速探测（no-cors，只能判断可达性）
   */
  let lineStatus = {};          // id -> { status, code, ms, title, note, checkedAt, source }
  let snapshotTime = null;
  let checking = false;

  const STATUS_META = {
    up:      { cls: 'st-up',      label: '可用' },
    blocked: { cls: 'st-blocked', label: '被拦' },
    down:    { cls: 'st-down',    label: '失效' },
    unknown: { cls: 'st-unknown', label: '未体检' }
  };

  const statusOf = (id) => lineStatus[id] || { status: 'unknown' };

  function applyStatus(id, rec) {
    lineStatus[id] = Object.assign({}, lineStatus[id], rec);
    renderLines();
    renderLineEditor();
    renderStatusSummary();
  }

  function applySnapshot(snapshot) {
    if (!snapshot || !snapshot.lines) return;
    snapshotTime = snapshot.checkedAt || null;
    Object.entries(snapshot.lines).forEach(([id, s]) => {
      lineStatus[id] = Object.assign({}, lineStatus[id], s, { source: 'tool' });
    });
    renderLines();
    renderLineEditor();
    renderStatusSummary();
  }

  function loadStatusSnapshot() {
    // 动态注入脚本：快照不存在时静默失败，file:// 与 http:// 下都可用
    const s = document.createElement('script');
    s.src = 'js/lines-status.js';
    s.onload = () => { if (window.LINES_STATUS) applySnapshot(window.LINES_STATUS); };
    s.onerror = () => { /* 无快照，仅剩浏览器快速体检 */ };
    document.head.appendChild(s);
  }

  function originOf(prefix) {
    try { return new URL(prefix).origin + '/'; } catch (e) { return null; }
  }

  function quickCheck() {
    if (checking) return;
    checking = true;
    const btn = $('#checkBtn');
    btn.textContent = '⏳ 体检中…';
    btn.disabled = true;
    let pending = lines.length;

    const settle = () => {
      renderLines();
      renderStatusSummary();
      if (--pending > 0) return;
      checking = false;
      btn.textContent = '⚡ 体检';
      btn.disabled = false;
      const up = lines.filter(l => statusOf(l.id).status === 'up').length;
      toast('查完了：' + up + '/' + lines.length + ' 条通');
    };

    lines.forEach(line => {
      const home = originOf(line.prefix);
      if (!home) { applyStatus(line.id, { status: 'down', note: '接口地址无效', source: 'browser' }); settle(); return; }
      const t0 = performance.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      // no-cors 模式：任何 HTTP 响应都算「可达」，网络层失败才算「不可达」（粗粒度）
      fetch(home, { mode: 'no-cors', cache: 'no-store', redirect: 'follow', signal: ctrl.signal })
        .then(() => applyStatus(line.id, {
          status: 'up', ms: Math.round(performance.now() - t0), source: 'browser', note: '浏览器快速探测可达'
        }))
        .catch(() => applyStatus(line.id, { status: 'down', source: 'browser', note: '浏览器探测不可达' }))
        .finally(() => { clearTimeout(timer); settle(); });
    });
  }

  function renderStatusSummary() {
    const el = $('#statusSummary');
    const known = lines.filter(l => statusOf(l.id).status !== 'unknown');
    if (!known.length) { el.hidden = true; return; }
    const up = known.filter(l => statusOf(l.id).status === 'up').length;
    const src = known.some(l => statusOf(l.id).source === 'tool')
      ? '深度体检'
      : '浏览器快测';
    const ago = snapshotTime ? '，约 ' + timeAgo(new Date(snapshotTime).getTime()) : '';
    el.hidden = false;
    el.innerHTML = '今晚 <span class="hi-count num">' + up + '/' + lines.length + '</span> 条线路通（' + src + ago + '）';
  }

  /* ---------- 平台识别 ---------- */
  function detectPlatform(url) {
    let host;
    try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return null; }
    return window.PLATFORMS.find(p => p.hosts.some(h => host === h || host.endsWith('.' + h)));
  }

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

  function buildParseUrl(line, url) {
    if (line.prefix.includes('{url}')) {
      return line.prefix.replace('{url}', encodeURIComponent(url));
    }
    return line.prefix + encodeURIComponent(url);
  }

  /* ---------- 线路渲染 ---------- */
  function renderLines() {
    const list = $('#lineList');
    list.innerHTML = '';
    lines.forEach((line, i) => {
      const st = statusOf(line.id);
      const meta = STATUS_META[st.status] || STATUS_META.unknown;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'line-chip' + (line.id === activeLineId ? ' active' : '') + (st.status === 'down' ? ' chip-down' : '');

      const dot = document.createElement('span');
      dot.className = 'st-dot ' + meta.cls;
      dot.title = meta.label;

      btn.append(dot, document.createTextNode(line.name));
      const bits = [line.prefix + '{视频地址}', '状态：' + meta.label + (st.note ? '（' + st.note + '）' : '')];
      if (st.ms) bits.push('延迟：' + st.ms + 'ms');
      const score = scoreOf(line.id);
      if (score !== null) {
        const rec = lineStats[line.id];
        bits.push('本地成功率：' + Math.round(score * 100) + '%（' + rec.ok + '/' + (rec.ok + rec.fail) + '）');
      }
      if (i < 9) bits.push('Alt+' + (i + 1));
      btn.title = bits.join('\n');
      btn.addEventListener('click', () => selectLine(line.id));
      list.appendChild(btn);
    });
  }

  function selectLine(id) {
    if (activeLineId === id) return;
    activeLineId = id;
    saveLines();
    renderLines();
    const line = lines.find(l => l.id === activeLineId);
    const st = statusOf(id);
    if (st.status === 'down') toast('提醒：该线路体检显示已失效', 'error');
    else if (st.status === 'blocked') toast('提醒：该线路可能被人机验证拦截', 'error');
    else toast('已切换线路：' + line.name);
    // 播放器开着时，自动用新线路重载当前视频，方便换线重试
    if (currentUrl && !$('#playerSection').hidden) play(currentUrl, { skipHistory: true });
  }

  /* ---------- 智能换线 ---------- */
  /* 失败记忆：线路加载超时后短期记一笔，智能换线先绕开它 */
  function markFail(lineId) {
    failMemo[lineId] = Date.now();
    LS.set(KEYS.failMemo, failMemo);
  }

  function clearFail(lineId) {
    if (lineId in failMemo) {
      delete failMemo[lineId];
      LS.set(KEYS.failMemo, failMemo);
    }
  }

  function pruneFailMemo() {
    const now = Date.now();
    Object.keys(failMemo).forEach(id => { if (now - failMemo[id] > FAIL_MEMO_TTL) clearFail(id); });
  }

  function recentlyFailed(id) {
    const ts = failMemo[id];
    return !!ts && (Date.now() - ts) < FAIL_MEMO_TTL;
  }

  /* ---------- 线路质量统计（本地长期学习） ----------
   * load 成功 / 超时 / 手动反馈都会累计；智能换线在体检可用的线路里优先选成功率高的。
   */
  function bumpStat(lineId, kind) {
    if (!lineId) return;
    const rec = lineStats[lineId] || { ok: 0, fail: 0 };
    rec[kind]++;
    lineStats[lineId] = rec;
    LS.set(KEYS.lineStats, lineStats);
  }

  function scoreOf(lineId) {
    const rec = lineStats[lineId];
    if (!rec) return null;
    const total = (rec.ok || 0) + (rec.fail || 0);
    return total ? (rec.ok || 0) / total : null;
  }

  function pruneLineStats() {
    let dirty = false;
    Object.keys(lineStats).forEach(id => {
      if (!lines.some(l => l.id === id)) { delete lineStats[id]; dirty = true; }
    });
    if (dirty) LS.set(KEYS.lineStats, lineStats);
  }

  function nextHealthyLine(fromId, excludeIds, avoidDown) {
    const exclude = excludeIds || [];
    const idx = lines.findIndex(l => l.id === fromId);
    // 第一优先：体检可用、且近期没失败过的线路；多条命中时按本地成功率择优
    const tier1 = [];
    for (let step = 1; step <= lines.length; step++) {
      const cand = lines[(idx + step) % lines.length];
      if (!exclude.includes(cand.id) && statusOf(cand.id).status === 'up' && !recentlyFailed(cand.id)) tier1.push(cand);
    }
    if (tier1.length) {
      return tier1.sort((a, b) => (scoreOf(b.id) ?? -1) - (scoreOf(a.id) ?? -1))[0];
    }
    // 第二优先：可用但近期失败过的线路
    for (let step = 1; step <= lines.length; step++) {
      const cand = lines[(idx + step) % lines.length];
      if (!exclude.includes(cand.id) && statusOf(cand.id).status === 'up') return cand;
    }
    // 第三优先：非失效线路（自动换线/重播兜底用，避免撞上已知失效的线）
    if (avoidDown) {
      for (let step = 1; step <= lines.length; step++) {
        const cand = lines[(idx + step) % lines.length];
        if (!exclude.includes(cand.id) && statusOf(cand.id).status !== 'down') return cand;
      }
    }
    // 兜底：顺序换下一条没试过的
    for (let step = 1; step <= lines.length; step++) {
      const cand = lines[(idx + step) % lines.length];
      if (!exclude.includes(cand.id)) return cand;
    }
    return null; // 全部被排除（自动换线把所有线路都试完时）
  }

  function switchLine() {
    if (lines.length < 2) { toast('只有一条线路，无法换线', 'error'); return; }
    const target = nextHealthyLine(activeLineId, [activeLineId]);
    if (!target || target.id === activeLineId) { toast('没有其他线路可换', 'error'); return; }
    activeLineId = target.id;
    saveLines();
    renderLines();
    toast('已换到线路：' + target.name);
    if (currentUrl) play(currentUrl, { skipHistory: true });
  }

  function renderAutoSwitch() {
    $('#autoSwitchBtn').classList.toggle('on', autoSwitch);
  }

  /* ---------- 线路管理 ---------- */
  function renderLineEditor() {
    const ul = $('#lineEditorList');
    ul.innerHTML = '';
    lines.forEach((line, i) => {
      const li = document.createElement('li');
      li.className = 'line-editor-item';

      const st = statusOf(line.id);
      const meta = STATUS_META[st.status] || STATUS_META.unknown;
      const dot = document.createElement('span');
      dot.className = 'st-dot ' + meta.cls;
      dot.title = meta.label + (st.note ? '（' + st.note + '）' : '');

      const nameI = document.createElement('input');
      nameI.type = 'text';
      nameI.value = line.name;
      nameI.placeholder = '线路名称';
      nameI.title = '线路名称';

      const prefixI = document.createElement('input');
      prefixI.type = 'text';
      prefixI.value = line.prefix;
      prefixI.placeholder = 'https://接口地址/?url= 或含 {url} 占位符';
      prefixI.title = '接口地址';

      const commit = () => {
        const name = nameI.value.trim();
        const prefix = prefixI.value.trim();
        if (name) line.name = name;
        if (prefix && !/^https?:\/\//i.test(prefix)) {
          toast('接口地址需以 http(s):// 开头', 'error');
          prefixI.value = line.prefix;
        } else if (prefix) {
          line.prefix = prefix;
        }
        saveLines();
        renderLines();
      };
      nameI.addEventListener('change', commit);
      prefixI.addEventListener('change', commit);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn ghost small';
      del.textContent = '删除';
      del.addEventListener('click', () => {
        if (lines.length <= 1) { toast('至少需要保留一条线路', 'error'); return; }
        lines = lines.filter(l => l.id !== line.id);
        if (!lines.some(l => l.id === activeLineId)) activeLineId = lines[0].id;
        saveLines();
        renderLines();
        renderLineEditor();
        toast('线路已删除');
      });

      // 排序：↑↓ 调整顺序，决定 Alt+1~9 与智能换线的优先级
      const move = (dir) => {
        const j = i + dir;
        if (j < 0 || j >= lines.length) return;
        const tmp = lines[i];
        lines[i] = lines[j];
        lines[j] = tmp;
        saveLines();
        renderLines();
        renderLineEditor();
      };
      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'btn ghost small';
      upBtn.textContent = '↑';
      upBtn.title = '上移（排得越靠前，换线优先级越高）';
      upBtn.disabled = i === 0;
      upBtn.addEventListener('click', () => move(-1));
      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'btn ghost small';
      downBtn.textContent = '↓';
      downBtn.title = '下移';
      downBtn.disabled = i === lines.length - 1;
      downBtn.addEventListener('click', () => move(1));

      li.append(dot, nameI, prefixI, upBtn, downBtn, del);
      ul.appendChild(li);
    });
  }

  /* ---------- 播放 ---------- */
  let frameLoaded = false;   // 区分「load 事件正常触发」与「8 秒兜底超时」
  let playLineId = null;     // 本次播放真正走了解析线路时才有值(m3u8 直连/自家播放器为 null)

  function hideLoading() {
    clearTimeout(play._t);
    $('#playerLoading').classList.add('gone');
    $('#loadingMsg').textContent = '正在加载线路…';
    $('#loadingSwitchBtn').hidden = true;
  }

  function play(rawUrl, opts) {
    const options = opts || {};
    const url = normalizeUrl(rawUrl);
    if (!url) {
      toast('请输入有效的视频链接，例如 https://v.qq.com/x/cover/...', 'error');
      $('#urlInput').focus();
      return;
    }
    const line = lines.find(l => l.id === activeLineId);
    if (!line) { toast('没有可用线路，请先添加', 'error'); return; }

    currentUrl = url;
    // m3u8 直连：粘贴 .m3u8 链接直接用自家播放器播放，不走解析线路
    const isM3u8 = /^https?:\/\/[^\s"'<>]+\.m3u8([?#]|$)/i.test(url);
    const parseUrl = (isM3u8 && window.CLOUD)
      ? window.CLOUD.PLAYER + encodeURIComponent(url)
      : buildParseUrl(line, url);
    playLineId = isM3u8 ? null : line.id;

    const section = $('#playerSection');
    const frame = $('#player');
    const loading = $('#playerLoading');
    section.hidden = false;
    loading.classList.remove('gone');

    const platform = detectPlatform(url);
    const nowPlaying = $('#nowPlaying');
    nowPlaying.textContent = (isM3u8
      ? (options.title ? options.title + '，' : 'm3u8直连，')
      : platform ? platform.name + '，' : '') + url;
    nowPlaying.title = url;

    frame.src = parseUrl;
    $('#newTabBtn').dataset.href = parseUrl;

    // 正常线路的 load 事件（跨域 iframe 同样会触发）会先一步隐藏加载层；
    // 8 秒兜底触发且仍未收到 load 时，大概率是线路失效或被拦，
    // 此时不直接关掉加载层，而是给出「换线」引导
    frameLoaded = false;
    clearTimeout(play._t);
    play._t = setTimeout(() => {
      if (frameLoaded) return;
      markFail(line.id);
      bumpStat(line.id, 'fail');
      const tried = options.tried || [];
      // 自动换线：超时后自动换下一条，最多试 AUTO_SWITCH_MAX 次，全失败再回到手动引导
      if (autoSwitch && tried.length < AUTO_SWITCH_MAX) {
        const target = nextHealthyLine(line.id, tried.concat(line.id), true);
        if (target) {
          activeLineId = target.id;
          saveLines();
          renderLines();
          $('#loadingMsg').textContent = '线路「' + line.name + '」超时，已自动换到「' + target.name + '」（第 ' + (tried.length + 1) + '/' + AUTO_SWITCH_MAX + ' 次）';
          play(url, { skipHistory: true, tried: tried.concat(line.id) });
          return;
        }
      }
      $('#loadingMsg').textContent = '线路加载超时，可能已失效或禁止内嵌';
      $('#loadingSwitchBtn').hidden = false;
    }, 8000);

    if (!options.skipHistory) addHistory(url, isM3u8 ? null : line, {
      platform: isM3u8 ? 'm3u8直连' : undefined,
      title: options.title
    });
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('#player').addEventListener('load', () => {
    frameLoaded = true;
    // 只有真走了解析线路的播放才计入质量统计/解除失败记忆/回写历史
    if (playLineId && currentUrl) {
      clearFail(playLineId);   // 正常加载即摘掉失败记忆
      bumpStat(playLineId, 'ok');
      const rec = history.find(x => x.url === currentUrl);
      if (rec && rec.lineId !== playLineId) {   // 最后有响应的线路写回观看记录
        rec.lineId = playLineId;
        rec.lineName = (lines.find(l => l.id === playLineId) || {}).name || '';
        saveHistory();
        renderHistory();
      }
    }
    hideLoading();
  });

  /* ---------- 观看记录 ---------- */
  function addHistory(url, line, meta) {
    const options = meta || {};
    const existed = history.find(h => h.url === url);
    const fav = existed ? existed.fav : false;
    history = history.filter(h => h.url !== url);
    const platform = detectPlatform(url);
    history.unshift({
      url: url,
      platform: options.platform || (platform ? platform.name : '其他'),
      fav: fav,
      time: Date.now(),
      lineId: line ? line.id : null,     // 记住这条记录用的线路，重播时自动切回
      lineName: line ? line.name : '',
      title: options.title || ''         // 云端播放时记录「剧名 · 集名」
    });
    if (history.length > 50) history = history.slice(0, 50);
    saveHistory();
    renderHistory();
  }

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const min = 6e4, hour = 36e5, day = 864e5;
    if (diff < min) return '刚刚';
    if (diff < hour) return Math.floor(diff / min) + ' 分钟前';
    if (diff < day) return Math.floor(diff / hour) + ' 小时前';
    if (diff < 7 * day) return Math.floor(diff / day) + ' 天前';
    return new Date(ts).toLocaleDateString('zh-CN');
  }

  function renderHistory() {
    const list = $('#historyList');
    list.innerHTML = '';
    const q = historyQuery.toLowerCase();
    const shown = history.filter(h =>
      (!filterFav || h.fav) &&
      (!q || (h.url + ' ' + (h.platform || '') + ' ' + (h.title || '')).toLowerCase().includes(q))
    );
    const empty = $('#historyEmpty');
    renderHistory.tip = renderHistory.tip || empty.innerHTML;
    empty.hidden = shown.length > 0;
    if (!history.length) {
      empty.innerHTML = renderHistory.tip;   // 还原 index.html 里的手写空态
    } else {
      empty.textContent = (!shown.length && q) ? '没有匹配「' + historyQuery + '」的记录'
        : (!shown.length) ? '没有符合条件的记录' : '';
    }
    $('#historyToolbar').hidden = history.length === 0;

    shown.forEach(h => {
      const p = window.PLATFORMS.find(x => x.name === h.platform);

      const li = document.createElement('li');
      li.className = 'history-item';

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'hi-main';
      main.title = '点击重新播放';

      const dot = document.createElement('span');
      dot.className = 'hi-dot';
      dot.style.background = p ? p.color : '#8a8fa3';

      const info = document.createElement('span');
      info.className = 'hi-info';
      const plat = document.createElement('span');
      plat.className = 'hi-platform';
      plat.textContent = h.platform;
      const urlSpan = document.createElement('span');
      urlSpan.className = 'hi-url' + (h.title ? ' has-title' : '');
      urlSpan.textContent = h.title || h.url;
      urlSpan.title = h.url;
      info.append(plat, urlSpan);

      const time = document.createElement('span');
      time.className = 'hi-time';
      time.textContent = timeAgo(h.time);
      main.append(dot, info, time);
      main.addEventListener('click', () => {
        // 重播选线：优先切回这条记录上次用的线路；它失效/被删/刚超时过时，
        // 只在能换到「严格更优」的线路上才自动切换，否则留在当前线路不折腾
        const stored = h.lineId ? lines.find(l => l.id === h.lineId) : null;
        const storedSt = stored ? statusOf(stored.id).status : null;
        const curSt = statusOf(activeLineId).status;
        let target = null;
        let note = '';
        if (stored && stored.id !== activeLineId && storedSt !== 'down' && !recentlyFailed(stored.id)) {
          target = stored;                              // 上次的线路还健康 → 直接切回
        } else if (!stored || storedSt === 'down' || recentlyFailed(stored.id)) {
          const cand = nextHealthyLine(activeLineId, [activeLineId], true);
          const candSt = cand ? statusOf(cand.id).status : 'down';
          const better = cand && candSt !== 'down' &&
            ((curSt === 'down' && candSt !== 'down') || (curSt !== 'up' && candSt === 'up'));
          if (better) {
            target = cand;
          } else if (h.lineId && !stored) {
            note = '已删除，继续用当前线路';
          } else if (storedSt === 'down') {
            note = '已失效，继续用当前线路';
          } else if (recentlyFailed(stored.id)) {
            note = '刚超时过，继续用当前线路';
          }
        }
        if (target && target.id !== activeLineId) {
          activeLineId = target.id;
          saveLines();
          renderLines();
          toast('已切到线路：' + target.name);
        } else if (note) {
          toast('上次线路「' + (h.lineName || '原线路') + '」' + note);
        }
        $('#urlInput').value = h.url;
        updateBadge();
        play(h.url); // 会置顶该记录
      });

      const favBtn = document.createElement('button');
      favBtn.type = 'button';
      favBtn.className = 'hi-btn hi-fav' + (h.fav ? ' on' : '');
      favBtn.title = h.fav ? '取消收藏' : '收藏';
      favBtn.textContent = h.fav ? '★' : '☆';
      favBtn.addEventListener('click', () => { h.fav = !h.fav; saveHistory(); renderHistory(); });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'hi-btn hi-del';
      delBtn.title = '删除这条记录';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', () => {
        history = history.filter(x => x.url !== h.url);
        saveHistory();
        renderHistory();
      });

      li.append(main, favBtn, delBtn);
      list.appendChild(li);
    });
  }

  /* ---------- 无损云搜索（片名 → 候选 → 选集 → m3u8 直连） ----------
   * 参考 88lin/video_vip 的「无损云解析」。资源库 API 无 CORS 头，
   * 浏览器端经公共代理中转：尽力而为 + 多代理回退 + 结果本地缓存 + 失败降级。
   */
  const CLOUD = window.CLOUD || null;
  let cloudState = { view: 'idle', kw: '', list: [], cand: null, candName: '', episodes: [], loading: false, error: '' };

  function pruneCloudCache() {
    if (!CLOUD) return;
    const now = Date.now();
    let dirty = false;
    ['search', 'detail'].forEach(kind => {
      const box = cloudCache[kind] || {};
      Object.keys(box).forEach(k => {
        if (!box[k] || (now - box[k].t) > CLOUD.CACHE_TTL) { delete box[k]; dirty = true; }
      });
    });
    if (dirty) LS.set(KEYS.cloudCache, cloudCache);
  }

  function cloudCacheGet(kind, key) {
    const hit = cloudCache[kind][key];
    return hit && (Date.now() - hit.t) < CLOUD.CACHE_TTL ? hit.v : null;
  }

  function cloudCacheSet(kind, key, val) {
    cloudCache[kind][key] = { t: Date.now(), v: val };
    LS.set(KEYS.cloudCache, cloudCache);
  }

  async function cloudJson(apiUrl) {
    const proxies = (CLOUD && CLOUD.PROXIES) || [];
    if (!proxies.length) throw new Error('未配置搜索代理');
    const start = ((cloudProxyIdx % proxies.length) + proxies.length) % proxies.length;
    let lastErr = null;
    for (let k = 0; k < proxies.length; k++) {
      const i = (start + k) % proxies.length;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CLOUD.TIMEOUT || 12000);
      try {
        const res = await fetch(proxies[i](apiUrl), { signal: ctrl.signal, cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = JSON.parse(await res.text());
        cloudProxyIdx = i;              // 记住这次成功的代理，下次优先用它
        LS.set(KEYS.proxyIdx, cloudProxyIdx);
        return data;
      } catch (e) {
        lastErr = e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr || new Error('代理全部不可用');
  }

  async function cloudSearch(kw) {
    const cached = cloudCacheGet('search', kw);
    if (cached) return cached;
    const data = await cloudJson(CLOUD.SEARCH_API + encodeURIComponent(kw));
    const list = (data.list || []).filter(x => x.id && x.name).slice(0, 12)
      .map(x => ({ id: x.id, name: x.name, pic: x.pic || '' }));
    if (list.length) cloudCacheSet('search', kw, list);
    return list;
  }

  function parseEpisodes(playUrl) {
    // 苹果CMS 格式：第1集$url1#第2集$url2…（无集名时整段就是链接）
    return String(playUrl || '').split('#').map(seg => {
      const p = seg.split('$');
      return { name: (p[0] || '').trim() || '播放', url: (p[1] || p[0] || '').trim() };
    }).filter(ep => /^https?:\/\//i.test(ep.url));
  }

  async function cloudDetail(id) {
    const cached = cloudCacheGet('detail', String(id));
    if (cached) return cached;
    const data = await cloudJson(CLOUD.DETAIL_API + encodeURIComponent(id));
    const v = (data.list || [])[0];
    if (!v) throw new Error('未找到详情');
    const out = {
      name: v.vod_name || '',
      remarks: v.vod_remarks || '',
      episodes: parseEpisodes(v.vod_play_url)
    };
    if (out.episodes.length) cloudCacheSet('detail', String(id), out);
    return out;
  }

  function setCloudState(patch) {
    Object.assign(cloudState, patch);
    renderSearchPanel();
  }

  async function openCloudSearch(kw) {
    if (!CLOUD) { toast('云端搜索未配置', 'error'); return; }
    $('#searchPanel').hidden = false;
    setCloudState({ view: 'loading', kw: kw, list: [], cand: null, candName: '', episodes: [], loading: true, error: '', retryKind: 'search' });
    try {
      const list = await cloudSearch(kw);
      if (cloudState.kw !== kw) return;   // 用户已改搜别的
      setCloudState({ view: list.length ? 'candidates' : 'empty', list: list, loading: false });
    } catch (e) {
      if (cloudState.kw !== kw) return;
      setCloudState({ view: 'error', loading: false, error: '搜索服务暂时不可用（公共代理波动），可稍后重试，或直接粘贴链接走解析线路' });
    }
  }

  async function openCloudDetail(cand) {
    setCloudState({ view: 'loading', cand: cand, candName: cand.name, loading: true, error: '', retryKind: 'detail' });
    try {
      const info = await cloudDetail(cand.id);
      if (!cloudState.cand || cloudState.cand.id !== cand.id) return;
      if (!info.episodes.length) {
        setCloudState({ view: 'error', loading: false, error: '「' + info.name + '」暂无可播资源' });
        return;
      }
      setCloudState({ view: 'episodes', episodes: info.episodes, candName: info.name || cand.name, loading: false });
    } catch (e) {
      if (!cloudState.cand || cloudState.cand.id !== cand.id) return;
      setCloudState({ view: 'error', loading: false, error: '获取选集失败（代理波动），请重试' });
    }
  }

  function playEpisode(ep) {
    // 面板保持开着：换集不用重新搜索
    play(ep.url, {
      skipHistory: false,
      title: (cloudState.candName ? cloudState.candName + ' ' : '') + ep.name
    });
    setCloudState({});   // 重新渲染选集网格，让当前集高亮跟上
  }

  function renderSearchPanel() {
    const panel = $('#searchPanel');
    if (panel.hidden) return;
    const box = $('#searchPanelBody');
    box.innerHTML = '';
    const st = cloudState;

    if (st.view === 'loading') {
      const wrap = document.createElement('div');
      wrap.className = 'cloud-loading';
      const sp = document.createElement('div');
      sp.className = 'spinner small keep-motion';
      const msg = document.createElement('p');
      msg.textContent = st.cand ? '正在获取「' + st.candName + '」的选集…' : '正在搜索「' + st.kw + '」…';
      wrap.append(sp, msg);
      box.appendChild(wrap);
      return;
    }

    if (st.view === 'error') {
      const wrap = document.createElement('div');
      wrap.className = 'cloud-msg';
      const p = document.createElement('p');
      p.textContent = st.error;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn ghost small';
      retry.textContent = '↻ 重试';
      retry.addEventListener('click', () => {
        if (st.retryKind === 'detail' && st.cand) openCloudDetail(st.cand);
        else openCloudSearch(st.kw);
      });
      wrap.append(p, retry);
      box.appendChild(wrap);
      return;
    }

    if (st.view === 'empty') {
      const wrap = document.createElement('div');
      wrap.className = 'cloud-msg';
      const p = document.createElement('p');
      p.textContent = '资源库未收录「' + st.kw + '」，换个片名试试，或粘贴链接走解析线路。';
      box.appendChild(wrap);
      return;
    }

    if (st.view === 'candidates') {
      $('#searchPanelTitle').textContent = '「' + st.kw + '」的搜索结果';
      const grid = document.createElement('div');
      grid.className = 'cand-grid';
      st.list.forEach(cand => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'cand-card';
        const img = document.createElement('img');
        img.src = cand.pic;
        img.alt = cand.name;
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        const name = document.createElement('span');
        name.className = 'cand-name';
        name.textContent = cand.name;
        name.title = cand.name;
        card.append(img, name);
        card.addEventListener('click', () => openCloudDetail(cand));
        grid.appendChild(card);
      });
      box.appendChild(grid);
      return;
    }

    if (st.view === 'episodes') {
      $('#searchPanelTitle').textContent = st.candName + '，共 ' + st.episodes.length + ' 集';
      const head = document.createElement('div');
      head.className = 'ep-head';
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'btn ghost small';
      back.textContent = '← 返回候选';
      back.addEventListener('click', () => setCloudState({ view: 'candidates', cand: null }));
      head.appendChild(back);
      box.appendChild(head);
      const grid = document.createElement('div');
      grid.className = 'ep-grid';
      st.episodes.forEach(ep => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ep-btn' + (ep.url === currentUrl ? ' on' : '');
        btn.textContent = ep.name;
        btn.title = ep.url;
        btn.addEventListener('click', () => playEpisode(ep));
        grid.appendChild(btn);
      });
      box.appendChild(grid);
    }
  }

  /* ---------- 平台徽标 ---------- */
  function updateBadge() {
    const badge = $('#platformBadge');
    const wrap = $('#inputWrap');
    const p = detectPlatform($('#urlInput').value.trim());
    if (p) {
      badge.hidden = false;
      badge.textContent = p.name;
      badge.style.background = p.color;
      wrap.classList.add('has-badge');
    } else {
      badge.hidden = true;
      wrap.classList.remove('has-badge');
    }
  }

  /* ---------- 事件绑定 ---------- */
  // 双模式提交：像链接就走解析，否则当片名搜无损云
  function submitInput() {
    const raw = $('#urlInput').value.trim();
    if (raw && !normalizeUrl(raw)) openCloudSearch(raw);
    else play(raw);
  }

  $('#urlInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitInput();
    else if (e.key === 'Escape') { $('#urlInput').value = ''; updateBadge(); }
  });
  $('#urlInput').addEventListener('input', updateBadge);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#searchPanel').hidden) { $('#searchPanel').hidden = true; return; }
      if (!$('#linePanel').hidden) $('#linePanel').hidden = true;
    }
    if (e.altKey && /^[1-9]$/.test(e.key)) {
      const line = lines[+e.key - 1];
      if (line) { selectLine(line.id); e.preventDefault(); }
    }
  });

  $('#playBtn').addEventListener('click', submitInput);

  $('#clearBtn').addEventListener('click', () => {
    $('#urlInput').value = '';
    updateBadge();
    $('#urlInput').focus();
  });

  $('#pasteBtn').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) { $('#urlInput').value = text.trim(); updateBadge(); toast('已粘贴剪贴板内容'); }
      else toast('剪贴板是空的');
    } catch (e) {
      toast('无法读取剪贴板，请手动粘贴', 'error');
    }
  });

  $('#manageBtn').addEventListener('click', () => {
    const panel = $('#linePanel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) renderLineEditor();
  });

  $('#checkBtn').addEventListener('click', quickCheck);
  $('#switchLineBtn').addEventListener('click', switchLine);
  $('#loadingSwitchBtn').addEventListener('click', switchLine);

  $('#autoSwitchBtn').addEventListener('click', () => {
    autoSwitch = !autoSwitch;
    LS.set(KEYS.autoSwitch, autoSwitch);
    renderAutoSwitch();
    toast(autoSwitch ? '超时自动换线：开' : '超时自动换线：关');
  });

  // 手动反馈：当前线路画面有问题(卡死/水印/声画不同步)时,记入失败记忆并立即换线
  $('#badLineBtn').addEventListener('click', () => {
    const line = lines.find(l => l.id === activeLineId);
    if (!line) return;
    markFail(line.id);
    bumpStat(line.id, 'fail');
    toast('已记住「' + line.name + '」这次不行');
    if (lines.length >= 2) switchLine();
  });

  $('#historySearch').addEventListener('input', (e) => {
    historyQuery = e.target.value.trim();
    renderHistory();
  });
  $('#historySearch').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.target.value = '';
      historyQuery = '';
      renderHistory();
    }
  });

  $('#resetLinesBtn').addEventListener('click', () => {
    lines = window.DEFAULT_LINES.map(l => Object.assign({}, l));
    activeLineId = lines[0].id;
    saveLines();
    renderLines();
    renderLineEditor();
    toast('已恢复默认线路');
  });

  $('#addLineForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#newLineName').value.trim();
    const prefix = $('#newLinePrefix').value.trim();
    if (!name || !prefix) return;
    if (!/^https?:\/\//i.test(prefix)) {
      toast('接口地址需以 http(s):// 开头', 'error');
      return;
    }
    lines.push({ id: 'custom-' + Date.now(), name: name, prefix: prefix });
    saveLines();
    renderLines();
    renderLineEditor();
    $('#newLineName').value = '';
    $('#newLinePrefix').value = '';
    toast('线路「' + name + '」已添加');
  });

  $('#reloadBtn').addEventListener('click', () => {
    if (currentUrl) play(currentUrl, { skipHistory: true });
  });

  $('#searchPanelClose').addEventListener('click', () => {
    $('#searchPanel').hidden = true;
  });

  $('#newTabBtn').addEventListener('click', () => {
    const href = $('#newTabBtn').dataset.href;
    if (href) window.open(href, '_blank', 'noopener');
  });

  $('#closePlayerBtn').addEventListener('click', () => {
    $('#player').src = 'about:blank';
    $('#playerSection').hidden = true;
    currentUrl = '';
    playLineId = null;
  });

  $('#favFilter').addEventListener('change', (e) => {
    filterFav = e.target.checked;
    LS.set(KEYS.favFilter, filterFav);
    renderHistory();
  });

  $('#clearHistoryBtn').addEventListener('click', () => {
    if (!history.length) return;
    if (confirm('确定清空所有观看记录吗？')) {
      history = [];
      saveHistory();
      renderHistory();
    }
  });

  /* ---------- 初始化 ---------- */
  $('#favFilter').checked = filterFav;
  pruneFailMemo();
  pruneCloudCache();
  pruneLineStats();
  renderAutoSwitch();
  // 解析页净化用户脚本（伴生组件）激活检测：脚本会在本站写入标记
  try {
    const shield = LS.get('vvpro.adShield', null);
    if (shield && shield.v) $('#shieldBadge').hidden = false;
  } catch (e) { /* 忽略 */ }
  renderLines();
  renderHistory();
  renderStatusSummary();
  loadStatusSnapshot();

  // 支持 ?url=xxx 直接解析
  const urlParam = new URLSearchParams(location.search).get('url');
  if (urlParam) {
    $('#urlInput').value = urlParam;
    updateBadge();
    play(urlParam);
  }
})();
