/**
 * A boat that rows a constant target pace, for racing against.
 *
 * Deliberately not a RowerSource and not part of the scene: it is derived data
 * that both the scene and the HUD read, and keeping it here makes the gap
 * arithmetic testable without a renderer.
 *
 * Sign convention: gapM is the pace boat's lead. Positive means it is ahead of
 * you, negative means you are ahead of it.
 */

const DEFAULT_TARGET_PACE_SEC = 120; // 2:00.0 /500m
const MIN_TARGET_PACE_SEC = 80;
const MAX_TARGET_PACE_SEC = 240;

export function paceToSpeed(paceSecPer500) {
  return 500 / paceSecPer500;
}

export class PaceBoat {
  #enabled = false;
  #targetPaceSecPer500 = DEFAULT_TARGET_PACE_SEC;
  #anchorDistanceM = 0;
  #anchorElapsedSec = 0;
  #distanceM = 0;
  #elapsedSec = 0;

  get enabled() {
    return this.#enabled;
  }

  get targetPaceSecPer500() {
    return this.#targetPaceSecPer500;
  }

  /**
   * Starts the pace boat level with you, so the race runs from here rather
   * than from the beginning of the piece.
   *
   * @param paceSecPer500 defaults to whatever you are currently pulling, which
   *   makes "hold this" the one-keystroke case.
   */
  enable(paceSecPer500) {
    if (Number.isFinite(paceSecPer500) && paceSecPer500 > 0) {
      this.#targetPaceSecPer500 = clampPace(Math.round(paceSecPer500));
    }
    this.#anchorDistanceM = this.#distanceM;
    this.#anchorElapsedSec = this.#elapsedSec;
    this.#enabled = true;
  }

  disable() {
    this.#enabled = false;
  }

  /** Re-anchors so a pace change speeds the boat up or slows it down rather than teleporting it. */
  adjustTargetPace(deltaSec) {
    const next = clampPace(this.#targetPaceSecPer500 + deltaSec);
    if (next === this.#targetPaceSecPer500) return;
    this.#anchorDistanceM = this.ghostDistanceM;
    this.#anchorElapsedSec = this.#elapsedSec;
    this.#targetPaceSecPer500 = next;
  }

  applySample(sample) {
    this.#distanceM = sample.distanceM;
    this.#elapsedSec = sample.elapsedSec;
  }

  /** Where the pace boat has got to, in metres along the course. */
  get ghostDistanceM() {
    if (!this.#enabled) return 0;
    const seconds = Math.max(0, this.#elapsedSec - this.#anchorElapsedSec);
    return this.#anchorDistanceM + paceToSpeed(this.#targetPaceSecPer500) * seconds;
  }

  get state() {
    const ghostDistanceM = this.ghostDistanceM;
    const gapM = this.#enabled ? ghostDistanceM - this.#distanceM : 0;
    return {
      enabled: this.#enabled,
      targetPaceSecPer500: this.#targetPaceSecPer500,
      ghostDistanceM,
      gapM,
      // How far behind in time, measured at the pace boat's own speed, so this
      // stays meaningful when you have stopped rowing.
      gapSec: gapM / paceToSpeed(this.#targetPaceSecPer500),
    };
  }
}

function clampPace(paceSec) {
  return Math.min(MAX_TARGET_PACE_SEC, Math.max(MIN_TARGET_PACE_SEC, paceSec));
}
