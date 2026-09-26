import { describe, it, expect } from 'vitest';
import {
  RateLadder,
  LADDER_STEPS,
  STEP_SECONDS,
  WARMUP_STEPS,
  WARMUP_STEP_SECONDS,
  BAND_SPM,
  OUT_OF_ZONE,
  PHASE,
} from '../src/rateLadder.js';

const sample = (strokeRate, powerW, elapsedSec) => ({ strokeRate, powerW, elapsedSec });

/** Feeds samples at 10Hz for `seconds`, holding a steady rate and power. */
function row(ladder, { rate, power, seconds, startAt = 0 }) {
  const steps = Math.round(seconds * 10);
  for (let i = 0; i <= steps; i += 1) {
    ladder.applySample(sample(rate, power, startAt + i * 0.1));
  }
  return startAt + steps * 0.1;
}

const WARMUP_TOTAL_SEC = WARMUP_STEPS.length * WARMUP_STEP_SECONDS;

/**
 * Rows through the warm-up so a test can get at the scored ladder. Held at a
 * rating valid on both sides of the handover, and with power to spare, so the
 * fraction of a second that spills onto the first ladder step doesn't count
 * against the score and muddy what a test is actually asserting.
 */
function skipWarmup(ladder) {
  const handoverRate = Math.round((WARMUP_STEPS.at(-1) + LADDER_STEPS[0]) / 2);
  return row(ladder, { rate: handoverRate, power: 400, seconds: WARMUP_TOTAL_SEC + 0.5 });
}

/** A ladder already started and sitting on the first scored step. */
function onLadder() {
  const ladder = new RateLadder();
  ladder.start();
  const at = skipWarmup(ladder);
  return { ladder, at };
}

describe('the sequence', () => {
  it('is a pyramid that comes back down', () => {
    const peak = Math.max(...LADDER_STEPS);
    const peakIndex = LADDER_STEPS.indexOf(peak);
    expect(LADDER_STEPS[0]).toBe(LADDER_STEPS.at(-1));
    expect(peakIndex).toBeGreaterThan(0);
    expect(peakIndex).toBeLessThan(LADDER_STEPS.length - 1);
  });

  it('warms up below the lowest ladder target', () => {
    expect(Math.max(...WARMUP_STEPS)).toBeLessThan(Math.min(...LADDER_STEPS));
  });

  it('starts in the warm-up, not on the ladder', () => {
    const ladder = new RateLadder();
    ladder.start();
    ladder.applySample(sample(18, 100, 0));
    const state = ladder.state;
    expect(state.phase).toBe(PHASE.WARMUP);
    expect(state.targetRate).toBe(WARMUP_STEPS[0]);
    expect(state.scored).toBe(false);
  });

  it('reaches the ladder once the warm-up is done', () => {
    const { ladder } = onLadder();
    const state = ladder.state;
    expect(state.phase).toBe(PHASE.LADDER);
    expect(state.targetRate).toBe(LADDER_STEPS[0]);
    expect(state.stepNumber).toBe(1);
    expect(state.stepCount).toBe(LADDER_STEPS.length);
  });
});

describe('the warm-up', () => {
  it('asks for no power at all', () => {
    const ladder = new RateLadder();
    ladder.start();
    ladder.applySample(sample(WARMUP_STEPS[0], 0, 0));
    ladder.applySample(sample(WARMUP_STEPS[0], 0, 0.1));
    expect(ladder.state.powerFloorW).toBe(0);
    expect(ladder.state.inZone).toBe(true);
  });

  it('does not count towards the score', () => {
    const ladder = new RateLadder();
    ladder.start();
    row(ladder, { rate: WARMUP_STEPS[0], power: 400, seconds: WARMUP_STEP_SECONDS / 2 });
    expect(ladder.state.timeInZoneSec).toBe(0);
    expect(ladder.state.zonePercent).toBe(0);
  });

  it('produces no per-step results of its own', () => {
    const { ladder } = onLadder();
    expect(ladder.state.results).toHaveLength(0);
  });
});

describe('zone detection on the ladder', () => {
  it('counts a rating inside the band with enough power', () => {
    const { ladder, at } = onLadder();
    row(ladder, { rate: LADDER_STEPS[0], power: 400, seconds: 1, startAt: at });
    expect(ladder.state.inZone).toBe(true);
    expect(ladder.state.reason).toBe(null);
  });

  it('accepts the edges of the band but not beyond', () => {
    const { ladder, at } = onLadder();
    const target = LADDER_STEPS[0];

    ladder.applySample(sample(target + BAND_SPM, 400, at + 0.1));
    expect(ladder.state.inZone).toBe(true);

    ladder.applySample(sample(target + BAND_SPM + 1, 400, at + 0.2));
    expect(ladder.state.reason).toBe(OUT_OF_ZONE.RATE_HIGH);

    ladder.applySample(sample(target - BAND_SPM - 1, 400, at + 0.3));
    expect(ladder.state.reason).toBe(OUT_OF_ZONE.RATE_LOW);
  });

  it('rejects the right rating pulled too softly', () => {
    const { ladder, at } = onLadder();
    const floor = ladder.state.powerFloorW;
    expect(floor).toBeGreaterThan(0);
    ladder.applySample(sample(LADDER_STEPS[0], floor - 1, at + 0.1));
    expect(ladder.state.inZone).toBe(false);
    expect(ladder.state.reason).toBe(OUT_OF_ZONE.POWER_LOW);
  });

  it('scales the power floor with the target rating', () => {
    const { ladder, at } = onLadder();
    const firstFloor = ladder.state.powerFloorW;
    row(ladder, { rate: LADDER_STEPS[0], power: 400, seconds: STEP_SECONDS + 1, startAt: at });
    expect(LADDER_STEPS[1]).toBeGreaterThan(LADDER_STEPS[0]);
    expect(ladder.state.powerFloorW).toBeGreaterThan(firstFloor);
  });
});

