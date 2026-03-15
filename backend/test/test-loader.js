import { ModelLoader } from '../src/encoder/ModelLoader.js';

async function testLoader() {
    console.log('=== ModelLoader Singleton Verification ===\n');

    // Test 1: Cold Start
    console.time('Cold Start');
    const model1 = await ModelLoader.getInstance();
    console.timeEnd('Cold Start');

    // Test 2: Warm Start (Sequential)
    console.time('Warm Start');
    const model2 = await ModelLoader.getInstance();
    console.timeEnd('Warm Start');

    // Validation
    const isSameInstance = model1 === model2;
    console.log(`\nSame Instance Reference: ${isSameInstance ? '✅ YES' : '❌ NO'}`);

    // Test 3: Concurrency handling
    // We'll simulate concurrent calls by calling it without awaiting immediately
    console.log('\n--- Testing Concurrency Handling ---');
    
    // Clear instance to force another load for testing purposes
    // Note: In real production we wouldn't do this, but for testing the locking logic:
    ModelLoader.instance = null; 
    
    console.log('Triggering two simultaneous getInstance() calls...');
    const [p1, p2] = await Promise.all([
        ModelLoader.getInstance(),
        ModelLoader.getInstance()
    ]);

    const isConcurrentSame = p1 === p2;
    console.log(`Concurrent Calls Return Same Instance: ${isConcurrentSame ? '✅ YES' : '❌ NO'}`);

    if (isSameInstance && isConcurrentSame) {
        console.log('\n🚀 ModelLoader Infrastructure is Bulletproof.');
    } else {
        process.exit(1);
    }
}

testLoader().catch(err => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
});
