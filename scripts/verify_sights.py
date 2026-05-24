"""Verify Sights.html: load it, look for console errors and broken assets,
scroll through the section to confirm the flipbook advances, and snapshot
each major section."""
import os
import sys
import time
from playwright.sync_api import sync_playwright

OUT_DIR = r"c:\Users\acer\Desktop\Arca\D2\scripts\_verify"
os.makedirs(OUT_DIR, exist_ok=True)
URL = "http://localhost:8765/Sights.html"

console_errors = []
network_failures = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()

    page.on("console", lambda msg:
            console_errors.append(f"[{msg.type}] {msg.text}")
            if msg.type in ("error", "warning") else None)
    page.on("requestfailed", lambda req:
            network_failures.append(f"{req.url} :: {req.failure}"))
    page.on("response", lambda r:
            network_failures.append(f"HTTP {r.status} {r.url}")
            if r.status >= 400 else None)

    page.goto(URL, wait_until="networkidle", timeout=30000)
    time.sleep(1.0)  # let reveal anims settle

    # 1. Top of page (masthead)
    page.screenshot(path=os.path.join(OUT_DIR, "01-masthead.png"), full_page=False)

    # 2. Scroll into the flipbook section, verify canvas + readout change.
    page.evaluate("document.getElementById('scrolly').scrollIntoView()")
    time.sleep(0.6)
    page.screenshot(path=os.path.join(OUT_DIR, "02-scrolly-start.png"), full_page=False)
    readout_start = page.locator("#readoutNum").inner_text()

    # 3. Scroll into the middle of the flipbook.
    page.evaluate("""
      () => {
        const s = document.getElementById('scrolly');
        const vh = window.innerHeight;
        window.scrollTo(0, s.offsetTop + (s.offsetHeight - vh) * 0.5);
      }
    """)
    time.sleep(0.8)
    page.screenshot(path=os.path.join(OUT_DIR, "03-scrolly-mid.png"), full_page=False)
    readout_mid = page.locator("#readoutNum").inner_text()

    # 4. End of the flipbook section.
    page.evaluate("""
      () => {
        const s = document.getElementById('scrolly');
        const vh = window.innerHeight;
        window.scrollTo(0, s.offsetTop + (s.offsetHeight - vh) * 0.98);
      }
    """)
    time.sleep(0.8)
    page.screenshot(path=os.path.join(OUT_DIR, "04-scrolly-end.png"), full_page=False)
    readout_end = page.locator("#readoutNum").inner_text()

    # 5. Process + custom sections.
    page.evaluate("document.getElementById('process').scrollIntoView()")
    time.sleep(0.6)
    page.screenshot(path=os.path.join(OUT_DIR, "05-process.png"), full_page=False)

    page.evaluate("document.getElementById('custom').scrollIntoView()")
    time.sleep(0.6)
    page.screenshot(path=os.path.join(OUT_DIR, "06-custom.png"), full_page=False)

    # 6. End / footer.
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    time.sleep(0.5)
    page.screenshot(path=os.path.join(OUT_DIR, "07-end.png"), full_page=False)

    browser.close()

print(f"Readouts: start={readout_start} mid={readout_mid} end={readout_end}")
print(f"Console errors/warnings ({len(console_errors)}):")
for e in console_errors[:20]:
    print(" ", e)
print(f"Network failures / 4xx-5xx ({len(network_failures)}):")
for e in network_failures[:20]:
    print(" ", e)

# Verify the flipbook actually scrubbed.
def to_int(s):
    try: return int(s)
    except: return -1

if to_int(readout_start) >= to_int(readout_end):
    print("FAIL: readout did not advance with scroll")
    sys.exit(2)

print("OK")
