// Proves CerebroEngine::SearchVectors (VectorSearch.cpp) rejects malformed buffers
// with a clear Node-API error instead of silently corrupting results via integer
// division, and that valid buffers still rank correctly. See the "Native addon /
// build" section of cerebro-audit-report.md for the bug this guards against.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CerebroEngine } = require('../build/Release/cerebro_core.node');

const DIM = 384;

function makeVector(dim, fill) {
    const v = new Float32Array(dim);
    for (let i = 0; i < dim; i++) v[i] = fill !== undefined ? fill : Math.random();
    return v;
}

function testValidBuffer() {
    console.log('--- Test 1: valid buffer still returns ranked results ---');
    const engine = new CerebroEngine();
    const query = makeVector(DIM, 1);
    const numVectors = 10;
    const dataset = new Float32Array(numVectors * DIM);
    for (let i = 0; i < numVectors; i++) {
        dataset.set(makeVector(DIM, i === 3 ? 1 : 0), i * DIM); // doc 3 is the best match
    }

    const results = engine.SearchVectors(query, dataset, 5);
    assert.equal(results.length, 5, 'expected 5 results for k=5');
    assert.equal(results[0].index, 3, 'expected the exact-match vector to rank first');
    console.log('PASS: valid buffer ranked correctly, top result =', results[0]);
}

function testMalformedDatasetLength() {
    console.log('--- Test 2: dataset length not a multiple of query dim throws ---');
    const engine = new CerebroEngine();
    const query = makeVector(DIM);
    // 2.5 vectors worth of floats — deliberately truncated/malformed.
    const dataset = new Float32Array(DIM * 2 + 17);

    assert.throws(
        () => engine.SearchVectors(query, dataset, 5),
        (err) => {
            console.log('  -> threw as expected:', err.message);
            assert.match(err.message, /not an exact multiple/i);
            return true;
        },
        'expected SearchVectors to throw on a malformed dataset buffer'
    );
    console.log('PASS: malformed dataset buffer rejected with a clear error');
}

function testEmptyQueryVector() {
    console.log('--- Test 3: empty query vector throws instead of dividing by zero ---');
    const engine = new CerebroEngine();
    const query = new Float32Array(0);
    const dataset = makeVector(DIM);

    assert.throws(
        () => engine.SearchVectors(query, dataset, 5),
        (err) => {
            console.log('  -> threw as expected:', err.message);
            assert.match(err.message, /must not be empty/i);
            return true;
        },
        'expected SearchVectors to throw on an empty query vector'
    );
    console.log('PASS: empty query vector rejected with a clear error');
}

function run() {
    console.log('=== VectorSearch buffer validation ===\n');
    testValidBuffer();
    testMalformedDatasetLength();
    testEmptyQueryVector();
    console.log('\n✅ All vector search validation tests passed.');
}

try {
    run();
} catch (err) {
    console.error('\n❌ Vector search validation test FAILED:', err);
    process.exit(1);
}
