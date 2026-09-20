# FoLocal clipper core

`vendor/` contains an unmodified snapshot of the user's `web-clipper-core` source.
The upstream package declares the MIT license. Its commit and per-file SHA-256
checksums are recorded in `upstream.json`. This snapshot makes builds independent
of a sibling checkout or a private registry; update it deliberately from upstream.

`src/source-article.ts` adds source-page extraction for FoLocal. Its input is an
HTML snapshot acquired from the original website, never an RSS body. Generic
pages use Mozilla Readability; WeChat pages use the shared upstream adapter.
Markdown images receive unique placeholders for verified asset localization.

Run `pnpm --filter @follow/clipper-core typecheck` and
`pnpm --filter @follow/clipper-core test` when updating the snapshot or wrapper.
