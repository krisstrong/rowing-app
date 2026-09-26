/**
 * Rate ladder: a pyramid of stroke-rate targets you have to hold, one step at
 * a time. The handle is the only input you have while rowing, and rating is
 * the thing you can change instantly — pace lags several strokes behind — so
 * it is the only honest thing to build a game on.
 *
 * You are "in the zone" only when the rating is inside the band AND the power
 * is above a floor that scales with the target. Rate alone is trivially gamed:
 * you can sit at 28 with no pressure on the handle and do less work than a
 * committed 20.
 *
 * Pure logic, no DOM and no rendering, so the scoring can be tested without an
 * erg attached.
 */

/**
 * Up and back down, 24 at the ends and 32 at the peak. Rowing the rate back
 * down while tired is the hard half.
 */
export const LADDER_STEPS = [24, 26, 28, 30, 32, 30, 28, 26, 24];
export const STEP_SECONDS = 90;

/** The PM5 reports rating as a jittering integer, so the band needs slack. */
export const BAND_SPM = 2;

const DEFAULT_WATTS_PER_SPM = 5;
const MIN_WATTS_PER_SPM = 2;
const MAX_WATTS_PER_SPM = 12;

/** Ignore absurd gaps between samples (a pause, or the monitor resetting). */
const MAX_SAMPLE_GAP_SEC = 1;

export const OUT_OF_ZONE = {
  RATE_LOW: 'rateLow',
  RATE_HIGH: 'rateHigh',
  POWER_LOW: 'powerLow',
};

export class RateLadder {
  #running = false;
  #finished = false;
  #wattsPerSpm = DEFAULT_WATTS_PER_SPM;

  #elapsedInGameSec = 0;
  #timeInZoneSec = 0;
  #lastSampleElapsedSec = null;
  #stepZoneSec = 0;
  #stepIndex = 0;
  #results = [];

  #rate = 0;
  #power = 0;

  get running() {
    return this.#running;
  }

  get wattsPerSpm() {
    return this.#wattsPerSpm;
  }

  start() {
    this.#running = true;
    this.#finished = false;
    this.#elapsedInGameSec = 0;
    this.#timeInZoneSec = 0;
    this.#stepZoneSec = 0;
    this.#stepIndex = 0;
    this.#results = [];
    this.#lastSampleElapsedSec = null;
  }

  stop() {
    this.#running = false;
    this.#finished = false;
  }

  /** Tunes the power floor to the rower rather than assuming a standard. */
  adjustWattsPerSpm(delta) {
    this.#wattsPerSpm = Math.min(
      MAX_WATTS_PER_SPM,
      Math.max(MIN_WATTS_PER_SPM, Math.round((this.#wattsPerSpm + delta) * 2) / 2),
    );
  }

  applySample(sample) {
    this.#rate = sample.strokeRate;
    this.#power = sample.powerW;

    if (!this.#running) {
      this.#lastSampleElapsedSec = sample.elapsedSec;
      return;
    }

    const previous = this.#lastSampleElapsedSec;
    this.#lastSampleElapsedSec = sample.elapsedSec;
    if (previous === null) return;

    const delta = sample.elapsedSec - previous;
    // Backwards means the monitor reset; too large means we were not watching.
    if (delta <= 0 || delta > MAX_SAMPLE_GAP_SEC) return;

    this.#elapsedInGameSec += delta;
    if (this.#evaluate().inZone) {
      this.#timeInZoneSec += delta;
      this.#stepZoneSec += delta;
    }

    this.#advanceStepIfDue();
  }

  #advanceStepIfDue() {
    const stepsDone = Math.floor(this.#elapsedInGameSec / STEP_SECONDS);
    while (this.#stepIndex < stepsDone && this.#stepIndex < LADDER_STEPS.length) {
      this.#results.push({
        targetRate: LADDER_STEPS[this.#stepIndex],
        zoneSec: Math.round(this.#stepZoneSec * 10) / 10,
        zonePercent: Math.round((this.#stepZoneSec / STEP_SECONDS) * 100),
      });
      this.#stepZoneSec = 0;
      this.#stepIndex += 1;
    }

    if (this.#stepIndex >= LADDER_STEPS.length) {
      this.#running = false;
      this.#finished = true;
    }
  }

  #evaluate() {
    const targetRate = LADDER_STEPS[Math.min(this.#stepIndex, LADDER_STEPS.length - 1)];
    const bandLow = targetRate - BAND_SPM;
    const bandHigh = targetRate + BAND_SPM;
    const powerFloorW = Math.round(targetRate * this.#wattsPerSpm);

    let reason = null;
    if (this.#rate < bandLow) reason = OUT_OF_ZONE.RATE_LOW;
    else if (this.#rate > bandHigh) reason = OUT_OF_ZONE.RATE_HIGH;
    else if (this.#power < powerFloorW) reason = OUT_OF_ZONE.POWER_LOW;

    return { targetRate, bandLow, bandHigh, powerFloorW, inZone: reason === null, reason };
  }

  get state() {
    const evaluated = this.#evaluate();
    const stepElapsed = this.#elapsedInGameSec - this.#stepIndex * STEP_SECONDS;
    const totalSec = LADDER_STEPS.length * STEP_SECONDS;

    return {
      running: this.#running,
      finished: this.#finished,
      ...evaluated,
      rate: this.#rate,
      powerW: this.#power,
      wattsPerSpm: this.#wattsPerSpm,
      stepNumber: Math.min(this.#stepIndex + 1, LADDER_STEPS.length),
      stepCount: LADDER_STEPS.length,
      stepRemainingSec: Math.max(0, STEP_SECONDS - stepElapsed),
      totalRemainingSec: Math.max(0, totalSec - this.#elapsedInGameSec),
      timeInZoneSec: this.#timeInZoneSec,
      zonePercent: this.#elapsedInGameSec > 0
        ? Math.round((this.#timeInZoneSec / this.#elapsedInGameSec) * 100)
        : 0,
      results: this.#results,
    };
  }
}
