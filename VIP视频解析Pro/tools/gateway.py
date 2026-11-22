# -*- coding: utf-8 -*-
"""本地线路网关 —— VIP 视频解析 Pro 的可选增强层

一个只跑在本机的轻量 HTTP 服务,把线路体检从「每天一次的 CI 快照」
升级成「分钟级的常驻管家」:

  - 后台定期体检 js/config.js 里的默认线路(复用 line_checker 的探测与归类)
  - GET  /api/lines   最新体检快照(前端启动后自动拉取,合并进线路状态)
  - GET  /api/best    播放前按需预检:带真实视频地址并发探测全部线路,
                      返回「最快可用」的候选排序,前端免去 8 秒盲等
  - POST /api/report  前端回报播放成功/失败,网关汇总成短期失败记忆
  - GET  /            仪表盘:线路状态表 + 预检测试框

用法(项目根目录下):
  python tools/gateway.py                  # 默认 127.0.0.1:8787,每 5 分钟体检
  python tools/gateway.py --port 8790      # 换端口(记得同步改 js/config.js 的 GATEWAY.base)
  python tools/gateway.py --no-browser     # 体检只走 HTTP 层,不启用无头浏览器复核
  python tools/gateway.py --interval 60    # 体检间隔(秒)
  python tools/gateway.py --allow https://example.com   # 额外放行的 Origin

说明:
  - 网关体检的是 config.js 里的默认线路;页面里后来添加的自定义线路只存在
    于浏览器 localStorage,前端自己的快速体检仍然覆盖它们。
  - 安全边界:默认只监听 127.0.0.1;/api/* 校验 Origin 白名单
    (file:// 的 null、localhost、本站 Pages),其余来源直接 403。
"""

import argparse
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import line_checker  # noqa: E402  (同目录,复用探测/归类)

CONFIG_JS = ROOT / "js" / "config.js"

GATEWAY_VERSION = "gateway/1.0"
PAGES_ORIGIN = "https://cloudy-one1.github.io"
BEST_CACHE_TTL = 90          # /api/best 结果缓存(秒):同一条视频短时间内不重复探测
REPORT_TTL = 30 * 60         # 前端回报的失败记忆有效期(秒),与前端 failMemo 同口径

# ---------- 共享状态(被体检线程与 HTTP 线程读写,一律走 LOCK) ----------
LOCK = threading.Lock()
STATE = {"lines": {}, "checkedAt": None}     # lines: id -> {status, ms, note, via, code, title}
BEST_CACHE = {}                              # 视频url -> {"ts":..., "result": {...}}
REPORTS = {}                                 # lineId -> {"ok":n,"fail":n,"lastFailAt":ts}


def log(msg):
    print("[%s] %s" % (datetime.now().strftime("%H:%M:%S"), msg), flush=True)


# ---------- 探测 ----------
def build_parse_url(line, video_url):
    """与前端 buildParseUrl 同逻辑:支持 {url} 占位符,否则拼接在末尾。"""
    prefix = line["prefix"]
    if "{url}" in prefix:
        return prefix.replace("{url}", quote(video_url, safe=""))
    return prefix + quote(video_url, safe="")


def classify_play(code, title, text):
    """播放页探测结果的归类(比 classify 宽:解析页合法跳转到播放器域是常态,
    不做停放/跳转劫持判定,只认连接失败/CF 拦截/HTTP 状态)。"""
    low = ((title or "") + " " + (text or "")[:4000]).lower()
    if code == 0:
        return "down", "连接失败(超时/DNS/拒连)"
    if any(m in low for m in line_checker.CF_MARKERS):
        return "blocked", "疑似人机验证页(Cloudflare)"
    if 200 <= code < 400:
        return "up", ""
    if code in (401, 403, 429, 503):
        return "blocked", "HTTP %d(可能被拦截或限流)" % code
    return "down", "HTTP %s" % (code or "?")


