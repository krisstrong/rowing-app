import { describe, it, expect } from 'vitest';
import {
  readUint24LE,
  strokeStateName,
  rowingStateName,
  parseGeneralStatus,
  parseAdditionalStatus1,
  parseAdditionalStatus2,
  parseStrokeData,
} from '../src/rower/pm5Parser.js';

const u16 = (value) => [value & 0xff, (value >> 8) & 0xff];
const u24 = (value) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];
const view = (bytes) => new DataView(Uint8Array.from(bytes).buffer);

describe('readUint24LE', () => {
  it('reads little-endian Lo/Mid/Hi triples', () => {
    expect(readUint24LE(view([0x01, 0x00, 0x00]), 0)).toBe(1);
    expect(readUint24LE(view([0x00, 0x01, 0x00]), 0)).toBe(256);
    expect(readUint24LE(view([0xff, 0xff, 0xff]), 0)).toBe(16777215);
  });

  it('honours the offset', () => {
    expect(readUint24LE(view([0xaa, 0xbb, 0x01, 0x00, 0x00]), 2)).toBe(1);
  });
});

describe('strokeStateName', () => {
  it('maps the five spec values', () => {
    expect(strokeStateName(0)).toBe('waitingForMinSpeed');
    expect(strokeStateName(1)).toBe('waitingToAccelerate');
    expect(strokeStateName(2)).toBe('driving');
    expect(strokeStateName(3)).toBe('dwellingAfterDrive');
    expect(strokeStateName(4)).toBe('recovery');
  });

  it('falls back for out-of-range values', () => {
    expect(strokeStateName(9)).toBe('unknown');
  });
});

describe('rowingStateName', () => {
  it('maps inactive and active', () => {
    expect(rowingStateName(0)).toBe('inactive');
    expect(rowingStateName(1)).toBe('active');
  });
});

describe('parseGeneralStatus (0x0031)', () => {
  // 19-byte payload: elapsed 312.45 s, distance 1284.3 m, driving, drag 115.
  const payload = [
    ...u24(31245), // elapsed time, 0.01 s
    ...u24(12843), // distance, 0.1 m
    0x00, // workout type
    0x00, // interval type
    0x01, // workout state
    0x01, // rowing state: active
    0x02, // stroke state: driving
    ...u24(2000), // total work distance, 1 m
    ...u24(0), // workout duration
    0x00, // workout duration type
    115, // drag factor
  ];

  it('decodes time, distance and stroke state', () => {
    const result = parseGeneralStatus(view(payload));
    expect(result.elapsedSec).toBeCloseTo(312.45, 5);
    expect(result.distanceM).toBeCloseTo(1284.3, 5);
    expect(result.rowingState).toBe('active');
    expect(result.strokeState).toBe('driving');
    expect(result.dragFactor).toBe(115);
    expect(result.totalWorkDistanceM).toBe(2000);
  });

  it('reports recovery when the monitor is in the recovery phase', () => {
    const recovery = [...payload];
    recovery[10] = 0x04;
    expect(parseGeneralStatus(view(recovery)).strokeState).toBe('recovery');
  });
});

describe('parseAdditionalStatus1 (0x0032)', () => {
  // speed 3.890 m/s, 24 spm, no HR belt (255), pace 128.60 s, avg pace 130.00 s.
  const payload = [
    ...u24(31245),
    ...u16(3890), // speed, 0.001 m/s
    24, // stroke rate
    255, // heart rate: no belt
    ...u16(12860), // current pace, 0.01 s
    ...u16(13000), // average pace, 0.01 s
    ...u16(0), // rest distance
    ...u24(0), // rest time
  ];

  it('decodes speed, rate and pace', () => {
    const result = parseAdditionalStatus1(view(payload));
    expect(result.speedMps).toBeCloseTo(3.89, 5);
    expect(result.strokeRate).toBe(24);
    expect(result.paceSecPer500).toBeCloseTo(128.6, 5);
    expect(result.avgPaceSecPer500).toBeCloseTo(130, 5);
  });

  it('normalises the 255 "no heart rate belt" sentinel to 0', () => {
    expect(parseAdditionalStatus1(view(payload)).heartRate).toBe(0);
  });

  it('passes a real heart rate through unchanged', () => {
    const withBelt = [...payload];
    withBelt[6] = 148;
    expect(parseAdditionalStatus1(view(withBelt)).heartRate).toBe(148);
  });
});

describe('parseAdditionalStatus2 (0x0033)', () => {
  const payload = [
    ...u24(31245),
    2, // interval count
    ...u16(165), // average power, watts
    ...u16(88), // total calories
    ...u16(13000), // split avg pace
    ...u16(160), // split avg power
    ...u16(700), // split avg calories/hr
    ...u24(1200), // last split time, 0.1 s
    ...u24(500), // last split distance, 1 m
  ];

  it('decodes power and calories', () => {
    const result = parseAdditionalStatus2(view(payload));
    expect(result.intervalCount).toBe(2);
    expect(result.powerW).toBe(165);
    expect(result.calories).toBe(88);
    expect(result.lastSplitTimeSec).toBeCloseTo(120, 5);
    expect(result.lastSplitDistanceM).toBe(500);
  });
});

describe('parseStrokeData (0x0035)', () => {
  const payload = [
    ...u24(31245),
    ...u24(12843),
    130, // drive length, 0.01 m
    72, // drive time, 0.01 s
    ...u16(158), // recovery time, 0.01 s
    ...u16(1020), // stroke distance, 0.01 m
    ...u16(2500), // peak drive force, 0.1 lbs
    ...u16(1500), // average drive force, 0.1 lbs
    ...u16(3000), // work per stroke, 0.1 J
    ...u16(121), // stroke count
  ];

  it('decodes drive/recovery timing and force', () => {
    const result = parseStrokeData(view(payload));
    expect(result.driveLengthM).toBeCloseTo(1.3, 5);
    expect(result.driveTimeSec).toBeCloseTo(0.72, 5);
    expect(result.recoveryTimeSec).toBeCloseTo(1.58, 5);
    expect(result.strokeDistanceM).toBeCloseTo(10.2, 5);
    expect(result.peakDriveForceLbs).toBeCloseTo(250, 5);
    expect(result.avgDriveForceLbs).toBeCloseTo(150, 5);
    expect(result.workPerStrokeJ).toBeCloseTo(300, 5);
    expect(result.strokeCount).toBe(121);
  });

  it('handles a stroke count above 255 across the two-byte field', () => {
    const highCount = [...payload];
    highCount[18] = 0x2c;
    highCount[19] = 0x01; // 300
    expect(parseStrokeData(view(highCount)).strokeCount).toBe(300);
  });
});
