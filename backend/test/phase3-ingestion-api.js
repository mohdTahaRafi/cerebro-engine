import assert from 'node:assert/strict';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import * as XLSX from 'xlsx';

const execFile = promisify(execFileCallback);
const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mongoUri = process.env.MONGO_URI;
const port = Number(process.env.PORT || 5106);
const filePrefix = `phase3-${Date.now()}`;

assert.equal(mongoUri, 'mongodb://127.0.0.1:27018/cerebro_phase2', 'Phase 3 tests must use the isolated MongoDB URI');

async function createDocx(directory) {
    const stagingDirectory = path.join(directory, 'docx-source');
    const docxPath = path.join(directory, `${filePrefix}-document.docx`);

    await mkdir(path.join(stagingDirectory, '_rels'), { recursive: true });
    await mkdir(path.join(stagingDirectory, 'word'), { recursive: true });
    await writeFile(path.join(stagingDirectory, '[Content_Types].xml'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
    await writeFile(path.join(stagingDirectory, '_rels', '.rels'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
    await writeFile(path.join(stagingDirectory, 'word', 'document.xml'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX ingestion content.</w:t></w:r></w:p></w:body></w:document>`);
    await execFile('zip', ['-q', '-r', docxPath, '[Content_Types].xml', '_rels', 'word'], { cwd: stagingDirectory });
    return docxPath;
}

async function createFixtures(directory) {
    const sensitiveText = 'Contact person@example.com or visit https://example.com/private for the record.';
    const files = {
        txt: path.join(directory, `${filePrefix}-document.txt`),
        markdown: path.join(directory, `${filePrefix}-document.md`),
        csv: path.join(directory, `${filePrefix}-document.csv`),
        xlsx: path.join(directory, `${filePrefix}-document.xlsx`),
        xls: path.join(directory, `${filePrefix}-document.xls`),
        json: path.join(directory, `${filePrefix}-document.json`),
        pdf: path.join(directory, `${filePrefix}-document.pdf`)
    };

    await writeFile(files.txt, `${sensitiveText}\n\n${'A complete ingestion sentence. '.repeat(40)}`);
    await writeFile(files.markdown, `# Heading\n\n${sensitiveText}`);
    await writeFile(files.csv, `name,notes\nAda,"${sensitiveText}"`);
    await writeFile(files.json, JSON.stringify([{ name: 'Ada', notes: sensitiveText }]));
    await copyFile(path.join(backendDirectory, 'dummy.pdf'), files.pdf);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
        ['name', 'notes'],
        ['Ada', sensitiveText]
    ]), 'Sheet1');
    XLSX.writeFile(workbook, files.xlsx);
    XLSX.writeFile(workbook, files.xls, { bookType: 'biff8' });
    files.docx = await createDocx(directory);
    return files;
}

async function waitForHealth(server) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
        if (server.exitCode !== null) throw new Error(`API server exited with code ${server.exitCode}`);
        try {
            const response = await fetch(`http://127.0.0.1:${port}/health`);
            if (response.ok) return;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('API server did not become healthy');
}

async function upload(filePath) {
    const form = new FormData();
    form.append('document', new Blob([await readFile(filePath)]), path.basename(filePath));
    const response = await fetch(`http://127.0.0.1:${port}/api/ingest`, { method: 'POST', body: form });
    return { response, body: await response.json() };
}

function vectorMagnitude(vector) {
    return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

async function run() {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'cerebro-phase3-api-'));
    const fixtureDirectory = path.join(temporaryRoot, 'fixtures');
    const serverDirectory = path.join(temporaryRoot, 'server');
    const serverLog = path.join(temporaryRoot, 'backend.log');
    let server;
    let uploadedFileNames = [];

    await mkdir(fixtureDirectory);
    await mkdir(serverDirectory);

    try {
        const fixtures = await createFixtures(fixtureDirectory);
        uploadedFileNames = Object.values(fixtures).map(filePath => path.basename(filePath));
        server = spawn(process.execPath, [path.join(backendDirectory, 'src/api/index.js')], {
            cwd: serverDirectory,
            env: { ...process.env, MONGO_URI: mongoUri, PORT: String(port) },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        const logStream = (chunk) => writeFile(serverLog, chunk, { flag: 'a' });
        server.stdout.on('data', logStream);
        server.stderr.on('data', logStream);
        await waitForHealth(server);

        for (const [format, filePath] of Object.entries(fixtures)) {
            const { response, body } = await upload(filePath);
            assert.equal(response.status, 200, `${format} upload should succeed: ${JSON.stringify(body)}`);
            assert.equal(body.success, true, `${format} response should report success`);
            assert.ok(body.chunksCount > 0, `${format} should produce chunks`);
        }

        await mongoose.connect(mongoUri);
        const collection = mongoose.connection.db.collection('chunks');
        const documents = await collection.find({ 'metadata.fileName': { $in: uploadedFileNames } }).toArray();
        const expectedTypes = new Set(['text', 'csv', 'excel', 'json', 'pdf', 'docx']);

        assert.ok(documents.length >= uploadedFileNames.length, 'each uploaded format should persist at least one chunk');
        for (const document of documents) {
            assert.ok(expectedTypes.has(document.metadata.type), 'persisted chunk should retain a supported metadata type');
            assert.equal(typeof document.metadata.position, 'string', 'persisted chunk should retain its position metadata');
            assert.equal(document.vector.length, 384, 'persisted vectors should have 384 dimensions');
            assert.ok(Math.abs(vectorMagnitude(document.vector) - 1) < 1e-5, 'persisted vectors should be L2 normalized');
            assert.ok(!document.text.includes('person@example.com'), 'persisted text should not retain raw emails');
            assert.ok(!document.text.includes('https://example.com/private'), 'persisted text should not retain raw URLs');
        }

        const textDocuments = documents.filter(document => document.metadata.type === 'text');
        assert.ok(textDocuments.every(document => document.text.length <= 500), 'text and markdown chunks should remain within the chunk limit');

        const uploadDirectory = path.join(serverDirectory, 'uploads');
        assert.deepEqual(await readdir(uploadDirectory), [], 'successful uploads should be removed from the temporary upload directory');

        const unsupportedPath = path.join(fixtureDirectory, `${filePrefix}-unsupported.exe`);
        await writeFile(unsupportedPath, 'not a supported document');
        const unsupported = await upload(unsupportedPath);
        assert.equal(unsupported.response.status, 500, 'unsupported upload should return a failure response');
        assert.match(unsupported.body.error, /Unsupported file type/, 'unsupported upload should explain the failure');
        assert.equal('preservedPath' in unsupported.body, false, 'failed uploads should not expose internal filesystem paths');
        const failedUploads = await readdir(uploadDirectory);
        assert.equal(failedUploads.length, 1, 'failed uploads should remain available internally for retry');
        assert.match(failedUploads[0], /\.exe$/, 'the retained upload should preserve its original extension');
        await stat(path.join(uploadDirectory, failedUploads[0]));

        await collection.deleteMany({ 'metadata.fileName': { $in: uploadedFileNames } });
        await mongoose.disconnect();
        console.log('Phase 3 API ingestion coverage passed.');
    } finally {
        if (uploadedFileNames.length > 0) {
            if (mongoose.connection.readyState === 0) await mongoose.connect(mongoUri);
            await mongoose.connection.db.collection('chunks').deleteMany({ 'metadata.fileName': { $in: uploadedFileNames } });
        }
        if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
        if (server && server.exitCode === null) {
            server.kill('SIGTERM');
            await new Promise(resolve => server.once('exit', resolve));
        }
        await rm(temporaryRoot, { recursive: true, force: true });
    }
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
