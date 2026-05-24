"""Quick re-check: full-page screenshot of the process grid at 1600 viewport."""
import time
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1600, "height": 1000})
    page = ctx.new_page()
    page.goto("http://localhost:8765/Sights.html", wait_until="networkidle")
    time.sleep(0.5)
    el = page.locator("#process")
    el.scroll_into_view_if_needed()
    time.sleep(1.2)  # let reveal anims finish
    page.locator("#process").screenshot(path=r"c:\Users\acer\Desktop\Arca\D2\scripts\_verify\05b-process-full.png")
    count = page.locator("#process .pstep").count()
    print(f"pstep count: {count}")
    browser.close()
