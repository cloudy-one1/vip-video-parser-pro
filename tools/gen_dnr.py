# -*- coding: utf-8 -*-
"""生成 extension/rules/dnr.json(MV3 declarativeNetRequest 静态规则)。

规则设计:
- **只对解析站生效**:所有规则的 initiatorDomains 限定为线路站 + 嵌套播放器域,
  绝不影响日常上网(这是"精准防御",不是通用广告拦截器)。
- 广告域名 → requestDomains 精确拦(含 main_frame,弹窗跳转在导航层就被掐断)。
  域名型 pattern 写在这里(listed_domains)。
- 路径/子串型 pattern → urlFilter 拦(substring,不含 main_frame 防误伤导航)。

改了 patterns 后在本目录重跑:  python tools/gen_dnr.py
"""
import json
import os

# 解析站与嵌套播放器域(initiator 限定)
# 注:bd.jx.cn(内容政策)/aidouer.net(服务关停)已于 2026-11-14/15 除名,同步摘除
INITIATOR_DOMAINS = [
    'lxyy.club', 'aibox.eu.org', '1ljx.com', 'maccms.xyz', 'im1907.top',
    'yemu.xyz', '8090g.cn', 'txnp.cn',
    '789jiexi.com', 'okjx.cc', 'wsyzy.vip'
]

# 域名型广告源 → requestDomains 拦截(顺带掐掉 main_frame 弹窗导航)
LISTED_AD_DOMAINS = [
    'googlesyndication.com', 'doubleclick.net', 'googletagservices.com',
    'popads.net', 'popcash.net', 'propellerads.com', 'clickadu.com',
    'exoclick.com', 'hilltopads.net', 'adskeeper.com', 'mgid.com',
    'adsterra.com', 'adcash.com', 'zeropark.com', 'bidvertiser.com',
    'juicyads.com', 'trafficstars.com', 'onclckds.com', 'adplexity.com'
]

# 子串型广告源 → urlFilter 拦截(不拦 main_frame)
URL_FILTER_PATTERNS = [
    '/pagead/', '/ads.js', '/ad.js', 'popunder', 'adservice',
    '/adsystem/', '/adserver', 'propeller', 'rollercdn'
]

REQUEST_TYPES_MEDIA = ['script', 'sub_frame', 'image', 'xmlhttprequest', 'ping', 'media', 'other']

rules = []
rid = 1

for domain in LISTED_AD_DOMAINS:
    rules.append({
        'id': rid,
        'priority': 1,
        'action': {'type': 'block'},
        'condition': {
            'requestDomains': [domain],
            'initiatorDomains': INITIATOR_DOMAINS,
            'resourceTypes': ['main_frame', 'sub_frame', 'script', 'image',
                              'xmlhttprequest', 'ping', 'media', 'other']
        }
    })
    rid += 1

for pattern in URL_FILTER_PATTERNS:
    rules.append({
        'id': rid,
        'priority': 1,
        'action': {'type': 'block'},
        'condition': {
            'urlFilter': pattern,
            'initiatorDomains': INITIATOR_DOMAINS,
            'resourceTypes': ['sub_frame', 'script', 'image', 'xmlhttprequest', 'ping', 'other']
        }
    })
    rid += 1

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'extension', 'rules', 'dnr.json')
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, 'w', encoding='utf-8') as f:
    json.dump(rules, f, ensure_ascii=False, indent=1)
print('written:', os.path.abspath(out), '| rules:', len(rules))
