"""Verify TesterTech.html's new Sights section + nav link."""
import time
from playwright.sync_api import sync_playwright

errors = []
fails = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1600, "height": 1000})
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(f"[{m.type}] {m.text}") if m.type == "error" else None)
    page.on("response", lambda r: fails.append(f"{r.status} {r.url}") if r.status >= 400 else None)

    page.goto("http://localhost:8765/TesterTech.html", wait_until="networkidle")
    time.sleep(0.5)

    # Confirm Sights nav link exists
    sights_link = page.locator(".nav__links a[href='#sights']")
    assert sights_link.count() == 1, "Sights nav link missing"
    print(f"nav link OK; href = {sights_link.get_attribute('href')}")

    # Click the nav link, confirm we scroll to #sights and the section is visible
    sights_link.click()
    time.sleep(0.8)
    page.locator("#sights").screenshot(path=r"c:\Users\acer\Desktop\Arca\D2\scripts\_verify\08-landing-sights.png")

    # Confirm the CTA goes to Sights.html
    btn = page.locator("#sights a.btn--primary")
    href = btn.get_attribute("href")
    print(f"primary CTA href: {href}")
    assert href == "Sights.html", f"unexpected CTA href {href!r}"

    # Click it and confirm we navigate
    btn.click()
    page.wait_for_load_state("networkidle")
    assert "Sights.html" in page.url, f"did not navigate, url={page.url}"
    print(f"navigated to: {page.url}")

    browser.close()

print(f"errors: {len(errors)} | http>=400: {len(fails)}")
for e in errors[:10]: print(" ", e)
for f in fails[:10]: print(" ", f)
print("OK" if not errors and not fails else "ISSUES")
