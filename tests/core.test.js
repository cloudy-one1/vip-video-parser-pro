/* 前端纯函数核心库单测:node --test tests/ 执行(Node 18+)。
 * core.js 是 UMD,CJS require 即可用。 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const core = require('../VIP视频解析Pro/js/lib/core.js');

/* ---------- normalizeUrl ---------- */
test('normalizeUrl: 裸域名自动补 https', () => {
  assert.strictEqual(core.normalizeUrl('v.qq.com/x/cover/abc'), 'https://v.qq.com/x/cover/abc');
});
test('normalizeUrl: 完整链接原样返回', () => {
  assert.strictEqual(
    core.normalizeUrl('https://www.iqiyi.com/v/abc.html?a=1'),
    'https://www.iqiyi.com/v/abc.html?a=1'
  );
});
test('normalizeUrl: 非链接与空值返回 null', () => {
  assert.strictEqual(core.normalizeUrl('庆余年'), null);
  assert.strictEqual(core.normalizeUrl(''), null);
  assert.strictEqual(core.normalizeUrl(null), null);
  assert.strictEqual(core.normalizeUrl('localhost:8000/x'), null); // 无点不算域名
});
test('normalizeUrl: 非 http(s) 协议拒绝', () => {
  assert.strictEqual(core.normalizeUrl('javascript:alert(1)'), null);
  assert.strictEqual(core.normalizeUrl('ftp://example.com/x'), null);
});

/* ---------- parseEpisodes ---------- */
test('parseEpisodes: 优选 m3u8 直链更多的组(非凡 share页坑)', () => {
  const playUrl =
    '分享页$https://s/1.html#第1集$https://a/1.m3u8$$$' +
    '第1集$https://a/1.m3u8#第2集$https://a/2.m3u8';
  const eps = core.parseEpisodes(playUrl);
  assert.strictEqual(eps.length, 2);
  assert.strictEqual(eps[0].url, 'https://a/1.m3u8');
  assert.strictEqual(eps[1].name, '第2集');
});
test('parseEpisodes: m3u8 数相同取集数多的组', () => {
  const eps = core.parseEpisodes('第1集$https://a/1.m3u8$$$第1集$https://b/1.m3u8#第2集$https://b/2.m3u8');
  assert.strictEqual(eps.length, 2);
  assert.strictEqual(eps[0].url, 'https://b/1.m3u8');
});
test('parseEpisodes: 裸链接(无 $ 分隔)按序号命名,不拿 URL 当按钮文字', () => {
  const eps = core.parseEpisodes('https://x/v.m3u8');
  assert.strictEqual(eps.length, 1);
  assert.strictEqual(eps[0].url, 'https://x/v.m3u8');
  assert.strictEqual(eps[0].name, '第1集');
});
test('parseEpisodes: 混合形态下缺名条目按位置命名', () => {
  const eps = core.parseEpisodes('第1集$https://x/1.m3u8#https://x/2.m3u8');
  assert.strictEqual(eps.length, 2);
  assert.strictEqual(eps[0].name, '第1集');
  assert.strictEqual(eps[1].name, '第2集');
});
test('parseEpisodes: 过滤非 http 项', () => {
  const eps = core.parseEpisodes('第1集$/vod/1.m3u8#第2集$https://x/2.m3u8');
  assert.strictEqual(eps.length, 1);
  assert.strictEqual(eps[0].name, '第2集');
});
test('parseEpisodes: 空输入返回空数组', () => {
  assert.deepStrictEqual(core.parseEpisodes(''), []);
  assert.deepStrictEqual(core.parseEpisodes(null), []);
});

/* ---------- rankCloudResults ---------- */
test('rankCloudResults: 正主与季名前置(main 角标)', () => {
  const list = [
    { id: '1', name: '庆余年短剧版' },
    { id: '2', name: '庆余年第二季' },
    { id: '3', name: '庆余年' },
    { id: '4', name: '我的庆余年同人' },
  ];
  const out = core.rankCloudResults(list, '庆余年');
  assert.strictEqual(out[0].name, '庆余年');
  assert.strictEqual(out[0].main, true);
  assert.strictEqual(out[1].name, '庆余年第二季');
  assert.strictEqual(out[1].main, true);
  assert.strictEqual(out[2].name, '庆余年短剧版');
  assert.strictEqual(out[2].main, false);
});
test('rankCloudResults: 排序后截断到 12 条', () => {
  const list = Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: '片名' + i }));
  assert.strictEqual(core.rankCloudResults(list, '片名').length, 12);
});
test('rankCloudResults: 空关键词不产生 main 角标(含片名分支恒真,全落第 2 档)', () => {
  const out = core.rankCloudResults([{ id: '1', name: '随便' }], '');
  assert.strictEqual(out[0].rank, 2);
  assert.strictEqual(out[0].main, false);
});

