#!/usr/bin/env python3
"""위젯 선택 화면에 보이는 미리보기 그림(res/drawable-nodpi/widget_preview.png)을 만듭니다.
render_widget_preview.py 와 같은 계산·같은 치수를 2배(600×680px)로 찍습니다.
"""
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("rp", os.path.join(HERE, "render_widget_preview.py"))
rp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rp)

OUT = os.path.join(os.path.dirname(HERE), "app/src/main/res/drawable-nodpi/widget_preview.png")

body = rp.widget_html(rp.cells_json(300, 340))
html = f"<!doctype html><html><head><meta charset='utf-8'><style>{rp.CSS}\nbody{{padding:0;background:#fff;}}</style></head><body>{body}</body></html>"
page = "/workspace/downloads/_asset.html"
with open(page, "w", encoding="utf-8") as f:
    f.write(html)

from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 300, "height": 340}, device_scale_factor=2)
    pg = ctx.new_page()
    pg.goto("file://" + page)
    pg.wait_for_timeout(300)
    el = pg.query_selector(".widget")
    el.screenshot(path=OUT)
    b.close()
print("wrote", OUT)
