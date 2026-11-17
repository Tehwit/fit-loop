# fit-loop
A bikefitting app live through your phone camera.

Put same-coloured stickers on the rider's joints, stand the phone beside the bike on the trainer and pedal. The app follows the stickers through the camera, measures the position over each pedal stroke and suggests one change at a time.

## Use
Open the GitHub Pages address of this repository on the phone, add a rider, then start a live side view. Everything is stored on the phone only (use Export to keep a copy).

## What it does
- Finds the stickers by colour and works out which joint each one is from how it moves (4, 5 or 7 stickers in side view, 4 in front view).
- Notices hidden, swapped or slipping stickers and a phone that is tilted or not square to the bike.
- Measures knee extension and flexion, hip, torso, shoulder and elbow angles, ankle movement and knee over pedal; front view measures knee tracking.
- Gets millimetres from the crank length, so no ruler is needed.
- Saves a check automatically once the measurement is stable, speaks the result, and compares it with the previous check.
- French and English.

## Files
- `index.html`, `style.css`, `app.js` – the app
- `core.js` – detection, tracking and measurement (no browser needed)
- `i18n.js` – texts
- `test/` – `node test/test.js` checks the maths on a synthetic rider; `test/e2e.py` runs the app in headless Chrome with a fake camera

The target ranges are starting values and can be edited per rider. The app has only been tested on synthetic video so far.
