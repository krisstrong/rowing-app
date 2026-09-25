# Project Brief: Rowing App (Computer) — v1 "Connect & Display"

## Goal

Build a **browser-based app** that runs on Kris's computer, connects to a **Concept2 rower (PM5 monitor)** over Bluetooth LE using the **Web Bluetooth API**, and shows live rowing data full-screen.

v1 is a proof of concept. There is no 3D scene yet. But the structure must already be the final one: a small **rower data layer** (real PM5 or simulator) that emits samples, and a **UI layer** that only consumes them. Later versions add a three.js lake/river scene beside or in place of the v1 dashboard, without touching the Bluetooth code.

## Target platform

- **Chrome or Microsoft Edge** on Windows or macOS. Web Bluetooth is not supported in Firefox or Safari.
- The computer needs Bluetooth LE (built-in, or a USB Bluetooth dongle).
- Web Bluetooth requires a secure context: `http://localhost` during development, HTTPS when hosted (e.g. GitHub Pages).
- Plain HTML/CSS/JavaScript (ES modules) with **Vite** as the dev server and bundler. No framework needed.

## Architecture

```
┌──────────── rower/ ────────────┐        ┌──────────── ui/ ────────────┐
│ Pm5Connection (Web Bluetooth)  │        │ dashboard.js                │
│   requestDevice / connect /    │──emit──►  renders big numbers,       │
│   notifications / reconnect    │ sample │  stroke phase, status       │
│ pm5Parser.js (pure functions)  │        │                             │
│ SimulatedRower                 │──emit──►  (v2: scene.js via three.js)│
└────────────────────────────────┘        └─────────────────────────────┘
          both implement the same RowerSource interface
```

- **`RowerSource` interface**: `start()`, `stop()`, and event subscriptions `on('sample', fn)` and `on('state', fn)`. Both the real PM5 and the simulator implement it, so the UI can't tell them apart.
- **`Pm5Connection`**: device selection, GATT connection, service discovery, enabling notifications, parsing bytes into a `RowingSample`, and auto-reconnecting on drop. No DOM code.
- **`pm5Parser.js`**: pure functions from `DataView` to plain objects. Unit-tested.
- **`SimulatedRower`**: produces realistic fake samples (stroke rate ~24, pace ~2:10/500m, a stroke cycle with drive/recovery phases). **This is required.** It lets all UI and scene work happen without sitting on the erg.
- **`ui/dashboard.js`**: subscribes to the active source and renders. It knows nothing about Bluetooth.

## PM5 Bluetooth details

Source of truth: Concept2's **"PM5 Bluetooth Smart Communications Interface Definition"** PDF, available from Concept2's developer/SDK pages. **Verify every UUID, byte offset, and scaling factor below against that document before relying on it.** These are starting notes, not gospel.

- Advertised device name starts with `PM5`.
- Base UUID: `CE06xxxx-43E5-11E4-916C-0800200C9A66` (replace `xxxx` with the short ID). Web Bluetooth needs the full lowercase 128-bit UUID strings.
- Rowing service: `0x0030`. Characteristics to subscribe to with `startNotifications()`:
  - `0x0031` **General status**: elapsed time, distance, workout state, rowing state, **stroke state**, drag factor
  - `0x0032` **Additional status 1**: speed, **stroke rate**, heart rate, **current pace**, average pace
  - `0x0033` **Additional status 2**: interval count, **average power**, calories, split data
  - `0x0035` **Stroke data**: drive length/time, recovery time, stroke distance, peak/avg force, stroke count
- `0x0034` **Sample rate** (write): set to the 250 ms or 100 ms option for smooth animation later.
- Multi-byte values are little-endian (Lo, Mid, Hi). Typical scaling: time in 0.01 s, distance in 0.1 m, pace in 0.01 s per 500 m, speed in 0.001 m/s. Confirm each one in the spec.
- Stroke state values (confirm in spec): waiting for min speed, waiting to accelerate, **driving**, dwelling after drive, **recovery**. Expose this, because the future scene uses it to animate oars and boat surge.
- The PM5 generally accepts one app connection at a time. If ErgData or a phone app is connected, the browser won't find it. Show a helpful message when nothing is found.

### Web Bluetooth specifics

