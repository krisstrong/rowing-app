import { STROKE_STATES, ROWING_STATES } from './pm5Uuids.js';

/**
 * Pure DataView -> plain object parsers for the PM5 rowing service.
 * All multi-byte values are little-endian (Lo, Mid, Hi).
 *
 * Offsets and scaling per the PM5 Bluetooth Smart Communications Interface
 * Definition: time 0.01 s, distance 0.1 m, pace 0.01 s/500m, speed 0.001 m/s,
 * force 0.1 lbs, work 0.1 J.
 */

export function readUint24LE(view, offset) {
  return view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
}

export function strokeStateName(value) {
  return STROKE_STATES[value] ?? 'unknown';
}

export function rowingStateName(value) {
  return ROWING_STATES[value] ?? 'unknown';
}

/** 0x0031 — General status. */
export function parseGeneralStatus(view) {
  return {
    elapsedSec: readUint24LE(view, 0) / 100,
    distanceM: readUint24LE(view, 3) / 10,
    workoutType: view.getUint8(6),
    intervalType: view.getUint8(7),
    workoutState: view.getUint8(8),
    rowingState: rowingStateName(view.getUint8(9)),
    strokeState: strokeStateName(view.getUint8(10)),
    totalWorkDistanceM: readUint24LE(view, 11),
    workoutDuration: readUint24LE(view, 14),
    workoutDurationType: view.getUint8(17),
    dragFactor: view.getUint8(18),
  };
}

/** 0x0032 — Additional status 1. Heart rate 255 means "no belt / invalid". */
export function parseAdditionalStatus1(view) {
  const heartRate = view.getUint8(6);
  return {
    elapsedSec: readUint24LE(view, 0) / 100,
    speedMps: view.getUint16(3, true) / 1000,
    strokeRate: view.getUint8(5),
    heartRate: heartRate === 255 ? 0 : heartRate,
    paceSecPer500: view.getUint16(7, true) / 100,
    avgPaceSecPer500: view.getUint16(9, true) / 100,
    restDistanceM: view.getUint16(11, true),
    restTimeSec: readUint24LE(view, 13) / 100,
  };
}

/** 0x0033 — Additional status 2. */
export function parseAdditionalStatus2(view) {
  return {
    elapsedSec: readUint24LE(view, 0) / 100,
    intervalCount: view.getUint8(3),
    powerW: view.getUint16(4, true),
    calories: view.getUint16(6, true),
    splitAvgPaceSecPer500: view.getUint16(8, true) / 100,
    splitAvgPowerW: view.getUint16(10, true),
    splitAvgCaloriesPerHour: view.getUint16(12, true),
    lastSplitTimeSec: readUint24LE(view, 14) / 10,
    lastSplitDistanceM: readUint24LE(view, 17),
  };
}

/** 0x0035 — Stroke data. */
export function parseStrokeData(view) {
  return {
    elapsedSec: readUint24LE(view, 0) / 100,
    distanceM: readUint24LE(view, 3) / 10,
    driveLengthM: view.getUint8(6) / 100,
    driveTimeSec: view.getUint8(7) / 100,
    recoveryTimeSec: view.getUint16(8, true) / 100,
    strokeDistanceM: view.getUint16(10, true) / 100,
    peakDriveForceLbs: view.getUint16(12, true) / 10,
    avgDriveForceLbs: view.getUint16(14, true) / 10,
    workPerStrokeJ: view.getUint16(16, true) / 10,
    strokeCount: view.getUint16(18, true),
  };
}
