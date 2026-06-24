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
            return extraction.content.map((text, i) => ({
                text,
                metadata: { ...extraction.metadata, position: `Row ${i + 1}` }
            }));
        } else if (extraction.pages) {
            // Data that has explicit page/section boundaries
            const finalChunks = [];
            extraction.pages.forEach((page) => {
                const processedText = TextSanitizer.sanitize(page.text, { maskUrls: true, maskEmails: true });
                const chunks = chunker.chunk(processedText);
                chunks.forEach((chunkText, j) => {
                    finalChunks.push({
                        text: chunkText,
                        metadata: { ...extraction.metadata, position: `Page ${page.pageNumber}` }
                    });
                });
            });
            return finalChunks;
        } else {
            // Textual data: Sanitize then Chunk
            let processedText = extraction.content;
            if (!isTabular) {
                processedText = TextSanitizer.sanitize(processedText, { maskUrls: true, maskEmails: true });
            }

            // Apply semantic chunker to non-tabular or large strings
            const chunks = chunker.chunk(processedText);
            
            return chunks.map((chunkText, i) => ({
                text: chunkText,
                metadata: { ...extraction.metadata, position: `Paragraph ${i + 1}` }
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
        
        let pages = [];
        try {
            const data = await parser.getText();
            // pdf-parse injects "-- X of Y --" at the end of each page
            const rawText = data.text || '';
            const splitted = rawText.split(/\n*\s*-- \d+ of \d+ --\s*\n*/);
            
            splitted.forEach((pageText, index) => {
                if (pageText.trim()) {
                    pages.push({ pageNumber: index + 1, text: pageText.trim() });
                }
            });

            if (pages.length === 0) {
                pages.push({ pageNumber: 1, text: rawText });
            }
        } catch (e) {
            console.warn("[UniversalLoader] Failed to extract page-by-page:", e.message);
            try {
               const data = await parser.getText();
               pages = [{ pageNumber: 1, text: data.text }];
            } catch (fallbackErr) {
               pages = [{ pageNumber: 1, text: '' }];
            }
        }
        
        await parser.destroy();
        return {
            pages,
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