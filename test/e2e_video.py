# Video mode end to end in headless Chrome: pick a video, tap a sticker for the colour, name each sticker, analyse, save.
# usage: python3 test/e2e_video.py video.mp4 poses.json [outdir]   (poses.json: sticker positions at t = 2 s, in video pixels)
import sys, json, subprocess, time, os
from playwright.sync_api import sync_playwright
video, poses = sys.argv[1], json.load(open(sys.argv[2])); out = sys.argv[3] if len(sys.argv) > 3 else '/tmp'
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8766', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--autoplay-policy=no-user-gesture-required'])
        pg = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, locale='fr-FR').new_page(); errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'ERR_' not in m.text else None)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:8766/index.html'); pg.wait_for_timeout(400)
        pg.fill('#rName', 'Test'); pg.click('#addRider button[type=submit]'); pg.wait_for_timeout(300)
        pg.screenshot(path=f'{out}/v1_rider.png', full_page=True)
        pg.set_input_files('#fileVideoPick', video)
        pg.wait_for_selector('#vCanvas', timeout=20000); pg.wait_for_timeout(1500)
        def tap(x, y):
            bb = pg.locator('#vCanvas').bounding_box(); w = pg.evaluate("document.querySelector('#vCanvas').width"); h = pg.evaluate("document.querySelector('#vCanvas').height")
            pg.mouse.click(bb['x'] + x / w * bb['width'], bb['y'] + y / h * bb['height']); pg.wait_for_timeout(200)
        if poses.get('_t0') is not None:
            pg.evaluate("v => { const s = document.querySelector('#vSlider'); s.value = v; s.dispatchEvent(new Event('input', {bubbles: true})); s.dispatchEvent(new Event('change', {bubbles: true})); }", poses['_t0']); pg.wait_for_timeout(2500)
        print('prompt:', pg.locator('.prompt').inner_text())
        tap(*poses['knee'])
        print('prompt:', pg.locator('.prompt').inner_text(), '|', pg.locator('.sheet p.muted').last.inner_text()[:60])
        for l in ['hip', 'knee', 'ankle', 'foot', 'shoulder', 'elbow', 'wrist']: tap(poses[l][0] + 2, poses[l][1] - 1)
        print('prompt:', pg.locator('.prompt').inner_text())
        pg.screenshot(path=f'{out}/v2_named.png', full_page=True)
        pg.click('[data-act=vRun]')
        pg.wait_for_selector('h1:has-text("Position mesurée"), h1:has-text("Pas assez")', timeout=240000); pg.wait_for_timeout(1500)
        print('result:', pg.locator('h1').inner_text(), '|', pg.locator('.eyebrow').first.inner_text())
        for m in pg.locator('.metric').all(): print('  |', m.locator('.name').inner_text(), m.locator('.val').inner_text(), m.locator('.pill').inner_text())
        print('coverage:', [c.inner_text() for c in pg.locator('.chip').all()])
        print('next:', pg.locator('.change h2').inner_text() if pg.locator('.change h2').count() else None, '| warnings:', [w.inner_text() for w in pg.locator('.warn p').all()])
        pg.screenshot(path=f'{out}/v3_result.png', full_page=True)
        pg.click('[data-act=vSave]'); pg.wait_for_timeout(500)
        print('history rows:', pg.locator('.check').count())
        pg.screenshot(path=f'{out}/v4_rider_after.png', full_page=True)
        print('errors:', errs)
        b.close()
finally:
    srv.terminate()
