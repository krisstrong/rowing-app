/**
 * Rate ladder: a pyramid of stroke-rate targets you have to hold, one step at
 * a time, after a short warm-up. The handle is the only input you have while
 * rowing, and rating is the thing you can change instantly — pace lags several
 * strokes behind — so it is the only honest thing to build a game on.
 *
 * You are "in the zone" only when the rating is inside the band AND the power
 * is above a floor that scales with the target. Rate alone is trivially gamed:
 * you can sit at 32 with no pressure on the handle and do less work than a
 * committed 24.
 *
 * Pure logic, no DOM and no rendering, so the scoring can be tested without an
 * erg attached.
 */

/** Builds in, unscored, so the ladder proper starts on a body that is ready. */
export const WARMUP_STEPS = [18, 20, 22];
export const WARMUP_STEP_SECONDS = 60;

/** Up and back down. Rowing the rate back down while tired is the hard half. */
export const LADDER_STEPS = [24, 26, 28, 30, 32, 30, 28, 26, 24];
export const STEP_SECONDS = 90;

/** The PM5 reports rating as a jittering integer, so the band needs slack. */
export const BAND_SPM = 2;

const DEFAULT_WATTS_PER_SPM = 5;
const MIN_WATTS_PER_SPM = 2;
const MAX_WATTS_PER_SPM = 12;

/** Ignore absurd gaps between samples (a pause, or the monitor resetting). */
const MAX_SAMPLE_GAP_SEC = 1;

export const PHASE = { WARMUP: 'warmup', LADDER: 'ladder' };

export const OUT_OF_ZONE = {
  RATE_LOW: 'rateLow',
  RATE_HIGH: 'rateHigh',
  POWER_LOW: 'powerLow',
};

/** Warm-up first, then the scored pyramid, as one flat sequence of steps. */
const SEQUENCE = [
  ...WARMUP_STEPS.map((targetRate) => ({
    targetRate,
    seconds: WARMUP_STEP_SECONDS,
    phase: PHASE.WARMUP,
    scored: false,
  })),
  ...LADDER_STEPS.map((targetRate) => ({
    targetRate,
    seconds: STEP_SECONDS,
    phase: PHASE.LADDER,
    scored: true,
  })),
];

/** Cumulative end time of each step, so steps of different lengths work. */
const STEP_ENDS = SEQUENCE.reduce((ends, step, index) => {
  ends.push((ends[index - 1] ?? 0) + step.seconds);
  return ends;
}, []);

const TOTAL_SECONDS = STEP_ENDS.at(-1);

function stepIndexAt(elapsedSec) {
  const index = STEP_ENDS.findIndex((end) => elapsedSec < end);
  return index === -1 ? SEQUENCE.length : index;
}

export class RateLadder {
  #running = false;
  #finished = false;
  #wattsPerSpm = DEFAULT_WATTS_PER_SPM;

  #elapsedInGameSec = 0;
  #scoredElapsedSec = 0;
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
    this.#scoredElapsedSec = 0;
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

    // Only the ladder proper counts. Scoring the warm-up would inflate the
    // percentage with time spent deliberately taking it easy.
    if (SEQUENCE[this.#stepIndex]?.scored) {
      this.#scoredElapsedSec += delta;
      if (this.#evaluate().inZone) {
        this.#timeInZoneSec += delta;
        this.#stepZoneSec += delta;
      }
    }

    this.#advanceStepIfDue();
  }

  #advanceStepIfDue() {
    const target = stepIndexAt(this.#elapsedInGameSec);
    while (this.#stepIndex < target && this.#stepIndex < SEQUENCE.length) {
      const step = SEQUENCE[this.#stepIndex];
      if (step.scored) {
        this.#results.push({
          targetRate: step.targetRate,
          zoneSec: Math.round(this.#stepZoneSec * 10) / 10,
          zonePercent: Math.round((this.#stepZoneSec / step.seconds) * 100),
        });
      }
      this.#stepZoneSec = 0;
      this.#stepIndex += 1;
    }

    if (this.#stepIndex >= SEQUENCE.length) {
      this.#running = false;
      this.#finished = true;
    }
  }

  #evaluate() {
    const step = SEQUENCE[Math.min(this.#stepIndex, SEQUENCE.length - 1)];
    const bandLow = step.targetRate - BAND_SPM;
    const bandHigh = step.targetRate + BAND_SPM;
    // No floor while warming up — the point is to get loose, not to work.
    const powerFloorW = step.scored ? Math.round(step.targetRate * this.#wattsPerSpm) : 0;

    let reason = null;
    if (this.#rate < bandLow) reason = OUT_OF_ZONE.RATE_LOW;
    else if (this.#rate > bandHigh) reason = OUT_OF_ZONE.RATE_HIGH;
    else if (this.#power < powerFloorW) reason = OUT_OF_ZONE.POWER_LOW;

    return {
      targetRate: step.targetRate,
      phase: step.phase,
      scored: step.scored,
      bandLow,
      bandHigh,
      powerFloorW,
      inZone: reason === null,
      reason,
    };
  }

  get state() {
    const evaluated = this.#evaluate();
    const index = Math.min(this.#stepIndex, SEQUENCE.length - 1);
    const stepStart = index === 0 ? 0 : STEP_ENDS[index - 1];
    const stepsInPhase = SEQUENCE.filter((step) => step.phase === evaluated.phase);
    const firstOfPhase = SEQUENCE.findIndex((step) => step.phase === evaluated.phase);

    return {
      running: this.#running,
      finished: this.#finished,
      ...evaluated,
      rate: this.#rate,
      powerW: this.#power,
      wattsPerSpm: this.#wattsPerSpm,
      stepNumber: index - firstOfPhase + 1,
      stepCount: stepsInPhase.length,
      stepRemainingSec: Math.max(0, STEP_ENDS[index] - this.#elapsedInGameSec),
      totalRemainingSec: Math.max(0, TOTAL_SECONDS - this.#elapsedInGameSec),
      timeInZoneSec: this.#timeInZoneSec,
      zonePercent: this.#scoredElapsedSec > 0
        ? Math.round((this.#timeInZoneSec / this.#scoredElapsedSec) * 100)
        : 0,
      results: this.#results,
    };
  }
}
