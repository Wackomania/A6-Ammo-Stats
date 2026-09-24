// Pulls the real editable stat surface out of a parsed AmmoConfigs/<caliber>
// config.cpp tree - the flat cfgAmmo fields (hit/initSpeed/caliber/etc),
// the nested DamageApplied.{Health,Blood,Shock}.damage sub-values, and
// NoiseHit.strength. Field NAMES and nesting are exactly what's on disk in
// real A6 ammo configs (see 12.7x99/config.cpp, read directly this
// session) - not invented.
const { findClassCI } = require('./cpp-parser');

// The stat surface this app edits, per bullet class. `path` is how to
// reach the field inside the parsed tree; used for both reading the
// current value and writing an edited one back.
const AMMO_FIELDS = [
  { key: 'hit', label: 'Hit (Damage)', path: [] },
  { key: 'indirectHit', label: 'Indirect Hit', path: [] },
  { key: 'indirectHitRange', label: 'Indirect Hit Range', path: [] },
  { key: 'initSpeed', label: 'Initial Speed (m/s)', path: [] },
  { key: 'typicalSpeed', label: 'Typical Speed (m/s)', path: [] },
  { key: 'caliber', label: 'Caliber', path: [] },
  { key: 'deflecting', label: 'Deflecting', path: [] },
  { key: 'airFriction', label: 'Air Friction', path: [] },
  { key: 'damageBarrel', label: 'Barrel Wear', path: [] },
  { key: 'weight', label: 'Round Weight', path: [] },
];

const DAMAGE_FIELDS = [
  { key: 'damage', label: 'Health Damage', path: ['DamageApplied', 'Health'] },
  { key: 'armorDamage', label: 'Armor Damage', path: ['DamageApplied', 'Health'] },
  { key: 'damage', label: 'Blood Damage', path: ['DamageApplied', 'Blood'], outKey: 'bloodDamage' },
  { key: 'damage', label: 'Shock Damage', path: ['DamageApplied', 'Shock'], outKey: 'shockDamage' },
  { key: 'strength', label: 'Noise Strength', path: ['NoiseHit'] },
];

function walk(node, path) {
  let cur = node;
  for (const seg of path) {
    cur = findClassCI(cur, seg);
    if (!cur) return null;
  }
  return cur;
}

function extractBulletStats(bulletClass) {
  const stats = {};
  for (const f of AMMO_FIELDS) {
    if (f.key in bulletClass.numFields) stats[f.key] = bulletClass.numFields[f.key];
  }
  for (const f of DAMAGE_FIELDS) {
    const target = walk(bulletClass, f.path);
    if (target && f.key in target.numFields) {
      stats[f.outKey || f.key] = target.numFields[f.key];
    }
  }
  return stats;
}

// Given the parsed root of ONE caliber's config.cpp, returns
// {caliber, className, parent, stats, magazine} or null if this file has
// no cfgAmmo section (e.g. VanillaAdaptations, which only patches vanilla
// CfgWeapons - confirmed by direct inspection, not a parse failure).
function extractCaliber(root, caliberFolderName) {
  const cfgAmmo = findClassCI(root, 'cfgAmmo');
  if (!cfgAmmo) return null;
  const bulletName = Object.keys(cfgAmmo.classes).find((n) => n.toLowerCase() !== 'bullet_base');
  if (!bulletName) return null;
  const bulletClass = cfgAmmo.classes[bulletName];

  let magazine = null;
  const cfgMagazines = findClassCI(root, 'cfgMagazines');
  if (cfgMagazines) {
    const magName = Object.keys(cfgMagazines.classes).find((n) => n.toLowerCase() !== 'ammunition_base');
    if (magName) {
      const magClass = cfgMagazines.classes[magName];
      magazine = {
        className: magName,
        displayName: magClass.fields.displayName ? String(magClass.fields.displayName).replace(/^"|"$/g, '') : magName,
        weight: magClass.numFields.weight ?? null,
        count: magClass.numFields.count ?? null,
      };
    }
  }

  return {
    caliber: caliberFolderName,
    className: bulletName,
    parent: bulletClass.parent,
    stats: extractBulletStats(bulletClass),
    magazine,
  };
}

module.exports = { extractCaliber, AMMO_FIELDS, DAMAGE_FIELDS };
