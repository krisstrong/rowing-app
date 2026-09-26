# Rowing App — v2 "On the Water"

A browser app for a **Concept2 PM5** monitor. It connects over **Web Bluetooth**, puts
you in a boat on a lake at dawn, and floats live pace, stroke rate, distance, elapsed
time and watts over the scene as a HUD you can read from the rowing seat. A built-in
simulator means you can work on the UI and the scene without sitting on the erg.

Your strokes drive the boat: distance scrolls the world, speed shapes the camera, and
the PM5's stroke state swings the oars in time with the handle.

## Requirements

- **Chrome or Microsoft Edge** on Windows or macOS. Web Bluetooth does not exist in
  Firefox or Safari — the app says so instead of failing silently.
- Bluetooth LE on the machine (built-in or a USB dongle).
- A secure context: `http://localhost` in development, HTTPS when hosted.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest unit tests for the PM5 parser
npm run build      # static site in dist/
npm run preview    # serve the built dist/ locally
```

## Using it

| Control | What it does |
| --- | --- |
| **Connect rower** | Opens Chrome's device chooser, filtered to names starting with `PM5` |
| **Demo mode** (`D`) | Runs the simulator — realistic fake data, no rower needed |
| **Pace boat** (`G`) | Drops a ghost boat into the next lane to race; `[` and `]` shift its target pace by a second per 500m |
| **Full screen** (`F`) | Fullscreen API; `Esc` exits |

The app requests a **Screen Wake Lock** while a session is running, and re-acquires it
when you switch back to the tab, so the display doesn't sleep mid-piece.

## Architecture

```
src/rower/                            src/ui/
  RowerSource.js    event-emitter base   dashboard.js    HUD, knows nothing of BLE
  Pm5Connection.js  Web Bluetooth
  pm5Parser.js      pure DataView -> object functions (unit-tested)
  pm5Uuids.js       UUIDs and enums    src/scene/
  SimulatedRower.js fake samples         RowingScene.js  orchestration, camera, loop
                                         water.js        wave shader + CPU mirror
                                         boat.js         hull, oars, rower
                                         river.js        banks, forest, erratics
                                         wildlife.js     loon, heron, deer, turtle
                                         sky.js          gradient dome and sun
                                       src/paceBoat.js   ghost boat gap arithmetic
