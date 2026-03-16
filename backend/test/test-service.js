import { processDocument } from '../src/services/EncoderService.js';

async function testService() {
    console.log('=== EncoderService Integration Test ===\n');

    // 1. Mock Document Chunks
    const mockChunks = [
        "Cerebro is a high-performance vector search engine.",
        "It uses Node.js for data orchestration and C++ for mathematics.",
        "Sentence embeddings are calculated using transformer models.",
        "L2 normalization is applied to ensure cosine similarity is efficient.",
        "Memory-contiguous buffers allow fast handoff to native code.",
        "Scaling vector search requires sub-50ms latency targets.",
        "SIMD instructions in C++ handle the dot product calculations.",
        "Automatic batching optimizes high-throughput document ingestion.",
        "This service layer wraps all encoding complexities.",
        "Ready for production deployment."
    ];

    try {
        // 2. Process
        const result = await processDocument(mockChunks);

        // 3. Inspect Metadata
        console.log('\n--- Pipeline Metadata ---');
        console.log(`Total Chunks: ${result.totalChunks}`);
        console.log(`Dimensions:   ${result.dimensions}`);
        console.log(`Latency:      ${result.metrics.latencyMs}ms`);
        console.log(`Buffer Type:  ${result.vectorData.constructor.name}`);
        console.log(`Buffer Size:  ${result.vectorData.byteLength} bytes`);

        // 4. Integrity Check
        const expectedSize = 10 * 384 * 4; // 10 chunks, 384 dims, 4 bytes per float
        if (result.vectorData.byteLength === expectedSize && result.totalChunks === 10) {
            console.log('\n✅ Integration Successful: Pipeline is fully connected.');
        } else {
            console.error('\n❌ Integration Failed: Metadata mismatch.');
            process.exit(1);
        }

    } catch (e) {
        console.error('Test Failed:', e);
        process.exit(1);
    }
}

testService();
