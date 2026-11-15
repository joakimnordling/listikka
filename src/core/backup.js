/* Listikka backup format: JSON Lines, one object per line.
     {"kind":"header","format":"listikka","version":1,"exported":"<UTC ISO time>","app":"listikka-web"}   first line
     {"kind":"list",...} and {"kind":"item",...}: the records exactly as kept (src/core/records.js), deleted ones too
     {"kind":"footer"}                                                                                    last line
   Lines of other kinds are skipped, so a newer Listikka can add some. A file that doesn't end with the footer line is
   refused as incomplete. Restoring merges each record as a sync does (src/core/merge.js): per field, the newer change
   wins, so nothing changed here since the backup is overwritten, and what was deleted permanently stays deleted. */
import { sameRecord } from "../../vendor/lokki-sync/crypto.js";
import { merge } from "./merge.js";
import { isLive, KINDS } from "./records.js";

export const BACKUP_VERSION = 1;

/** The backup of these records, as text. */
export function backupText(records, now = new Date()) {
  const lines = [
    { kind: "header", format: "listikka", version: BACKUP_VERSION, exported: now.toISOString(), app: "listikka-web" },
    // lists first, so a list comes before its items, and in a stable order
    ...KINDS.flatMap((k) => records.filter((r) => r.kind === k).sort((a, b) => (a.id < b.id ? -1 : 1))),
    { kind: "footer" },
  ];
  return `${lines.map((o) => JSON.stringify(o)).join("\n")}\n`;
}

const okId = (x) => typeof x === "string" && /^[A-Za-z0-9_\-.:@+]{1,200}$/.test(x);
const okTs = (ts) =>
  ts && typeof ts === "object" && Object.values(ts).every((t) => Number.isFinite(t) && t >= 0) && !Array.isArray(ts);
const STRINGS = ["list", "name", "q", "note", "s", "o"];
function okRecord(o) {
  if (!okId(o.id) || !okTs(o.ts)) return false;
  if (o.d === true) return true;
  if (o.d !== undefined) return false;
  if (STRINGS.some((f) => o[f] !== undefined && typeof o[f] !== "string")) return false;
  return o.kind === "list" ? typeof o.name === "string" : typeof o.name === "string" || o.name === undefined;
}

/** {header, records} from a backup's text, or {error} saying why it can't be restored. */
export function parseBackup(text) {
  const no = (error) => ({ error });
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const json = (l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  };
  const h = json(lines[0] || "");
  if (h?.kind !== "header" || h.format !== "listikka") return no("This isn't a Listikka backup.");
  if (!Number.isInteger(h.version) || h.version < 1) return no("This backup's header is damaged.");
  if (h.version > BACKUP_VERSION) return no("This backup was made by a newer version of Listikka.");
  const f = lines.length > 1 ? json(lines[lines.length - 1]) : null;
  if (f?.kind !== "footer") return no("This backup is incomplete: its last line is missing. Nothing was restored.");
  const records = [];
  for (let i = 1; i < lines.length - 1; i++) {
    const o = json(lines[i]);
    if (!o || typeof o !== "object" || Array.isArray(o)) return no(`Line ${i + 1} is damaged. Nothing was restored.`);
    if (KINDS.includes(o.kind)) {
      if (!okRecord(o)) return no(`Line ${i + 1} isn't a valid ${o.kind}. Nothing was restored.`);
      records.push(o);
    } else if (o.kind === "header" || o.kind === "footer")
      return no(`Line ${i + 1} is out of place. Nothing was restored.`);
  }
  return { header: h, records };
}

/**
 * What restoring would do here. get(kind, id): the record kept here, or null.
 * Returns {has: {list, item}, added: {list, item}, changed: {list, item}, records}: what the backup has (not
 * deleted), what restoring adds and changes, and the records that would change, to pass to the store.
 */
export function planRestore(records, get) {
  const zero = () => ({ list: 0, item: 0 });
  const p = { has: zero(), added: zero(), changed: zero(), records: [] };
  for (const r of records) {
    if (isLive(r)) p.has[r.kind]++;
    const cur = get(r.kind, r.id);
    if (!cur) {
      if (!isLive(r)) continue;
      p.added[r.kind]++;
    } else if (sameRecord(merge(cur, r), cur)) continue;
    else p.changed[r.kind]++;
    p.records.push(r);
  }
  return p;
}
