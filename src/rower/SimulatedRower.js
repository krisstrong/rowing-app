import { RowerSource } from './RowerSource.js';

const TICK_MS = 100;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Concept2's power/pace relationship: watts = 2.80 / (sec-per-meter)^3. */
function paceToPower(paceSecPer500) {
  const secPerMeter = paceSecPer500 / 500;
  return 2.8 / secPerMeter ** 3;
}

/**
 * Produces plausible fake RowingSamples: ~24 spm, ~2:08/500m pace, a
 * drive/recovery stroke cycle, and slow random-walk drift so numbers feel
 * alive without a rower attached. Lets UI and future scene work happen
 * off the erg.
 */
export class SimulatedRower extends RowerSource {
  #timer = null;
  #elapsedSec = 0;
  #distanceM = 0;
  #strokeCount = 0;
  #calories = 0;
  #strokeRate = 24;
  #paceSecPer500 = 128;
  #cyclePos = 0; // 0..1 within the current stroke cycle
  #dragFactor = 115 + Math.round(Math.random() * 10);
  #heartRate = 132;

  start() {
    if (this.#timer) return;
    this.emit('state', { state: 'connecting', deviceName: 'Simulator', message: 'Starting demo mode…' });
    this.#timer = setInterval(() => this.#tick(), TICK_MS);
    // Let the "connecting" state be visible for a beat, like a real connect would be.
    setTimeout(() => {
      if (this.#timer) {
        this.emit('state', { state: 'connected', deviceName: 'Simulator', message: 'Demo mode running' });
      }
    }, 300);
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.emit('state', { state: 'idle', deviceName: null, message: 'Demo mode stopped' });
  }

  #tick() {
    const dt = TICK_MS / 1000;
    this.#elapsedSec += dt;

    // Slow random-walk drift on rate and pace so it looks like a real row.
    this.#strokeRate = clamp(this.#strokeRate + (Math.random() - 0.5) * 0.3, 20, 28);
    this.#paceSecPer500 = clamp(this.#paceSecPer500 + (Math.random() - 0.5) * 0.4, 118, 140);
    this.#heartRate = clamp(this.#heartRate + (Math.random() - 0.5) * 0.6, 118, 168);

    const cycleSec = 60 / this.#strokeRate;
    const prevPos = this.#cyclePos;
    this.#cyclePos = (this.#cyclePos + dt / cycleSec) % 1;
    if (this.#cyclePos < prevPos) this.#strokeCount += 1; // wrapped around: one stroke completed

    const drivePhaseFraction = 0.35; // drive is the faster ~1/3 of the cycle
    const strokeState = this.#cyclePos < drivePhaseFraction ? 'driving' : 'recovery';

    const speedMps = 500 / this.#paceSecPer500;
    this.#distanceM += speedMps * dt;

    const powerW = paceToPower(this.#paceSecPer500);
    this.#calories += (powerW * dt) / 4.1868 / 0.24; // rough erg calorie approximation

    this.emit('sample', {
      elapsedSec: Math.round(this.#elapsedSec * 100) / 100,
      distanceM: Math.round(this.#distanceM * 10) / 10,
      paceSecPer500: Math.round(this.#paceSecPer500 * 10) / 10,
      speedMps: Math.round(speedMps * 1000) / 1000,
      strokeRate: Math.round(this.#strokeRate),
      powerW: Math.round(powerW),
      heartRate: Math.round(this.#heartRate),
      strokeState,
      strokeCount: this.#strokeCount,
      dragFactor: this.#dragFactor,
      calories: Math.round(this.#calories),
      source: 'simulator',
    });
  }
}
