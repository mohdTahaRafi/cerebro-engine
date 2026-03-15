export class SemanticChunker {
    /**
     * Splits text into sequential chunks with a sliding window overlap.
     * 
     * @param {string} text - The sanitized text to chunk
     * @param {number} chunkSize - Maximum characters per chunk
     * @param {number} chunkOverlap - Number of characters to overlap between chunks
     * @returns {string[]} An array of text chunks
     */
    chunk(text, chunkSize = 500, chunkOverlap = 50) {
        if (!text || text.length === 0) return [];
        if (text.length <= chunkSize) return [text];

        // 1. Recursive Splitting
        const segments = this._recursiveSplit(text, chunkSize);
        
        // 2. Sliding Window Logic
        return this._mergeAndSlide(segments, chunkSize, chunkOverlap);
    }

    _recursiveSplit(text, maxSize) {
        // Level 1: Split by paragraph (\n\n)
        let splits = text.split('\n\n');
        let result = [];

        for (let split of splits) {
            if (split.length <= maxSize) {
                if (split.trim().length > 0) result.push(split);
            } else {
                // Level 2: Split by newline (\n)
                let newlines = split.split('\n');
                for (let nl of newlines) {
                    if (nl.length <= maxSize) {
                        if (nl.trim().length > 0) result.push(nl);
                    } else {
                        // Level 3: Split by sentence boundaries (. ? !)
                        // Using a regex with positive lookbehind/lookahead to keep the punctuation
                        let sentences = nl.match(/[^.!?]+[.!?]+|\s+[^.!?]+$/g) || [nl];
                        for (let sentence of sentences) {
                            if (sentence.length <= maxSize) {
                                if (sentence.trim().length > 0) result.push(sentence);
                            } else {
                                // Level 4: Fallback to space split
                                let words = sentence.split(' ');
                                for (let word of words) {
                                    if (word.trim().length > 0) result.push(word);
                                }
                            }
                        }
                    }
                }
            }
        }
        return result;
    }

    _mergeAndSlide(segments, chunkSize, chunkOverlap) {
        const chunks = [];
        let currentChunk = '';

        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            
            // If the segment by itself is larger than chunkSize (this only happens if a single word > chunkSize, rare)
            if (segment.length > chunkSize) {
                // Force cut it if it's massively abnormal, though ideally Level 4 spaces prevented this.
                let start = 0;
                while (start < segment.length) {
                    chunks.push(segment.substring(start, start + chunkSize));
                    start += chunkSize - chunkOverlap;
                }
                continue;
            }

            // Can we fit this segment into the current chunk?
            const separator = currentChunk === '' ? '' : ' ';
            if ((currentChunk.length + separator.length + segment.length) <= chunkSize) {
                currentChunk += separator + segment;
            } else {
                // Push the current chunk, it's full
                if (currentChunk.trim().length > 0) {
                    chunks.push(currentChunk.trim());
                }
                
                // Calculate sliding window overlap
                let overlapStartIdx = currentChunk.length - chunkOverlap;
                if (overlapStartIdx < 0) overlapStartIdx = 0;
                
                // Adjust overlapStartIdx to the start of a word
                while (overlapStartIdx > 0 && currentChunk[overlapStartIdx - 1] !== ' ') {
                    overlapStartIdx--;
                }
                
                let overlapContext = currentChunk.substring(overlapStartIdx).trim();
                
                // If the overlapContext + segment still exceeds chunkSize, 
                // we must shrink the overlapContext because segment is already <= chunkSize.
                while (overlapContext.length > 0 && (overlapContext.length + 1 + segment.length) > chunkSize) {
                    // Shrink to the next word boundary
                    let nextSpace = overlapContext.indexOf(' ');
                    if (nextSpace === -1) {
                        overlapContext = '';
                    } else {
                        overlapContext = overlapContext.substring(nextSpace + 1).trim();
                    }
                }

                // The new chunk begins with the overlap context and the current segment
                currentChunk = overlapContext;
                if (currentChunk.length > 0) {
                    currentChunk += ' ' + segment;
                } else {
                    currentChunk = segment;
                }
            }
        }

        // Push the final chunk if anything is left
        if (currentChunk.trim().length > 0) {
            chunks.push(currentChunk.trim());
        }

        return chunks;
    }
}
