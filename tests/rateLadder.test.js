import { describe, it, expect } from 'vitest';
import { RateLadder, LADDER_STEPS, STEP_SECONDS, BAND_SPM, OUT_OF_ZONE } from '../src/rateLadder.js';

const sample = (strokeRate, powerW, elapsedSec) => ({ strokeRate, powerW, elapsedSec });

/** Feeds samples at 10Hz for `seconds`, holding a steady rate and power. */
function row(ladder, { rate, power, seconds, startAt = 0 }) {
  const steps = Math.round(seconds * 10);
  for (let i = 0; i <= steps; i += 1) {
    ladder.applySample(sample(rate, power, startAt + i * 0.1));
  }
  return startAt + steps * 0.1;
}

describe('the ladder itself', () => {
  it('is a pyramid that comes back down', () => {
    const peak = Math.max(...LADDER_STEPS);
    const peakIndex = LADDER_STEPS.indexOf(peak);
    expect(LADDER_STEPS[0]).toBe(LADDER_STEPS.at(-1));
    expect(peakIndex).toBeGreaterThan(0);
    expect(peakIndex).toBeLessThan(LADDER_STEPS.length - 1);
  });
});

describe('zone detection', () => {
  it('is out of the zone before it starts', () => {
    const ladder = new RateLadder();
    expect(ladder.state.running).toBe(false);
  });

  it('counts a rating inside the band with enough power', () => {
    const ladder = new RateLadder();
    ladder.start();
    ladder.applySample(sample(LADDER_STEPS[0], 400, 0));
    ladder.applySample(sample(LADDER_STEPS[0], 400, 0.1));
    expect(ladder.state.inZone).toBe(true);
    expect(ladder.state.reason).toBe(null);
  });

  it('accepts the edges of the band but not beyond', () => {
    const ladder = new RateLadder();
    ladder.start();
    const target = LADDER_STEPS[0];

    ladder.applySample(sample(target + BAND_SPM, 300, 0));
    expect(ladder.state.inZone).toBe(true);

    ladder.applySample(sample(target + BAND_SPM + 1, 300, 0.1));
    expect(ladder.state.inZone).toBe(false);
    expect(ladder.state.reason).toBe(OUT_OF_ZONE.RATE_HIGH);

    ladder.applySample(sample(target - BAND_SPM - 1, 300, 0.2));
    expect(ladder.state.reason).toBe(OUT_OF_ZONE.RATE_LOW);
  });

  it('rejects the right rating pulled too softly', () => {
    const ladder = new RateLadder();
    ladder.start();
    const floor = ladder.state.powerFloorW;
    ladder.applySample(sample(LADDER_STEPS[0], floor - 1, 0));
    ladder.applySample(sample(LADDER_STEPS[0], floor - 1, 0.1));
    expect(ladder.state.inZone).toBe(false);
    expect(ladder.state.reason).toBe(OUT_OF_ZONE.POWER_LOW);
  });

  it('scales the power floor with the target rating', () => {
    const ladder = new RateLadder();
    ladder.start();
    const firstFloor = ladder.state.powerFloorW;
    row(ladder, { rate: LADDER_STEPS[0], power: 400, seconds: STEP_SECONDS + 1 });
    const secondFloor = ladder.state.powerFloorW;
    expect(LADDER_STEPS[1]).toBeGreaterThan(LADDER_STEPS[0]);
    expect(secondFloor).toBeGreaterThan(firstFloor);
  });
});

describe('scoring', () => {
  it('accumulates only the time spent in the zone', () => {
    const ladder = new RateLadder();
    ladder.start();
    let at = row(ladder, { rate: LADDER_STEPS[0], power: 400, seconds: 10 });
    // Well outside the band in the other direction.
    at = row(ladder, { rate: LADDER_STEPS[0] + 10, power: 400, seconds: 10, startAt: at });
    const state = ladder.state;
    expect(state.timeInZoneSec).toBeGreaterThan(9);
    expect(state.timeInZoneSec).toBeLessThan(11);
    expect(state.zonePercent).toBeGreaterThan(45);
    expect(state.zonePercent).toBeLessThan(55);
  });

  it('ignores time while it is not running', () => {
    const ladder = new RateLadder();
    row(ladder, { rate: LADDER_STEPS[0], power: 400, seconds: 10 });
    expect(ladder.state.timeInZoneSec).toBe(0);
  });

  it('does not count a backwards jump when the monitor resets', () => {
    const ladder = new RateLadder();
    ladder.start();
    ladder.applySample(sample(LADDER_STEPS[0], 400, 100));
    ladder.applySample(sample(LADDER_STEPS[0], 400, 0));
    expect(ladder.state.timeInZoneSec).toBe(0);
  });

  it('does not credit a long gap as time rowed', () => {
    const ladder = new RateLadder();
    ladder.start();
    ladder.applySample(sample(LADDER_STEPS[0], 400, 0));
    ladder.applySample(sample(LADDER_STEPS[0], 400, 45)); // tab was hidden
    expect(ladder.state.timeInZoneSec).toBe(0);
  });
});

describe('step progression', () => {
  it('moves to the next target after the step duration', () => {
    const ladder = new RateLadder();
    ladder.start();
    expect(ladder.state.targetRate).toBe(LADDER_STEPS[0]);
    row(ladder, { rate: LADDER_STEPS[0], power: 400, seconds: STEP_SECONDS + 1 });
    expect(ladder.state.targetRate).toBe(LADDER_STEPS[1]);
    expect(ladder.state.stepNumber).toBe(2);
  });

  it('records a result for each completed step', () => {
    const ladder = new RateLadder();
    ladder.start();
    row(ladder, { rate: LADDER_STEPS[0], power: 400, seconds: STEP_SECONDS + 1 });
    const [first] = ladder.state.results;
    expect(first.targetRate).toBe(LADDER_STEPS[0]);
    expect(first.zonePercent).toBeGreaterThan(95);
  });

  it('finishes after the last step and stops running', () => {
    const ladder = new RateLadder();
    ladder.start();
    // Row the whole pyramid at a rating that is only ever right for the ends.
    row(ladder, { rate: LADDER_STEPS[0], power: 400, seconds: STEP_SECONDS * LADDER_STEPS.length + 2 });
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
