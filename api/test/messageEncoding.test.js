const test = require('node:test');
const assert = require('node:assert/strict');

const { repairMojibakeText } = require('../src/application/messages/encoding');
const { getSystemDefaultTemplate, getTemplateKeyMeta } = require('../src/application/messages/catalog');

const CP1252_BYTE_TO_CODE_POINT = new Map([
  [0x80, 0x20ac],
  [0x82, 0x201a],
  [0x83, 0x0192],
  [0x84, 0x201e],
  [0x85, 0x2026],
  [0x86, 0x2020],
  [0x87, 0x2021],
  [0x88, 0x02c6],
  [0x89, 0x2030],
  [0x8a, 0x0160],
  [0x8b, 0x2039],
  [0x8c, 0x0152],
  [0x8e, 0x017d],
  [0x91, 0x2018],
  [0x92, 0x2019],
  [0x93, 0x201c],
  [0x94, 0x201d],
  [0x95, 0x2022],
  [0x96, 0x2013],
  [0x97, 0x2014],
  [0x98, 0x02dc],
  [0x99, 0x2122],
  [0x9a, 0x0161],
  [0x9b, 0x203a],
  [0x9c, 0x0153],
  [0x9e, 0x017e],
  [0x9f, 0x0178],
]);

function decodeCp1252(buffer) {
  let out = '';
  for (const byte of buffer) {
    const codePoint = CP1252_BYTE_TO_CODE_POINT.get(byte) || byte;
    out += String.fromCodePoint(codePoint);
  }
  return out;
}

function toMojibake(source) {
  return decodeCp1252(Buffer.from(source, 'utf8'));
}

test('repairMojibakeText repairs deterministic cp1252->utf8 corruption', () => {
  const source = '\u0130\u015Flem ba\u015Far\u0131yla tamamland\u0131.\u22C6\u02DA\u0FD4';
  const broken = toMojibake(source);

  assert.notEqual(broken, source);
  assert.equal(repairMojibakeText(broken), source);
});

test('repairMojibakeText keeps valid utf8 text untouched', () => {
  const source = 'Ge\u00E7ersiz kullan\u0131c\u0131';
  assert.equal(repairMojibakeText(source), source);
});

test('catalog defaults ship with valid utf8 text', () => {
  assert.equal(
    getSystemDefaultTemplate('unknown', 'success').content,
    '\u0130\u015Flem tamamland\u0131.'
  );
  assert.equal(getTemplateKeyMeta('success').label, 'Ba\u015Far\u0131l\u0131');
});
