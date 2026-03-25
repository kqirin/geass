const test = require('node:test');
const assert = require('node:assert/strict');

// Load only the function, not the PG pool (which isn't available in tests).
// convertQuestionPlaceholders is now exported from database.js but database.js
// also tries to create a pg pool on require. We stub pg to avoid that.
const pg = require.resolve('pg');
const pgOriginal = require.cache[pg];
require.cache[pg] = {
    id: pg,
    filename: pg,
    loaded: true,
    exports: {
        Pool: class FakePool {
            constructor() { }
            connect() { return Promise.resolve({}); }
            end() { return Promise.resolve(); }
            query() { return Promise.resolve({ rows: [], rowCount: 0, command: 'SELECT' }); }
            on() { }
        },
    },
};

let convertQuestionPlaceholders;
try {
    const dbPath = require.resolve('../src/database');
    delete require.cache[dbPath];
    convertQuestionPlaceholders = require('../src/database').convertQuestionPlaceholders;
} finally {
    if (pgOriginal) require.cache[pg] = pgOriginal;
    else delete require.cache[pg];
}

test('basit ? dönüşümü', () => {
    assert.equal(convertQuestionPlaceholders('SELECT * FROM t WHERE id = ?'), 'SELECT * FROM t WHERE id = $1');
});

test('birden fazla ? sıralı dönüşür', () => {
    assert.equal(
        convertQuestionPlaceholders('INSERT INTO t (a, b, c) VALUES (?, ?, ?)'),
        'INSERT INTO t (a, b, c) VALUES ($1, $2, $3)'
    );
});

test('string literal içindeki ? korunur', () => {
    assert.equal(
        convertQuestionPlaceholders("SELECT '?' FROM t WHERE id = ?"),
        "SELECT '?' FROM t WHERE id = $1"
    );
});

test("escaped single quote ('' ) içindeki ? korunur", () => {
    assert.equal(
        convertQuestionPlaceholders("SELECT 'a''?''b' FROM t WHERE x = ?"),
        "SELECT 'a''?''b' FROM t WHERE x = $1"
    );
});

test('double-quote içindeki ? korunur', () => {
    assert.equal(
        convertQuestionPlaceholders('SELECT "col?" FROM t WHERE id = ?'),
        'SELECT "col?" FROM t WHERE id = $1'
    );
});

test('line comment (--) içindeki ? korunur', () => {
    assert.equal(
        convertQuestionPlaceholders('SELECT id -- where x = ?\nFROM t WHERE id = ?'),
        'SELECT id -- where x = ?\nFROM t WHERE id = $1'
    );
});

test('block comment (/* */) içindeki ? korunur', () => {
    assert.equal(
        convertQuestionPlaceholders('SELECT /* what? */ id FROM t WHERE id = ?'),
        'SELECT /* what? */ id FROM t WHERE id = $1'
    );
});

test('? yoksa sql değişmeden döner', () => {
    const sql = 'SELECT 1';
    assert.equal(convertQuestionPlaceholders(sql), sql);
});

test('boş string geçerli döner', () => {
    assert.equal(convertQuestionPlaceholders(''), '');
});

test('null/undefined güvenli geçer', () => {
    assert.equal(convertQuestionPlaceholders(null), '');
    assert.equal(convertQuestionPlaceholders(undefined), '');
});
