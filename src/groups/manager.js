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
import { groupKeys } from "./keys.js";
import { groupName } from "./look.js";
import { RelayPool } from "./relay.js";
import { syncGroup } from "./sync.js";

export const GROUP_BITS = { from: 15, to: 30 };

/** The public relays a new group uses. Every event goes to all of them, so the group works while any one does. */
export const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net", "wss://nostr.mom"];

const EVERY_MS = 60000;
const AFTER_CHANGE_MS = 3000;

const sameKey = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export class GroupFullError extends Error {}

export function createGroups({ app, store, makeDevice, relays = DEFAULT_RELAYS, relayOptions, onSynced }) {
  const live = new Map(); // bit -> {keys, pool}
  async function wire(group) {
    live.get(group.bit)?.pool.close();
    live.set(group.bit, {
      keys: await groupKeys(hexToBytes(group.key)),
      pool: new RelayPool(group.relays, relayOptions),
    });
  }
  return {
    groups: [],
    running: false,
    again: false,
    timer: 0,
    device: null,
    listeners: new Set(),

    async load() {
      const rows = await store.all();
      this.groups = rows.filter((r) => r.k.startsWith("group:")).sort((a, b) => a.bit - b.bit);
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
    start() {
      addEventListener("online", () => this.soon(0));
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) this.soon(0);
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
      await this.device.persist([["put", { ...group }]]);
      this.notify();
      this.soon(0);
      return group;
    },
    /** Stop syncing with a group on this device. What it shared stays here, and in the group. */
    async remove(bit) {
      this.groups = this.groups.filter((g) => g.bit !== bit);
      live.get(bit)?.pool.close();
      live.delete(bit);
      this.device.clearBit(bit);
      await this.device.persist([["delete", `group:${bit}`]]);
      this.notify();
    },

    soon(ms = AFTER_CHANGE_MS) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.now(), ms);
    },
    async now() {
      if (!this.groups.length) return;
      if (this.running) {
        this.again = true;
        return;
      }
      this.running = true;
      this.notify();
      let applied = 0;
      try {
        for (const group of [...this.groups]) {
          if (!live.has(group.bit)) continue; // removed meanwhile
          const { keys, pool } = live.get(group.bit);
          try {
            const report = await syncGroup({ app, group, keys, device: this.device, pool });
            applied += report.applied;
            group.last = { at: Date.now(), ok: true, error: null, report };
          } catch (error) {
            group.last = { at: Date.now(), ok: false, error: error.message || String(error), report: null };
          }
        }
        // The records' bits are saved with the groups' state, in one transaction
        await this.device.persist(this.groups.map((g) => ["put", { ...g }]));
        if (applied) onSynced?.();
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
        last: g.last,
        lacks: this.device.lacks(g.bit),
      }));
      return {
        running: this.running,
        groups,
        failing: groups.some((g) => g.last && !g.last.ok),
      };
    },
    /** The bits of this device's groups, for counting changes no group or server has. */
    bits() {
      return this.groups.map((g) => g.bit);
    },
  };

  function liveLook(g) {
    return live.get(g.bit).keys.look;
  }
}
