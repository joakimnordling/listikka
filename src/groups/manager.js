/* This device's sharing groups: each one's state in the sync store ("group:<bit>", see sync.js), syncing them soon
   after a change and every so often, and their status for the screens. It works next to the servers' sync manager
   (src/sync/manager.js) on the same store: servers use the records' bits 0 to 14, groups 15 to 30, and each has its
   own sync device, which saves records' bits from what's in memory, so neither writes over the other's.

   createGroups({app, store, makeDevice, relays, relayOptions, onSynced}):
     store         the sync store: all() -> rows, write(ops) with ["put", row] / ["delete", k]
     makeDevice    () -> a sync device (src/sync/device.js)
     relays        the relays new groups use (DEFAULT_RELAYS)
     relayOptions  for relay.js: {WebSocket, timeout}
     onSynced      called after a round that changed something here */
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { KIND } from "./events.js";
import { groupKeys } from "./keys.js";
import { groupName } from "./look.js";
import { RelayPool } from "./relay.js";
import { compare, forgetEvents, hostOf, syncGroup } from "./sync.js";

export const GROUP_BITS = { from: 15, to: 30 };

/**
 * The public relays a new group uses. Every event goes to all of them, so the group works while any one does. Free,
 * general relays running strfry, whose defaults take events up to 64 KB dated up to 15 minutes ahead; not yet
 * checked for how long they keep kind 30078 events (see the design notes).
 */
export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.nostr.net",
];

const EVERY_MS = 60000;
const AFTER_CHANGE_MS = 3000;
// After another device's event arrives live: soon, but letting the same event from the other relays come too
const AFTER_EVENT_MS = 300;
// After a failed round, as when the network isn't back yet after the app was in the background: try again this soon,
// plus up to a second at random, and only show the group as failing once these tries have failed too
const RETRY_MS = [2000, 8000];

const sameKey = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export class GroupFullError extends Error {}

