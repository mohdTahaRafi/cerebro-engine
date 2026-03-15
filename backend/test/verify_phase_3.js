import { SemanticChunker } from '../src/utils/SemanticChunker.js';

function generateLongText() {
    return `Artificial intelligence (AI) is the intelligence of machines or software, as opposed to the intelligence of human beings or animals. It is also the field of study in computer science that develops and studies intelligent machines. "AI" may also refer to the machines themselves.

AI technology is widely used throughout industry, government, and science. Some high-profile applications are: advanced web search engines (e.g., Google Search), recommendation systems (used by YouTube, Amazon, and Netflix), understanding human speech (such as Siri and Alexa), self-driving cars (e.g., Waymo), generative or creative tools (ChatGPT and AI art), and competing at the highest level in strategic games (such as chess and Go).

Artificial intelligence was founded as an academic discipline in 1956. The field went through multiple cycles of optimism followed by disappointment and loss of funding, but after 2012, when deep learning surpassed all previous AI techniques, there was a vast increase in funding and interest.

The various sub-fields of AI research are centered around particular goals and the use of particular tools. The traditional goals of AI research include reasoning, knowledge representation, planning, learning, natural language processing, perception, and support for robotics. General intelligence (the ability to complete any task performable by a human) is among the field's long-term goals.

To solve these problems, AI researchers have adapted and integrated a wide range of problem-solving techniques, including search and mathematical optimization, formal logic, artificial neural networks, and methods based on statistics, probability, and economics. AI also draws upon psychology, linguistics, philosophy, neuroscience and many other fields.

In the twenty-first century, AI techniques have experienced a resurgence following concurrent advances in computer power, large amounts of data, and theoretical understanding; and AI techniques have become an essential part of the technology industry, helping to solve many challenging problems in computer science, software engineering and operations research.`;
}

function runTests() {
    console.log("=== Phase 3: SemanticChunker Validation ===");
    
    const chunker = new SemanticChunker();
    const text = generateLongText();
    console.log(`Input Text Length: ${text.length} characters`);
    
    // Target Chunk Size is smaller here to force high fragmentation, making testing easier
    const CHUNK_SIZE = 250;
    const CHUNK_OVERLAP = 50;
    
    console.log(`\nConfig: chunkSize=${CHUNK_SIZE}, chunkOverlap=${CHUNK_OVERLAP}`);
    
    const chunks = chunker.chunk(text, CHUNK_SIZE, CHUNK_OVERLAP);
    
    console.log(`\nTotal Chunks Produced: ${chunks.length}\n`);

    let passedAll = true;

    // VALIDATION A: No chunk exceeds chunkSize
    let validSizeCount = 0;
    chunks.forEach((chunk, index) => {
        if (chunk.length <= CHUNK_SIZE) {
            validSizeCount++;
        } else {
            console.error(`❌ Validation A Failed: Chunk ${index} length (${chunk.length}) exceeds chunkSize (${CHUNK_SIZE})`);
            passedAll = false;
        }
    });

    if (validSizeCount === chunks.length) {
        console.log(`✅ Validation A Passed: All ${chunks.length} chunks are <= ${CHUNK_SIZE} characters.`);
    }

    // VALIDATION B: Compare end of Chunk 0 with start of Chunk 1
    if (chunks.length >= 2) {
        const chunk0 = chunks[0];
        const chunk1 = chunks[1];

        // Find the overlap text
        // We know chunk1 starts with the overlap. Since chunk0 ends with it, 
        // we can take the first N words of chunk1 and see if they match the last N words of chunk0.
        // Or simply find the longest common suffix/prefix substring.
        // A simpler way: Check if the first 20 chars of chunk1 exist at the very end of chunk0.
        
        // Find the overlapping string
        const overlapStartIn0 = chunk0.indexOf(chunk1.substring(0, 30)); 
        
        if (overlapStartIn0 !== -1 && chunk0.endsWith(chunk0.substring(overlapStartIn0))) {
             console.log(`✅ Validation B Passed: Perfect overlap handshake detected.`);
             
             // VALIDATION C: Print the handshake visually
             console.log(`\n--- Validation C: Manual Visual Inspection ---`);
             console.log(`\x1b[36m[CHUNK 0]\x1b[0m\n${chunk0}`);
             console.log(`\n\x1b[35m[HANDSHAKE OVERLAP] --->\x1b[0m "\x1b[32m${chunk0.substring(overlapStartIn0)}\x1b[0m"`);
             console.log(`\n\x1b[36m[CHUNK 1]\x1b[0m\n${chunk1}`);
             console.log(`----------------------------------------------\n`);
        } else {
             console.error(`❌ Validation B Failed: Overlap not found cleanly between Chunk 0 and 1.`);
             console.error(`Start of Chunk 1: "${chunk1.substring(0, 30)}..."`);
             console.error(`End of Chunk 0:   "...${chunk0.substring(chunk0.length - 30)}"`);
             passedAll = false;
        }
    } else {
        console.error("❌ Need at least 2 chunks to validate overlap logic!");
        passedAll = false;
    }

    if (!passedAll) process.exit(1);
}

runTests();
