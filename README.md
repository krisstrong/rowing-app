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
| **Sound** (`S`) | River, hull, oarlocks and the odd loon. Off until you ask — browsers block audio without a gesture anyway |
| **Rate ladder** (`R`) | The game mode: a pyramid of stroke-rate targets to hold. `-` and `=` tune the power floor to your level |
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
                                       src/rateLadder.js game mode scoring
                                       src/audio.js      synthesised sound
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

What makes it read as real water:

- **Planar reflections.** The scene renders a second time from a camera mirrored
  through the waterline, into a reduced-resolution target the water samples by
  *projective texture mapping* — bias × projection × view of the mirrored camera,
  applied to the world position. The wave normal ripples that lookup, which is the
  difference between water and a mirror. Everything below the waterline is clipped out
  of the pass so it can't show through.

  Two traps here, both of which produced reflections detached from the things casting
  them. The mirrored camera needs its **up vector mirrored too** (`up = (0,-1,0)` before
  `lookAt`); mirroring only the eye and target leaves the basis rotated about the view
  axis. And you cannot shortcut the lookup with `gl_FragCoord` screen position — the two
  cameras don't share a screen space, so the reflection slides away from its source. The
  visible symptom was the boat appearing in the water far up the river ahead of itself.
- **Puddles.** At the finish of every drive the blades leave a pair of swirls at their
  reach, and those stay put in the water while the boat pulls away from them. This is
  the detail that says *rowing* rather than *boat with an engine*.
- **Wake and dawn mist**, both deliberately faint. The stern is only a few metres from
  the camera, so a strong wake reads as a grey road; mist you are inside of reads as
  fog, so each band fades out as it comes at you.

- **Shadows**, including on the water. Three's shadow chunks are wired into the custom
  water shader (`lights: true`, merged light uniforms, shadow coordinates built from the
  *displaced* vertex so shadows move with the surface). On water they mostly kill the
  glint rather than darkening the tea, which is how shaded water actually behaves.

The reflection pass doubles the draw calls and still holds 60fps. Shadows are flagged
once per frame with `shadowMap.autoUpdate = false`, otherwise the two passes rebuild the
shadow map twice.

**The sun's position is load-bearing, in two ways.** Its elevation sets how far the bank
trees throw their shadows: too low and they reach clear across the channel and the whole
river sits in shade. And it has to be off the bow rather than dead ahead — rowing
straight into a low sun silhouettes the entire scene. The current angle is a compromise
between those and keeping the sun near the edge of frame where you can see it.

### Rate ladder (game mode)

`src/rateLadder.js`. A pyramid of stroke-rate targets — 24-26-28-30-32 and back down,
90 seconds a step — with a gauge showing the band and where your rating currently sits.
Nothing below 24, so it is a working piece throughout rather than a warm-up that builds.

Three design constraints shaped it:

- **The handle is the only input.** You cannot steer, and the PM5 exposes no per-oar
  data, so anything built on dodging or aiming is impossible. Rating is the one thing
  you control instantly — pace lags several strokes behind — which makes it the only
  honest thing to build a game on.
- **Rate alone is gameable.** You can sit at 28spm with no pressure on the handle and do
  less work than a committed 20. So you are in the zone only when the rating is in band
  *and* the power is above a floor that scales with the target rate. `-` and `=` tune
  that floor (watts per spm) to your level — there is no universal right answer. The
  default of 5W per spm puts it at 120W at rate 24 and 160W at rate 32.
- **The PM5 reports rating as a jittering integer**, so the band is ±2spm. Anything
  tighter feels unfair through no fault of the rower.

Scoring is time in the zone as a percentage, per step and overall. The clock only
advances on plausible sample gaps, so pausing, hiding the tab, or the monitor resetting
its elapsed time can't be used to bank a score.

The pyramid comes back down on purpose: holding a *lower* rate when you are already
tired is the genuinely hard half, and it means the piece ends rowing rather than blown.

The gauge spans 18–36spm — wide enough for the whole ladder plus its bands with a little
air either side. Change `LADDER_STEPS` and the gauge range together, or the bands end up
crammed against an edge.

### Sound

`src/audio.js` synthesises everything through Web Audio — no sample files, so nothing to
download and nothing to licence. A lowpassed noise bed for the river, a bandpassed one
for water against the hull that rises with boat speed, a triangle-wave knock plus a
noise burst for the oarlock and the blades biting at the catch, and a softer pair at the
finish for the release and the seat running up the slide.

The loon is the fussy one: a sine wail that rises, holds and falls, with a 5.5 Hz vibrato
(a steady tone sounds like a theremin, not a bird) and a delay line for the echo across
the water. It calls every 40–95 seconds.

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

Saved sessions, routes and heart-rate straps. Saved sessions would make the pace boat
much better — racing a previous row rather than a flat target.

The river is currently the only setting. `RowingScene` composes it from `river.js`, so a
second location would be another module of the same shape rather than a rewrite.
