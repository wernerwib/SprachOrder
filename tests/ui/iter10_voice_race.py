# Iteration 10 UI test: VoiceRecorderModal quick-reopen race, German error messages, regressions
import base64, re, asyncio

B64 = base64.b64encode(open("/tmp/short1.mp3", "rb").read()).decode()
FAKE = open("/app/tests/ui/iter10_fake_mic.js").read()
LOG = "/var/log/supervisor/backend.err.log"
URL = "https://sprach-order--1c62g48d.preview.emergentagent.com"


def uploads():
    return len([l for l in open(LOG, errors="ignore") if "voice upload from" in l])


async def has(sel):
    return await page.locator(sel).count() > 0


async def wait_idle(timeout=20000):
    await page.wait_for_selector('[data-testid="voice-record-button"], [data-testid="voice-error-text"]', timeout=timeout)


errors_seen = []
page.on("console", lambda m: errors_seen.append(m.text) if ("error" in m.text.lower() or "Cannot" in m.text) else None)

try:
    await page.set_viewport_size({"width": 375, "height": 667})
    await page.context.grant_permissions(["microphone"], origin=URL)
    await page.add_init_script(f"window.__mp3b64='{B64}';")
    await page.add_init_script(FAKE)
    await page.goto(URL, wait_until="networkidle")
    await page.wait_for_selector('[data-testid="login-username-input"]', timeout=20000)
    await page.fill('[data-testid="login-username-input"]', "kellner1")
    await page.fill('[data-testid="login-password-input"]', "Kellner123!")
    await page.click('[data-testid="login-submit-button"]', force=True)
    await page.wait_for_selector('[data-testid="table-tile-7"]', timeout=20000)
    await page.click('[data-testid="table-tile-7"]', force=True)
    await page.wait_for_selector('[data-testid^="menu-add-"]', timeout=15000)
    await page.locator('[data-testid^="menu-add-"]').first.click(force=True)
    await page.wait_for_selector('[data-testid="draft-mic-0"]', timeout=5000)
    print("SETUP OK")

    # ---- Test A: quick reopen race (record, stop, cancel ~300ms, reopen + record within ~1s)
    for variant, reopen_delay, rec_delay in (("A1 fast", 150, 100), ("A2 ~1s", 400, 450)):
        before = uploads()
        await page.click('[data-testid="draft-mic-0"]', force=True)
        await page.wait_for_selector('[data-testid="voice-record-button"]', timeout=5000)
        await page.evaluate("window.__fakeMode='speech'")
        await page.click('[data-testid="voice-record-button"]', force=True)
        await page.wait_for_selector('[data-testid="voice-stop-button"]', timeout=8000)
        await page.wait_for_timeout(500)
        await page.click('[data-testid="voice-stop-button"]', force=True)
        await page.wait_for_timeout(300)
        up = await has('[data-testid="voice-uploading"]')
        await page.click('[data-testid="voice-cancel-button"]', force=True)
        await page.wait_for_timeout(reopen_delay)
        await page.click('[data-testid="draft-mic-0"]', force=True)
        await page.wait_for_selector('[data-testid="voice-record-button"]', timeout=5000)
        await page.wait_for_timeout(rec_delay)
        await page.click('[data-testid="voice-record-button"]', force=True)
        err_during = None
        for _ in range(12):
            await page.wait_for_timeout(150)
            if await has('[data-testid="voice-error-text"]'):
                err_during = await page.locator('[data-testid="voice-error-text"]').inner_text()
                break
        body = await page.inner_text("body")
        rec_ok = await has('[data-testid="voice-stop-button"]')
        print(f"{variant}: uploading-shown-before-cancel={up} error={err_during!r} english_in_body={'Cannot start' in body} recording={rec_ok}")
        if rec_ok:
            await page.wait_for_timeout(1000)
            await page.click('[data-testid="voice-stop-button"]', force=True)
            await wait_idle()
        err = await page.locator('[data-testid="voice-error-text"]').inner_text() if await has('[data-testid="voice-error-text"]') else None
        val = await page.input_value('[data-testid="voice-note-text-input"]')
        await page.wait_for_timeout(1500)
        after = uploads()
        print(f"{variant}: transcript={val!r} error_after={err!r} new_uploads={after-before} (expected 1)")
        lines = [l.strip()[:200] for l in open(LOG, errors="ignore") if "voice upload from" in l][-(after - before or 1):]
        print("   log:", lines)
        await page.screenshot(path=f".screenshots/iter10_{variant[:2]}.jpeg", quality=40, full_page=False)
        # Test B (regression): save to draft-note-0
        await page.click('[data-testid="voice-save-button"]', force=True)
        await page.wait_for_timeout(500)
        note = await page.locator('[data-testid="draft-note-0"]').inner_text() if await has('[data-testid="draft-note-0"]') else None
        print(f"{variant}: draft-note-0={note!r}")

    # ---- Test C (regression): silent recording -> voice-no-text-notice
    before = uploads()
    await page.click('[data-testid="draft-mic-0"]', force=True)
    await page.wait_for_selector('[data-testid="voice-record-button"]', timeout=5000)
    await page.evaluate("window.__fakeMode='noise'")
    await page.click('[data-testid="voice-record-button"]', force=True)
    await page.wait_for_selector('[data-testid="voice-stop-button"]', timeout=8000)
    await page.wait_for_timeout(1600)
    await page.click('[data-testid="voice-stop-button"]', force=True)
    await wait_idle()
    await page.wait_for_timeout(500)
    notice = await page.locator('[data-testid="voice-no-text-notice"]').inner_text() if await has('[data-testid="voice-no-text-notice"]') else None
    print(f"C silent: notice={notice!r} attached={await has('[data-testid=voice-attached]')} uploads={uploads()-before}")
    await page.screenshot(path=".screenshots/iter10_C.jpeg", quality=40, full_page=False)
    await page.click('[data-testid="voice-cancel-button"]', force=True)
    await page.wait_for_timeout(600)

    # ---- Test D (regression): cancel right after stop -> no upload
    before = uploads()
    await page.click('[data-testid="draft-mic-0"]', force=True)
    await page.wait_for_selector('[data-testid="voice-record-button"]', timeout=5000)
    await page.evaluate("window.__fakeMode='speech'")
    await page.click('[data-testid="voice-record-button"]', force=True)
    await page.wait_for_selector('[data-testid="voice-stop-button"]', timeout=8000)
    await page.wait_for_timeout(1000)
    await page.click('[data-testid="voice-stop-button"]', force=True)
    await page.wait_for_timeout(300)
    await page.click('[data-testid="voice-cancel-button"]', force=True)
    await page.wait_for_timeout(5000)
    note = await page.locator('[data-testid="draft-note-0"]').inner_text() if await has('[data-testid="draft-note-0"]') else None
    print(f"D cancel-after-stop: modal_open={await has('[data-testid=voice-recorder-modal]')} new_uploads={uploads()-before} (expected 0) draft-note-0={note!r}")

    # ---- Test E1: non-server error (network failure) -> German generic message
    await page.route("**/api/voice-notes", lambda r: r.abort())
    await page.click('[data-testid="draft-mic-0"]', force=True)
    await page.wait_for_selector('[data-testid="voice-record-button"]', timeout=5000)
    await page.click('[data-testid="voice-record-button"]', force=True)
    await page.wait_for_selector('[data-testid="voice-stop-button"]', timeout=8000)
    await page.wait_for_timeout(1000)
    await page.click('[data-testid="voice-stop-button"]', force=True)
    await wait_idle()
    e1 = await page.locator('[data-testid="voice-error-text"]').inner_text() if await has('[data-testid="voice-error-text"]') else None
    print(f"E1 network error message: {e1!r}")
    await page.screenshot(path=".screenshots/iter10_E1.jpeg", quality=40, full_page=False)
    await page.unroute("**/api/voice-notes")
    # ---- Test E2: server detail message is shown as-is (server 400 replayed)
    async def fake400(route):
        await route.fulfill(status=400, content_type="application/json",
                            body='{"detail":"Es kam kein Ton an – bitte Mikrofon prüfen und erneut aufnehmen."}')
    await page.route("**/api/voice-notes", fake400)
    if await has('[data-testid="voice-retry-button"]'):
        await page.click('[data-testid="voice-retry-button"]', force=True)
    await page.wait_for_selector('[data-testid="voice-record-button"]', timeout=5000)
    await page.click('[data-testid="voice-record-button"]', force=True)
    await page.wait_for_selector('[data-testid="voice-stop-button"]', timeout=8000)
    await page.wait_for_timeout(1000)
    await page.click('[data-testid="voice-stop-button"]', force=True)
    await wait_idle()
    e2 = await page.locator('[data-testid="voice-error-text"]').inner_text() if await has('[data-testid="voice-error-text"]') else None
    print(f"E2 server detail message: {e2!r}")
    await page.unroute("**/api/voice-notes")
    await page.click('[data-testid="voice-cancel-button"]', force=True)
    print("console errors:", [e[:160] for e in errors_seen][:10])
except Exception as e:
    print("TEST ERROR:", e)
    await page.screenshot(path=".screenshots/iter10_err.jpeg", quality=40, full_page=False)
    print("console errors:", [e[:160] for e in errors_seen][:10])
