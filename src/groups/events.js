/* A device's events in a group, on Nostr relays. Every event is addressable (kind 30078, application data), so a
   relay keeps only the newest one of each d tag, and each device writes only its own:

     chunk/0, chunk/1, …   the device's records, packed until each passes about 16 KB; changed only when compacting
     recent                every record changed since the last compaction
     status                the device's name, when it was online, and its digests (planned)

   An event's d tag is an HMAC of "<device>/<name>" (keys.js), and its content is the event's body as canonical JSON,
   padded as Lokki's rows are, encrypted with AES-GCM under the group's encryption key, with the d tag bound in as
   additional data: base64 of the 12-byte nonce followed by the ciphertext. The body says which device and event it
   is, so a relay can't pass one device's event off as another's. Events are signed with the group's key (NIP-01). */
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { canonicalJson, pad } from "../../vendor/lokki-sync/crypto.js";
import { dTag } from "./keys.js";

export const KIND = 30078;
export const FORMAT = 1;
export const CHUNK_TARGET = 16 * 1024;

const enc = new TextEncoder();
const dec = new TextDecoder();

export class EventError extends Error {}

const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const aad = (d) => enc.encode(`listikka/group/v1/event/${d}`);

/** NIP-01's event ID: the SHA-256 of the serialised event, as hex. */
export const eventId = (e) =>
  bytesToHex(sha256(enc.encode(JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]))));

/**
 * When to date an event that replaces one dated `last`: now, in whole seconds, but always later than `last`, as
 * relays keep the newest (and, on a tie, the one with the lowest ID).
 */
export function nextCreatedAt(last, now = Date.now()) {
  const at = Math.max(Math.floor(now / 1000), (last ?? 0) + 1);
  // Relays refuse events dated more than about 15 minutes ahead (strfry's default). Ahead only by publishing faster
  // than once a second, or by a clock that was wrong: then wait for the time to catch up.
  if (at > Math.floor(now / 1000) + MAX_AHEAD) throw new EventError("Too many changes at once. Syncing again soon.");
  return at;
}
/** How far ahead of now an event may be dated, in seconds. */
export const MAX_AHEAD = 600;

/** A signed event holding `body` for `device`'s event `name`. */
export async function sealEvent(keys, { device, name, body, createdAt }) {
  const d = await dTag(keys, device, name);
  const plain = pad(canonicalJson({ v: FORMAT, device, name, ...body }));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(d) }, keys.encrypt, plain),
  );
  const event = {
    kind: KIND,
    pubkey: keys.pubkey,
    created_at: createdAt,
    tags: [["d", d]],
    content: toBase64(new Uint8Array([...nonce, ...sealed])),
  };
  event.id = eventId(event);
  event.sig = bytesToHex(schnorr.sign(hexToBytes(event.id), keys.secret));
  return event;
}

/**
 * The body of one of the group's events: {v, device, name, …}. An EventError for anything else: another author or
 * kind, a wrong ID or signature, content that doesn't decrypt, or a body that doesn't match its d tag. A newer
 * format is an EventError too, with `newer` set.
 */
export async function openEvent(keys, event) {
  const no = (why) => {
    throw new EventError(why);
  };
  if (event?.kind !== KIND || event.pubkey !== keys.pubkey) no("not this group's");
  if (eventId(event) !== event.id) no("wrong ID");
  let signed = false;
  try {
    signed = schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey));
  } catch {}
  if (!signed) no("wrong signature");
  const d = event.tags?.find((t) => t[0] === "d")?.[1];
  if (typeof d !== "string") no("no d tag");
  let plain;
  try {
    const data = fromBase64(event.content);
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: data.slice(0, 12), additionalData: aad(d) },
      keys.encrypt,
      data.slice(12),
    );
  } catch {
    no("doesn't decrypt");
  }
  let body;
  try {
    body = JSON.parse(dec.decode(plain).trimEnd());
  } catch {
    no("damaged");
  }
  if (body?.v !== FORMAT) {
    const e = new EventError("a format this app doesn't know");
    e.newer = Number.isInteger(body?.v) && body.v > FORMAT;
    throw e;
  }
  if (typeof body.device !== "string" || typeof body.name !== "string") no("damaged");
  if ((await dTag(keys, body.device, body.name)) !== d) no("not the event it says it is");
  return body;
}

/**
 * Records packed into chunks: each takes records until its JSON passes `target` bytes, then the next one starts.
 * Lists come first and then items, each by ID, so the same records always pack the same way.
 */
export function packChunks(records, target = CHUNK_TARGET) {
  const sorted = [...records].sort((a, b) =>
    a.kind === b.kind ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.kind === "list" ? -1 : 1,
  );
  const chunks = [];
  let chunk = [];
  let size = 0;
  for (const r of sorted) {
    chunk.push(r);
    size += enc.encode(canonicalJson(r)).length + 1;
    if (size > target) {
      chunks.push(chunk);
      chunk = [];
      size = 0;
    }
  }
  if (chunk.length || !chunks.length) chunks.push(chunk);
  return chunks;
}
