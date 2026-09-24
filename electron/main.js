const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseConfig } = require('./pbo/cpp-parser');
const { extractCaliber } = require('./pbo/ammo-extract');
const { unpackPbo, packPbo, derapifyTree } = require('./pbo/pbo-tools');

// Dev mode: app/ is a sibling of this file's own folder. Packaged mode:
// electron-builder's extraResources copies app/ to <install-dir>/resources/
// app-content (see package.json's "build" config) - same pattern as
// [[a6-workbench-project]]'s Electron build.
const APP_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'app-content')
  : path.join(__dirname, '..', 'app');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const rel = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
      const filePath = path.join(APP_DIR, rel === '/' ? 'index.html' : rel);
      fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

let win;
async function createWindow() {
  const port = await startServer();
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#0b0d10',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.loadURL(`http://127.0.0.1:${port}/index.html`);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ---------------------------------------------------------------- IPC: load a pbo pair

ipcMain.handle('pbo:pickFile', async (_e, label) => {
  const result = await dialog.showOpenDialog(win, {
    title: `Select ${label}`,
    filters: [{ name: 'PBO files', extensions: ['pbo'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

let scratchDir = null;

ipcMain.handle('pbo:load', async (_e, { ammoPath, weaponScriptsPath }) => {
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a6ammostats-'));
  const ammoDir = path.join(scratchDir, 'ammo');
  const wsDir = path.join(scratchDir, 'weaponscripts');

  if (ammoPath) await unpackPbo(ammoPath, ammoDir);
  if (weaponScriptsPath) await unpackPbo(weaponScriptsPath, wsDir);

  const searchRoots = [ammoDir, wsDir].filter((d) => fs.existsSync(d));
  const ammoConfigDirs = [];
  for (const root of searchRoots) {
    (function walk(d) {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.toLowerCase() === 'ammoconfigs') {
            for (const sub of fs.readdirSync(full, { withFileTypes: true })) {
              if (sub.isDirectory()) ammoConfigDirs.push(path.join(full, sub.name));
            }
          } else walk(full);
        }
      }
    })(root);
  }

  let derapCount = 0;
  for (const dir of ammoConfigDirs) derapCount += await derapifyTree(dir);

  const calibers = [];
  for (const dir of ammoConfigDirs) {
    const cppPath = path.join(dir, 'config.cpp');
    if (!fs.existsSync(cppPath)) continue;
    const text = fs.readFileSync(cppPath, 'utf-8');
    let entry;
    try {
      const parsed = parseConfig(text);
      entry = extractCaliber(parsed, path.basename(dir));
    } catch (e) {
      entry = null;
    }
    if (entry) {
      entry._configPath = cppPath;
      calibers.push(entry);
    }
  }
  calibers.sort((a, b) => a.caliber.localeCompare(b.caliber));
  return { calibers, derapifiedCount: derapCount, scratchDir };
});

// ---------------------------------------------------------------- IPC: edit + pack

// Surgical text replace: only touches the exact `key=value;` the user
// changed, inside the right class body, leaving every other byte of the
// original file (formatting, comments, untouched classes) identical -
// safer than regenerating the whole file from the parsed tree.
function applyEditToText(text, className, fieldKey, newValue, nestedPath) {
  // Find the class body first (handles duplicate field names in sibling classes).
  const classRe = new RegExp(`class\\s+${className}\\b[^{;]*\\{`, 'i');
  const m = classRe.exec(text);
  if (!m) throw new Error(`class ${className} not found`);
  let bodyStart = m.index + m[0].length;
  let depth = 1;
  let i = bodyStart;
  while (i < text.length && depth > 0) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    i++;
  }
  const bodyEnd = i - 1;
  let searchFrom = bodyStart;
  let searchTo = bodyEnd;

  if (nestedPath && nestedPath.length) {
    let cursor = bodyStart;
    for (const seg of nestedPath) {
      const nestedRe = new RegExp(`class\\s+${seg}\\b[^{;]*\\{`, 'i');
      nestedRe.lastIndex = 0;
      const sub = text.slice(cursor, bodyEnd);
      const nm = nestedRe.exec(sub);
      if (!nm) throw new Error(`nested class ${seg} not found under ${className}`);
      const nestedStart = cursor + nm.index + nm[0].length;
      let d = 1, j = nestedStart;
      while (j < text.length && d > 0) {
        if (text[j] === '{') d++;
        else if (text[j] === '}') d--;
        j++;
      }
      cursor = nestedStart;
      searchFrom = nestedStart;
      searchTo = j - 1;
    }
  }

  const fieldRe = new RegExp(`(\\b${fieldKey}\\s*=\\s*)(-?[0-9.eE+-]+)(\\s*;)`, 'i');
  const region = text.slice(searchFrom, searchTo);
  const fm = fieldRe.exec(region);
  if (!fm) throw new Error(`field ${fieldKey} not found in ${className}${nestedPath ? '.' + nestedPath.join('.') : ''}`);
  const absStart = searchFrom + fm.index;
  const before = text.slice(0, absStart);
  const after = text.slice(absStart + fm[0].length);
  return before + fm[1] + newValue + fm[3] + after;
}

ipcMain.handle('pbo:applyEdits', async (_e, { configPath, className, edits }) => {
  let text = fs.readFileSync(configPath, 'utf-8');
  const FIELD_PATHS = {
    hit: [], indirectHit: [], indirectHitRange: [], initSpeed: [], typicalSpeed: [],
    caliber: [], deflecting: [], airFriction: [], damageBarrel: [], weight: [],
    damage: ['DamageApplied', 'Health'], armorDamage: ['DamageApplied', 'Health'],
    bloodDamage: ['DamageApplied', 'Blood'], shockDamage: ['DamageApplied', 'Shock'],
    strength: ['NoiseHit'],
  };
  const FIELD_NAMES = { bloodDamage: 'damage', shockDamage: 'damage', armorDamage: 'armorDamage' };
  for (const [key, value] of Object.entries(edits)) {
    const realFieldName = FIELD_NAMES[key] || key;
    text = applyEditToText(text, className, realFieldName, value, FIELD_PATHS[key] || []);
  }
  fs.writeFileSync(configPath, text, 'utf-8');
  return true;
});

ipcMain.handle('pbo:pack', async (_e, { sourceLabel }) => {
  const target = sourceLabel === 'ammo' ? path.join(scratchDir, 'ammo') : path.join(scratchDir, 'weaponscripts');
  const result = await dialog.showSaveDialog(win, {
    title: `Save packed ${sourceLabel === 'ammo' ? 'Ammo.pbo' : 'WeaponScripts.pbo'}`,
    defaultPath: sourceLabel === 'ammo' ? 'Ammo.pbo' : 'WeaponScripts.pbo',
    filters: [{ name: 'PBO files', extensions: ['pbo'] }],
  });
  if (result.canceled) return null;
  await packPbo(target, result.filePath);
  return result.filePath;
});
