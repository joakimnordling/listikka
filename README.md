# Listikka

A shared shopping list. Lists hold items, every field of an item merges on its own, and removed items stay
remembered as suggestions until deleted permanently. It syncs end-to-end encrypted through a server you choose,
using the same sync protocol and server as [Lokki](https://github.com/joakimnordling/lokki).

Work in progress: this repository holds the core so far.

## Core

`src/core/` is plain JavaScript with no browser APIs, so it runs and is tested in Node:

- `records.js`: lists and items, with a timestamp per field; clearing a field keeps its timestamp; a permanent
  delete leaves a small tombstone.
- `merge.js`: merging two versions of a record, field by field, with a permanent delete always winning. The merge
  is commutative, associative and idempotent, so every device ends up with the same record.
- `order.js`: fractional sort keys, so moving one item writes only that item.
- `lists.js`: what the screens do: add, tick, remove, add back, move, remove ticked, remove and delete lists, and
  suggestions while typing.
- `clock.js`: a monotonic clock for the timestamps.

## Sync

Listikka syncs with Lokki's sync package, copied into `vendor/lokki-sync` and pinned to one Lokki commit
(`vendor/lokki-sync/LOKKI_COMMIT`). To take a newer one, run `scripts/update-sync.sh [commit]` and check that its
dependencies match `package.json`. `src/sync/app.js` holds Listikka's settings for it: the name `listikka`, the kinds
`list` and `item`, and the field-by-field merge.

## Development

Needs Node 22 or later.

```sh
npm install
npm test
npm run lint
```

## Licence

MIT. See `THIRD_PARTY_NOTICES.md` for what Listikka uses from others.
