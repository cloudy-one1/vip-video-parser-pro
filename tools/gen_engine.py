# -*- coding: utf-8 -*-
"""从 userscript/parse-ad-shield.user.js 生成 extension/content/engine.js。
去掉 ==UserScript== 元数据块,加来源说明头。改规则请改 userscript 后重跑本脚本。"""
import os

src = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'userscript', 'parse-ad-shield.user.js')
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'extension', 'content', 'engine.js')
os.makedirs(os.path.dirname(dst), exist_ok=True)

t = open(src, encoding='utf-8').read()
start = t.find('// ==UserScript==')
end = t.find('// ==/UserScript==')
assert start != -1 and end != -1, 'userscript header not found'
end = t.find('\n', end) + 1

header = """/* ============================================================
 * VIP解析 Pro · 解析页净化引擎(扩展版 content script)
 * ⚠ 本文件由 tools/gen_engine.py 从 userscript/parse-ad-shield.user.js 生成,
 *   规则与 scriptlet 请改用户脚本源文件后重新生成,勿直接编辑本文件。
 * ============================================================ */
"""
open(dst, 'w', encoding='utf-8', newline='\n').write(header + t[end:])
print('written:', os.path.abspath(dst))