- `navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'PM5' }], optionalServices: [<rowing service UUID>, <device info UUID>] })`.
- `requestDevice` **must be called from a user gesture** (the Connect button click), and it opens the browser's device chooser.
- Listen for `gattserverdisconnected` and retry `device.gatt.connect()` with backoff. Show "reconnecting" while doing so.
- Feature-detect `navigator.bluetooth`. If it's missing, show a clear message: "Open this in Chrome or Edge."

### `RowingSample` fields

```json
{
  "elapsedSec": 312.45,
  "distanceM": 1284.3,
  "paceSecPer500": 128.6,
  "speedMps": 3.89,
  "strokeRate": 24,
  "powerW": 165,
  "heartRate": 0,
  "strokeState": "driving",
  "strokeCount": 121,
  "dragFactor": 115,
  "calories": 88,
  "source": "pm5"
}
```

`source` is `"pm5"` or `"simulator"`. Connection state events are `{ state, deviceName, message }`, where `state` is one of `idle | connecting | connected | reconnecting | error | unsupported`.

## v1 UI (dashboard page)

A full-screen layout readable from the rowing seat, a few metres from the screen:

- **Big numbers:** current pace (`m:ss.t /500m`, the hero stat), stroke rate, distance, elapsed time, watts.
- A small stroke-phase indicator showing drive vs recovery, to prove the stroke state is flowing.
- A connection status line, plus buttons: **Connect rower**, **Demo mode** (simulator), and **Full screen** (Fullscreen API).
- **Keyboard shortcuts**, since hands are on the handle: `F` full screen, `D` demo mode, `Esc` exit full screen.
- Request a **Screen Wake Lock** during a session so the display doesn't sleep. Re-acquire it when the tab becomes visible again.
- Style it with the **krisstrong-brand** system: `#0A1428` page background, `#0F1E3D`/`#17284A` panels, `#EAEEF7` text, amber `#F5A623` for the hero pace number, focus rings, and the primary button only. Headings in Space Grotesk, numbers in IBM Plex Mono.

## Project layout

```
rowing-app/
├── index.html
├── src/
│   ├── main.js
│   ├── rower/
│   │   ├── RowerSource.js       # tiny event-emitter base
│   │   ├── Pm5Connection.js
│   │   ├── pm5Parser.js         # pure functions, unit-tested
│   │   ├── pm5Uuids.js
│   │   └── SimulatedRower.js
│   ├── ui/dashboard.js
│   └── styles/{tokens.css, app.css}
├── tests/pm5Parser.test.js      # Vitest
├── package.json
└── README.md                    # run, build, host, troubleshooting
```

## Run & deploy

```
npm install
npm run dev        # http://localhost:5173 (secure context, Web Bluetooth works)
npm test
npm run build      # static files in dist/
```

Optional hosting: publish `dist/` to GitHub Pages (HTTPS), so it's available at a URL without running a dev server.

## Acceptance criteria

- [ ] Opens in Chrome/Edge. In unsupported browsers, it shows a clear message instead of failing silently.
- [ ] **Demo mode** shows smoothly updating fake data with no rower present.
- [ ] **Connect rower** opens the device chooser, finds the PM5, and shows live pace, stroke rate, distance, time, and watts within ~2 seconds of rowing.
- [ ] The stroke-phase indicator visibly alternates drive/recovery in time with actual strokes.
- [ ] Turning the PM5 off mid-session shows "reconnecting," and the app recovers when it's back on.
- [ ] If nothing is found, the app suggests the rower may be connected to another app.
- [ ] Full screen and wake lock work, and the screen stays on through a 30-minute session.
- [ ] `pm5Parser` has Vitest tests using byte arrays built from the spec's examples.
- [ ] The README covers run, build, hosting, and troubleshooting.

## Out of scope for v1 (next steps)

- three.js lake/river scene driven by `distanceM`, `speedMps`, and `strokeState` (v2)
- Scenery, audio, and a pace/ghost boat (v3)
- Saving sessions, routes, and heart-rate straps

## Notes for Claude Code

- Build the **simulator and the dashboard first**, then the Bluetooth layer, so the UI can be verified before the rower is involved.
- Keep parsing in pure functions, separate from Bluetooth event handlers, so it's testable.
- Throttle UI updates to animation frames (`requestAnimationFrame`) and render from the latest sample. Don't re-render on every notification.
- When anything in the PM5 spec disagrees with this brief, the spec wins. Flag the discrepancy.
