# End-to-end check in headless Chrome with a fake camera playing the synthetic rider.
# usage: python3 test/e2e.py /path/to/side.y4m [outdir]
import sys, subprocess, time, os
from playwright.sync_api import sync_playwright
y4m = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else '/tmp'
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', f'--use-file-for-fake-video-capture={y4m}', '--autoplay-policy=no-user-gesture-required'])
        ctx = b.new_context(viewport={'width': 844, 'height': 390}, device_scale_factor=2, locale='fr-FR')
        pg = ctx.new_page(); errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'ERR_' not in m.text else None)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:8765/index.html'); pg.wait_for_timeout(500)
        pg.screenshot(path=f'{out}/1_home.png', full_page=True)
        pg.fill('#rName', 'Test'); pg.click('#addRider button[type=submit]'); pg.wait_for_timeout(300)
        pg.screenshot(path=f'{out}/2_rider.png', full_page=True)
        pg.click('[data-act=live][data-v=side]'); pg.wait_for_timeout(2500)
        print('status 1:', pg.locator('.hud-status').inner_text())
        bb = pg.locator('#view').bounding_box()
        pg.mouse.click(bb['x'] + 260 / 640 * bb['width'], bb['y'] + 148 / 360 * bb['height'])   # the hip sticker
        pg.wait_for_timeout(1500); print('status 2:', pg.locator('.hud-status').inner_text().replace('\n', ' | '))
        pg.screenshot(path=f'{out}/3_search.png')
        pg.wait_for_selector('.hud-status.good', timeout=40000); pg.wait_for_timeout(1200)
        print('status 3:', pg.locator('.hud-status').inner_text().replace('\n', ' | '))
        for t in pg.locator('.tile').all(): print('  |', t.locator('.tl').inner_text(), t.locator('.tv').inner_text(), '|', t.locator('.tt').inner_text())
        print('next:', pg.locator('.hud-next b').inner_text()); print('warn:', [w.inner_text() for w in pg.locator('.hud-warn p').all()])
        print('fps:', pg.evaluate('document.querySelector("#view").width'), 'px wide')
        pg.screenshot(path=f'{out}/4_live.png')
        pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(1200); pg.screenshot(path=f'{out}/5_live_portrait.png')
        pg.click('[data-act=quit]'); pg.wait_for_timeout(400)
        print('history rows:', pg.locator('.check').count(), '| next change:', pg.locator('.change h2').inner_text())
        pg.screenshot(path=f'{out}/6_rider_after.png', full_page=True)
        pg.click('.check'); pg.wait_for_timeout(300); pg.screenshot(path=f'{out}/7_check.png', full_page=True)
        print('errors:', errs)
        b.close()
finally:
    srv.terminate()
