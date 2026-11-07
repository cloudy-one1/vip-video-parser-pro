# -*- coding: utf-8 -*-
"""线路体检 —— VIP 视频解析 Pro 的 Scrapling 工具链

批量探测解析线路的存活状态,输出前端可直接消费的状态快照。
探测只访问各线路的首页(站点根地址),不携带任何视频链接。

用法(项目根目录下):
  python tools/line_checker.py                    # 体检 js/config.js 里的默认线路
  python tools/line_checker.py --lines my.json    # 体检自定义线路列表(格式同 config.js 条目)
  python tools/line_checker.py --timeout 12       # 单站超时(秒),默认 10
  python tools/line_checker.py --stealth          # 所有站点都走无头浏览器重试(慢)

输出(写入 js/ 目录,前端启动时自动读取):
  js/lines-status.json   供 http:// 部署时 fetch 读取
  js/lines-status.js     供 file:// 直接打开时以 <script> 方式读取

状态含义:
  up       首页可达且内容正常
  blocked  站点活着,但有人机验证/拦截(常见为 Cloudflare 质询)
  down     连不上、报错,或被判定为停放/过期/跳转劫持页
"""

import argparse
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
CONFIG_JS = ROOT / "js" / "config.js"
OUT_DIR = ROOT / "js"

TOOL_VERSION = "1.0"

# 疑似 Cloudflare 质询/拦截页的特征(小写匹配)
CF_MARKERS = [
    "just a moment",
    "challenge-platform",
    "cf-chl",
    "attention required",
    "checking your browser",
    "verify you are human",
]
# 疑似停放/过期/劫持页的特征
PARKING_KEYWORDS = [
    "域名出售", "域名过期", "域名续费", "已到期",
    "domain for sale", "domain is for sale", "buy this domain",
    "parked", "expired domain", "account suspended",
]


def parse_config_lines(config_path: Path):
    """从 config.js 里抠出 DEFAULT_LINES 条目(纯文本解析,不执行任何 JS)。"""
    text = config_path.read_text(encoding="utf-8")
    pattern = re.compile(
        r"\{\s*id:\s*'([^']+)'\s*,\s*name:\s*'([^']+)'\s*,\s*prefix:\s*'([^']+)'\s*\}"
    )
    lines = [
        {"id": m.group(1), "name": m.group(2), "prefix": m.group(3)}
        for m in pattern.finditer(text)
    ]
    if not lines:
        raise SystemExit(f"未能从 {config_path} 解析出任何线路,请检查格式")
    return lines


def origin_of(prefix: str) -> str:
    """取线路接口地址的站点根地址,作为探测目标。"""
    u = urlparse(prefix)
    return f"{u.scheme}://{u.netloc}/"


def registrable(host: str) -> str:
    """简化版主域提取:取最后两段标签(够用于跳转劫持判断)。"""
    parts = host.lower().split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def page_text(resp) -> str:
    """优先取渲染后的可见文本(避免扫到 <script> 里的无关字符串导致误判)。"""
    try:
        txt = resp.get_all_text(separator=" ", strip=True)
        if txt:
            return txt
    except Exception:
        pass
    val = getattr(resp, "html_content", None)
    return val if isinstance(val, str) else ""


def classify(code, title, text, final_url, home):
    """把一次探测结果归类为 up / blocked / down,并给出一句中文说明。"""
    low = (title + " " + text[:6000]).lower()
    home_host = urlparse(home).netloc.lower()
    final_host = (urlparse(final_url).netloc or home_host).lower()

    if code == 0:
        return "down", "连接失败(超时/DNS/拒连)"
    if any(m in low for m in CF_MARKERS):
        return "blocked", "疑似人机验证页(Cloudflare)"
    if "403 forbidden" in low and ("nginx" in low or "<hr>" in text[:2000].lower()):
        # REA 浏览器实测:nginx 裸 403 页在真实浏览器里也如此渲染,属服务器明确拒绝
        return "down", "服务器明确拒绝访问(nginx 403)"
    if 200 <= code < 400:
        if any(k in low for k in PARKING_KEYWORDS):
            return "down", "疑似停放/过期页面"
        if registrable(final_host) != registrable(home_host):
            return "down", f"跳转到其他站点({final_host})"
        return "up", ""
    if code in (401, 403, 429, 503):
        return "blocked", f"HTTP {code}(可能被拦截或限流)"
    return "down", f"HTTP {code}"


