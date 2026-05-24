"""Verify both flipbooks (Sagrada + Eiffel) scrub independently and don't error."""
import time
from playwright.sync_api import sync_playwright

errors = []
fails = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_context(viewport={"width": 1600, "height": 1000}).new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(f"[{m.type}] {m.text}") if m.type == "error" else None)
    page.on("response", lambda r: fails.append(f"{r.status} {r.url}") if r.status >= 400 else None)

    page.goto("http://localhost:8765/Sights.html", wait_until="networkidle")
    time.sleep(1.0)

    # Confirm CTA row is centered
    cta = page.locator(".masthead__cta-row")
    jc = page.evaluate("getComputedStyle(document.querySelector('.masthead__cta-row')).justifyContent")
    print(f"masthead CTA justify-content: {jc}")

    def scrub(section_id, label):
        # Scroll to top of section
        page.evaluate(f"document.getElementById('{section_id}').scrollIntoView()")
        time.sleep(0.6)
        start = page.locator(f"#{section_id} [data-readout]").inner_text()

        # Mid
        page.evaluate(f"""
          () => {{
            const s = document.getElementById('{section_id}');
            const vh = window.innerHeight;
            window.scrollTo(0, s.offsetTop + (s.offsetHeight - vh) * 0.5);
          }}
        """)
        time.sleep(0.7)
        mid = page.locator(f"#{section_id} [data-readout]").inner_text()

        # End
        page.evaluate(f"""
          () => {{
            const s = document.getElementById('{section_id}');
            const vh = window.innerHeight;
            window.scrollTo(0, s.offsetTop + (s.offsetHeight - vh) * 0.98);
          }}
        """)
        time.sleep(0.7)
        end = page.locator(f"#{section_id} [data-readout]").inner_text()

        page.locator(f"#{section_id}").screenshot(
            path=rf"c:\Users\acer\Desktop\Arca\D2\scripts\_verify\11-{label}.png"
        )
        return start, mid, end

    s1 = scrub("scrolly", "sagrada")
    s2 = scrub("eiffel",  "eiffel")
    print(f"sagrada readouts: start={s1[0]} mid={s1[1]} end={s1[2]}")
    print(f"eiffel  readouts: start={s2[0]} mid={s2[1]} end={s2[2]}")

    # Confirm no inter-section coupling: scrub eiffel and confirm sagrada readout didn't change
    page.evaluate("document.getElementById('scrolly').scrollIntoView()")
    time.sleep(0.4)
    sagrada_at_start = page.locator("#scrolly [data-readout]").inner_text()
    page.evaluate("""
      () => {
        const s = document.getElementById('eiffel');
        const vh = window.innerHeight;
        window.scrollTo(0, s.offsetTop + (s.offsetHeight - vh) * 0.5);
      }
    """)
    time.sleep(0.6)
    sagrada_after_eiffel = page.locator("#scrolly [data-readout]").inner_text()
    print(f"sagrada readout at start: {sagrada_at_start} | after eiffel scroll: {sagrada_after_eiffel}")

    # Snapshot the field divider too
    page.evaluate("document.querySelector('.field-divider').scrollIntoView({block:'center'})")
    time.sleep(0.6)
    page.locator(".field-divider").screenshot(
        path=r"c:\Users\acer\Desktop\Arca\D2\scripts\_verify\12-divider.png"
    )

    # And the centered masthead CTAs
    page.evaluate("window.scrollTo(0, 0)")
    time.sleep(0.4)
    page.locator(".masthead").screenshot(
        path=r"c:\Users\acer\Desktop\Arca\D2\scripts\_verify\13-masthead-centered.png"
    )

    browser.close()

print(f"console errors: {len(errors)} | http>=400: {len(fails)}")
for e in errors[:10]: print(" ", e)
for f in fails[:10]: print(" ", f)

ok = (
    jc == "center"
    and int(s1[0]) < int(s1[2])  # sagrada advances
    and int(s2[0]) < int(s2[2])  # eiffel advances
    and not errors
    and not fails
)
print("OK" if ok else "ISSUES")