def probe_parse(line, video_url, timeout):
    """带真实视频地址探测解析页(HTTP-only),返回轻量记录。"""
    target = build_parse_url(line, video_url)
    rec = {"id": line["id"], "name": line["name"], "prefix": line["prefix"],
           "parseUrl": target, "status": "down", "ms": None, "note": ""}
    t0 = time.perf_counter()
    code, title, text = 0, "", ""
    try:
        from scrapling.fetchers import Fetcher
        resp = Fetcher.get(target, timeout=timeout, stealthy_headers=True,
                           follow_redirects=True, retries=1)
        code = int(resp.status)
        title = (resp.css("title::text").get() or "").strip()
        text = line_checker.page_text(resp)
    except Exception as exc:
        rec["note"] = ("%s: %s" % (type(exc).__name__, exc))[:120]
    rec["ms"] = round((time.perf_counter() - t0) * 1000)
    status, note = classify_play(code, title, text)
    rec["status"] = status
    if note:
        rec["note"] = note
    return rec


def sweep(args):
    """一轮后台体检:HTTP 并发探测全部线路;非 up 的再用无头浏览器复核。"""
    lines = line_checker.parse_config_lines(CONFIG_JS)
    results = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(line_checker.probe, l, args.timeout, False, False): l for l in lines}
        for f in as_completed(futs):
            r = f.result()
            results[r["id"]] = r
    rechecked = 0
    if not args.no_browser:
        for l in lines:
            r = results[l["id"]]
            if r["status"] != "up":
                rb = line_checker.probe(l, args.timeout, False, True)  # HTTP 重测 + 浏览器复核
                if rb["via"] == "browser":
                    results[l["id"]] = rb
                    rechecked += 1
    slim = {}
    for k, r in results.items():
        slim[k] = {kk: r[kk] for kk in ("status", "ms", "note", "via", "code") if r.get(kk) is not None}
    checked_at = datetime.now().astimezone().isoformat(timespec="seconds")
    with LOCK:
        STATE["lines"] = slim
        STATE["checkedAt"] = checked_at
    alive = sum(1 for r in results.values() if r["status"] == "up")
    log("体检完成:%d/%d up,浏览器复核 %d 条,耗时 %.1fs"
        % (alive, len(results), rechecked, time.perf_counter() - _T0[0]))


_T0 = [time.perf_counter()]


def sweep_loop(args):
    while True:
        try:
            _T0[0] = time.perf_counter()
            sweep(args)
        except Exception as exc:
            log("体检线程异常:%s: %s" % (type(exc).__name__, exc))
        time.sleep(max(30, args.interval))


# ---------- HTTP ----------
def origin_allowed(origin, extra):
    if not origin:
        return True                      # 同源请求/curl 无 Origin
    if origin == "null":
        return True                      # file:// 打开的页面
    low = origin.lower()
    # 按 hostname 判断本机来源;不用 startswith 前缀匹配,防 http://localhost.evil.com 这类绕过
    try:
        p = urlparse(low)
        host = (p.hostname or "").lower()
    except ValueError:
        return False
    if p.scheme in ("http", "https") and host in ("localhost", "127.0.0.1", "::1"):
        return True
    if low == PAGES_ORIGIN or low.startswith(PAGES_ORIGIN + "/"):
        return True
    return low in extra