def probe(line, timeout, force_stealth=False):
    """探测一条线路的首页,返回标准化记录。"""
    home = origin_of(line["prefix"])
    rec = {
        "id": line["id"],
        "name": line["name"],
        "homepage": home,
        "status": "down",
        "code": None,
        "ms": None,
        "title": "",
        "finalUrl": home,
        "note": "",
        "via": "http",
    }

    t0 = time.perf_counter()
    code, title, text, final_url, err = 0, "", "", home, ""
    try:
        from scrapling.fetchers import Fetcher

        resp = Fetcher.get(
            home, timeout=timeout, stealthy_headers=True, follow_redirects=True
        )
        code = int(resp.status)
        title = (resp.css("title::text").get() or "").strip()
        text = page_text(resp)
        final_url = str(getattr(resp, "url", None) or home)
    except Exception as exc:  # 网络/库异常都归为连接失败,不留裸堆栈
        err = f"{type(exc).__name__}: {exc}"[:200]

    rec["ms"] = round((time.perf_counter() - t0) * 1000)
    rec["code"] = code or None
    rec["title"] = title
    rec["finalUrl"] = final_url
    status, note = classify(code, title, text, final_url, home)

    # HTTP 层不理想时,用无头浏览器复核一次(能过 Cloudflare 质询、执行 JS 跳转)
    if status != "up" or force_stealth:
        b_code, b_title, b_text, b_final, b_err = stealth_probe(home, timeout)
        if b_code:
            rec["via"] = "browser"
            b_status, b_note = classify(b_code, b_title, b_text, b_final, home)
            # 浏览器复核结论优先(HTTP 层可能被假拦截)
            if b_status == "up":
                status = "up"
                note = f"HTTP 层异常({err.split(':')[0] if err else '不可达'}),浏览器复核通过" if err else "浏览器复核通过"
            else:
                status, note = b_status, b_note
            rec["code"], rec["title"] = b_code, b_title
            rec["finalUrl"] = b_final
    if err and status == "down" and not note:
        note = err

    rec["status"] = status
    rec["note"] = note
    return rec


def stealth_probe(home, timeout):
    """无头浏览器探测;环境里没装浏览器时安静放弃,保留 HTTP 层结论。"""
    try:
        from scrapling.fetchers import StealthyFetcher

        resp = StealthyFetcher.fetch(
            home, headless=True, block_ads=True, timeout=timeout * 1000
        )
        return (
            int(resp.status),
            (resp.css("title::text").get() or "").strip(),
            page_text(resp),
            str(getattr(resp, "url", None) or home),
            "",
        )
    except Exception as exc:
        return 0, "", "", home, f"{type(exc).__name__}: {exc}"[:200]


def main():
    ap = argparse.ArgumentParser(description="VIP 视频解析 Pro 线路体检(Scrapling)")
    ap.add_argument("--lines", help="自定义线路 JSON 文件(缺省读 js/config.js)")
    ap.add_argument("--timeout", type=int, default=10, help="单站超时秒数,默认 10")
    ap.add_argument("--stealth", action="store_true", help="全部走无头浏览器复核")
    ap.add_argument("--out-dir", default=str(OUT_DIR), help="快照输出目录")
    args = ap.parse_args()

    if args.lines:
        lines = json.loads(Path(args.lines).read_text(encoding="utf-8"))
    else:
        lines = parse_config_lines(CONFIG_JS)

    print(f"开始体检 {len(lines)} 条线路(超时 {args.timeout}s)…\n")
    results = {}
    with ThreadPoolExecutor(max_workers=min(8, len(lines))) as pool:
        futs = {pool.submit(probe, ln, args.timeout, args.stealth): ln for ln in lines}
        for fut in as_completed(futs):
            rec = fut.result()
            results[rec["id"]] = rec
            mark = {"up": "🟢", "blocked": "🟡", "down": "🔴"}.get(rec["status"], "⚪")
            extra = f" | {rec['note']}" if rec["note"] else ""
            print(f"  {mark} {rec['name']:<10} {rec['status']:<8} {rec['ms']}ms  {rec['homepage']}{extra}")

    snapshot = {
        "checkedAt": datetime.now().isoformat(timespec="seconds"),
        "tool": f"line_checker/{TOOL_VERSION}",
        "lines": {lid: {k: v for k, v in r.items() if k not in ("id", "name")} for lid, r in results.items()},
    }

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "lines-status.json").write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out / "lines-status.js").write_text(
        "/* 由 tools/line_checker.py 自动生成,前端启动时读取 */\n"
        "window.LINES_STATUS = " + json.dumps(snapshot, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )

    alive = sum(1 for r in results.values() if r["status"] == "up")
    print(f"\n完成:{alive}/{len(lines)} 可用。快照已写入 {out / 'lines-status.json'} 与 lines-status.js")


if __name__ == "__main__":
    main()
