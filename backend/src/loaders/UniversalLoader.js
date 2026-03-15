import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import { PDFParse } from 'pdf-parse';
import { createRequire } from 'module';
import { TextSanitizer } from '../utils/TextSanitizer.js';

const require = createRequire(import.meta.url);
const mammoth = require('mammoth');
const xlsx = require('xlsx');
import { SemanticChunker } from '../utils/SemanticChunker.js';

const chunker = new SemanticChunker();

export class UniversalLoader {
    async load(inputSource) {
        let extraction;
        if (this._isUrl(inputSource)) {
            extraction = await this._extractWeb(inputSource);
        } else {
            const ext = path.extname(inputSource).toLowerCase();
            switch (ext) {
                case '.pdf':
                    extraction = await this._extractPDF(inputSource);
                    break;
                case '.docx':
                    extraction = await this._extractDocx(inputSource);
                    break;
                case '.txt':
                case '.md':
                    extraction = await this._extractText(inputSource);
                    break;
                case '.csv':
                    extraction = await this._extractCSV(inputSource);
                    break;
                case '.xlsx':
                case '.xls':
                    extraction = await this._extractExcel(inputSource);
                    break;
                case '.json':
                    extraction = await this._extractJSON(inputSource);
                    break;
                default:
                    throw new Error(`Unsupported file type: ${ext}`);
            }
        }

        const tabularTypes = ['csv', 'excel', 'json'];
        const isTabular = tabularTypes.includes(extraction.metadata.type);

        if (Array.isArray(extraction.content)) {
            // Tabular data already comes in chunks
            return extraction.content.map(text => ({
                text,
                metadata: extraction.metadata
            }));
        } else {
            // Textual data: Sanitize then Chunk
            let processedText = extraction.content;
            if (!isTabular) {
                processedText = TextSanitizer.sanitize(processedText, { maskUrls: true, maskEmails: true });
            }

            // Apply semantic chunker to non-tabular or large strings
            const chunks = chunker.chunk(processedText);
            
            return chunks.map(chunkText => ({
                text: chunkText,
                metadata: extraction.metadata
            }));
        }
    }

    _isUrl(input) {
        try {
            new URL(input);
            return true;
        } catch {
            return false;
        }
    }

    async _extractPDF(filePath) {
        const dataBuffer = await fs.readFile(filePath);
        const parser = new PDFParse({ data: dataBuffer });
        const data = await parser.getText();
        await parser.destroy();
        return {
            content: data.text,
            metadata: {
                source: filePath,
                type: 'pdf',
                timestamp: new Date()
            }
        };
    }

    async _extractDocx(filePath) {
        const result = await mammoth.extractRawText({ path: filePath });
        return {
            content: result.value,
            metadata: {
                source: filePath,
                type: 'docx',
                timestamp: new Date()
            }
        };
    }

    async _extractWeb(url) {
        const response = await fetch(url);
        const html = await response.text();
        const $ = cheerio.load(html);
        const text = $('body').text().replace(/\s+/g, ' ').trim();
        return {
            content: text,
            metadata: {
                source: url,
                type: 'web',
                timestamp: new Date()
            }
        };
    }

    async _extractText(filePath) {
        const content = await fs.readFile(filePath, 'utf-8');
        return {
            content,
            metadata: {
                source: filePath,
                type: 'text',
                timestamp: new Date()
            }
        };
    }

    async _extractCSV(filePath) {
        const buffer = await fs.readFile(filePath);
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) throw new Error("CSV file has no sheets or data.");
        
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);
        
        const chunks = data.map(row => {
            const context = Object.entries(row)
                .filter(([_, val]) => val !== null && val !== undefined)
                .map(([key, value]) => `${key} is ${value}`)
                .join(', ');
            return `Context: ${context}`;
        });

        return {
            content: chunks,
            metadata: {
                source: filePath,
                type: 'csv',
                timestamp: new Date()
            }
        };
    }

    async _extractExcel(filePath) {
        const buffer = await fs.readFile(filePath);
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) throw new Error("Excel file has no sheets or data.");

        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);
        
        const chunks = data.map(row => {
            const context = Object.entries(row)
                .filter(([_, val]) => val !== null && val !== undefined)
                .map(([key, value]) => `${key} is ${value}`)
                .join(', ');
            return `Context: ${context}`;
        });

        return {
            content: chunks,
            metadata: {
                source: filePath,
                type: 'excel',
                timestamp: new Date()
            }
        };
    }

    async _extractJSON(filePath) {
        const raw = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(raw);
        let chunks;
        
        if (Array.isArray(data)) {
            chunks = data.map(item => typeof item === 'object' ? JSON.stringify(item) : String(item));
        } else {
            chunks = [JSON.stringify(data)];
        }

        return {
            content: chunks,
            metadata: {
                source: filePath,
                type: 'json',
                timestamp: new Date()
            }
        };
    }
}