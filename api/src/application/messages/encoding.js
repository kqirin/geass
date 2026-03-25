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

const CODE_POINT_TO_CP1252_BYTE = new Map(
  Array.from(CP1252_BYTE_TO_CODE_POINT.entries()).map(([byte, codePoint]) => [codePoint, byte])
);

function decodeCp1252(buffer) {
  let out = '';
  for (const byte of buffer) {
    const codePoint = CP1252_BYTE_TO_CODE_POINT.get(byte) || byte;
    out += String.fromCodePoint(codePoint);
  }
  return out;
}

function encodeCp1252(value) {
  const bytes = [];
  for (const ch of String(value)) {
    const codePoint = ch.codePointAt(0);
    if (codePoint <= 0xff) {
      bytes.push(codePoint);
      continue;
    }
    const mapped = CODE_POINT_TO_CP1252_BYTE.get(codePoint);
    if (mapped === undefined) return null;
    bytes.push(mapped);
  }
  return Buffer.from(bytes);
}

function countLikelyMojibakeMarkers(value) {
  let count = 0;
  const source = String(value || '');
  for (let i = 0; i < source.length - 1; i += 1) {
    const first = source.codePointAt(i);
    if (
      first !== 0x00c2 &&
      first !== 0x00c3 &&
      first !== 0x00c4 &&
      first !== 0x00c5 &&
      first !== 0x00cb &&
      first !== 0x00e0 &&
      first !== 0x00e2
    ) {
      continue;
    }
    const second = source.codePointAt(i + 1);
    if (second >= 0x0080) count += 1;
  }
  return count;
}

function repairMojibakeText(value) {
  const source = String(value || '');
  const before = countLikelyMojibakeMarkers(source);
  if (before === 0) return source;

  const cp1252Bytes = encodeCp1252(source);
  if (!cp1252Bytes) return source;

  const candidate = cp1252Bytes.toString('utf8');
  if (candidate.includes('\uFFFD')) return source;

  const after = countLikelyMojibakeMarkers(candidate);
  if (after >= before) return source;

  // Only apply deterministic repairs to avoid double or incorrect decode.
  const roundTrip = decodeCp1252(Buffer.from(candidate, 'utf8'));
  if (roundTrip !== source) return source;

  return candidate;
}

module.exports = {
  repairMojibakeText,
  countLikelyMojibakeMarkers,
};