export function createGroups({ app, store, makeDevice, relays = DEFAULT_RELAYS, relayOptions, onSynced }) {
  const live = new Map(); // bit -> {keys, pool, stop}: stop ends its live subscription
  async function wire(group) {
    live.get(group.bit)?.pool.close();
    live.set(group.bit, {
      keys: await groupKeys(hexToBytes(group.key)),
      pool: new RelayPool(group.relays, relayOptions),
    });
  }
  return {
    groups: [],
    me: null, // this device, as its status shows it to the others: {label, kind}; null until named
    running: false,
    again: false,
    retryDelays: RETRY_MS,
    timer: 0,
    device: null,
    listeners: new Set(),

    async load() {
      const rows = await store.all();
      this.groups = rows.filter((r) => r.k.startsWith("group:")).sort((a, b) => a.bit - b.bit);
      const me = rows.find((r) => r.k === "me");
      this.me = me ? { label: me.label, kind: me.kind } : null;
      this.device = makeDevice();
      for (const g of this.groups) await wire(g);
    },
    onChange(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    },
    notify() {
      for (const fn of this.listeners) fn();
    },
    /**
     * While the app is open, each group that isn't paused listens to its relays: an event from another device starts
     * a round soon, so changes arrive as they're made, and right after another device joins.
     */
    listening: false,
    listen(group) {
      const wired = live.get(group.bit);
      if (!this.listening || !wired || group.paused || wired.stop) return;
      wired.stop = wired.pool.subscribe(
        () => ({ kinds: [KIND], authors: [wired.keys.pubkey], since: Math.floor(Date.now() / 1000) - 60 }),
        (event) => {
          if (!Object.values(group.heads).includes(event.id)) this.soon(AFTER_EVENT_MS); // not one read or sent already
        },
      );
    },
    quiet(group) {
      const wired = live.get(group.bit);
      wired?.stop?.();
      if (wired) wired.stop = null;
    },

    start() {
      this.listening = true;
      for (const g of this.groups) this.listen(g);
      addEventListener("online", () => this.soon(0));
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) return;
        // Back from the background: the connections may have died meanwhile without saying so
        for (const { pool } of live.values()) pool.drop();
        this.soon(0);
      });
      setInterval(() => {
        if (!document.hidden) this.soon(0);
      }, EVERY_MS);
      this.soon(0);
    },

    /** The group with this key on this device, if any. */
    find(groupKey) {
      return this.groups.find((g) => sameKey(hexToBytes(g.key), groupKey)) ?? null;
    },
    /** Start syncing with a group, new or joined: its key is 32 bytes (keys.js). */
    async add(groupKey) {
      const found = this.find(groupKey);
      if (found) return found;
      const used = new Set(this.groups.map((g) => g.bit));
      let bit = GROUP_BITS.from;
      while (used.has(bit)) bit++;
      if (bit > GROUP_BITS.to) throw new GroupFullError("This device is in as many groups as it can be.");
      const group = {
        k: `group:${bit}`,
        bit,
        key: bytesToHex(groupKey),
        device: bytesToHex(crypto.getRandomValues(new Uint8Array(8))),
        relays: [...relays],
        epoch: 0,
        chunks: 0,
        recent: [],
        at: {},
        heads: {},
        last: null,
      };
      // A bit an earlier group left behind is cleared before this one uses it
      this.device.clearBit(bit);
      this.groups.push(group);
      this.groups.sort((a, b) => a.bit - b.bit);
      await wire(group);
      this.listen(group);
      await this.device.persist([["put", { ...group }]]);
      this.notify();
      this.soon(0);
      return group;
    },
    /** Pause a group on this device, or resume it (and sync soon). A round already running finishes as it is. */
    async setPaused(bit, paused) {
      const group = this.groups.find((g) => g.bit === bit);
      if (!group) throw new Error(`No group with bit ${bit}.`);
      group.paused = paused;
      if (paused) this.quiet(group);
      else this.listen(group);
      await this.device.persist([["put", { ...group }]]);
      this.notify();
      if (!paused) this.soon(0);
    },
    /**
     * Leave a group on this device. What it shared stays here, and with the others. The relays are asked to delete
     * this device's events in it (NIP-09), without waiting: they may or may not, and the events are encrypted anyway.
     */
    async remove(bit) {
      const group = this.groups.find((g) => g.bit === bit);
      if (group) this.quiet(group);
      this.groups = this.groups.filter((g) => g.bit !== bit);
      const wired = live.get(bit);
      live.delete(bit);
      if (wired && group)
        forgetEvents({ group, ...wired })
          .catch(() => {})
          .finally(() => wired.pool.close());
      this.device.clearBit(bit);
      await this.device.persist([["delete", `group:${bit}`]]);
      this.notify();
    },

    /** Name this device, for every group's other devices: {label, kind} ("phone", "tablet" or "computer"). */
    async setMe(me) {
      this.me = { label: String(me.label).trim().slice(0, 60), kind: me.kind ?? "" };
      await store.write([["put", { k: "me", ...this.me }]]);
      this.notify();
      this.soon(0);
    },

    /** Close every group's connections (in tests). */
    close() {
      this.listening = false;
      clearTimeout(this.timer);
      for (const { pool } of live.values()) pool.close();
    },

    soon(ms = AFTER_CHANGE_MS) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.now(), ms);
    },
    active() {
      return this.groups.filter((g) => !g.paused);
    },
    async now() {
      if (!this.active().length) return;
      if (this.running) {
        this.again = true;
        return;
      }
      this.running = true;
      this.notify();
      let applied = 0;
      let retry = null;
      try {
        for (const group of [...this.groups]) {
          if (!live.has(group.bit) || group.paused) continue; // removed meanwhile, or paused
          const { keys, pool } = live.get(group.bit);
          try {
            const report = await syncGroup({ app, group, keys, device: this.device, pool, me: this.me ?? {} });
            applied += report.applied;
            group.last = { at: Date.now(), ok: true, error: null, report };
            group.tries = 0;
          } catch (error) {
            if ((group.tries ?? 0) < this.retryDelays.length) {
              // keep the last result showing for now, and try again soon
              const wait = this.retryDelays[group.tries ?? 0] + Math.random() * 1000;
              group.tries = (group.tries ?? 0) + 1;
              retry = retry === null ? wait : Math.min(retry, wait);
              continue;
            }
            group.tries = 0;
            group.last = { at: Date.now(), ok: false, error: error.message || String(error), report: null };
          }
        }
        // The records' bits are saved with the groups' state, in one transaction
        await this.device.persist(this.groups.map((g) => ["put", { ...g }]));
        if (applied) onSynced?.();
        if (retry !== null) this.soon(retry);
      } finally {
        this.running = false;
        this.notify();
        if (this.again) {
          this.again = false;
          this.soon(0);
        }
      }
    },

    status() {
      const groups = this.groups.map((g) => ({
        bit: g.bit,
        name: groupName(liveLook(g)),
        look: liveLook(g),
        paused: !!g.paused,
        last: g.last,
        relays: g.relays.map((url) => ({
          url,
          host: hostOf(url),
          ...(g.relayState?.[url] ?? { read: null, wrote: null }),
        })),
        lacks: this.device.lacks(g.bit),
        devices: devicesOf(g),
      }));
      return {
        running: this.running,
        groups,
        active: groups.filter((g) => !g.paused).length,
        failing: groups.some((g) => !g.paused && g.last && !g.last.ok),
      };
    },
    /** The group's key, for its codes (code.js). */
    keyOf(bit) {
      const g = this.groups.find((x) => x.bit === bit);
      return g ? hexToBytes(g.key) : null;
    },
    /** The bits of this device's groups (`active`: those not paused), for counting what's on no group or server. */
    bits(active = false) {
      return (active ? this.active() : this.groups).map((g) => g.bit);
    },
  };

  /**
   * A group's other devices, as their status says, the most recently online first: {id, label, kind, online,
   * hasAllMine, haveAllTheirs}.
   */
  function devicesOf(g) {
    return Object.entries(g.peers ?? {})
      .filter(([id]) => id !== g.device)
      .map(([id, p]) => ({ id, label: p.label, kind: p.kind, online: p.online, ...compare(g, id) }))
      .sort((a, b) => b.online - a.online);
  }

  function liveLook(g) {
    return live.get(g.bit).keys.look;
  }
}
