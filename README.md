<p align="center"><img src="public/icons/listikka-icon.svg" width="96" height="96" alt=""></p>

<h1 align="center">Listikka</h1>

<p align="center">
  <img src="docs/screenshots/lists.png" width="250" alt="Lists for a supermarket and a pharmacy, with ticked items crossed out">
  <img src="docs/screenshots/adding.png" width="250" alt="Typing Co in the supermarket list offers back Coffee, removed earlier, above the field">
  <img src="docs/screenshots/item.png" width="250" alt="An item's sheet: Milk, 2 l, in Supermarket, with the note Lactose free">
</p>

Lists for shopping and more. Lists hold items, and removed items stay remembered as suggestions until deleted
permanently. Everything is kept on the device; it can also sync between devices through a
[Lokki](https://github.com/joakimnordling/lokki) sync server, where every field of an item merges on its own.

It runs in the browser at [listikka.jocke.fi](https://listikka.jocke.fi), works offline, and can be added to a phone's
home screen.

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

## Storage

`src/data/` keeps every list and item in memory and in IndexedDB, in the protocol's shape with its server bits
(`sb`). A change made on this device is merged with the version kept here and saved with no bits, so every server
gets it.

## Sync

Listikka syncs with Lokki's sync package, copied into `vendor/lokki-sync` and pinned to one Lokki commit
(`vendor/lokki-sync/LOKKI_COMMIT`). To take a newer one, run `scripts/update-sync.sh [commit]` and check that its
dependencies match `package.json`. `src/sync/app.js` holds Listikka's settings for it: the name `listikka`, the kinds
`list` and `item`, and the field-by-field merge. `src/sync/device.js` is the engine's device over the store, and `src/sync/manager.js`
the shared manager with Listikka's settings.

## Screens

`src/app.js` draws the app from the stored records and changes them only through the core's list actions, so every
change gets its timestamps and merges with other devices' changes. Which lists are open, which hide ticked items,
drafts and the theme are each device's own, kept in localStorage. `public/` holds the page, the stylesheet, the
manifest and the app icons; `npm run app-icons` redraws the PNG icons from `public/icons/listikka-icon.svg`. The
icons inside the app come from Lucide: `scripts/build-icons.js` lists the ones in use, and `npm run icons` regenerates
`src/ui/lucide.js` from the `lucide-static` package; a test fails when it's out of date.

## Development

Needs Node 22 or later.

```sh
npm install
npm test
npm run lint
npm run build        # the site in dist/site
npm run serve        # dist/site on http://localhost:8080
npm run screenshots  # regenerate docs/screenshots after a visual change
```

## Tests

- `npm test`: unit tests of the core, storage, sync settings and icons (`tests/unit`).
- `npm run test:sync`: devices made of the app's store and sync manager, syncing through Lokki's Python server
  (`tests/sync`): joining the vault, field-by-field merges, deletes and the passphrase.
- `npm run test:e2e`: builds the site and drives it in Chromium (`tests/e2e`): items, lists, gestures, the menus,
  scanning a QR code with a fake camera, and setting up sync against the server.

The sync and end-to-end tests need [uv](https://docs.astral.sh/uv/) and Lokki's server, which
`scripts/fetch-lokki-server.sh` fetches into `.lokki/` at the Lokki commit the copied sync package came from. The
end-to-end tests also need Playwright's Chromium (`npx playwright install chromium`). CI runs all three.

Syncing needs a [Lokki sync server](https://github.com/joakimnordling/lokki/tree/main/servers/python) that lists the
app's origin in `LOKKI_CORS_ORIGINS`, for example `["https://listikka.jocke.fi"]`.

## Deploying

Every push to `main` builds the site and publishes it on GitHub Pages (`.github/workflows/pages.yml`), at
listikka.jocke.fi (`CNAME`, written by the build).

## License

[MIT](LICENSE). Third-party material is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
