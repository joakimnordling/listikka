// A tiny Nostr relay for tests (NIP-01, with addressable events): it checks each event's ID and signature, keeps only
// the newest of each kind/author/d tag, answers REQ with what matches and EOSE, and sends later matches to open
// subscriptions. Public relays can't be reached from where these tests run, and shouldn't be used by them anyway.
import { schnorr } from "@noble/curves/secp256k1.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { WebSocketServer } from "ws";
import { eventId } from "../../src/groups/events.js";

const addressable = (e) => e.kind >= 30000 && e.kind < 40000;
const dOf = (e) => e.tags.find((t) => t[0] === "d")?.[1] ?? "";
const newer = (a, b) => a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);

function matches(f, e) {
  if (f.ids && !f.ids.includes(e.id)) return false;
  if (f.authors && !f.authors.includes(e.pubkey)) return false;
  if (f.kinds && !f.kinds.includes(e.kind)) return false;
  if (f["#d"] && !f["#d"].includes(dOf(e))) return false;
  if (f.since && e.created_at < f.since) return false;
  if (f.until && e.created_at > f.until) return false;
  return true;
}

function valid(e) {
  try {
    return eventId(e) === e.id && schnorr.verify(hexToBytes(e.sig), hexToBytes(e.id), hexToBytes(e.pubkey));
  } catch {
    return false;
  }
}

/** A relay on a free port: {url, events (Map), published (count), refuse (set true to refuse events), close()} */
export async function startRelay() {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((r) => wss.once("listening", r));
  const relay = {
    url: `ws://127.0.0.1:${wss.address().port}`,
    events: new Map(),
    published: 0,
    refuse: false,
    close: () =>
      new Promise((r) => {
        for (const c of wss.clients) c.terminate();
        wss.close(r);
      }),
  };
  const subs = new Map(); // ws -> Map(id -> filters)
  wss.on("connection", (ws) => {
    subs.set(ws, new Map());
    ws.on("close", () => subs.delete(ws));
    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return ws.send(JSON.stringify(["NOTICE", "not JSON"]));
      }
      const [type, ...rest] = msg;
      if (type === "EVENT") {
        const e = rest[0];
        if (relay.refuse) return ws.send(JSON.stringify(["OK", e?.id, false, "blocked: not taking events"]));
        if (!valid(e)) return ws.send(JSON.stringify(["OK", e?.id, false, "invalid: bad id or signature"]));
        const key = addressable(e) ? `${e.kind}:${e.pubkey}:${dOf(e)}` : e.id;
        const had = relay.events.get(key);
        if (had && !newer(e, had)) return ws.send(JSON.stringify(["OK", e.id, true, "duplicate: have a newer one"]));
        relay.events.set(key, e);
        relay.published++;
        ws.send(JSON.stringify(["OK", e.id, true, ""]));
        for (const [client, open] of subs)
          for (const [id, filters] of open)
            if (filters.some((f) => matches(f, e))) client.send(JSON.stringify(["EVENT", id, e]));
      } else if (type === "REQ") {
        const [id, ...filters] = rest;
        const found = [...relay.events.values()]
          .filter((e) => filters.some((f) => matches(f, e)))
          .sort((a, b) => b.created_at - a.created_at);
        for (const e of found) ws.send(JSON.stringify(["EVENT", id, e]));
        ws.send(JSON.stringify(["EOSE", id]));
        subs.get(ws).set(id, filters);
      } else if (type === "CLOSE") subs.get(ws)?.delete(rest[0]);
    });
  });
  return relay;
}

/** A URL where no relay answers. */
export const NOWHERE = "ws://127.0.0.1:9";
