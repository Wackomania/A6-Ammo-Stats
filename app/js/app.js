const BALLISTICS_FIELDS = [
  { key: 'hit', label: 'Hit (Damage)' },
  { key: 'indirectHit', label: 'Indirect Hit' },
  { key: 'indirectHitRange', label: 'Indirect Range' },
  { key: 'initSpeed', label: 'Init Speed (m/s)' },
  { key: 'typicalSpeed', label: 'Typical Speed' },
  { key: 'caliber', label: 'Caliber' },
  { key: 'deflecting', label: 'Deflecting' },
  { key: 'airFriction', label: 'Air Friction' },
  { key: 'damageBarrel', label: 'Barrel Wear' },
  { key: 'weight', label: 'Round Weight' },
];
const DAMAGE_FIELDS = [
  { key: 'damage', label: 'Health Damage' },
  { key: 'armorDamage', label: 'Armor Damage' },
  { key: 'bloodDamage', label: 'Blood Damage' },
  { key: 'shockDamage', label: 'Shock Damage' },
  { key: 'strength', label: 'Noise Strength' },
];

const els = {};
let calibers = [];
let currentCaliber = null;
let currentSearch = '';
// pending[caliberName] = { className, configPath, edits: {field: newValue}, originals: {field: oldValue} }
const pending = {};

function $(id) { return document.getElementById(id); }

function cacheEls() {
  els.btnLoadAmmo = $('btnLoadAmmo');
  els.btnLoadWeaponScripts = $('btnLoadWeaponScripts');
  els.loadStatus = $('loadStatus');
  els.searchBox = $('searchBox');
  els.caliberList = $('caliberList');
  els.editorEmpty = $('editorEmpty');
  els.editorContent = $('editorContent');
  els.editorCaliber = $('editorCaliber');
  els.editorClassname = $('editorClassname');
  els.modifiedBadge = $('modifiedBadge');
  els.ballisticsFields = $('ballisticsFields');
  els.damageFields = $('damageFields');
  els.magazineInfo = $('magazineInfo');
  els.pendingList = $('pendingList');
  els.btnPackAmmo = $('btnPackAmmo');
  els.btnPackWeaponScripts = $('btnPackWeaponScripts');
  els.packResult = $('packResult');
}

let loadedAmmoPath = null;
let loadedWsPath = null;

async function doLoad() {
  if (!loadedAmmoPath && !loadedWsPath) return;
  els.loadStatus.textContent = 'Unpacking + parsing...';
  let result;
  try {
    result = await window.api.loadPbos({ ammoPath: loadedAmmoPath, weaponScriptsPath: loadedWsPath });
  } catch (e) {
    els.loadStatus.textContent = '';
    els.loadStatus.style.color = 'var(--red)';
    const msg = String(e && e.message || e).replace(/^Error invoking remote method '[^']+': Error: /, '');
    els.caliberList.innerHTML = `<div class="empty-note" style="color:var(--red)">${msg}</div>`;
    return;
  }
  els.loadStatus.style.color = '';
  calibers = result.calibers;
  els.loadStatus.textContent = `${calibers.length} calibers loaded`;
  renderCaliberList();
}

function renderCaliberList() {
  const filtered = calibers.filter((c) => {
    const s = currentSearch.toLowerCase();
    return !s || c.caliber.toLowerCase().includes(s) || c.className.toLowerCase().includes(s);
  });
  els.caliberList.innerHTML = '';
  if (!filtered.length) {
    els.caliberList.innerHTML = '<div class="empty-note">No calibers loaded yet.</div>';
    return;
  }
  for (const c of filtered) {
    const row = document.createElement('div');
    row.className = 'caliber-row' + (currentCaliber === c ? ' active' : '') + (pending[c.caliber] ? ' dirty' : '');
    row.innerHTML = `<div><div class="cr-name">${c.caliber}</div><div class="cr-class">${c.className}</div></div><span class="cr-dot"></span>`;
    row.addEventListener('click', () => selectCaliber(c));
    els.caliberList.appendChild(row);
  }
}

function selectCaliber(c) {
  currentCaliber = c;
  els.editorEmpty.classList.add('hidden');
  els.editorContent.classList.remove('hidden');
  els.editorCaliber.textContent = c.caliber;
  els.editorClassname.textContent = c.className + (c.parent ? ` : ${c.parent}` : '');
  const isDirty = !!pending[c.caliber];
  els.modifiedBadge.classList.toggle('hidden', !isDirty);

  renderFieldGroup(els.ballisticsFields, BALLISTICS_FIELDS, c);
  renderFieldGroup(els.damageFields, DAMAGE_FIELDS, c);

  if (c.magazine) {
    els.magazineInfo.innerHTML = `<div class="mag-name">${c.magazine.displayName}</div><div>${c.magazine.className}</div><div>Weight: ${c.magazine.weight} &middot; Count: ${c.magazine.count}</div>`;
  } else {
    els.magazineInfo.innerHTML = '<div class="empty-note">No magazine data found.</div>';
  }
  renderCaliberList();
}

function currentValueFor(c, key) {
  const edit = pending[c.caliber];
  if (edit && key in edit.edits) return edit.edits[key];
  return c.stats[key];
}

