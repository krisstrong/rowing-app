/**
 * The sound of the river, synthesised with Web Audio — no sample files, so
 * nothing to download and nothing to licence.
 *
 * Everything is driven by the same RowingSample stream as the scene: the catch
 * fires the oarlock and the bite of the blades, speed sets the water against
 * the hull, and a loon calls across the water every now and then because this
 * is Kejimkujik at dawn.
 *
 * Browsers refuse to start audio without a user gesture, so nothing is created
 * until enable() is called from a click or keypress.
 */

const LOON_MIN_GAP_SEC = 40;
const LOON_MAX_GAP_SEC = 95;

/** A few seconds of brown noise, looped. Cheaper than generating it live. */
function createNoiseBuffer(context, seconds = 4) {
  const length = context.sampleRate * seconds;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  return buffer;
}

export class SceneAudio {
  #context = null;
  #master = null;
  #noiseBuffer = null;
  #hullGain = null;
  #loonTimer = null;
  #enabled = false;

  get enabled() {
    return this.#enabled;
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  async enable() {
    if (this.#enabled) return;

    if (!this.#context) {
      const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioContextClass) return;
      this.#context = new AudioContextClass();
      this.#noiseBuffer = createNoiseBuffer(this.#context);
      this.#master = this.#context.createGain();
      this.#master.gain.value = 0;
      this.#master.connect(this.#context.destination);
      this.#startAmbience();
    }

    await this.#context.resume();
    this.#enabled = true;
    this.#master.gain.cancelScheduledValues(this.#context.currentTime);
    this.#master.gain.linearRampToValueAtTime(1, this.#context.currentTime + 0.6);
    this.#scheduleLoon();
  }

  disable() {
    if (!this.#enabled || !this.#context) return;
    this.#enabled = false;
    this.#master.gain.cancelScheduledValues(this.#context.currentTime);
    this.#master.gain.linearRampToValueAtTime(0, this.#context.currentTime + 0.4);
    clearTimeout(this.#loonTimer);
    this.#loonTimer = null;
  }

  toggle() {
    if (this.#enabled) {
      this.disable();
      return Promise.resolve();
    }
    return this.enable();
  }

  /** Continuous beds: the river itself, and water moving past the hull. */
  #startAmbience() {
    const context = this.#context;

    const river = context.createBufferSource();
    river.buffer = this.#noiseBuffer;
    river.loop = true;
    const riverFilter = context.createBiquadFilter();
    riverFilter.type = 'lowpass';
    riverFilter.frequency.value = 420;
    const riverGain = context.createGain();
    riverGain.gain.value = 0.05;
    river.connect(riverFilter).connect(riverGain).connect(this.#master);
    river.start();

    const hull = context.createBufferSource();
    hull.buffer = this.#noiseBuffer;
    hull.loop = true;
    const hullFilter = context.createBiquadFilter();
    hullFilter.type = 'bandpass';
    hullFilter.frequency.value = 780;
    hullFilter.Q.value = 0.8;
    this.#hullGain = context.createGain();
    this.#hullGain.gain.value = 0;
    hull.connect(hullFilter).connect(this.#hullGain).connect(this.#master);
    hull.start();
  }

  /** Water noise against the hull rises with boat speed. */
  setSpeed(speedMps) {
    if (!this.#context || !this.#hullGain) return;
    const target = Math.min(0.075, Math.max(0, speedMps) * 0.017);
    this.#hullGain.gain.setTargetAtTime(target, this.#context.currentTime, 0.25);
  }

  #noiseBurst({ duration, frequency, Q, peak, type = 'bandpass', delay = 0 }) {
    const context = this.#context;
    const now = context.currentTime + delay;

    const source = context.createBufferSource();
    source.buffer = this.#noiseBuffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = Q;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + duration * 0.16);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(filter).connect(gain).connect(this.#master);
    source.start(now);
    source.stop(now + duration + 0.05);
  }

  /** The catch: the oarlock knocks, then the blades bite the water. */
  playCatch() {
    if (!this.#enabled) return;
    const context = this.#context;
    const now = context.currentTime;

    const knock = context.createOscillator();
    knock.type = 'triangle';
    knock.frequency.setValueAtTime(190, now);
    knock.frequency.exponentialRampToValueAtTime(90, now + 0.05);
    const knockGain = context.createGain();
    knockGain.gain.setValueAtTime(0.09, now);
    knockGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    knock.connect(knockGain).connect(this.#master);
    knock.start(now);
    knock.stop(now + 0.09);

    this.#noiseBurst({ duration: 0.28, frequency: 1500, Q: 1.1, peak: 0.1 });
  }

  /** The finish: blades out, and the seat running back up the slide. */
  playFinish() {
    if (!this.#enabled) return;
    this.#noiseBurst({ duration: 0.34, frequency: 900, Q: 0.9, peak: 0.07 });
    this.#noiseBurst({ duration: 0.5, frequency: 2600, Q: 0.6, peak: 0.02, type: 'highpass', delay: 0.12 });
  }

  /**
   * A common loon's wail: a long whistle that rises, holds and falls, with the
   * lake's echo behind it. The sound Keji is known for at dawn.
   */
  playLoon() {
    if (!this.#enabled) return;
    const context = this.#context;
    const now = context.currentTime;

    const voice = context.createOscillator();
    voice.type = 'sine';
    voice.frequency.setValueAtTime(560, now);
    voice.frequency.exponentialRampToValueAtTime(880, now + 0.45);
    voice.frequency.setValueAtTime(880, now + 1.0);
    voice.frequency.exponentialRampToValueAtTime(680, now + 1.7);

    // Loons waver; a steady tone sounds like a theremin instead.
    const vibrato = context.createOscillator();
    vibrato.frequency.value = 5.5;
    const vibratoDepth = context.createGain();
    vibratoDepth.gain.value = 14;
    vibrato.connect(vibratoDepth).connect(voice.frequency);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.3);
    gain.gain.setValueAtTime(0.1, now + 1.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.9);

    const echo = context.createDelay(1);
    echo.delayTime.value = 0.32;
    const echoGain = context.createGain();
    echoGain.gain.value = 0.28;
    gain.connect(echo).connect(echoGain).connect(this.#master);
    gain.connect(this.#master);

    voice.connect(gain);
    voice.start(now);
    voice.stop(now + 2.1);
    vibrato.start(now);
    vibrato.stop(now + 2.1);
  }

  #scheduleLoon() {
    clearTimeout(this.#loonTimer);
    const gap = LOON_MIN_GAP_SEC + Math.random() * (LOON_MAX_GAP_SEC - LOON_MIN_GAP_SEC);
    this.#loonTimer = setTimeout(() => {
      this.playLoon();
      if (this.#enabled) this.#scheduleLoon();
    }, gap * 1000);
  }
}
