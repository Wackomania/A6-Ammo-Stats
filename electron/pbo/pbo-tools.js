// Thin wrapper around the external tools used for the two binary-format
// steps this app needs (pbo archive unpack/pack, and derapifying a
// binarized config.bin). Neither binary format was hand-rolled from
// memory: both are real, well-established formats, but a subtly-wrong
// from-scratch parser could silently produce corrupted stat values rather
// than a visible error - not worth that risk when proven tools exist.
//   PBOConsole.exe (vendored, electron/vendor/ - small standalone exe, no
//     DayZ Tools/Steam dependency) - unpack/pack .pbo archives. Verified
//     this session via a real round-trip test: packed a test pbo, unpacked
//     it, byte-identical.
//   CfgConvert.exe (DayZ Tools, already installed) - derapify config.bin.
//     DEV-TIME CHOICE, not the final distribution answer: the originally
//     planned bundled alternative (Mikero's DeRap.exe) hit a real missing
//     Universal-CRT DLL on this machine (confirmed from its own install
//     location too, not a vendoring mistake) - rather than chase that,
//     switched to the already-proven CfgConvert.exe for now. Revisit
//     before shipping to other users, since CfgConvert requires DayZ Tools
//     to be installed, which is exactly the dependency this app was meant
//     to avoid for end users (see the a6-ammo-stats-project memory).
const { execFile } = require('child_process');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

// Native exes can't run from inside an asar archive, so packaged mode
// resolves vendor/ via extraResources (real unpacked files on disk) -
// same reasoning as APP_DIR in main.js.
const VENDOR_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'vendor')
  : path.join(__dirname, '..', 'vendor');
const PBOCONSOLE = path.join(VENDOR_DIR, 'PBOConsole.exe');
const CFGCONVERT = 'X:\\SteamLibrary\\steamapps\\common\\DayZ Tools\\Bin\\CfgConvert\\CfgConvert.exe';

function run(exe, args) {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(exe)} failed: ${err.message}\n${stdout}\n${stderr}`));
      else resolve({ stdout, stderr });
    });
  });
}

async function unpackPbo(pboPath, destDir) {
  await run(PBOCONSOLE, ['-unpack', pboPath, destDir]);
}

async function packPbo(sourceDir, destPboPath) {
  await run(PBOCONSOLE, ['-pack', sourceDir, destPboPath]);
}

// Derapifies every config.bin found under dir (recursively) into a
// sibling config.cpp, in place. Skips any folder that already has a
// config.cpp (plain-text source, e.g. Welliton-style packs - nothing to
// derapify).
async function derapifyTree(dir) {
  const binFiles = [];
  (function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase() === 'config.bin') binFiles.push(full);
    }
  })(dir);

  if (binFiles.length > 0 && !fs.existsSync(CFGCONVERT)) {
    throw new Error(
      'This pbo has binarized configs (config.bin) that need converting to text first, ' +
      'and that step currently requires DayZ Tools to be installed (CfgConvert.exe was not ' +
      `found at ${CFGCONVERT}). Install DayZ Tools via Steam, or ask for this to be fixed to ` +
      'not need it.'
    );
  }
  for (const binPath of binFiles) {
    const cppPath = path.join(path.dirname(binPath), 'config.cpp');
    if (fs.existsSync(cppPath)) continue;
    await run(CFGCONVERT, ['-txt', '-dst', cppPath, binPath]);
    if (!fs.existsSync(cppPath)) {
      throw new Error(`CfgConvert.exe did not produce ${cppPath}`);
    }
  }
  return binFiles.length;
}

module.exports = { unpackPbo, packPbo, derapifyTree };
