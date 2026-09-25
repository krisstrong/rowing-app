/**
 * Renders the live dashboard from whatever RowerSource is currently active.
 * Knows nothing about Bluetooth — it only calls start()/stop() and listens
 * for 'sample' and 'state' events.
 */
export class Dashboard {
  #els;
  #latestSample = null;
  #rafId = null;
  #wakeLock = null;
  #activeSource = null;

  constructor({ root = document } = {}) {
    this.#els = {
      statusIndicator: root.getElementById('status-indicator'),
      statusText: root.getElementById('status-text'),
      messageBanner: root.getElementById('message-banner'),
      btnConnect: root.getElementById('btn-connect'),
      btnDemo: root.getElementById('btn-demo'),
      btnFullscreen: root.getElementById('btn-fullscreen'),
      pace: root.getElementById('stat-pace'),
      rate: root.getElementById('stat-rate'),
      distance: root.getElementById('stat-distance'),
      time: root.getElementById('stat-time'),
      power: root.getElementById('stat-power'),
      strokePhaseWord: root.getElementById('stroke-phase-word'),
      strokePhaseFill: root.getElementById('stroke-phase-fill'),
    };

    this.#els.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
    document.addEventListener('visibilitychange', () => this.#reacquireWakeLockIfNeeded());
  }

  /** Wire up Connect/Demo buttons to callbacks supplied by main.js. */
  bindControls({ onConnect, onDemo }) {
    this.#els.btnConnect.addEventListener('click', onConnect);
    this.#els.btnDemo.addEventListener('click', onDemo);
  }

  bindKeyboardShortcuts({ onFullscreenToggle, onDemoToggle }) {
    document.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const key = event.key.toLowerCase();
      if (key === 'f') {
        onFullscreenToggle();
      } else if (key === 'd') {
        onDemoToggle();
      } else if (key === 'escape' && document.fullscreenElement) {
        document.exitFullscreen();
      }
    });
  }

  /** Attach to a RowerSource: subscribes to its events and starts the render loop. */
  attach(source) {
    this.#activeSource = source;
    source.on('sample', (sample) => {
      this.#latestSample = sample;
    });
    source.on('state', (state) => this.#renderState(state));
    this.#startRenderLoop();
  }

  setConnectButtonEnabled(enabled) {
    this.#els.btnConnect.disabled = !enabled;
  }

  showMessage(text) {
    this.#els.messageBanner.textContent = text;
    this.#els.messageBanner.classList.add('visible');
  }

  clearMessage() {
    this.#els.messageBanner.textContent = '';
    this.#els.messageBanner.classList.remove('visible');
  }

  #renderState({ state, deviceName, message }) {
    this.#els.statusIndicator.dataset.state = state;
    const labels = {
      idle: 'Not connected',
      connecting: 'Connecting…',
      connected: deviceName ? `Connected — ${deviceName}` : 'Connected',
      reconnecting: 'Reconnecting…',
      error: 'Connection error',
      unsupported: 'Unsupported browser',
    };
    this.#els.statusText.textContent = labels[state] ?? state;

    if (state === 'error' || state === 'unsupported') {
      if (message) this.showMessage(message);
    } else if (state === 'connected') {
      this.clearMessage();
    } else if (message) {
      this.showMessage(message);
    }
  }

  #startRenderLoop() {
    if (this.#rafId) return;
    const loop = () => {
      if (this.#latestSample) this.#renderSample(this.#latestSample);
      this.#rafId = requestAnimationFrame(loop);
    };
    this.#rafId = requestAnimationFrame(loop);
  }

  #renderSample(sample) {
    this.#els.pace.textContent = formatPace(sample.paceSecPer500);
    this.#els.rate.innerHTML = `${sample.strokeRate}<span class="unit">spm</span>`;
    this.#els.distance.innerHTML = `${Math.round(sample.distanceM)}<span class="unit">m</span>`;
    this.#els.time.textContent = formatElapsed(sample.elapsedSec);
    this.#els.power.innerHTML = `${sample.powerW}<span class="unit">W</span>`;

    const phase = sample.strokeState === 'driving' ? 'driving' : 'recovery';
    this.#els.strokePhaseWord.textContent = phase === 'driving' ? 'Drive' : 'Recovery';
    this.#els.strokePhaseWord.dataset.phase = phase;
    this.#els.strokePhaseFill.dataset.phase = phase;
    this.#els.strokePhaseFill.style.width = phase === 'driving' ? '100%' : '0%';
  }

  async toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Embedded frames and some policies refuse fullscreen; the dashboard still works windowed.
      this.showMessage('This browser refused full screen here. Try opening the page in its own Chrome or Edge window.');
      return;
    }
    await this.#requestWakeLock();
  }

  async requestWakeLockForSession() {
    await this.#requestWakeLock();
  }

  async #requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      this.#wakeLock = await navigator.wakeLock.request('screen');
      this.#wakeLock.addEventListener('release', () => {
        this.#wakeLock = null;
      });
    } catch {
      // Wake lock can be refused (e.g. low battery, backgrounded tab) — non-fatal.
    }
  }

  async #reacquireWakeLockIfNeeded() {
    if (document.visibilityState === 'visible' && this.#activeSource && !this.#wakeLock) {
      await this.#requestWakeLock();
    }
  }
}

function formatPace(paceSecPer500) {
  if (!Number.isFinite(paceSecPer500) || paceSecPer500 <= 0) return '–:––.–';
  const minutes = Math.floor(paceSecPer500 / 60);
  const seconds = paceSecPer500 % 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

function formatElapsed(elapsedSec) {
  if (!Number.isFinite(elapsedSec) || elapsedSec < 0) return '–:––';
  const minutes = Math.floor(elapsedSec / 60);
  const seconds = Math.floor(elapsedSec % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