class Handler(BaseHTTPRequestHandler):
    server_version = GATEWAY_VERSION
    protocol_version = "HTTP/1.1"
    allow_extra = frozenset()            # main() 里注入

    # -- 基础工具 --
    def log_message(self, fmt, *args):
        log("%s %s" % (self.address_string(), fmt % args))

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin_allowed(origin, self.allow_extra):
            self.send_header("Access-Control-Allow-Origin", origin or "*")
            self.send_header("Vary", "Origin")

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _reject_origin(self):
        origin = self.headers.get("Origin")
        if not origin_allowed(origin, self.allow_extra):
            self._send_json({"ok": False, "error": "Origin 不在白名单"}, 403)
            return True
        return False

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self._cors()
        self.end_headers()

    def _read_body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        raw = self.rfile.read(n) if 0 < n <= 65536 else b""
        try:
            return json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            return None

    # -- 路由 --
    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/":
            self._send_dashboard()
        elif u.path == "/api/lines":
            with LOCK:
                payload = {"gateway": GATEWAY_VERSION, "checkedAt": STATE["checkedAt"],
                           "lines": dict(STATE["lines"]), "reports": dict(REPORTS)}
            self._send_json(payload)
        elif u.path == "/api/best":
            if self._reject_origin():
                return
            video_url = (q.get("url") or [""])[0].strip()
            if not video_url.startswith(("http://", "https://")):
                self._send_json({"ok": False, "error": "缺少合法的 url 参数"}, 400)
                return
            exclude = set(filter(None, (q.get("exclude") or [""])[0].split(",")))
            fresh = (q.get("fresh") or ["0"])[0] == "1"
            with LOCK:
                cached = BEST_CACHE.get(video_url)
                if cached and not fresh and time.time() - cached["ts"] < BEST_CACHE_TTL:
                    self._send_json(cached["result"])
                    return
            result = self._best(video_url, exclude)
            with LOCK:
                BEST_CACHE[video_url] = {"ts": time.time(), "result": result}
            self._send_json(result)
        else:
            self._send_json({"ok": False, "error": "not found"}, 404)

    def do_POST(self):
        u = urlparse(self.path)
        body = self._read_body()   # 先读完请求体再判断,避免拒答后残余字节被当成下一个请求
        if u.path != "/api/report":
            self._send_json({"ok": False, "error": "not found"}, 404)
            return
        if self._reject_origin():
            return
        if body is None:
            self._send_json({"ok": False, "error": "请求体不是合法 JSON"}, 400)
            return
        line_id = str(body.get("lineId") or "")[:64]
        if not line_id:
            self._send_json({"ok": False, "error": "缺少 lineId"}, 400)
            return
        platform = str(body.get("platform") or "")[:24]
        now = time.time()
        with LOCK:
            rec = REPORTS.setdefault(line_id, {"ok": 0, "fail": 0, "lastFailAt": 0, "platforms": {}})
            if body.get("ok"):
                rec["ok"] += 1
            else:
                rec["fail"] += 1
                rec["lastFailAt"] = now
            if platform:   # 平台维度聚合(与前端 lineStats 同口径:全局+平台各一笔)
                plats = rec.setdefault("platforms", {})
                p = plats.setdefault(platform, {"ok": 0, "fail": 0})
                p["ok" if body.get("ok") else "fail"] += 1
            # 顺手清理过期失败记忆与过旧的预检缓存
            for k in [k for k, v in REPORTS.items()
                      if v["lastFailAt"] and now - v["lastFailAt"] > REPORT_TTL and not v["ok"]]:
                REPORTS.pop(k, None)
            for k in [k for k, v in BEST_CACHE.items() if now - v["ts"] > 3600]:
                BEST_CACHE.pop(k, None)
        self._send_json({"ok": True})

    # -- 按需预检 --
    def _best(self, video_url, exclude):
        lines = [l for l in line_checker.parse_config_lines(CONFIG_JS)
                 if l["id"] not in exclude]
        results = []
        if lines:
            with ThreadPoolExecutor(max_workers=10) as ex:
                futs = [ex.submit(probe_parse, l, video_url, self.probe_timeout) for l in lines]
                results = [f.result() for f in as_completed(futs)]
        order = {"up": 0, "blocked": 1, "down": 2}
        results.sort(key=lambda r: (order.get(r["status"], 3), r["ms"] if r["ms"] is not None else 9e9))
        best = next((r for r in results if r["status"] == "up"), None)
        return {"gateway": GATEWAY_VERSION, "url": video_url,
                "checkedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
                "best": best, "candidates": results}

    # -- 仪表盘 --
    def _send_dashboard(self):
        html = DASHBOARD_HTML.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(html)))
        self.end_headers()
        self.wfile.write(html)


