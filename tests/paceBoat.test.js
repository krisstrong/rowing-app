import { describe, it, expect } from 'vitest';
import { PaceBoat, paceToSpeed } from '../src/paceBoat.js';

const sample = (distanceM, elapsedSec, paceSecPer500 = 120) => ({
  distanceM,
  elapsedSec,
  paceSecPer500,
});

describe('paceToSpeed', () => {
  it('converts a 2:00/500m pace to m/s', () => {
    expect(paceToSpeed(120)).toBeCloseTo(4.1667, 3);
  });
});

describe('PaceBoat', () => {
  it('is inert until enabled', () => {
    const boat = new PaceBoat();
    boat.applySample(sample(100, 30));
    expect(boat.state.enabled).toBe(false);
    expect(boat.state.gapM).toBe(0);
  });

  it('starts level with you rather than from the beginning of the piece', () => {
    const boat = new PaceBoat();
    boat.applySample(sample(500, 130));
    boat.enable(120);
    expect(boat.state.gapM).toBeCloseTo(0, 5);
    expect(boat.state.ghostDistanceM).toBeCloseTo(500, 5);
  });

  it('adopts your current pace when enabled without an explicit target', () => {
    const boat = new PaceBoat();
    boat.applySample(sample(500, 130, 128.6));
    boat.enable(128.6);
    expect(boat.targetPaceSecPer500).toBe(129);
  });

  it('keeps its default target when your pace is not yet valid', () => {
    const boat = new PaceBoat();
    boat.applySample(sample(0, 0, 0));
    boat.enable(0);
    expect(boat.targetPaceSecPer500).toBe(120);
  });

  it('reports a positive gap when the pace boat pulls ahead', () => {
    const boat = new PaceBoat();
    boat.applySample(sample(0, 0));
    boat.enable(120); // 4.1667 m/s
    boat.applySample(sample(40, 10)); // you managed 40 m, it managed ~41.7
    expect(boat.state.gapM).toBeCloseTo(1.667, 2);
    expect(boat.state.gapSec).toBeCloseTo(0.4, 2);
  });

  it('reports a negative gap when you are up on it', () => {
    const boat = new PaceBoat();
    boat.applySample(sample(0, 0));
    boat.enable(120);
    boat.applySample(sample(45, 10));
    expect(boat.state.gapM).toBeCloseTo(-3.333, 2);
    expect(boat.state.gapSec).toBeLessThan(0);
  });

  it('changes speed on a pace adjustment without teleporting', () => {
    const boat = new PaceBoat();
    boat.applySample(sample(0, 0));
    boat.enable(120);
    boat.applySample(sample(40, 10));
    const before = boat.state.ghostDistanceM;

    boat.adjustTargetPace(-10); // now chasing 1:50/500m
    expect(boat.targetPaceSecPer500).toBe(110);
    expect(boat.state.ghostDistanceM).toBeCloseTo(before, 5); // same place, new speed

    boat.applySample(sample(80, 20));
    expect(boat.state.ghostDistanceM).toBeCloseTo(before + paceToSpeed(110) * 10, 5);
  });

  it('clamps the target pace to a plausible range', () => {
    const boat = new PaceBoat();
    boat.enable(120);
    boat.adjustTargetPace(-100);
    expect(boat.targetPaceSecPer500).toBe(80);
    boat.adjustTargetPace(500);
    expect(boat.targetPaceSecPer500).toBe(240);
  });

  it('does not run backwards if elapsed time goes backwards on a new piece', () => {
    const boat = new PaceBoat();
    boat.applySample(sample(500, 130));
    boat.enable(120);
    boat.applySample(sample(0, 0)); // monitor reset
    expect(boat.state.ghostDistanceM).toBeCloseTo(500, 5);
  });
});
