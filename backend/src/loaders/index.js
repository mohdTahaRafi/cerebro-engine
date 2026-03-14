import fs from 'fs/promises';
import path from 'path';
import { UniversalLoader } from './UniversalLoader.js';

async function test() {
    console.log('--- Initializing UniversalLoader ---');
    const loader = new UniversalLoader();

    // Create a sample.txt file
    const txtPath = path.resolve(process.cwd(), 'sample.txt');
    await fs.writeFile(txtPath, 'This is a sample text file to test the UniversalLoader.');

    try {
        console.log("\n--- Loading Sample TXT ---");
        const txtData = await loader.load(txtPath);
        console.log("Result content:", txtData.content);
        console.log("Metadata:", txtData.metadata);

        // Fetch a dummy PDF to test PDF parsing
        const pdfPath = path.resolve(process.cwd(), 'sample.pdf');
        const fetchRes = await fetch('https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/tracemonkey.pdf');
        const buffer = await fetchRes.arrayBuffer();
        await fs.writeFile(pdfPath, Buffer.from(buffer));

        console.log("\n--- Loading Sample PDF ---");
        const pdfData = await loader.load(pdfPath);
        console.log("Result content length:", pdfData.content.length);
        console.log("Result content (first 100 chars):", pdfData.content.substring(0, 100));
        console.log("Metadata:", pdfData.metadata);

        console.log("\n--- Loading URL ---");
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        const webData = await loader.load('https://example.com');
        console.log('Result content length:', webData.content.length);
        console.log('Result content (first 100 chars):', webData.content.substring(0, 100));
        console.log('Metadata:', webData.metadata);
    } catch (e) {
        console.error("\nTest failed:", e);
    } finally {
        // cleanup 
        try {
            await fs.unlink(path.resolve(process.cwd(), 'sample.txt'));
            await fs.unlink(path.resolve(process.cwd(), 'sample.pdf'));
            console.log('\n--- Cleaned up sample files ---');
        } catch(e) {
            console.error('\nCleanup error:', e);
        }
    }
}

test();
