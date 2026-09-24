# A6 Ammo Stats

A small Windows desktop app (Electron) for editing the ammo/damage stats of the
A6 Welliton weapon pack. It loads `Ammo.pbo` and `WeaponScripts.pbo`, lets you
browse and edit every caliber's ballistics and damage fields, and packs the
changes back into a pbo.

No knowledge of `config.cpp`/rapify internals is needed to use it — pick the
two pbos, edit fields in a normal form UI, and pack.

## Features

- Loads `Ammo.pbo` + `WeaponScripts.pbo` and lists every caliber found in
  `WeaponScripts.pbo\AmmoConfigs\<caliber>\`.
- Edits the real `CfgAmmo` fields per caliber: `hit`, `indirectHit`,
  `indirectHitRange`, `initSpeed`, `typicalSpeed`, `caliber`, `deflecting`,
  `airFriction`, `damageBarrel`, plus the paired `CfgMagazines` entry
  (`weight` / `count`), the `DamageApplied.{Health,Blood,Shock}.damage` /
  `Health.armorDamage` values, and `NoiseHit.strength`.
- Search/filter the caliber list, a pending-changes panel showing every
  old → new diff before you commit anything.
- Packing rewrites only the specific fields that changed, via a surgical
  text replacement scoped to the right class — every other byte of the
  original `config.cpp` is left untouched.

## Requirements

- Windows.
- [Node.js](https://nodejs.org/) (LTS) to run from source.
- **DayZ Tools installed via Steam** (`CfgConvert.exe`) if the pbo you load
  ships binarized configs (`config.bin` rather than plain-text
  `config.cpp` — the stock A6 `WeaponScripts.pbo` does). This is a real,
  currently-unavoidable dependency for that one step; see
  [Known limitations](#known-limitations).

## Running from source

```bash
cd electron
npm install
npm start
```

## Building an installer

```bash
cd electron
npm install
npm run dist
```

Produces an NSIS installer in `electron/dist/`.

## Project layout

```
app/                  Renderer UI (served locally by main.js) - HTML/CSS/JS, no build step
electron/
  main.js             Electron main process: window, local static server, IPC handlers
  preload.js           contextBridge API exposed to the renderer
  pbo/
    cpp-parser.js      Recursive-descent parser for DayZ/Arma config.cpp
    ammo-extract.js    Pulls the editable stat surface out of a parsed caliber config
    pbo-tools.js        Wraps external tools for the two binary-format steps (see below)
  vendor/              Small vendored tools PBOConsole.exe needs to unpack/pack .pbo archives
                        (PBOConsole.exe + PBOLib.DLL + MWCommon.DLL, from PBO Manager;
                        DeRap.exe is bundled but currently unused - see limitations)
```

## How it works

1. **Unpack** — `PBOConsole.exe` (vendored, no DayZ Tools needed) unpacks the
   two pbos to a temp folder.
2. **Derapify** — any `config.bin` found is converted to plain-text
   `config.cpp` via `CfgConvert.exe` (DayZ Tools).
3. **Parse** — `cpp-parser.js` parses every caliber's `config.cpp` into a
   tree (nested classes, arrays, inheritance).
4. **Extract** — `ammo-extract.js` reads the real editable fields out of that
   tree.
5. **Edit** — the UI lets you change values; nothing is written until you
   pack.
6. **Pack** — `main.js` applies only the changed fields as a scoped text
   replacement against the original `config.cpp` (the rest of the file is
   byte-identical to the source), then `PBOConsole.exe -pack` rebuilds the
   pbo.

## Known limitations

- **`CfgConvert.exe` (DayZ Tools) dependency**: derapifying `config.bin` is
  currently done via DayZ Tools' own `CfgConvert.exe`, which means DayZ
  Tools must be installed on the machine running this app. The original
  plan was to use a fully standalone derapifier (`DeRap.exe`, bundled in
  `vendor/` but currently unused) to avoid this — it hit a missing
  Universal C Runtime DLL on the dev machine that wasn't worth chasing
  further at the time. If you hit this, either install DayZ Tools via
  Steam, or pick up `DeRap.exe` again.
- The pbo archive unpack/pack step itself has no DayZ Tools dependency
  (`PBOConsole.exe` is small and self-contained, vendored in `vendor/`).
- Only tested against the stock A6 Ammo/WeaponScripts pbos; a pbo with a
  meaningfully different folder/config structure hasn't been tried.

## License

MIT — see [LICENSE](LICENSE).
