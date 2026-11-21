/* A group's keys. The group key is 32 random bytes, shared by every device in the group through its code; every
   other key comes from it by HKDF-SHA256, each with a label of its own, so knowing one shows nothing of the others:

     listikka/group/v1/encrypt   AES-GCM key for the content of events
     listikka/group/v1/sign      the group's Nostr secret key: secp256k1, used for Schnorr signatures (NIP-01). In
                                 the very rare case the bytes aren't a valid secret key, …/sign/1, …/sign/2 and so on
     listikka/group/v1/tags      HMAC-SHA256 key for the events' d tags, so relays see nothing of what an event holds
     listikka/group/v1/look      bytes for the group's name and picture (look.js), which are shown on screen

   All devices sign with the same derived key, so a group is one author to relays. */
import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const enc = new TextEncoder();
const label = (what) => `listikka/group/v1/${what}`;

/** A new group key: 32 random bytes. */
export const newGroupKey = () => crypto.getRandomValues(new Uint8Array(32));

async function hkdf(groupKey, info, length = 32) {
  const base = await crypto.subtle.importKey("raw", groupKey, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(info) },
    base,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** The group's Nostr secret key: the first of …/sign, …/sign/1, … that's a valid secp256k1 secret key. */
export async function signingSecret(groupKey) {
  for (let i = 0; ; i++) {
    const secret = await hkdf(groupKey, label(i ? `sign/${i}` : "sign"));
    if (secp256k1.utils.isValidSecretKey(secret)) return secret;
  }
}

/** Everything derived from a group key: {encrypt, tags (CryptoKeys), secret, pubkey (hex), look (32 bytes)}. */
export async function groupKeys(groupKey) {
  if (!(groupKey instanceof Uint8Array) || groupKey.length !== 32) throw new Error("A group key is 32 bytes.");
  const [encrypt, tags, secret, look] = await Promise.all([
    hkdf(groupKey, label("encrypt")).then((b) =>
      crypto.subtle.importKey("raw", b, "AES-GCM", false, ["encrypt", "decrypt"]),
    ),
    hkdf(groupKey, label("tags")).then((b) =>
      crypto.subtle.importKey("raw", b, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
    ),
    signingSecret(groupKey),
    hkdf(groupKey, label("look")),
  ]);
  return { encrypt, tags, secret, pubkey: bytesToHex(schnorr.getPublicKey(secret)), look };
}

/** The d tag of a device's event, such as "chunk/0", "recent" or "status": hex HMAC of "<device>/<name>". */
export async function dTag(keys, device, name) {
  const mac = await crypto.subtle.sign("HMAC", keys.tags, enc.encode(`${device}/${name}`));
  return bytesToHex(new Uint8Array(mac));
}