function renderFieldGroup(container, defs, c) {
  container.innerHTML = '';
  for (const def of defs) {
    if (!(def.key in c.stats)) continue;
    const row = document.createElement('div');
    const val = currentValueFor(c, def.key);
    const isDirty = pending[c.caliber] && def.key in pending[c.caliber].edits;
    row.className = 'field-row' + (isDirty ? ' dirty' : '');
    const label = document.createElement('label');
    label.textContent = def.label;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.value = val;
    // Deliberately does NOT trigger a full re-render on every keystroke -
    // that used to recreate this exact <input> mid-edit (via selectCaliber
    // -> renderFieldGroup rebuilding the whole panel), destroying focus and
    // cursor position after the very first character. Only the specific
    // row's dirty styling + the separate pending-list/sidebar panels update
    // here; the input the user is actively typing in is never replaced.
    input.addEventListener('input', () => onFieldEdit(c, def.key, input.value, row));
    row.appendChild(label);
    row.appendChild(input);
    container.appendChild(row);
  }
}

function onFieldEdit(c, key, newValue, rowEl) {
  // Partial input while typing (e.g. "-", "1.", "") is not a committable
  // number yet - leave the field alone (don't touch pending) rather than
  // rejecting/resetting it, so the user can keep typing normally.
  if (newValue.trim() === '' || newValue === '-' || /[.,]$/.test(newValue)) return;
  const numVal = Number(newValue);
  if (Number.isNaN(numVal)) return;

  if (!pending[c.caliber]) {
    pending[c.caliber] = { className: c.className, configPath: c._configPath, edits: {}, originals: {} };
  }
  if (!(key in pending[c.caliber].originals)) {
    pending[c.caliber].originals[key] = c.stats[key];
  }
  let isDirty;
  if (numVal === pending[c.caliber].originals[key]) {
    delete pending[c.caliber].edits[key];
    isDirty = false;
    if (Object.keys(pending[c.caliber].edits).length === 0) delete pending[c.caliber];
  } else {
    pending[c.caliber].edits[key] = numVal;
    isDirty = true;
  }

  rowEl.classList.toggle('dirty', isDirty);
  els.modifiedBadge.classList.toggle('hidden', !pending[c.caliber]);
  renderPendingList();
  renderCaliberList();
}

function fieldLabel(key) {
  return [...BALLISTICS_FIELDS, ...DAMAGE_FIELDS].find((f) => f.key === key)?.label || key;
}

function renderPendingList() {
  const entries = Object.entries(pending);
  els.pendingList.innerHTML = '';
  if (!entries.length) {
    els.pendingList.innerHTML = '<div class="empty-note">No changes yet.</div>';
    els.btnPackAmmo.disabled = true;
    els.btnPackWeaponScripts.disabled = true;
    return;
  }
  els.btnPackWeaponScripts.disabled = false;
  for (const [caliber, data] of entries) {
    const item = document.createElement('div');
    item.className = 'pending-item';
    const changes = Object.entries(data.edits).map(([k, v]) => `${fieldLabel(k)}: <span class="old">${data.originals[k]}</span> &rarr; <span class="new">${v}</span>`).join('<br>');
    item.innerHTML = `<div class="pi-caliber">${caliber}</div><div class="pi-change">${changes}</div>`;
    els.pendingList.appendChild(item);
  }
}

async function doPack(sourceLabel) {
  els.packResult.textContent = 'Applying edits...';
  for (const [, data] of Object.entries(pending)) {
    await window.api.applyEdits({ configPath: data.configPath, className: data.className, edits: data.edits });
  }
  els.packResult.textContent = 'Packing...';
  const outPath = await window.api.pack(sourceLabel);
  els.packResult.textContent = outPath ? `Saved: ${outPath}` : 'Cancelled.';
}

function wireEvents() {
  els.btnLoadAmmo.addEventListener('click', async () => {
    const p = await window.api.pickFile('Ammo.pbo');
    if (p) { loadedAmmoPath = p; els.btnLoadAmmo.textContent = 'Ammo.pbo ✓'; doLoad(); }
  });
  els.btnLoadWeaponScripts.addEventListener('click', async () => {
    const p = await window.api.pickFile('WeaponScripts.pbo');
    if (p) { loadedWsPath = p; els.btnLoadWeaponScripts.textContent = 'WeaponScripts.pbo ✓'; doLoad(); }
  });
  els.searchBox.addEventListener('input', () => { currentSearch = els.searchBox.value; renderCaliberList(); });
  els.btnPackAmmo.addEventListener('click', () => doPack('ammo'));
  els.btnPackWeaponScripts.addEventListener('click', () => doPack('weaponscripts'));
}

function main() {
  cacheEls();
  wireEvents();
}

main();

// Debug-only hook for automated verification (CDP-driven testing) since
// Electron's native file-picker dialog can't be driven the same way a web
// page's own DOM can - lets a test script trigger the exact same load path
// a real button click would, without needing OS-level dialog automation.
window.__debugLoad = async (ammoPath, wsPath) => {
  loadedAmmoPath = ammoPath;
  loadedWsPath = wsPath;
  els.btnLoadAmmo.textContent = 'Ammo.pbo ✓';
  els.btnLoadWeaponScripts.textContent = 'WeaponScripts.pbo ✓';
  await doLoad();
};
window.__debugSelectFirst = () => { if (calibers.length) selectCaliber(calibers[0]); };
window.__debugSelectByName = (name) => { const c = calibers.find((x) => x.caliber === name); if (c) selectCaliber(c); };
