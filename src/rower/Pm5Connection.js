import { RowerSource } from './RowerSource.js';
import {
  PM5_ROWING_SERVICE,
  PM5_DEVICE_INFO_SERVICE,
  CHAR_GENERAL_STATUS,
  CHAR_ADDITIONAL_STATUS_1,
  CHAR_ADDITIONAL_STATUS_2,
  CHAR_SAMPLE_RATE,
  CHAR_STROKE_DATA,
  SAMPLE_RATE,
} from './pm5Uuids.js';
import {
  parseGeneralStatus,
  parseAdditionalStatus1,
  parseAdditionalStatus2,
  parseStrokeData,
} from './pm5Parser.js';

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 8000, 8000];

const EMPTY_SAMPLE = {
  elapsedSec: 0,
  distanceM: 0,
  paceSecPer500: 0,
  speedMps: 0,
  strokeRate: 0,
  powerW: 0,
  heartRate: 0,
  strokeState: 'waitingForMinSpeed',
  strokeCount: 0,
  dragFactor: 0,
  calories: 0,
  source: 'pm5',
};

/**
 * Connects to a Concept2 PM5 over Web Bluetooth and emits merged
 * RowingSamples. The four rowing-service characteristics each carry part of
 * the picture, so notifications update a running sample which is emitted on
 * every update. No DOM code lives here.
 */
export class Pm5Connection extends RowerSource {
  #device = null;
  #server = null;
  #sample = { ...EMPTY_SAMPLE };
  #running = false;
  #reconnectAttempt = 0;
  #reconnectTimer = null;
  // Chrome hands back the same characteristic object across reconnects, so track
  // which ones already have a listener to avoid stacking duplicates.
  #boundCharacteristics = new WeakSet();

  static isSupported() {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  async start() {
    if (!Pm5Connection.isSupported()) {
      this.emit('state', {
        state: 'unsupported',
        deviceName: null,
        message: 'Web Bluetooth is not available. Open this in Chrome or Edge on a machine with Bluetooth LE.',
      });
      return;
    }

    this.#running = true;
    this.emit('state', { state: 'connecting', deviceName: null, message: 'Choose your PM5 in the browser dialog…' });

    try {
      this.#device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'PM5' }],
        optionalServices: [PM5_ROWING_SERVICE, PM5_DEVICE_INFO_SERVICE],
      });
    } catch (error) {
      this.#running = false;
      this.emit('state', {
        state: 'error',
        deviceName: null,
        message:
          error?.name === 'NotFoundError'
            ? 'No PM5 found, or the picker was dismissed. Make sure the monitor is on and not already connected to ErgData or a phone app — the PM5 only accepts one app at a time.'
            : `Could not open the device chooser: ${error?.message ?? error}`,
      });
      return;
    }

    this.#device.addEventListener('gattserverdisconnected', () => this.#handleDisconnect());

    try {
      await this.#connectGatt();
    } catch (error) {
      this.#running = false;
      this.emit('state', {
        state: 'error',
        deviceName: this.#device?.name ?? null,
        message: `Found the monitor but could not read from it: ${error?.message ?? error}. If ErgData or a phone app is connected, disconnect it — the PM5 only accepts one app at a time.`,
      });
    }
  }

  async stop() {
    this.#running = false;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    if (this.#device?.gatt?.connected) this.#device.gatt.disconnect();
    this.#device = null;
    this.#server = null;
    this.#sample = { ...EMPTY_SAMPLE };
    this.emit('state', { state: 'idle', deviceName: null, message: null });
  }

  async #connectGatt() {
    const deviceName = this.#device?.name ?? 'PM5';
    this.emit('state', { state: 'connecting', deviceName, message: `Connecting to ${deviceName}…` });

    this.#server = await this.#device.gatt.connect();
    const service = await this.#server.getPrimaryService(PM5_ROWING_SERVICE);

    await this.#setSampleRate(service, SAMPLE_RATE.QUARTER_SEC);

    await this.#subscribe(service, CHAR_GENERAL_STATUS, (view) => {
      const status = parseGeneralStatus(view);
      this.#sample.elapsedSec = status.elapsedSec;
      this.#sample.distanceM = status.distanceM;
      this.#sample.strokeState = status.strokeState;
      this.#sample.dragFactor = status.dragFactor;
    });

    await this.#subscribe(service, CHAR_ADDITIONAL_STATUS_1, (view) => {
      const status = parseAdditionalStatus1(view);
      this.#sample.speedMps = status.speedMps;
      this.#sample.strokeRate = status.strokeRate;
      this.#sample.heartRate = status.heartRate;
      this.#sample.paceSecPer500 = status.paceSecPer500;
    });

    await this.#subscribe(service, CHAR_ADDITIONAL_STATUS_2, (view) => {
      const status = parseAdditionalStatus2(view);
      this.#sample.powerW = status.powerW;
      this.#sample.calories = status.calories;
    });

    await this.#subscribe(service, CHAR_STROKE_DATA, (view) => {
      const stroke = parseStrokeData(view);
      this.#sample.strokeCount = stroke.strokeCount;
    });

    this.#reconnectAttempt = 0;
    this.emit('state', { state: 'connected', deviceName, message: null });
  }

  async #setSampleRate(service, rate) {
    try {
      const characteristic = await service.getCharacteristic(CHAR_SAMPLE_RATE);
      await characteristic.writeValue(Uint8Array.of(rate));
    } catch {
      // Not every firmware exposes a writable sample rate; the default 500 ms still works.
    }
  }

  async #subscribe(service, uuid, handler) {
    const characteristic = await service.getCharacteristic(uuid);
    if (!this.#boundCharacteristics.has(characteristic)) {
      characteristic.addEventListener('characteristicvaluechanged', (event) => {
        handler(event.target.value);
        this.emit('sample', { ...this.#sample });
      });
      this.#boundCharacteristics.add(characteristic);
    }
    await characteristic.startNotifications();
  }

  #handleDisconnect() {
    if (!this.#running) return;
    const deviceName = this.#device?.name ?? 'PM5';
    const delay = RECONNECT_DELAYS_MS[Math.min(this.#reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.#reconnectAttempt += 1;

    if (this.#reconnectAttempt > RECONNECT_DELAYS_MS.length) {
      this.#running = false;
      this.emit('state', {
        state: 'error',
        deviceName,
        message: 'Lost the connection and could not get it back. Check the monitor is on, then press Connect rower again.',
      });
      return;
    }

    this.emit('state', {
      state: 'reconnecting',
      deviceName,
      message: `Lost ${deviceName}. Retrying (attempt ${this.#reconnectAttempt})…`,
    });

    this.#reconnectTimer = setTimeout(async () => {
      if (!this.#running) return;
      try {
        await this.#connectGatt();
      } catch {
        this.#handleDisconnect();
      }
    }, delay);
  }
}
