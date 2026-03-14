import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import { PDFParse } from 'pdf-parse';
import { createRequire } from 'module';
import { TextSanitizer } from '../utils/TextSanitizer.js';

const require = createRequire(import.meta.url);
const mammoth = require('mammoth');

export class UniversalLoader {
    async load(inputSource) {
        let result;
        if (this._isUrl(inputSource)) {
            result = await this._extractWeb(inputSource);
        } else {
            const ext = path.extname(inputSource).toLowerCase();
            switch (ext) {
                case '.pdf':
                    result = await this._extractPDF(inputSource);
                    break;
                case '.docx':
                    result = await this._extractDocx(inputSource);
                    break;
                case '.txt':
                case '.md':
                    result = await this._extractText(inputSource);
                    break;
                default:
                    throw new Error(`Unsupported file type: ${ext}`);
            }
        }

        // Sanitize the raw content before returning
        result.content = TextSanitizer.sanitize(result.content, { maskUrls: true, maskEmails: true });
        return result;
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
}