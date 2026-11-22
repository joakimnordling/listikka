/* Talking to Nostr relays (NIP-01): a connection to one relay, and a pool that talks to all of a group's at once.
   Only what groups need: publishing an event and waiting for the relay's OK, and asking for the events that match a
   filter until the relay says it has sent them all (EOSE). Nothing here is trusted: every event is checked when it's
   opened (events.js). */

const TIMEOUT_MS = 10000;

export class RelayError extends Error {}

let subs = 0;

/** One relay. It connects when first needed, and again after the connection drops. */
export class Relay {
  constructor(url, { WebSocket = globalThis.WebSocket, timeout = TIMEOUT_MS } = {}) {
    this.url = url;
    this.WebSocket = WebSocket;
    this.timeout = timeout;
    this.ws = null;
    this.opening = null;
    this.waiting = new Map(); // event ID or subscription -> handler of the relay's messages about it
  }

  open() {
    if (this.ws?.readyState === 1) return Promise.resolve();
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new this.WebSocket(this.url);
      } catch (e) {
        this.opening = null;
        reject(new RelayError(`Can't reach it: ${e.message}`));
        return;
      }
      const timer = setTimeout(() => {
        ws.close();
        fail(new RelayError("Can't reach it: no answer"));
      }, this.timeout);
      const fail = (error) => {
        clearTimeout(timer);
        this.opening = null;
        reject(error);
      };
      ws.onopen = () => {
        clearTimeout(timer);
        this.ws = ws;
        this.opening = null;
        resolve();
      };
      ws.onerror = () => fail(new RelayError("Can't reach it"));
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        for (const handle of [...this.waiting.values()]) handle(["CLOSED", null, "the connection closed"]);
      };
      ws.onmessage = (m) => {
        let msg;
        try {
          msg = JSON.parse(m.data);
        } catch {
          return;
        }
        if (!Array.isArray(msg) || typeof msg[1] !== "string") return;
        this.waiting.get(msg[1])?.(msg);
      };
    });
    return this.opening;
  }

  /** Wait for messages about `key` until `handle` returns a result, or the time runs out. */
  #await(key, send, handle, onTimeout) {
    return new Promise((resolve) => {
      const done = (value) => {
        clearTimeout(timer);
        this.waiting.delete(key);
        resolve(value);
      };
      const timer = setTimeout(() => done(onTimeout()), this.timeout);
      this.waiting.set(key, (msg) => {
        const value = handle(msg);
        if (value !== undefined) done(value);
      });
      try {
        this.ws.send(JSON.stringify(send));
      } catch (e) {
        done({ ok: false, message: e.message });
      }
    });
  }

  /** Publish an event: {ok, message}, as the relay answers (NIP-01 OK), or not ok when it doesn't. */
  async publish(event) {
    try {
      await this.open();
    } catch (e) {
      return { ok: false, message: e.message };
    }
    return this.#await(
      event.id,
      ["EVENT", event],
      (msg) => {
        if (msg[0] === "OK") return { ok: msg[2] === true, message: msg[3] ?? "" };
        if (msg[0] === "CLOSED") return { ok: false, message: msg[2] ?? "closed" };
      },
      () => ({ ok: false, message: "no answer" }),
    );
  }

  /** The events matching `filter`, once the relay has sent all it has (EOSE). Throws a RelayError if it can't. */
  async query(filter) {
    await this.open();
    const id = `q${++subs}`;
    const events = [];
    const result = await this.#await(
      id,
      ["REQ", id, filter],
      (msg) => {
        if (msg[0] === "EVENT" && msg[2] && typeof msg[2] === "object") events.push(msg[2]);
        else if (msg[0] === "EOSE") return { ok: true };
        else if (msg[0] === "CLOSED") return { ok: false, message: msg[2] ?? "closed" };
      },
      () => ({ ok: false, message: "no answer" }),
    );
    try {
      if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(["CLOSE", id]));
    } catch {}
    if (!result.ok) throw new RelayError(result.message);
    return events;
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }
}

/** All of a group's relays: each event goes to every one, and a query asks every one. */
export class RelayPool {
  constructor(urls, options) {
    this.relays = urls.map((url) => new Relay(url, options));
  }

  /** {accepted: how many relays took it, results: [{url, ok, message}]} */
  async publish(event) {
    const results = await Promise.all(this.relays.map(async (r) => ({ url: r.url, ...(await r.publish(event)) })));
    return { accepted: results.filter((r) => r.ok).length, results };
  }

  /**
   * Every event matching `filter` on the relays that answered, once each: {events, answered, results}, results
   * being [{url, ok, message}] for each relay. Nothing is thrown when none answers: `answered` is 0.
   */
  async query(filter) {
    const settled = await Promise.allSettled(this.relays.map((r) => r.query(filter)));
    const byId = new Map();
    const results = settled.map((s, i) => {
      const url = this.relays[i].url;
      if (s.status === "rejected") return { url, ok: false, message: s.reason.message };
      for (const e of s.value) if (typeof e.id === "string" && !byId.has(e.id)) byId.set(e.id, e);
      return { url, ok: true, message: "" };
    });
    return { events: [...byId.values()], answered: results.filter((r) => r.ok).length, results };
  }

  close() {
    for (const r of this.relays) r.close();
  }
}
