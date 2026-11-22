/* A group's code, to join it from another device: the 32-byte group key in Crockford base32 (52 characters), plus
   Crockford's check symbol (the key as a number mod 37), so a typo is caught instead of joining a group nobody is in.
   Shown in groups of four; typed in any case, with or without spaces and dashes, and with O for 0 and I or L for 1,
   as Crockford base32 allows. The QR code holds it as a link: listikka:join?k=<code>. */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CHECK = `${ALPHABET}*~$=U`;
const LENGTH = 53; // 52 for 256 bits (the last character holds 1 bit and four zeros), and the check symbol

export class CodeError extends Error {}

const toBig = (bytes) => bytes.reduce((n, b) => (n << 8n) | BigInt(b), 0n);

/** The code for a group key, without spaces: 53 characters. */
export function encodeCode(groupKey) {
  if (groupKey.length !== 32) throw new Error("A group key is 32 bytes.");
  const n = toBig(groupKey);
  const padded = n << 4n; // 256 bits + 4 = 260 = 52 × 5
  let out = "";
  for (let i = 51; i >= 0; i--) out += ALPHABET[Number((padded >> BigInt(i * 5)) & 31n)];
  return out + CHECK[Number(n % 37n)];
}

/** The code as people see it: groups of four, the check symbol joining the last group. */
export const showCode = (code) => code.slice(0, 52).match(/.{4}/g).join(" ").concat(code.slice(52));

/** The group key in a typed or scanned code, or a CodeError when it isn't a group's code. */
export function decodeCode(text) {
  const s = String(text).toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (s.length !== LENGTH) throw new CodeError("This code isn't right: it should have 53 characters.");
  let padded = 0n;
  for (const c of s.slice(0, 52)) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) throw new CodeError("This code isn't right: it has a character codes don't use.");
    padded = (padded << 5n) | BigInt(v);
  }
  if (padded & 15n) throw new CodeError("This code isn't right.");
  const n = padded >> 4n;
  if (CHECK[Number(n % 37n)] !== s[52]) throw new CodeError("This code isn't right: check it for a typo.");
  const key = new Uint8Array(32);
  for (let i = 31, m = n; i >= 0; i--, m >>= 8n) key[i] = Number(m & 255n);
  return key;
}

/** The link in a group's QR code. */
export const joinLink = (groupKey) => `listikka:join?k=${encodeCode(groupKey)}`;

/** The group key in a scanned QR code's text, or a typed code; a CodeError otherwise. */
export function readJoin(text) {
  const t = String(text).trim();
  const link = /^listikka:join\?(.*)$/i.exec(t);
  if (!link) return decodeCode(t);
  const k = new URLSearchParams(link[1]).get("k");
  if (!k) throw new CodeError("This QR code isn't a Listikka group's.");
  return decodeCode(k);
}