/* ---------- familyOf ---------- */
test('familyOf: 无 up 字段的线路按 id 独立成族', () => {
  assert.strictEqual(core.familyOf({ id: 'custom-1' }), 'custom-1');
  assert.strictEqual(core.familyOf({ id: 'x', up: '8090' }), '8090');
});

/* ---------- nextHealthyLine ---------- */
const mkDeps = (statusMap, failedSet, scoreMap) => ({
  statusOf: (id) => ({ status: statusMap[id] || 'unknown' }),
  recentlyFailed: (id) => !!(failedSet && failedSet.has(id)),
  scoreOf: (id) => (scoreMap && typeof scoreMap[id] === 'number' ? scoreMap[id] : null),
});

const LINES = [
  { id: 'a8090', name: '8090', prefix: 'https://8090.example/?url=', up: '8090' },
  { id: 'j789', name: '789', prefix: 'https://789.example/?url=', up: '8090' },
  { id: 'other', name: '其他', prefix: 'https://o.example/?url=', up: 'o' },
];

test('nextHealthyLine: 同上游家族降权,优先真不同的上游', () => {
  const deps = mkDeps({ a8090: 'up', j789: 'up', other: 'up' });
  const pick = core.nextHealthyLine(LINES, 'a8090', ['a8090'], true, null, deps);
  assert.strictEqual(pick.id, 'other'); // 789 与 8090 同运营者,不算真重试
});
test('nextHealthyLine: 只剩同族时仍返回同族兜底', () => {
  const deps = mkDeps({ a8090: 'up', j789: 'up', other: 'down' });
  const pick = core.nextHealthyLine(LINES, 'a8090', ['a8090'], true, null, deps);
  assert.strictEqual(pick.id, 'j789');
});
test('nextHealthyLine: 近期失败过的线路退到第二优先', () => {
  const deps = mkDeps({ a8090: 'up', j789: 'up', other: 'up' }, new Set(['other']));
  const pick = core.nextHealthyLine(LINES, 'a8090', ['a8090'], true, null, deps);
  assert.strictEqual(pick.id, 'j789');
});
test('nextHealthyLine: 同族候选之间按成功率择优', () => {
  const LINES2 = [
    { id: 'x1', prefix: 'https://x1/?url=', up: 'fam' },
    { id: 'x2', prefix: 'https://x2/?url=', up: 'fam' },
    { id: 'x3', prefix: 'https://x3/?url=', up: 'fam3' },
  ];
  const deps = mkDeps({ x1: 'up', x2: 'up', x3: 'down' }, null, { x1: 0.4, x2: 0.9 });
  const pick = core.nextHealthyLine(LINES2, 'x1', ['x1'], true, null, deps);
  assert.strictEqual(pick.id, 'x2');
});
test('nextHealthyLine: 自定义线(无家族)不触发降权', () => {
  const LINES3 = [
    { id: 'custom-1', prefix: 'https://c1/?url=' },
    { id: 'x1', prefix: 'https://x1/?url=', up: 'fam' },
    { id: 'x2', prefix: 'https://x2/?url=', up: 'fam' },
  ];
  const deps = mkDeps({ 'custom-1': 'up', x1: 'up', x2: 'up' });
  const pick = core.nextHealthyLine(LINES3, 'custom-1', ['custom-1'], true, null, deps);
  assert.strictEqual(pick.id, 'x1'); // 无数据时稳定排序保持原序
});
test('nextHealthyLine: 全部被排除返回 null', () => {
  const deps = mkDeps({ a8090: 'up', j789: 'up', other: 'up' });
  const pick = core.nextHealthyLine(LINES, 'a8090', ['a8090', 'j789', 'other'], true, null, deps);
  assert.strictEqual(pick, null);
});
test('nextHealthyLine: 起点不存在返回 null', () => {
  const deps = mkDeps({});
  assert.strictEqual(core.nextHealthyLine(LINES, 'nope', [], true, null, deps), null);
});
