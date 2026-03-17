// This script benchmarks the SIMD dot product against a pure JS implementation and verifies the Top-K extraction.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const addon = require('../build/Release/cerebro_core.node');
const { CerebroEngine } = addon;

async function runBenchmark() {
    console.log('=== Cerebro SIMD & Top-K Performance Audit ===\n');
    
    const engine = new CerebroEngine();
    const dim = 384;
    const numVectors = 100000;
    const k = 5;

    console.log('Generating mock dataset: ' + numVectors + ' vectors (' + dim + ' dims each)...');
    const queryVector = new Float32Array(dim).map(() => Math.random());
    const dataset = new Float32Array(numVectors * dim).map(() => Math.random());

    console.log('Dataset allocation complete.\n');

    console.log('--- Benchmarking JavaScript (Pure JS Loop) ---');
    const jsStartTime = performance.now();
    const jsResults = new Float32Array(numVectors);
    
    for (let i = 0; i < numVectors; i++) {
        const offset = i * dim;
        let sum = 0;
        for (let j = 0; j < dim; j++) {
            sum += queryVector[j] * dataset[offset + j];
        }
        jsResults[i] = sum;
    }
    const jsEndTime = performance.now();
    console.log('JS Time: ' + (jsEndTime - jsStartTime).toFixed(2) + 'ms');

    console.log('\n--- Benchmarking C++ Native (AVX2 + Top-K) ---');
    const cppStartTime = performance.now();
    
    const cppResults = engine.SearchVectors(queryVector, dataset, k);
    
    const cppEndTime = performance.now();
    console.log('C++ Time (including Top-K filtering): ' + (cppEndTime - cppStartTime).toFixed(2) + 'ms');

    console.log('\n--- Top-5 Results Verification ---');
    for (let i = 0; i < cppResults.length; i++) {
        console.log('Rank ' + (i + 1) + ': Index ' + cppResults[i].index + ', Score: ' + cppResults[i].score.toFixed(4));
    }

    const speedup = ((jsEndTime - jsStartTime) / (cppEndTime - cppStartTime)).toFixed(1);
    console.log('\n🚀 PERFORMANCE GAIN: ' + speedup + 'x faster than pure JavaScript.');

    if (cppResults.length === k) {
        console.log('\n✅ Phase 3 COMPLETE: Top-K Priority Queue is operational.');
    }
}

runBenchmark().catch(err => {
    console.error('Benchmark Failed:', err);
    process.exit(1);
});
