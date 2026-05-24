"""Confirm the title is centered and sparkles render in the masthead."""
import time
from playwright.sync_api import sync_playwright

errors = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1600, "height": 1000})
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(f"[{m.type}] {m.text}") if m.type == "error" else None)

    page.goto("http://localhost:8765/Sights.html", wait_until="networkidle")
    time.sleep(1.5)  # let reveal animation finish + sparkles spawn

    title = page.locator(".masthead__title")
    box = title.bounding_box()
    vw = page.evaluate("window.innerWidth")
    center_offset = abs((box["x"] + box["width"] / 2) - vw / 2)
    print(f"title bounding box: x={box['x']:.1f} w={box['width']:.1f}  viewport center={vw/2:.1f}")
    print(f"title center offset from viewport center: {center_offset:.1f}px")

    sparkle_count = page.locator(".masthead__title .sparkle").count()
    print(f"sparkle count: {sparkle_count}")

    text_align = page.evaluate("getComputedStyle(document.querySelector('.masthead__title')).textAlign")
    print(f"text-align: {text_align}")

    page.locator(".masthead").screenshot(
        path=r"c:\Users\acer\Desktop\Arca\D2\scripts\_verify\09-sparkles-masthead.png"
    )
    browser.close()

print(f"console errors: {len(errors)}")
for e in errors[:10]: print(" ", e)

ok = (
    center_offset < 60  # centered within 60px of viewport center
    and sparkle_count == 14
    and text_align == "center"
    and not errors
)
print("OK" if ok else "ISSUES")
