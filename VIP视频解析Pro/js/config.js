/* ========= 默认解析线路 =========
 * prefix 里可用 {url} 占位符表示视频链接的位置；
 * 不写占位符时，视频链接会编码后拼在接口地址末尾。
 * 清单来源：老默认线路 + 88lin/video_vip 维护的接口清单，
 * 经 tools/line_checker.py 深度体检筛选（2026-11-14，10/11 通过），
 * 按响应速度排序。解析站时效性差，失效后可在页面里编辑或删除。
 *
 * 除名记录：
 *  - bd.jx.cn（BD解析）：2026-11-14 播放页实测出现成人广告插页，内容政策除名。
 */
window.DEFAULT_LINES = [
  { id: 'lxyy',       name: 'LXYY解析',  prefix: 'https://jx.lxyy.club/index.php?url=' },
  { id: 'aibox',      name: 'AiBox解析', prefix: 'https://aibox.eu.org/?url=' },
  { id: 'maccms',     name: 'MacCms解析', prefix: 'https://free.maccms.xyz/?url=' },
  { id: 'im1907',     name: 'IM1907',    prefix: 'https://im1907.top/?jx=' },
  { id: 'yemu',       name: '夜幕解析',   prefix: 'https://www.yemu.xyz/?url=' },
  { id: '8090g',      name: '8090解析',  prefix: 'https://www.8090g.cn/?url=' },
  { id: 'aidouer',    name: '爱豆解析',   prefix: 'https://jx.aidouer.net/?url=' },
  { id: 'txnp',       name: 'TXNQ解析',  prefix: 'https://bfq.txnp.cn/player?url=' },
  { id: 'jx789',      name: '789解析',   prefix: 'https://jiexi.789jiexi.com/?url=' },
  { id: 'okjx',       name: 'OK解析',    prefix: 'https://okjx.cc/?url=' }
];

/* 内容政策除名的默认线路：app.js 会在加载时自动清掉「未被用户改动过」的这些线 */
window.REMOVED_DEFAULT_LINES = {
  bdjx: 'https://bd.jx.cn/?url='
};

/* ========= 无损云搜索配置 =========
 * 片名搜索 → 候选 → 选集 → m3u8 直连，参考 88lin/video_vip 的「无损云解析」。
 * 资源库 API 无 CORS 头，浏览器端经公共代理中转（尽力而为，失败自动降级）。
 */
window.CLOUD = {
  SEARCH_API: 'https://wsyzy.cc/index.php/ajax/suggest?mid=1&wd=',
  DETAIL_API: 'https://api.wsyzy.net/api.php/provide/vod/?ac=detail&ids=',
  PLAYER: 'player.html?src=',                       /* 自建 hls.js 播放器(零第三方页面) */
  PLAYER_REMOTE: 'https://wsyzy.vip/m3u8/?url=',    /* 官方回退:自建播放器失败时在 player.html 内可一键切换 */
  /* 代理链：按序尝试，成功者记入 localStorage 下次优先 */
  PROXIES: [
    u => u,
    u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    u => 'https://cors.eu.org/' + u,
    u => 'https://test.cors.workers.dev/?' + u
  ],
  CACHE_TTL: 6 * 3600e3,   // 搜索/详情缓存 6 小时
  TIMEOUT: 12000
};

/* ========= 平台识别规则 =========
 * 用于在输入链接时显示来源平台徽标、给历史记录上色。
 */
window.PLATFORMS = [
  { name: '腾讯视频',  hosts: ['qq.com'],            color: '#ff6b35' },
  { name: '爱奇艺',    hosts: ['iqiyi.com', 'iq.com'], color: '#00be06' },
  { name: '优酷',      hosts: ['youku.com'],          color: '#1ba7ff' },
  { name: '芒果TV',    hosts: ['mgtv.com'],           color: '#ff5f00' },
  { name: '哔哩哔哩',  hosts: ['bilibili.com', 'b23.tv'], color: '#fb7299' },
  { name: '搜狐视频',  hosts: ['tv.sohu.com'],        color: '#ffd11a' },
  { name: '乐视视频',  hosts: ['le.com'],             color: '#e43b3b' },
  { name: 'PPTV',      hosts: ['pptv.com'],           color: '#00b4ff' },
  { name: '1905电影网', hosts: ['1905.com'],           color: '#d4a03c' }
];
