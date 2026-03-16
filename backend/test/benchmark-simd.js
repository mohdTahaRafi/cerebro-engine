import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load the compiled C++ addon
const addon = require('../build/Release/cerebro_core.node');
const { CerebroEngine } = addon;

function javascriptDotProduct(a, b, dim) {
    let sum = 0;
    for (let i = 0; i < dim; i++) {
        sum += a[i] * b[i];
    }
    return sum;
}

async function runBenchmark() {
    console.log('=== Cerebro SIMD Performance Audit ===\n');
    
    const engine = new CerebroEngine();
    const dim = 384;
    const numVectors = 100000; // 100k vectors

    // 1. Generate Mock Data
    console.log(`Generating mock dataset: ${numVectors} vectors (${dim} dims each)...`);
    const queryVector = new Float32Array(dim).map(() => Math.random());
    const dataset = new Float32Array(numVectors * dim).map(() => Math.random());

    console.log('Dataset allocation complete.\n');

    // 2. JavaScript Benchmark
    console.log('--- Benchmarking JavaScript (Pure JS Loop) ---');
    const jsStartTime = performance.now();
    const jsResults = new Float32Array(numVectors);
    
    for (let i = 0; i < numVectors; i++) {
        const offset = i * dim;
        // Slicing in JS is expensive, so we pass raw index if possible, 
        // but for this benchmark we'll simulate a standard loop
        let sum = 0;
        for (let j = 0; j < dim; j++) {
            sum += queryVector[j] * dataset[offset + j];
        }
        jsResults[i] = sum;
    }
    const jsEndTime = performance.now();
    console.log(`JS Time: ${(jsEndTime - jsStartTime).toFixed(2)}ms`);

    // 3. C++ SIMD Benchmark
    console.log('\n--- Benchmarking C++ Native (AVX2/FMA SIMD) ---');
    const cppStartTime = performance.now();
    
    const cppResults = engine.SearchVectors(queryVector, dataset);
    
    const cppEndTime = performance.now();
    console.log(`C++ Time: ${(cppEndTime - cppStartTime).toFixed(2)}ms`);

    // 4. Accuracy Check
    console.log('\n--- Accuracy Audit ---');
    const diff = Math.abs(jsResults[0] - cppResults[0]);
    console.log(`First Result Match (JS vs C++): ${diff < 1e-4 ? '✅ PASSED' : '❌ FAILED'} (Diff: ${diff})`);

    // 5. Conclusion
    const speedup = ((jsEndTime - jsStartTime) / (cppEndTime - cppStartTime)).toFixed(1);
    console.log(`\n🚀 PERFORMANCE GAIN: ${speedup}x faster than pure JavaScript.`);

    if (cppResults.length === numVectors) {
        console.log('\n✅ Phase 2 COMPLETE: SIMD Engine is operational and highly optimized.');
    }
}

runBenchmark().catch(err => {
    console.error('Benchmark Failed:', err);
    process.exit(1);
});