```

`Pm5Connection` and `SimulatedRower` both implement the same **`RowerSource`** interface —
`start()`, `stop()`, `on('sample', fn)`, `on('state', fn)` — so nothing downstream can
tell them apart. The scene subscribes to that same stream, which is why v2 landed
without a line changing in the Bluetooth layer.

Samples look like this:

```json
{
  "elapsedSec": 312.45, "distanceM": 1284.3, "paceSecPer500": 128.6,
  "speedMps": 3.89, "strokeRate": 24, "powerW": 165, "heartRate": 0,
  "strokeState": "driving", "strokeCount": 121, "dragFactor": 115,
  "calories": 88, "source": "pm5"
}
```

Connection state events are `{ state, deviceName, message }` where `state` is
`idle | connecting | connected | reconnecting | error | unsupported`.

The dashboard stores the latest sample and renders on `requestAnimationFrame`, so a
burst of BLE notifications never causes a burst of re-renders.

### The scene

Three sample fields drive everything you see:

| Field | Drives |
| --- | --- |
| `distanceM` | How far the world has scrolled — buoys and banks recycle against it |
| `speedMps` | Camera pullback and a touch of extra field of view as you wind up |
| `strokeState` | The oar sweep, the blades burying and lifting, and the hull's pitch |

Nothing in the scene actually travels. The boat sits at the origin and the water, buoys
and banks recycle underneath it modulo the course length, so vertex coordinates stay
small no matter how far you row.

Between the PM5's 4 Hz samples the scene integrates `speedMps` and then eases onto the
distance the monitor actually reported, which keeps motion smooth without letting the
world drift away from the real number. Stroke phase is a single 0→1 scalar: the drive
takes 35% of the stroke cycle and the recovery 65%, timed from your actual rating, so
the oars stay in sync with the handle rather than running on a fixed animation.

The water's wave field lives in a vertex shader, and `water.js` mirrors the same maths
on the CPU so the boat and buoys can ride the surface. If you change one, change both.

### The river

The setting is the **Mersey River through Kejimkujik National Park**, Nova Scotia, at
dawn. The details are drawn from Parks Canada's own description of the park rather than
invented:

- **"Mersey tea."** Keji's water is stained brown by tannins leached from the peat bogs
  it drains. So the body of the water is tea-coloured and only the grazing-angle
  reflection is sky — which is why `water.js` uses a tight fresnel lobe.
- **Acadian forest**, weighted to the eastern hemlock and spruce that form the park's
  "pure hemlock stands", with white birch and the occasional red maple for the autumn
  blaze the Mersey is known for. Kept mostly dark on purpose: an orange forest would
  fight the amber pace number for attention.
- **Granite erratics** at the water's edge, over slate and quartzite bedrock.
- **The odd animal** — one per 350 m tile, each where its species actually would be:
  a common loon riding the water, a great blue heron wading the shallows, a
  white-tailed deer on the bank, and a **Blanding's turtle** basking on a half-sunk log.
  The turtle is Keji's signature species — nationally endangered, and the yellow throat
  modelled on it is how you tell one from any other turtle.

The river is built as three tiles that recycle against distance rowed, each with
different content, so the landscape repeats every 1050 m rather than every 350. Trees
and boulders are instanced — about a dozen draw calls for the whole forest.

### The pace boat

`src/paceBoat.js` holds a boat that rows a constant target pace. It is deliberately
neither a `RowerSource` nor part of the scene — it is derived data that the scene and
the HUD both read, which keeps the gap arithmetic unit-testable without a renderer.

Turning it on starts it **level with you**, at whatever pace you are currently pulling,
so "hold this" costs one keystroke. Adjusting the target re-anchors it at its current
position, so it speeds up or slows down from where it is rather than teleporting.

`gapM` is the pace boat's lead: positive means it is ahead of you, negative means you
are up on it. The HUD reads *down* and *up* respectively; the scene turns the same
number into a z offset (ahead is −z) and eases onto it, since samples arrive at 10 Hz
and the scene draws at 60.

`prefers-reduced-motion` flattens the waves and drops the camera's speed effects.

### PM5 protocol notes

From Concept2's *PM5 Bluetooth Smart Communications Interface Definition*. Base UUID
`CE06xxxx-43E5-11E4-916C-0800200C9A66`; rowing service `0x0030`. The app subscribes to
four characteristics and merges them into one sample:

| UUID | Carries |
| --- | --- |
| `0x0031` General status | elapsed time, distance, rowing/stroke state, drag factor |
| `0x0032` Additional status 1 | speed, stroke rate, heart rate, current + average pace |
| `0x0033` Additional status 2 | interval count, average power, calories, split data |
| `0x0035` Stroke data | drive length/time, recovery time, forces, stroke count |

It also writes `0x0034` to request 250 ms samples (the default is 500 ms), which matters
for smooth animation in v2. Multi-byte values are little-endian; time is 0.01 s,
distance 0.1 m, pace 0.01 s/500 m, speed 0.001 m/s, force 0.1 lbs.

Two details worth knowing, both verified against the spec rather than assumed:

- **Heart rate 255 means "no belt"**, not 255 bpm. `pm5Parser` normalises it to `0`.
- **Stroke state** is `0 waitingForMinSpeed, 1 waitingToAccelerate, 2 driving,
  3 dwellingAfterDrive, 4 recovery`. The dashboard shows drive vs everything-else; the
  raw value is passed through on the sample for the future scene to use.

## Hosting

Live at **https://krisstrong.github.io/rowing-app/** — Web Bluetooth needs HTTPS, which
Pages provides, so the PM5 connects from there exactly as it does from localhost.

To publish a change:

```bash
npm run deploy      # builds, then pushes dist/ to the gh-pages branch
```

Pages serves the `gh-pages` branch; `master` holds the source. `vite.config.js` sets
`base` to `/rowing-app/` for builds only, so the dev server stays at the root of
localhost. Renaming the repo would change that path and break the asset URLs.

There's deliberately no GitHub Actions workflow — deploying from the CLI avoids needing
the `workflow` token scope, and this is a one-person project where a manual `npm run
deploy` is less machinery than a pipeline.

## Troubleshooting

**"Web Bluetooth is not available"** — you're in Firefox or Safari. Open it in Chrome or
Edge. Demo mode still works everywhere.

**The chooser is empty / "No PM5 found"** — the PM5 accepts **one app at a time**. Close
ErgData or any phone app that's connected to it. Also check the monitor is awake (pull
the handle) and that Bluetooth is on. On the PM5: *More Options → Drag Factor* etc. keeps
it awake; the monitor sleeps after a few idle minutes.

**It connects but nothing updates** — the PM5 only sends data while the flywheel is
moving. Take a stroke. If it stays at zero, disconnect and reconnect.

**"Lost the connection"** — turning the monitor off mid-session shows *Reconnecting…* and
retries with backoff (0.5 s up to 8 s, seven attempts). Power the PM5 back on and it
recovers on its own. After that it gives up and you press **Connect rower** again.

**Full screen refused** — some embedded or policy-restricted contexts block the
Fullscreen API. Open the page in its own browser window.

**Wake lock doesn't hold** — browsers drop the lock when the tab is hidden and some
refuse it on low battery. The app re-requests it whenever the tab becomes visible again.

**The build warns about chunk size** — that's three.js, about 550 kB raw and ~140 kB
gzipped. Expected; not worth code-splitting for a single-page app.

**The scene is choppy** — it runs at 60fps on modest hardware, but if the GPU is
struggling, the wave plane in `water.js` (`segments`) is the first thing to turn down.

## Not yet

Audio; saved sessions, routes and heart-rate straps. Saved sessions would make the pace
boat much better — racing a previous row rather than a flat target.

The river is currently the only setting. `RowingScene` composes it from `river.js`, so a
second location would be another module of the same shape rather than a rewrite.
