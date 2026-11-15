/* ========= 默认解析线路 =========
 * prefix 里可用 {url} 占位符表示视频链接的位置；
 * 不写占位符时，视频链接会编码后拼在接口地址末尾。
 * 清单来源：老默认线路 + 88lin/video_vip 维护的接口清单，
 * 经 tools/line_checker.py 深度体检筛选（2026-11-14，10/11 通过），
 * 按响应速度排序。解析站时效性差，失效后可在页面里编辑或删除。
 *
 * 除名记录：
 *  - bd.jx.cn（BD解析）：2026-11-14 播放页实测出现成人广告插页，内容政策除名。
 *  - jx.aidouer.net（爱豆）/ jx.hls.one（HLS）：2026-11-15 上游指纹分析发现两站同上游，
 *    且均已发布告别页（「江湖路远，后会无期」）服务关停，除名。
 *
 * 2026-11-15 增补：来源 yinghezhinan.com 解析接口合集 + 88lin/video_vip，
 * 9 条候选经 line_checker 深度体检，FongMi 入选（七哥×2 为 Cloudflare 质询拦截、
 * 937/花旗/Ai超级/RdfPlayer 连接失败，均未入选；HLS解析同日入选又因上述告别页除名）。
 */
window.DEFAULT_LINES = [
  { id: 'lxyy',       name: 'LXYY解析',  prefix: 'https://jx.lxyy.club/index.php?url=' },
  { id: 'aibox',      name: 'AiBox解析', prefix: 'https://aibox.eu.org/?url=' },
  { id: 'maccms',     name: 'MacCms解析', prefix: 'https://free.maccms.xyz/?url=' },
  { id: 'im1907',     name: 'IM1907',    prefix: 'https://im1907.top/?jx=' },
  { id: 'yemu',       name: '夜幕解析',   prefix: 'https://www.yemu.xyz/?url=' },
  { id: '8090g',      name: '8090解析',  prefix: 'https://www.8090g.cn/?url=' },
  { id: 'txnp',       name: 'TXNQ解析',  prefix: 'https://bfq.txnp.cn/player?url=' },
  { id: 'jx789',      name: '789解析',   prefix: 'https://jiexi.789jiexi.com/?url=' },
  { id: 'okjx',       name: 'OK解析',    prefix: 'https://okjx.cc/?url=' },
  { id: 'fongmi',     name: 'FongMi',    prefix: 'https://json.fongmi.cc/web?url=' }
];

/* 已除名的默认线路（内容政策/服务关停）：app.js 会在加载时自动清掉「未被用户改动过」的这些线 */
window.REMOVED_DEFAULT_LINES = {
  bdjx: 'https://bd.jx.cn/?url=',
  aidouer: 'https://jx.aidouer.net/?url=',
  hlsone: 'https://jx.hls.one/?url='
};

/* ========= 无损云搜索配置 =========
 * 片名搜索 → 候选 → 选集 → m3u8 直连，参考 88lin/video_vip 的「无损云解析」。
 * 资源库 API 无 CORS 头，浏览器端经公共代理中转（尽力而为，失败自动降级）。
 *
 * 资源源聚合：候选卡同名去重（源顺序即优先级），单源失败不影响其余源。
 * protocol:
 *  - 'cms'     标准苹果CMS：search(?ac=detail&wd=) 一次带回详情（含 vod_play_url），
 *              搜索时顺手把详情种进缓存，点击候选零等待；
 *  - 'suggest' 无忧专用：suggest 搜索只回 id/name/pic，详情点击时再走 detail&ids=。
 * 候选源 2026-11-15 实测（curl 直连，狂飙/繁花双探针）：非凡（狂飙77集+繁花59集）/
 * 暴风（狂飙39集）/360（繁花30集）补齐无忧片库缺口；量子 SSL 断连、卧龙/天空返回非
 * JSON、极速/红牛无正主命中，均未入选。覆盖缺口见 README 云搜索说明。
 */
window.CLOUD = {
  SOURCES: [
    { id: 'ffzy',  name: '非凡', protocol: 'cms',
      search: 'https://api.ffzyapi.com/api.php/provide/vod/?ac=detail&wd=',
      detail: 'https://api.ffzyapi.com/api.php/provide/vod/?ac=detail&ids=' },
    { id: 'bfzy',  name: '暴风', protocol: 'cms',
      search: 'https://bfzyapi.com/api.php/provide/vod/?ac=detail&wd=',
      detail: 'https://bfzyapi.com/api.php/provide/vod/?ac=detail&ids=' },
    { id: 'zy360', name: '360',  protocol: 'cms',
      search: 'https://360zy5.com/api.php/provide/vod/?ac=detail&wd=',
      detail: 'https://360zy5.com/api.php/provide/vod/?ac=detail&ids=' },
    { id: 'wsyzy', name: '无忧', protocol: 'suggest',
      search: 'https://wsyzy.cc/index.php/ajax/suggest?mid=1&wd=',
      detail: 'https://api.wsyzy.net/api.php/provide/vod/?ac=detail&ids=' }
  ],
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

/* ========= 本地网关(可选增强) =========
 * python tools/gateway.py 起的本机服务:分钟级线路体检 + 播放前预检 + 失败回报。
 * 页面打开后每分钟自动探测,网关在线即接入;不在时一切照旧,零依赖。
 * 换端口时同步改这里的 base。
 */
window.GATEWAY = {
  enabled: true,
  base: 'http://127.0.0.1:8787'
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