describe('scoring', () => {
  it('accumulates only the time spent in the zone', () => {
    const { ladder, at } = onLadder();
    let now = row(ladder, { rate: LADDER_STEPS[0], power: 400, seconds: 10, startAt: at });
    now = row(ladder, { rate: LADDER_STEPS[0] + 10, power: 400, seconds: 10, startAt: now });
    const state = ladder.state;
    expect(state.timeInZoneSec).toBeGreaterThan(9);
    expect(state.timeInZoneSec).toBeLessThan(11);
    expect(state.zonePercent).toBeGreaterThan(45);
    expect(state.zonePercent).toBeLessThan(55);
  });

  it('measures the percentage against ladder time only, not warm-up time', () => {
    const { ladder, at } = onLadder();
    row(ladder, { rate: LADDER_STEPS[0], power: 400, seconds: 20, startAt: at });
    // Perfect rowing since the ladder began, despite a long unscored warm-up.
    expect(ladder.state.zonePercent).toBe(100);
  });

  it('ignores time while it is not running', () => {
    const ladder = new RateLadder();
    row(ladder, { rate: LADDER_STEPS[0], power: 400, seconds: 10 });
    expect(ladder.state.timeInZoneSec).toBe(0);
  });

  it('does not count a backwards jump when the monitor resets', () => {
    const { ladder, at } = onLadder();
    ladder.applySample(sample(LADDER_STEPS[0], 400, at + 0.1));
    const before = ladder.state.timeInZoneSec;
    ladder.applySample(sample(LADDER_STEPS[0], 400, 0));
    expect(ladder.state.timeInZoneSec).toBe(before);
  });

  it('does not credit a long gap as time rowed', () => {
    const { ladder, at } = onLadder();
    ladder.applySample(sample(LADDER_STEPS[0], 400, at + 0.1));
    const before = ladder.state.timeInZoneSec;
    ladder.applySample(sample(LADDER_STEPS[0], 400, at + 45)); // tab was hidden
    expect(ladder.state.timeInZoneSec).toBe(before);
  });
});

describe('step progression', () => {
  it('moves to the next target after the step duration', () => {
    const { ladder, at } = onLadder();
    expect(ladder.state.targetRate).toBe(LADDER_STEPS[0]);
    row(ladder, { rate: LADDER_STEPS[0], power: 400, seconds: STEP_SECONDS + 1, startAt: at });
    expect(ladder.state.targetRate).toBe(LADDER_STEPS[1]);
    expect(ladder.state.stepNumber).toBe(2);
  });

  it('records a result for each completed ladder step', () => {
    const { ladder, at } = onLadder();
    row(ladder, { rate: LADDER_STEPS[0], power: 400, seconds: STEP_SECONDS + 1, startAt: at });
    const [first] = ladder.state.results;
    expect(first.targetRate).toBe(LADDER_STEPS[0]);
    expect(first.zonePercent).toBeGreaterThan(95);
  });

  it('finishes after the last step and stops running', () => {
    const ladder = new RateLadder();
    ladder.start();
    const total = WARMUP_TOTAL_SEC + STEP_SECONDS * LADDER_STEPS.length;
    row(ladder, { rate: LADDER_STEPS[0], power: 400, seconds: total + 2 });
    const state = ladder.state;
    expect(state.finished).toBe(true);
    expect(state.running).toBe(false);
    expect(state.results).toHaveLength(LADDER_STEPS.length);
    expect(state.totalRemainingSec).toBe(0);
  });
});

describe('the power floor', () => {
  it('can be tuned and stays within sane bounds', () => {
    const ladder = new RateLadder();
    const initial = ladder.wattsPerSpm;
    ladder.adjustWattsPerSpm(0.5);
    expect(ladder.wattsPerSpm).toBe(initial + 0.5);
    ladder.adjustWattsPerSpm(-100);
    expect(ladder.wattsPerSpm).toBeGreaterThanOrEqual(2);
    ladder.adjustWattsPerSpm(100);
    expect(ladder.wattsPerSpm).toBeLessThanOrEqual(12);
  });
});
