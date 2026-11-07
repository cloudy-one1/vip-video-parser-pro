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
    favFilter: 'vvpro.favFilter'
  };

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
  let currentUrl = '';

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
      toast('体检完成：' + up + '/' + lines.length + ' 条可达');
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
    const ago = snapshotTime ? ' · ' + timeAgo(new Date(snapshotTime).getTime()) : '';
    el.hidden = false;
    el.textContent = src + '：' + up + '/' + lines.length + ' 条线路可用' + ago;
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
  function nextHealthyLine(fromId) {
    const idx = lines.findIndex(l => l.id === fromId);
    for (let step = 1; step <= lines.length; step++) {
      const cand = lines[(idx + step) % lines.length];
      if (statusOf(cand.id).status === 'up') return cand;
    }
    // 没有已知可用的线路，就顺序换下一条
    return lines[(idx + 1) % lines.length];
  }

  function switchLine() {
    if (lines.length < 2) { toast('只有一条线路，无法换线', 'error'); return; }
    const target = nextHealthyLine(activeLineId);
    if (target.id === activeLineId) { toast('没有其他线路可换', 'error'); return; }
    activeLineId = target.id;
    saveLines();
    renderLines();
    toast('已换到线路：' + target.name);
    if (currentUrl) play(currentUrl, { skipHistory: true });
  }

  /* ---------- 线路管理 ---------- */
  function renderLineEditor() {
    const ul = $('#lineEditorList');
    ul.innerHTML = '';
    lines.forEach(line => {
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

      li.append(dot, nameI, prefixI, del);
      ul.appendChild(li);
    });
  }

  /* ---------- 播放 ---------- */
  let frameLoaded = false;   // 区分「load 事件正常触发」与「8 秒兜底超时」

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
    const parseUrl = buildParseUrl(line, url);

    const section = $('#playerSection');
    const frame = $('#player');
    const loading = $('#playerLoading');
    section.hidden = false;
    loading.classList.remove('gone');

    const platform = detectPlatform(url);
    const nowPlaying = $('#nowPlaying');
    nowPlaying.textContent = (platform ? platform.name + ' · ' : '') + url;
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
      $('#loadingMsg').textContent = '线路加载超时，可能已失效或禁止内嵌';
      $('#loadingSwitchBtn').hidden = false;
    }, 8000);

    if (!options.skipHistory) addHistory(url);
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('#player').addEventListener('load', () => { frameLoaded = true; hideLoading(); });

  /* ---------- 观看记录 ---------- */
  function addHistory(url) {
    const existed = history.find(h => h.url === url);
    const fav = existed ? existed.fav : false;
    history = history.filter(h => h.url !== url);
    const platform = detectPlatform(url);
    history.unshift({ url: url, platform: platform ? platform.name : '其他', fav: fav, time: Date.now() });
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
    const shown = filterFav ? history.filter(h => h.fav) : history;
    $('#historyEmpty').hidden = shown.length > 0;
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
      urlSpan.className = 'hi-url';
      urlSpan.textContent = h.url;
      urlSpan.title = h.url;
      info.append(plat, urlSpan);

      const time = document.createElement('span');
      time.className = 'hi-time';
      time.textContent = timeAgo(h.time);
      main.append(dot, info, time);
      main.addEventListener('click', () => {
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
  $('#urlInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') play($('#urlInput').value);
    else if (e.key === 'Escape') { $('#urlInput').value = ''; updateBadge(); }
  });
  $('#urlInput').addEventListener('input', updateBadge);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#linePanel').hidden) $('#linePanel').hidden = true;
    if (e.altKey && /^[1-9]$/.test(e.key)) {
      const line = lines[+e.key - 1];
      if (line) { selectLine(line.id); e.preventDefault(); }
    }
  });

  $('#playBtn').addEventListener('click', () => play($('#urlInput').value));

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

  $('#newTabBtn').addEventListener('click', () => {
    const href = $('#newTabBtn').dataset.href;
    if (href) window.open(href, '_blank', 'noopener');
  });

  $('#closePlayerBtn').addEventListener('click', () => {
    $('#player').src = 'about:blank';
    $('#playerSection').hidden = true;
    currentUrl = '';
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
