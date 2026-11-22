# -*- coding: utf-8 -*-
"""线路体检 —— VIP 视频解析 Pro 的 Scrapling 工具链

批量探测解析线路的存活状态,输出前端可直接消费的状态快照。
探测只访问各线路的首页(站点根地址),不携带任何视频链接。

用法(项目根目录下):
  python tools/line_checker.py                    # 体检 js/config.js 里的默认线路
  python tools/line_checker.py --lines my.json    # 体检自定义线路列表(格式同 config.js 条目)
  python tools/line_checker.py --timeout 12       # 单站超时(秒),默认 10
  python tools/line_checker.py --stealth          # 所有站点都走无头浏览器重试(慢)
  python tools/line_checker.py --no-browser       # 只走 HTTP 层,禁用无头浏览器复核(CI 用)
  python tools/line_checker.py --badge out.json   # 额外输出 shields.io 徽标 JSON
  python tools/line_checker.py --summary-md out.md  # 额外输出 Markdown 摘要表
  python tools/line_checker.py --history h.json   # 追加体检记录到历史(趋势数据源)
  python tools/line_checker.py --trend-svg t.svg  # 从历史生成可用率趋势曲线 SVG

输出(写入 js/ 目录):
  js/lines-status.js     前端启动时以 <script> 方式读取(file:// 与 http:// 均适用)
  js/lines-status.json   供人阅读与 CI/徽标展示使用(前端实际不读取)

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

TOOL_VERSION = "1.3"

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
# 站长主动关停的告别页特征(2026-11-15 实测:爱豆/HLS 同款告别页,页面 200 但服务已停)
FAREWELL_MARKERS = [
    "后会无期", "此去一别", "江湖路远", "不再相逢", "望君珍重",
]


def parse_config_lines(config_path: Path):
    """从 config.js 里抠出 DEFAULT_LINES 条目(纯文本解析,不执行任何 JS)。"""
    text = config_path.read_text(encoding="utf-8")
    pattern = re.compile(
        r"\{\s*id:\s*'([^']+)'\s*,\s*name:\s*'([^']+)'\s*,\s*prefix:\s*'([^']+)'[^}]*\}"
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


FALLBACK_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def _extract_title(html: str) -> str:
    """requests 兜底路径的 <title> 提取(不去依赖解析库)。"""
    m = re.search(r"<title[^>]*>(.*?)</title>", html or "", re.I | re.S)
    if not m:
        return ""
    title = re.sub(r"<[^>]+>", " ", m.group(1))
    return title.replace("&nbsp;", " ").strip()


def _visible_text(html: str) -> str:
    """requests 兜底路径的可见文本近似:去 script/style、剥标签、压空白。"""
    txt = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html or "", flags=re.I | re.S)
    txt = re.sub(r"<[^>]+>", " ", txt)
    txt = txt.replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", txt).strip()


def _requests_home(home: str, timeout: int):
    """scrapling 缺席时的纯 requests 兜底(CI 轻量依赖路径,省掉浏览器全家桶)。"""
    import requests

    resp = requests.get(
        home, timeout=timeout, allow_redirects=True,
        headers={"User-Agent": FALLBACK_UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5"},
    )
    html = resp.text or ""
    return int(resp.status_code), _extract_title(html), _visible_text(html), str(resp.url)


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
        # 页面可达 ≠ 服务可用:告别页/空壳跳转页都渲染正常,但不再解析
        if any(k in low for k in FAREWELL_MARKERS):
            return "down", "站点已发布告别页(服务关停)"
        if "redirecting" in low and len((text or "").strip()) <= 60:
            return "down", "空壳跳转页(疑似域名停放/易主)"
        if registrable(final_host) != registrable(home_host):
            return "down", f"跳转到其他站点({final_host})"
        return "up", ""
    if code in (401, 403, 429, 503):
        return "blocked", f"HTTP {code}(可能被拦截或限流)"
    return "down", f"HTTP {code}"


def probe(line, timeout, force_stealth=False, use_browser=True):
    """探测一条线路的首页,返回标准化记录;use_browser=False 时只信 HTTP 层结论。"""
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
    except ImportError:
        # scrapling 未安装(CI 轻量路径):退化到 requests 兜底
        try:
            code, title, text, final_url = _requests_home(home, timeout)
        except Exception as exc:
            err = f"{type(exc).__name__}: {exc}"[:200]
    except Exception as exc:  # 网络/库异常都归为连接失败,不留裸堆栈
        err = f"{type(exc).__name__}: {exc}"[:200]

    rec["ms"] = round((time.perf_counter() - t0) * 1000)
    rec["code"] = code or None
    rec["title"] = title
    rec["finalUrl"] = final_url
    status, note = classify(code, title, text, final_url, home)

    # HTTP 层不理想时,用无头浏览器复核一次(能过 Cloudflare 质询、执行 JS 跳转)
    if use_browser and (status != "up" or force_stealth):
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


def badge_color(ratio: float) -> str:
    """可用率 -> shields 徽标颜色:>=75% 绿,>=50% 橙,其余红。"""
    if ratio >= 0.75:
        return "brightgreen"
    if ratio >= 0.5:
        return "orange"
    return "red"


STATUS_MARK = {"up": "🟢 可用", "blocked": "🟡 被拦", "down": "🔴 失效"}


def write_badge(path: Path, alive: int, total: int, date_str: str = "") -> None:
    """写 shields.io endpoint 格式徽标 JSON(https://shields.io/badges/endpoint-badge)。

    message 里带体检日期:静态 JSON 上的徽标不会自己过期,把日期写进文案,
    体检停摆时徽标原地不动但日期一眼可见,配合看门狗工作流兜底。
    """
    message = f"{alive}/{total} 可用"
    if date_str:
        message += f" · {date_str}"
    badge = {
        "schemaVersion": 1,
        "label": "解析线路",
        "message": message,
        "color": badge_color(alive / total if total else 0),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(badge, ensure_ascii=False), encoding="utf-8")


def write_summary_md(path: Path, lines, results, alive: int, total: int, history=None) -> None:
    """写 Markdown 摘要表(按 config.js 线路顺序),供 GitHub Actions 运行摘要展示。"""
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    rows = []
    for ln in lines:
        rec = results.get(ln["id"], {})
        st = rec.get("status")
        mark = STATUS_MARK.get(st, "⚪ 未体检")
        ms = rec.get("ms")
        note = rec.get("note") or ""
        rows.append(f"| {ln['name']} | {mark} | {ms if ms is not None else '-'} | {note} |")
    path.parent.mkdir(parents=True, exist_ok=True)
    lines_out = [
        "# 线路体检摘要\n\n"
        f"- 体检时间:{now}\n"
        f"- 结果:**{alive}/{total} 可用**\n"
        "- 口径:HTTP 层探测(`--no-browser`);GitHub Actions runner 位于海外,"
        "个别国内站点可能因跨境网络差异被判异常,以本地深度体检为准\n"
    ]
    if history:
        recent = history[-7:]
        trend = " → ".join(f"{e.get('alive', 0)}/{e.get('total', 0)}" for e in recent)
        lines_out.append(f"- 趋势(最近 {len(recent)} 次):{trend}\n")
    lines_out += [
        "\n| 线路 | 状态 | 延迟(ms) | 说明 |\n"
        "|---|---|---|---|\n" + "\n".join(rows) + "\n",
    ]
    path.write_text("".join(lines_out), encoding="utf-8")


def append_history(path: Path, checked_at: str, alive: int, total: int, keep: int = 180):
    """追加一条体检记录并裁剪,返回最新历史(文件不存在或损坏则新建)。"""
    history = []
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                history = [e for e in data if isinstance(e, dict)]
        except Exception:
            history = []
    history.append({"checkedAt": checked_at, "alive": alive, "total": total})
    history = history[-keep:]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    return history


ACCENT = "#2dd4bf"  # 与前端 G4「微光磨砂」一致的青蓝强调色


def write_trend_svg(path: Path, history) -> bool:
    """从历史生成可用率迷你趋势曲线 SVG;无数据时返回 False 不写出。"""
    pts = [e for e in history if e.get("total")]
    if not pts:
        return False
    ratios = [e["alive"] / e["total"] for e in pts]
    W, H, PAD = 480, 64, 8
    iw, ih = W - PAD * 2, H - PAD * 2
    n = len(pts)
    if n == 1:  # 单条数据:只在末端画一个点
        coords = [(W - PAD, PAD + (1 - ratios[0]) * ih)]
    else:
        coords = [(PAD + i * iw / (n - 1), PAD + (1 - r) * ih) for i, r in enumerate(ratios)]

    last = pts[-1]
    label = f"{last.get('alive', 0)}/{last['total']}"
    lx, ly = coords[-1]
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        # 50% 基准线
        f'<line x1="{PAD}" y1="{PAD + ih / 2:.0f}" x2="{W - PAD}" y2="{PAD + ih / 2:.0f}" '
        'stroke="#d1d5db" stroke-width="1" stroke-dasharray="3,3"/>',
    ]
    if n >= 2:
        poly = " ".join(f"{x:.1f},{y:.1f}" for x, y in coords)
        area = f"{PAD:.1f},{PAD + ih} " + poly + f" {W - PAD:.1f},{PAD + ih}"
        parts += [
            f'<polygon points="{area}" fill="{ACCENT}" opacity="0.15"/>',
            f'<polyline points="{poly}" fill="none" stroke="{ACCENT}" stroke-width="2" '
            'stroke-linejoin="round" stroke-linecap="round"/>',
        ]
    parts += [
        f'<circle cx="{lx:.1f}" cy="{ly:.1f}" r="3.5" fill="{ACCENT}"/>',
        f'<text x="{W - PAD}" y="{H - 1}" text-anchor="end" font-family="system-ui,sans-serif" '
        f'font-size="11" fill="#6b7280">{label}</text>',
        "</svg>",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(parts), encoding="utf-8")
    return True


def main():
    ap = argparse.ArgumentParser(description="VIP 视频解析 Pro 线路体检(Scrapling)")
    ap.add_argument("--lines", help="自定义线路 JSON 文件(缺省读 js/config.js)")
    ap.add_argument("--timeout", type=int, default=10, help="单站超时秒数,默认 10")
    ap.add_argument("--stealth", action="store_true", help="全部走无头浏览器复核")
    ap.add_argument("--no-browser", action="store_true",
                    help="禁用无头浏览器复核,只走 HTTP 层(CI 用)")
    ap.add_argument("--out-dir", default=str(OUT_DIR), help="快照输出目录")
    ap.add_argument("--badge", help="额外写一个 shields.io 徽标 JSON 到指定路径")
    ap.add_argument("--summary-md", help="额外写一份 Markdown 摘要表到指定路径")
    ap.add_argument("--history", help="体检历史 JSON 文件(追加本次记录,CI 累积趋势用)")
    ap.add_argument("--trend-svg", help="从历史生成可用率趋势曲线 SVG 到指定路径")
    args = ap.parse_args()

    if args.lines:
        lines = json.loads(Path(args.lines).read_text(encoding="utf-8"))
    else:
        lines = parse_config_lines(CONFIG_JS)

    print(f"开始体检 {len(lines)} 条线路(超时 {args.timeout}s)…\n")
    results = {}
    with ThreadPoolExecutor(max_workers=min(8, len(lines))) as pool:
        futs = {
            pool.submit(probe, ln, args.timeout, args.stealth, not args.no_browser): ln
            for ln in lines
        }
        for fut in as_completed(futs):
            rec = fut.result()
            results[rec["id"]] = rec
            mark = {"up": "🟢", "blocked": "🟡", "down": "🔴"}.get(rec["status"], "⚪")
            extra = f" | {rec['note']}" if rec["note"] else ""
            print(f"  {mark} {rec['name']:<10} {rec['status']:<8} {rec['ms']}ms  {rec['homepage']}{extra}")

    snapshot = {
        "checkedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
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

    history = None
    if args.history:
        history = append_history(
            Path(args.history), snapshot["checkedAt"], alive, len(lines)
        )
        print(f"历史已追加 {args.history}(共 {len(history)} 条)")
    if args.badge:
        write_badge(Path(args.badge), alive, len(lines), snapshot["checkedAt"][5:10])
        print(f"徽标已写入 {args.badge}")
    if args.summary_md:
        write_summary_md(Path(args.summary_md), lines, results, alive, len(lines), history)
        print(f"摘要已写入 {args.summary_md}")
    if args.trend_svg:
        svg_path = Path(args.trend_svg)
        data = history
        if data is None:
            src = Path(args.history) if args.history else svg_path.with_name("history.json")
            try:
                loaded = json.loads(src.read_text(encoding="utf-8")) if src.exists() else []
                data = loaded if isinstance(loaded, list) else []
            except Exception:
                data = []
        if write_trend_svg(svg_path, data):
            print(f"趋势曲线已写入 {args.trend_svg}")
        else:
            print("历史数据不足,跳过趋势曲线")


if __name__ == "__main__":
    main()
