import { UniversalLoader } from '../src/loaders/UniversalLoader.js';
import fs from 'fs/promises';
import path from 'path';

async function runTests() {
    console.log("=== Phase 4: Tabular Data Support Validation ===");
    const loader = new UniversalLoader();
    let passCount = 0;
    let failCount = 0;

    const report = (name, passed, msg, output = null) => {
        if (passed) {
            console.log(`✅ Passed: [${name}]`);
            if (output !== null) {
                console.log(`\n--- Output Preview (First 2 chunks) ---\n`, JSON.stringify(output.slice(0, 2), null, 2), `\n--------------------------------\n`);
            }
            passCount++;
        } else {
            console.log(`❌ Failed: [${name}] - ${msg}`);
            failCount++;
        }
    };

    // SETUP
    const csvPath = path.resolve(process.cwd(), 'sample_tabular.csv');
    const jsonPath = path.resolve(process.cwd(), 'sample_structured.json');
    
    const csvContent = "Name,Age,Role\nAlice,30,Engineer\nBob,25,Designer\nCharlie,35,Manager\nDavid,28,Developer\nEve,22,Intern";
    await fs.writeFile(csvPath, csvContent);
    
    const jsonContent = [
        { "id": 1, "title": "First Item", "meta": { "tag": "A" } },
        { "id": 2, "title": "Second Item", "meta": { "tag": "B" } }
    ];
    await fs.writeFile(jsonPath, JSON.stringify(jsonContent, null, 2));

    // CASE A: CSV with headers
    try {
        const dataA = await loader.load(csvPath);
        // Validation A: Assert each row converted into string with header names
        const allHaveHeaders = dataA.every(chunk => 
            chunk.text.includes('Name is') && 
            chunk.text.includes('Age is') && 
            chunk.text.includes('Role is')
        );
        
        if (Array.isArray(dataA) && dataA.length === 5 && allHaveHeaders) {
            report('Case A (CSV Row-to-Context)', true, null, dataA);
        } else {
            report('Case A (CSV Row-to-Context)', false, `Condition failed. Length: ${dataA.length}, Headers valid: ${allHaveHeaders}`);
        }
    } catch(e) {
        report('Case A (CSV Row-to-Context)', false, e.message);
    }

    // CASE B: JSON array of objects
    try {
        const dataB = await loader.load(jsonPath);
        // Validation B: Verify nested objects correctly stringified
        const validObjects = dataB.every(chunk => {
            try {
                const parsed = JSON.parse(chunk.text);
                return typeof parsed === 'object' && parsed.id !== undefined;
            } catch { return false; }
        });

        if (Array.isArray(dataB) && dataB.length === 2 && validObjects) {
            report('Case B (JSON Structure)', true, null, dataB);
        } else {
            report('Case B (JSON Structure)', false, `Condition failed. Length: ${dataB.length}, Valid serialization: ${validObjects}`);
        }
    } catch(e) {
        report('Case B (JSON Structure)', false, e.message);
    }

    // CASE C: Output format check (Overall consistency)
    try {
        const txtPath = path.resolve(process.cwd(), 'standard_text.txt');
        await fs.writeFile(txtPath, "Just some normal text.");
        const dataC = await loader.load(txtPath);
        
        const isCorrectFormat = Array.isArray(dataC) && 
                                dataC.length === 1 && 
                                typeof dataC[0].text === 'string' &&
                                dataC[0].metadata !== undefined;

        if (isCorrectFormat) {
            report('Case C (Output Consistency)', true, null, dataC);
        } else {
            report('Case C (Output Consistency)', false, 'Text loader did not return array of objects.');
        }
        await fs.unlink(txtPath);
    } catch(e) {
        report('Case C (Output Consistency)', false, e.message);
    }

    // TEARDOWN
    try {
        await fs.unlink(csvPath);
        await fs.unlink(jsonPath);
    } catch(e) {}

    console.log(`\nResults: ${passCount} Passed, ${failCount} Failed.`);
    if (failCount > 0) process.exit(1);
}

runTests();
