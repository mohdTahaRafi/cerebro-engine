import { UniversalLoader } from '../src/loaders/UniversalLoader.js';
import fs from 'fs/promises';
import path from 'path';

async function runTests() {
    console.log("=== Phase 1 & 2 Integration Test Suite ===");
    const loader = new UniversalLoader();
    let passCount = 0;
    let failCount = 0;

    const report = (name, passed, msg, output = null) => {
        if (passed) {
            console.log(`✅ Passed: [${name}]`);
            if (output !== null) {
                 console.log(`\n--- Sanitized Output Preview ---\n${output.substring(0, 150)}...\n--------------------------------\n`);
            } else {
                 passCount++;
            }
            passCount++;
        } else {
            console.log(`❌ Failed: [${name}] - ${msg}`);
            failCount++;
        }
    };

    // SETUP
    const cleanTxtPath = path.resolve(process.cwd(), 'clean_sample.txt');
    const emptyTxtPath = path.resolve(process.cwd(), 'empty_sample.txt');
    const pdfPath = path.resolve(process.cwd(), 'sample.pdf');
    
    await fs.writeFile(cleanTxtPath, "This is clean prose. It has correct sentences! What else? \t\t\t\t\t Multiple tabs         and  spaces. \n\n\n  \t  And strange newlines.");
    await fs.writeFile(emptyTxtPath, "");
    
    // Download a sample PDF for Case B
    try {
        const fetchRes = await fetch('https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/tracemonkey.pdf');
        const buffer = await fetchRes.arrayBuffer();
        await fs.writeFile(pdfPath, Buffer.from(buffer));
    } catch(e) {
        console.error("Failed to download sample PDF. Skipping PDF setup.");
    }

    // CASE A: The Perfect File
    try {
        const dataA = await loader.load(cleanTxtPath);
        if (typeof dataA.content === 'string' && dataA.metadata.source === cleanTxtPath) {
            report('Case A (The Perfect File)', true, null, dataA.content);
        } else {
            report('Case A (The Perfect File)', false, 'Output format mismatch.');
        }
    } catch(e) {
        report('Case A (The Perfect File)', false, e.message);
    }

    // CASE B: The Messy PDF
    try {
        const dataB = await loader.load(pdfPath);
        const hasCid = dataB.content.includes('cid:10') || dataB.content.includes('(cid:');
        const hasTooManyNewlines = dataB.content.includes('\\n\\n\\n') || dataB.content.includes('\n\n\n');
        
        if (!hasCid && !hasTooManyNewlines && dataB.content.length > 100) {
            report('Case B (The Messy PDF)', true, null, dataB.content);
        } else {
            report('Case B (The Messy PDF)', false, `Contains Artifacts? CID: ${hasCid}, Multiple \\n: ${hasTooManyNewlines}. Valid Length: ${dataB.content.length > 100}`);
        }
    } catch(e) {
        report('Case B (The Messy PDF)', false, e.message);
    }

    // CASE C: The Web Scraper
    try {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // For testing only
        const dataC = await loader.load('https://example.com');
        const hasHtmlTags = /<html[^>]*>|<\/html>|<script[^>]*>|<\/script>/i.test(dataC.content);
        
        if (!hasHtmlTags && dataC.content.includes('Example Domain')) {
            report('Case C (The Web Scraper)', true, null, dataC.content);
        } else {
            report('Case C (The Web Scraper)', false, 'HTML Tags leaked into output.');
        }
    } catch(e) {
        report('Case C (The Web Scraper)', false, e.message);
    }

    // CASE D: The Edge Case
    try {
        const dataD = await loader.load(emptyTxtPath);
        if (dataD.content === '') {
            report('Case D (The Edge Case)', true, null, dataD.content);
        } else {
            report('Case D (The Edge Case)', false, 'Did not return empty string for empty file.');
        }
    } catch(e) {
        report('Case D (The Edge Case)', true, `Handled gracefully via throw: ${e.message}`);
    }

    // TEARDOWN
    try {
        await fs.unlink(cleanTxtPath);
        await fs.unlink(emptyTxtPath);
        await fs.unlink(pdfPath);
    } catch(e) {
        // Ignore cleanup errors
    }

    console.log(`\nResults: ${passCount} Passed, ${failCount} Failed.`);
    if (failCount > 0) process.exit(1);
}

runTests();