DASHBOARD_HTML = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>解析线路网关</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#101418;color:#d5dae2;
       max-width:760px;margin:40px auto;padding:0 16px}
  h1{font-size:20px} h1 small{color:#8a93a3;font-weight:400;font-size:13px}
  table{width:100%;border-collapse:collapse;margin:16px 0;font-size:14px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #232a33}
  th{color:#8a93a3;font-weight:600;font-size:12px}
  .up{color:#2dd4bf}.down{color:#f87171}.blocked{color:#fbbf24}
  .meta{color:#8a93a3;font-size:12px}
  form{display:flex;gap:8px;margin:16px 0}
  input{flex:1;background:#1a2028;border:1px solid #2a323d;color:#d5dae2;border-radius:8px;padding:8px 10px}
  button{background:#2dd4bf;border:none;color:#0c1216;border-radius:8px;padding:8px 14px;cursor:pointer;font-weight:600}
  pre{background:#1a2028;border-radius:8px;padding:10px;font-size:12px;overflow:auto;white-space:pre-wrap}
</style></head><body>
<h1>解析线路网关 <small id="meta"></small></h1>
<form onsubmit="return testBest(event)">
  <input id="u" placeholder="粘贴视频地址,测试 /api/best 预检" size="40">
  <button>预检</button>
</form>
<pre id="out">预检结果会显示在这里</pre>
<table><thead><tr><th>状态</th><th>线路</th><th>延迟</th><th>说明</th><th>回报(ok/fail)</th></tr></thead>
<tbody id="rows"></tbody></table>
<p class="meta" id="checked"></p>
<script>
async function refresh(){
  try{
    const d = await (await fetch('/api/lines',{cache:'no-store'})).json();
    document.getElementById('meta').textContent = d.gateway;
    document.getElementById('checked').textContent = d.checkedAt ? '最近体检:' + d.checkedAt : '尚未完成首轮体检…';
    const order={up:0,blocked:1,down:2,unknown:3};
    const rows=Object.entries(d.lines).sort((a,b)=>(order[a[1].status]??9)-(order[b[1].status]??9));
    document.getElementById('rows').innerHTML = rows.map(([id,s])=>{
      const r=d.reports&&d.reports[id];
      return '<tr><td class="'+s.status+'">'+s.status+'</td><td>'+id+'</td><td>'+(s.ms?s.ms+'ms':'-')+
             '</td><td>'+(s.note||'')+'</td><td class="meta">'+(r?r.ok+'/'+r.fail:'-')+'</td></tr>';
    }).join('') || '<tr><td colspan="5" class="meta">还没有数据</td></tr>';
  }catch(e){ document.getElementById('checked').textContent = '读取失败:'+e; }
  setTimeout(refresh, 15000);
}
async function testBest(ev){
  ev.preventDefault();
  const u=document.getElementById('u').value.trim();
  if(!u) return false;
  document.getElementById('out').textContent='探测中…(全部线路并发,约 2~8 秒)';
  try{
    const d=await (await fetch('/api/best?url='+encodeURIComponent(u)+'&fresh=1',{cache:'no-store'})).json();
    document.getElementById('out').textContent=JSON.stringify(d,null,2);
    refresh();
  }catch(e){ document.getElementById('out').textContent='失败:'+e; }
  return false;
}
refresh();
</script></body></html>
"""


def main():
    ap = argparse.ArgumentParser(description="VIP 视频解析 Pro 本地线路网关")
    ap.add_argument("--host", default="127.0.0.1", help="监听地址(默认仅本机)")
    ap.add_argument("--port", type=int, default=8787, help="监听端口(默认 8787)")
    ap.add_argument("--interval", type=int, default=300, help="后台体检间隔秒数(默认 300)")
    ap.add_argument("--timeout", type=int, default=10, help="首页体检单站超时秒数(默认 10)")
    ap.add_argument("--probe-timeout", type=int, default=7, help="/api/best 预检单站超时秒数(默认 7)")
    ap.add_argument("--no-browser", action="store_true", help="体检不启用无头浏览器复核(更快,但可能保守)")
    ap.add_argument("--allow", action="append", default=[], help="额外放行的 Origin(可重复)")
    args = ap.parse_args()
    Handler.allow_extra = frozenset(o.lower().rstrip("/") for o in args.allow)
    Handler.probe_timeout = args.probe_timeout

    threading.Thread(target=sweep_loop, args=(args,), daemon=True).start()
    try:
        srv = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as exc:
        print("端口 %d 起不来:%s" % (args.port, exc), file=sys.stderr)
        sys.exit(1)
    log("%s 已启动:http://%s:%d/  体检间隔 %ds  浏览器复核:%s"
        % (GATEWAY_VERSION, args.host, args.port, args.interval, "关" if args.no_browser else "开"))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        log("收到 Ctrl+C,退出")


if __name__ == "__main__":
    main()
