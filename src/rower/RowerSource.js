/**
 * Tiny event-emitter base. Both Pm5Connection and SimulatedRower extend this
 * so the UI layer can subscribe to 'sample' and 'state' events without
 * knowing which one it's talking to.
 */
export class RowerSource {
  #listeners = new Map();

  on(event, fn) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this.#listeners.get(event)?.delete(fn);
  }

  emit(event, payload) {
    for (const fn of this.#listeners.get(event) ?? []) fn(payload);
  }

  /** @abstract */
  start() {
    throw new Error('start() not implemented');
  }

  /** @abstract */
  stop() {
    throw new Error('stop() not implemented');
  }
}
