// Recursive-descent parser for the DayZ/Arma config.cpp dialect: nested
// `class X: Y { ... };`, `key[] = {...};` arrays, `key = value;` scalars,
// forward declarations `class Foo;`, C-style comments. Same dialect already
// proven (zero parse errors across 192 real files) by the A6 Workbench's
// Python cpp_config_parser.py - ported to JS here rather than shelling out
// to Python, so this app has one less runtime dependency.
//
// Output shape: { type: 'root'|'class', name, parent, fields: {key: value},
// classes: {name: node} } - a value is a string, number, array of those, or
// (for a plain assignment RHS) always kept as the RAW STRING from source
// for round-tripping; numeric fields are additionally exposed via
// `numFields` for the UI to edit safely without reformatting anything else.

function stripComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text[i] === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (text[i] === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
    } else if (text[i] === '"') {
      out += text[i++];
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && text[i + 1] === '"') { out += text[i] + text[i + 1]; i += 2; continue; }
        out += text[i++];
      }
      if (i < n) out += text[i++];
    } else {
      out += text[i++];
    }
  }
  return out;
}

class Tokenizer {
  constructor(text) {
    this.text = text;
    this.pos = 0;
    this.len = text.length;
  }
  skipWs() {
    while (this.pos < this.len && /\s/.test(this.text[this.pos])) this.pos++;
  }
  peekChar() {
    this.skipWs();
    return this.text[this.pos];
  }
  readIdent() {
    this.skipWs();
    const start = this.pos;
    while (this.pos < this.len && /[A-Za-z0-9_]/.test(this.text[this.pos])) this.pos++;
    return this.text.slice(start, this.pos);
  }
  expect(ch) {
    this.skipWs();
    if (this.text[this.pos] !== ch) {
      throw new Error(`Expected '${ch}' at pos ${this.pos}, got '${this.text.slice(this.pos, this.pos + 20)}'`);
    }
    this.pos++;
  }
  readValue() {
    // Reads one scalar value up to (but not including) the next , ; or }
    this.skipWs();
    if (this.text[this.pos] === '"') {
      const start = this.pos;
      this.pos++;
      while (this.pos < this.len) {
        if (this.text[this.pos] === '"' && this.text[this.pos + 1] === '"') { this.pos += 2; continue; }
        if (this.text[this.pos] === '"') { this.pos++; break; }
        this.pos++;
      }
      return this.text.slice(start, this.pos);
    }
    const start = this.pos;
    let depth = 0;
    while (this.pos < this.len) {
      const c = this.text[this.pos];
      if (c === '{') depth++;
      if (c === '}') { if (depth === 0) break; depth--; }
      if ((c === ',' || c === ';') && depth === 0) break;
      this.pos++;
    }
    return this.text.slice(start, this.pos).trim();
  }
  readArray() {
    this.expect('{');
    const items = [];
    this.skipWs();
    if (this.text[this.pos] === '}') { this.pos++; return items; }
    while (true) {
      this.skipWs();
      if (this.text[this.pos] === '{') {
        items.push(this.readArray());
      } else {
        items.push(this.readValue());
      }
      this.skipWs();
      if (this.text[this.pos] === ',') { this.pos++; continue; }
      break;
    }
    this.expect('}');
    return items;
  }
}

function parseBody(tok, node) {
  while (true) {
    tok.skipWs();
    if (tok.pos >= tok.len || tok.text[tok.pos] === '}') return;
    if (tok.text.slice(tok.pos, tok.pos + 5) === 'class') {
      const classStart = tok.pos;
      tok.pos += 5;
      const name = tok.readIdent();
      let parent = null;
      tok.skipWs();
      if (tok.text[tok.pos] === ':') {
        tok.pos++;
        parent = tok.readIdent();
      }
      tok.skipWs();
      if (tok.text[tok.pos] === ';') {
        // forward declaration, e.g. `class Bullet_Base;`
        tok.pos++;
        continue;
      }
      const child = { type: 'class', name, parent, fields: {}, numFields: {}, classes: {}, order: [] };
      tok.expect('{');
      parseBody(tok, child);
      tok.expect('}');
      tok.skipWs();
      if (tok.text[tok.pos] === ';') tok.pos++;
      node.classes[name] = child;
      node.order.push({ kind: 'class', name });
      continue;
    }
    // key[] = {...};  or  key = value;
    const keyStart = tok.pos;
    const key = tok.readIdent();
    if (!key) throw new Error(`Unexpected token at pos ${tok.pos}: '${tok.text.slice(tok.pos, tok.pos + 30)}'`);
    tok.skipWs();
    let isArray = false;
    if (tok.text[tok.pos] === '[') {
      tok.pos++;
      tok.expect(']');
      isArray = true;
    }
    tok.skipWs();
    if (tok.text[tok.pos] === '+' && tok.text[tok.pos + 1] === '=') tok.pos += 2;
    else tok.expect('=');
    const value = isArray ? tok.readArray() : tok.readValue();
    tok.skipWs();
    if (tok.text[tok.pos] === ';') tok.pos++;
    node.fields[key] = value;
    if (!isArray && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(String(value).trim())) {
      node.numFields[key] = Number(value);
    }
    node.order.push({ kind: 'field', name: key });
  }
}

function parseConfig(rawText) {
  const text = stripComments(rawText);
  const tok = new Tokenizer(text);
  const root = { type: 'root', name: null, parent: null, fields: {}, numFields: {}, classes: {}, order: [] };
  parseBody(tok, root);
  return root;
}

// DayZ/Arma's own config system matches class names case-insensitively
// (confirmed against real files: some ship `cfgAmmo`, others `CfgAmmo`) -
// plain JS object-key lookups are case-sensitive, so every lookup by a
// known class name must go through this instead of `node.classes[name]`.
function findClassCI(node, name) {
  if (!node || !node.classes) return null;
  const lower = name.toLowerCase();
  for (const key of Object.keys(node.classes)) {
    if (key.toLowerCase() === lower) return node.classes[key];
  }
  return null;
}

module.exports = { parseConfig, findClassCI };
