# Third-party notices

The bundled H5 runtime executes only the exact files registered in
`src/infrastructure/browser/h5-runtime-registry.ts`:

- **Preact 10.27.2** and **Preact Hooks 10.27.2**, MIT license. Source and
  license: <https://github.com/preactjs/preact/tree/10.27.2>
- **HTM 3.1.1**, Apache License 2.0. Source and license:
  <https://github.com/developit/htm/tree/3.1.1>
- **Apache ECharts 5.6.0**, Apache License 2.0. Source and license:
  <https://github.com/apache/echarts/tree/5.6.0>
- **Phaser 3.90.0**, MIT license. Source and license:
  <https://github.com/phaserjs/phaser/tree/v3.90.0>

The exact registered files are stored in one ZIP bundled with the signed App.
The installed App verifies the archive and every entry, extracts one global
read-only copy, and performs no runtime CDN download. The maintainer-only bundle
generator uses npmmirror, BootCDN or Staticfile as mainland-friendly sources
and jsDelivr or UNPKG as global fallbacks. A source file is accepted into the
ZIP only when its byte length and SHA-256 match the registry. The ZIP digest,
source list, versions, hashes, and this notice must change together in a
reviewed app release.

The bundled H5 resource catalog also contains fixed, scanned, read-only files:

- **Bootstrap Icons 1.13.1**, MIT license, <https://icons.getbootstrap.com/>.
- **Kenney UI Pack 2.0**, Creative Commons Zero 1.0, <https://kenney.nl/assets/ui-pack>.
- **Kenney 1-Bit Pack 1.2**, Creative Commons Zero 1.0, <https://kenney.nl/assets/1-bit-pack>.

Only the Bootstrap icon font/CSS/index, the Blue and Extra Default PNG subset
and fonts from Kenney UI Pack, and the tilesheets/example Tilemaps from Kenney
1-Bit Pack are bundled. Their source archives, selected paths, dimensions,
MIME types, byte lengths, and SHA-256 values are pinned by
`scripts/build-h5-resource-bundle.ts`. The installed App validates the archive
and every file before extracting one global cache copy.
