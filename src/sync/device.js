/* Listikka's data as a device for the sync engine (vendor/lokki-sync/engine.js). Records are already in the
   protocol's shape, so nothing is converted: the store keeps each with its server bits (sb). Rows that servers hold in
   a format this device can't read (a newer Listikka's) are kept by row name in the sync store,
   "unreadable:<key>" -> {bits}, so nothing is pushed over them (protocol 7.5). */

export class ListikkaDevice {
  /**
   * store: the app's store (src/data/store.js); vault: {keyring, save(keyring)}; unreadable: the sync store's
   * "unreadable:<key>" rows.
   */
  constructor(store, vault, unreadable = []) {
    this.store = store;
    this.vault = vault;
    // Records whose bits changed since the last persist, as "kind\u0000id". Their rows are made when saving, from what's
    // in memory then: a row made earlier could hold an older version, edited since, and overwrite the edit
    this.dirty = new Map();
    this.unreadableRows = new Map(unreadable.map((r) => [r.k.slice("unreadable:".length), r.bits]));
    this.unreadableDirty = new Set();
  }

  keyring() {
    return this.vault.keyring;
  }
  setKeyring(keyring) {
    this.vault.save(keyring);
  }
  get(kind, id) {
    return this.store.get(kind, id);
  }
  /** Records that won or were merged: only `bit` set on them, or none for `bit` null (a change every server lacks). */
  async apply(records, bit) {
    await this.store.put(records, bit == null ? 0 : 1 << bit);
    this.store.changed();
  }
  #bits(kind, id, f) {
    if (this.store.setBits(kind, id, f(this.store.bits(kind, id)))) this.dirty.set(`${kind}\u0000${id}`, [kind, id]);
  }
  markHas(kind, id, bit) {
    this.#bits(kind, id, (b) => b | (1 << bit));
  }
  markLacks(kind, id, bit) {
    this.#bits(kind, id, (b) => b & ~(1 << bit));
  }
  /** Records the server lacks: lists first, so a list arrives before its items. */
  pending(bit) {
    const mask = 1 << bit;
    const lists = [];
    const items = [];
    for (const { record, sb } of this.store.entries())
      if (!(sb & mask)) (record.kind === "list" ? lists : items).push(record);
    return [...lists, ...items];
  }
  lacks(bit) {
    return this.pending(bit).length;
  }
  /** How many records a server lacks (for status), and how many no server has. */
  lacking(bits) {
    const all = bits.reduce((a, b) => a | (1 << b), 0);
    let missing = 0;
    let nowhere = 0;
    for (const { sb } of this.store.entries()) {
      if ((sb & all) !== all) missing++;
      if (!(sb & all)) nowhere++;
    }
    return { missing, nowhere };
  }
  /** Whether some change has reached none of these servers. */
  anyNowhere(bits) {
    const all = bits.reduce((a, b) => a | (1 << b), 0);
    for (const { sb } of this.store.entries()) if (!(sb & all)) return true;
    return false;
  }
  clearBit(bit) {
    for (const { record } of [...this.store.entries()]) this.markLacks(record.kind, record.id, bit);
    for (const key of [...this.unreadableRows.keys()]) this.clearUnreadable(key, bit);
  }
  unreadable(key) {
    return this.unreadableRows.get(key) ?? 0;
  }
  markUnreadable(key, bit) {
    const bits = this.unreadable(key) | (1 << bit);
    if (bits === this.unreadable(key)) return;
    this.unreadableRows.set(key, bits);
    this.unreadableDirty.add(key);
  }
  clearUnreadable(key, bit) {
    const before = this.unreadable(key);
    if (!(before & (1 << bit))) return;
    const left = before & ~(1 << bit);
    if (left) this.unreadableRows.set(key, left);
    else this.unreadableRows.delete(key);
    this.unreadableDirty.add(key);
  }
  get unreadableCount() {
    return this.unreadableRows.size;
  }
  all() {
    return [...this.store.lists(), ...this.store.items()];
  }
  /**
   * Save the bits changed since the last call together with `also` (the sync store's ["put", row] / ["delete", k]),
   * in one transaction: a row's unreadable bit must never be lost while the server's cursor is saved past it.
   */
  async persist(also = []) {
    const ops = [...this.dirty.values()].map(([kind, id]) => this.store.row(kind, id)).filter(Boolean);
    for (const key of this.unreadableDirty) {
      const bits = this.unreadableRows.get(key);
      ops.push(bits ? ["sync", "put", { k: `unreadable:${key}`, bits }] : ["sync", "delete", `unreadable:${key}`]);
    }
    ops.push(...also.map(([op, value]) => ["sync", op, value]));
    this.dirty.clear();
    this.unreadableDirty.clear();
    await this.store.db.write(ops);
  }
}
