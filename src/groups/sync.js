/* One round of syncing a group: read the other devices' events from the group's relays and merge them in, then
   publish what this device has that the group lacks.

   Each device publishes only its own events (events.js): its records packed into chunks, and the records it changed
   since then in "recent". When "recent" grows past a chunk's size, the device compacts: it publishes all its records
   as new chunks, and then an empty "recent". Merging is field by field with timestamps, and a deleted record stays
   deleted, so merging any version, old or new, in any order, ends in the same place: a reader merges every event it
   sees, and a compaction that stops half way loses nothing.

   A record's group bit (its server bits, sb) means this group has this version: this device published it, or got it
   from another device's events. A change made here, or one that came from a server, has no group bit, so it goes
   into "recent".

   The group's state is a row in the sync store, kept by manager.js and changed here:
     {k: "group:<bit>", bit, key, device, relays, epoch, chunks, recent, at, heads, last}
       device   this device's ID in the group (random)
       epoch    how many times this device compacted; chunks: how many chunks it published then
       recent   the records in this device's "recent", as "<kind>/<id>"
       at       the created_at of this device's last event of each name (events.js, nextCreatedAt)
       heads    the ID of the last event read for each d tag, so an unchanged event isn't opened again; emptied to read
                everything again, as after clearing this device's lists */
import { canonicalJson, sameRecord } from "../../vendor/lokki-sync/crypto.js";
import { CHUNK_TARGET, EventError, KIND, nextCreatedAt, openEvent, packChunks, sealEvent } from "./events.js";
import { RelayError } from "./relay.js";

const keyOf = (r) => `${r.kind}/${r.id}`;
const fromKey = (k) => {
  const at = k.indexOf("/");
  return [k.slice(0, at), k.slice(at + 1)];
};
const size = (records) => new TextEncoder().encode(canonicalJson(records)).length;

/**
 * Sync one group. `device` is Listikka's sync device (src/sync/device.js); `pool` the group's relays (relay.js);
 * `keys` its keys (keys.js). Returns a report: {pulled, applied, pushed, compacted, unreadable, newer, relays}.
 */
export async function syncGroup({ app, group, keys, device, pool, now = Date.now }) {
  const report = { pulled: 0, applied: 0, pushed: 0, compacted: false, unreadable: 0, newer: 0, relays: null };
  await pull({ app, group, keys, device, pool, report });
  await push({ group, keys, device, pool, now, report });
  return report;
}

async function pull({ app, group, keys, device, pool, report }) {
  const { events, answered, errors } = await pool.query({ kinds: [KIND], authors: [keys.pubkey] });
  report.relays = { answered, errors };

  // The newest event of each d tag that opens: relays keep only the newest, but one may send an older one, and
  // anyone can send an event with a later date that doesn't open
  const byD = new Map();
  for (const e of events) {
    const d = Array.isArray(e.tags) ? e.tags.find((t) => t[0] === "d")?.[1] : undefined;
    if (typeof d !== "string") continue;
    if (!byD.has(d)) byD.set(d, []);
    byD.get(d).push(e);
  }
  const read = []; // [{d, id, body}]
  for (const [d, list] of byD) {
    list.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1));
    for (const e of list) {
      if (group.heads[d] === e.id) break; // read before
      let body;
      try {
        body = await openEvent(keys, e);
      } catch (error) {
        if (!(error instanceof EventError)) throw error;
        if (error.newer) report.newer++;
        continue;
      }
      // This device's own events are read too: what they hold is in the group, and after this device's lists were
      // cleared, they come back from them. And the next one it publishes must be later.
      if (body.device === group.device) group.at[body.name] = Math.max(group.at[body.name] ?? 0, e.created_at);
      read.push({ d, id: e.id, body });
      break;
    }
  }

  // Every version of each record that came, merged into one: the order doesn't matter
  const remote = new Map();
  for (const { body } of read) {
    for (const r of Array.isArray(body.records) ? body.records : []) {
      if (!r || typeof r.id !== "string" || !app.kinds.includes(r.kind)) {
        report.unreadable++;
        continue;
      }
      report.pulled++;
      const k = keyOf(r);
      const seen = remote.get(k);
      remote.set(k, seen ? app.merge(r, seen) : r);
    }
  }

  // Decided and applied with no await in between, so a change made here meanwhile is never written over
  const winners = [];
  const merged = [];
  for (const record of remote.values()) {
    const local = device.get(record.kind, record.id);
    const result = local ? app.merge(record, local) : record;
    if (sameRecord(result, record)) {
      if (local && sameRecord(local, result)) device.markHas(record.kind, record.id, group.bit);
      else winners.push(result);
    } else if (!local || !sameRecord(result, local)) merged.push(result); // a change made here, for everyone
    // else: this device's version is newer, and is published (or waits to be) on its own
  }
  const saved = await Promise.allSettled([
    winners.length && device.apply(winners, group.bit),
    merged.length && device.apply(merged, null),
  ]);
  const failed = saved.find((r) => r.status === "rejected");
  if (failed) throw failed.reason;
  report.applied += winners.length + merged.length;
  for (const { d, id } of read) group.heads[d] = id;
}

async function publish({ group, keys, pool, now }, name, body) {
  const createdAt = nextCreatedAt(group.at[name], now());
  const event = await sealEvent(keys, { device: group.device, name, body, createdAt });
  const { accepted, results } = await pool.publish(event);
  if (!accepted) throw new RelayError(results.map((r) => `${r.url}: ${r.message}`).join("; ") || "No relays");
  group.at[name] = createdAt;
  group.heads[event.tags[0][1]] = event.id; // nothing to read in it
}

/** Mark records as in the group, if they're still the version that was published. */
function markSent(device, group, records) {
  for (const r of records) {
    const now = device.get(r.kind, r.id);
    if (now && sameRecord(now, r)) device.markHas(r.kind, r.id, group.bit);
  }
}

async function push({ group, keys, device, pool, now, report }) {
  const pending = device.pending(group.bit);
  if (!pending.length) return;
  const keys_ = new Set([...group.recent, ...pending.map(keyOf)]);
  const recent = [...keys_].map((k) => device.get(...fromKey(k))).filter(Boolean);
  const ctx = { group, keys, pool, now };
  if (size(recent) <= CHUNK_TARGET) {
    await publish(ctx, "recent", { records: recent, epoch: group.epoch, chunks: group.chunks });
    group.recent = recent.map(keyOf);
    markSent(device, group, recent);
    report.pushed += pending.length;
    return;
  }

  // Compacting: all of this device's records as new chunks, chunks it no longer needs emptied, and then "recent"
  const all = device.all();
  const chunks = packChunks(all);
  const epoch = group.epoch + 1;
  for (let n = 0; n < Math.max(chunks.length, group.chunks); n++)
    await publish(ctx, `chunk/${n}`, { records: chunks[n] ?? [], epoch, n, of: chunks.length });
  await publish(ctx, "recent", { records: [], epoch, chunks: chunks.length });
  group.epoch = epoch;
  group.chunks = chunks.length;
  group.recent = [];
  markSent(device, group, all);
  report.pushed += pending.length;
  report.compacted = true;
}
