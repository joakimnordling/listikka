// Listikka's settings for Lokki's sync package (vendor/lokki-sync): its name, its two kinds of record, and the
// field-by-field merge. The name is in every key label and every text bound into the encryption, as "listikka/...",
// so Listikka's keys never open Lokki's rows, and the other way round.
import { merge } from "../core/merge.js";

export const LISTIKKA = { name: "listikka", kinds: ["list", "item"], merge: (remote, local) => merge(remote, local) };
