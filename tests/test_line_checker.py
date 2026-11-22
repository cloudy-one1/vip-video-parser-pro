# -*- coding: utf-8 -*-
"""line_checker 纯逻辑单测:归类启发式 + config.js 文本解析 + 徽标分档。
CI 里由 `python -m unittest discover -s tests` 执行,零第三方依赖。
"""
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1] / "VIP视频解析Pro" / "tools"
sys.path.insert(0, str(TOOLS))

from line_checker import badge_color, classify, parse_config_lines, registrable  # noqa: E402

HOME = "https://jx.example.com/"


class ClassifyTests(unittest.TestCase):
    def test_connection_failure(self):
        status, note = classify(0, "", "", HOME, HOME)
        self.assertEqual(status, "down")
        self.assertIn("连接失败", note)

    def test_cloudflare_challenge(self):
        status, _ = classify(200, "Just a moment...", "", HOME, HOME)
        self.assertEqual(status, "blocked")

    def test_nginx_403_page(self):
        text = "<hr>403 Forbidden<p>nginx</p>"
        status, note = classify(200, "", text, HOME, HOME)
        self.assertEqual(status, "down")
        self.assertIn("403", note)

    def test_parking_page(self):
        status, note = classify(200, "", "domain for sale, buy this domain", HOME, HOME)
        self.assertEqual(status, "down")
        self.assertIn("停放", note)

    def test_farewell_page(self):
        status, note = classify(200, "", "江湖路远，后会无期。此去一别，望君珍重。", HOME, HOME)
        self.assertEqual(status, "down")
        self.assertIn("告别页", note)

    def test_redirect_shell(self):
        status, note = classify(200, "", "Redirecting", HOME, HOME)
        self.assertEqual(status, "down")
        self.assertIn("空壳", note)

    def test_cross_domain_redirect(self):
        status, note = classify(200, "播放器", "正文内容足够长一些。", "https://elsewhere.org/", HOME)
        self.assertEqual(status, "down")
        self.assertIn("跳转", note)

    def test_http_403_blocked(self):
        self.assertEqual(classify(403, "", "", HOME, HOME)[0], "blocked")

    def test_http_404_down(self):
        self.assertEqual(classify(404, "", "", HOME, HOME)[0], "down")

    def test_healthy_up(self):
        status, note = classify(200, "解析播放器", "这是一个内容正常的页面，字数远超一行判断阈值。", HOME, HOME)
        self.assertEqual(status, "up")
        self.assertEqual(note, "")


class ParseConfigTests(unittest.TestCase):
    def test_parse_with_extra_fields(self):
        """config.js 条目带 up 家族字段后仍能解析(向前兼容)。"""
        src = (
            "window.DEFAULT_LINES = [\n"
            "  { id: 'lxyy', name: 'LXYY解析', prefix: 'https://a.example/?url=', up: 'lx' },\n"
            "  { id: 'b', name: 'B线', prefix: 'https://b.example/?url=' },\n"
            "]\n"
        )
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as fh:
            fh.write(src)
            path = fh.name
        try:
            lines = parse_config_lines(Path(path))
        finally:
            Path(path).unlink(missing_ok=True)
        self.assertEqual([l["id"] for l in lines], ["lxyy", "b"])
        self.assertEqual(lines[0]["prefix"], "https://a.example/?url=")
        self.assertEqual(lines[0]["name"], "LXYY解析")

    def test_empty_config_raises(self):
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as fh:
            fh.write("window.DEFAULT_LINES = [];")
            path = fh.name
        try:
            with self.assertRaises(SystemExit):
                parse_config_lines(Path(path))
        finally:
            Path(path).unlink(missing_ok=True)


class MiscTests(unittest.TestCase):
    def test_registrable(self):
        self.assertEqual(registrable("a.b.example.com"), "example.com")
        self.assertEqual(registrable("localhost"), "localhost")

    def test_badge_color(self):
        self.assertEqual(badge_color(0.9), "brightgreen")
        self.assertEqual(badge_color(0.6), "orange")
        self.assertEqual(badge_color(0.1), "red")


if __name__ == "__main__":
    unittest.main()
