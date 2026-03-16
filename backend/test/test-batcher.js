import { BatchEncoder } from '../src/encoder/BatchEncoder.js';

async function testBatcher() {
    console.log('=== BatchEncoder & L2 Normalization Verification ===\n');
    const encoder = new BatchEncoder();

    // 1. Generate 120 dummy sentences
    const sentences = Array.from({ length: 120 }, (_, i) => 
        `This is sample sentence number ${i + 1} for testing the batch encoding pipeline.`
    );

    console.log(`Input: ${sentences.length} sentences`);
    console.time('Batch Processing (120 chunks)');
    
    // 2. Encode with batch size 50
    const result = await encoder.encode(sentences, 50);
    
    console.timeEnd('Batch Processing (120 chunks)');

    // 3. Validation Checks
    console.log('\n--- Validation ---');
    
    // Check instance
    const isFloat32 = result instanceof Float32Array;
    console.log(`Is Float32Array: ${isFloat32 ? '✅' : '❌'}`);

    // Check length (120 * 384 = 46080)
    const expectedLength = 120 * 384;
    const isCorrectLength = result.length === expectedLength;
    console.log(`Correct Length (${expectedLength}): ${isCorrectLength ? '✅' : '❌'}`);

    // 4. Manual L2 Magnitude Verification
    // Extract the first vector (0-383)
    const firstVector = result.slice(0, 384);
    let sumSquared = 0;
    for (const val of firstVector) {
        sumSquared += val * val;
    }
    const magnitude = Math.sqrt(sumSquared);
    console.log(`Manual Magnitude Check: ${magnitude.toFixed(6)}`);
    
    // Check if near 1.0 (float precision handling)
    const isNormalized = Math.abs(magnitude - 1.0) < 1e-6;
    console.log(`L2 Normalization Proven: ${isNormalized ? '✅' : '❌'}`);

    if (isFloat32 && isCorrectLength && isNormalized) {
        console.log('\n🚀 Phase 2 COMPLETE: Batching & Normalization Verified.');
    } else {
        console.error('\n❌ Phase 2 FAILED: Validation errors found.');
        process.exit(1);
    }
}

testBatcher().catch(err => {
    console.error('Batcher Test Failed:', err);
    process.exit(1);
});
