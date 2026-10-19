from pathlib import Path
import os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs"
OUT.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"),
        headless=True,
        args=["--no-sandbox"],
    )
    page = browser.new_page(
        viewport={"width": 1440, "height": 960}, device_scale_factor=1
    )
    errors = []
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.on(
        "console", lambda msg: errors.append(msg.text) if msg.type == "error" else None
    )
    page.set_content((ROOT / "dist/index.html").read_text(), wait_until="load")
    page.wait_for_timeout(4500)
    page.screenshot(path=str(OUT / "01-home.png"), full_page=True)
    print("Home body", page.locator("body").inner_text()[:500])
    page.locator('[data-action="demo-start"]').click()
    page.wait_for_timeout(300)
    page.screenshot(path=str(OUT / "02-agent-plan.png"), full_page=True)
    page.locator('[data-action="approve-run"]').click()
    page.wait_for_timeout(2400)
    page.locator('[data-action="pause-run"]').click()
    page.locator('[data-action="toggle-log"][data-id="0"]').click()
    page.locator(".conversation").evaluate("(el)=>el.scrollTop=el.scrollHeight")
    page.screenshot(path=str(OUT / "03-agent-process.png"), full_page=True)
    page.locator('[data-nav="results"]').first.click()
    page.wait_for_timeout(300)
    page.screenshot(path=str(OUT / "04-results.png"), full_page=True)
    page.locator('[data-nav="data"]').first.click()
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / "05-data.png"), full_page=True)
    page.locator('[data-nav="workflows"]').first.click()
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / "06-workflows.png"), full_page=True)
    page.locator('[data-nav="literature"]').first.click()
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / "07-literature.png"), full_page=True)
    page.locator('[data-nav="tools"]').first.click()
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / "08-tools.png"), full_page=True)
    page.locator('[data-nav="projects"]').first.click()
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / "09-projects.png"), full_page=True)
    mobile = browser.new_page(
        viewport={"width": 390, "height": 844}, device_scale_factor=1
    )
    mobile.set_content((ROOT / "dist/index.html").read_text(), wait_until="load")
    mobile.wait_for_timeout(4500)
    mobile.screenshot(path=str(OUT / "10-mobile.png"), full_page=True)
    print("Errors:", errors)
    print(
        "Desktop overflow",
        page.evaluate("document.documentElement.scrollWidth>innerWidth"),
    )
    print(
        "Mobile overflow",
        mobile.evaluate("document.documentElement.scrollWidth>innerWidth"),
    )
    browser.close()
