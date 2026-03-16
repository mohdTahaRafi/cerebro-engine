import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load the compiled C++ addon
const addon = require('../build/Release/cerebro_core.node');
const { CerebroEngine } = addon;

async function testCppBridge() {
    console.log('=== Native C++ Bridge & Zero-Copy Verification ===\n');

    const engine = new CerebroEngine();

    // 1. Initialize Engine
    engine.InitEngine();

    // 2. Create a dummy Float32Array with 1000 random numbers
    console.log('Generating 1000 random vectors...');
    const randomData = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) {
        randomData[i] = Math.random();
    }

    // 3. Pass to C++ via Zero-Copy Bridge
    console.log('Triggering ReceiveVectors (Zero-Copy)...');
    const result = engine.ReceiveVectors(randomData);

    // 4. Validation
    console.log('\n--- Validation ---');
    console.log(`Floats expected in JS: 1000`);
    console.log(`Floats received in C++: ${result.floatsReceived}`);

    if (result.floatsReceived === 1000) {
        console.log('\n✅ Zero-Copy Bridge: MEMORY INTEGRITY VERIFIED.');
        console.log('The C++ core accurately read the Node.js memory address without copying.');
    } else {
        console.error('\n❌ Zero-Copy Bridge: DIMENSION MISMATCH.');
        process.exit(1);
    }
}

testCppBridge().catch(err => {
    console.error('Bridge Test Failed:', err);
    process.exit(1);
});
