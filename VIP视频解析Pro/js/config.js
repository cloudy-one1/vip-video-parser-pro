/* ========= 默认解析线路 =========
 * prefix 里可用 {url} 占位符表示视频链接的位置；
 * 不写占位符时，视频链接会编码后拼在接口地址末尾。
 * 这些只是示例，解析站时效性差，失效后可在页面里编辑或删除。
 */
window.DEFAULT_LINES = [
  { id: 'bljex',      name: '极致解析',   prefix: 'https://svip.bljex.cc/?v=' },
  { id: 'playm3u8',   name: 'PlayM3U8',  prefix: 'https://www.playm3u8.cn/jiexi.php?url=' },
  { id: 'im1907',     name: 'IM1907',    prefix: 'https://im1907.top/?jx=' },
  { id: 'aidouer',    name: '爱豆解析',   prefix: 'https://jx.aidouer.net/?url=' },
  { id: 'okjx',       name: 'OK解析',    prefix: 'https://okjx.cc/?url=' },
  { id: 'yemu',       name: '夜幕解析',   prefix: 'https://www.yemu.xyz/?url=' },
  { id: 'jsonplayer', name: 'JsonPlayer', prefix: 'https://jx.jsonplayer.com/player/?url=' },
  { id: '8090g',      name: '8090解析',  prefix: 'https://www.8090g.cn/?url=' }
];

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
