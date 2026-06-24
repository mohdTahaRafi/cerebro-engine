import axios from 'axios';

/**
 * Service to handle interaction with the local Ollama LLM
 */
export class GenerationService {
    /**
     * Constructs a prompt from retrieved chunks and streams the response from Ollama.
     * 
     * @param {string} query - The user's query
     * @param {Array} chunks - The retrieved document chunks
     * @param {Function} onToken - Callback fired when a new text token arrives
     * @returns {Promise<void>} Resolves when the stream is complete
     */
    static async generateStreamingResponse(query, chunks, onToken) {
        // Construct the prompt context
        const contextText = chunks.map((c, i) => `[Chunk ${i + 1}]:\n${c.text || c.content}`).join('\n\n');
        
        const prompt = `You are a highly intelligent, secure corporate assistant. 
Answer the user's question based STRICTLY on the Context provided below. 
If the answer is not contained in the Context, say "I do not have enough information."
Do NOT make up facts. Cite your sources where possible.

CONTEXT:
${contextText}

QUESTION: ${query}

ANSWER:`;

        console.log(`[GenerationService] Sending prompt to Ollama API (Model: llama3)`);

        try {
            const response = await axios({
                method: 'post',
                url: process.env.OLLAMA_API_URL || 'http://127.0.0.1:11434/api/generate',
                data: {
                    model: process.env.OLLAMA_MODEL || 'llama3', // Defaulting to llama3, can be overridden via env
                    prompt: prompt,
                    stream: true // Enable streaming
                },
                responseType: 'stream'
            });

            // Handle the stream
            return new Promise((resolve, reject) => {
                let buffer = '';
                response.data.on('data', (chunk) => {
                    buffer += chunk.toString();
                    let newlineIndex = buffer.indexOf('\n');
                    
                    while (newlineIndex !== -1) {
                        const line = buffer.substring(0, newlineIndex).trim();
                        buffer = buffer.substring(newlineIndex + 1);
                        
                        if (line) {
                            try {
                                const parsed = JSON.parse(line);
                                if (parsed.response) {
                                    onToken(parsed.response);
                                }
                                if (parsed.done) {
                                    resolve();
                                }
                            } catch (e) {
                                console.error("[GenerationService] Error parsing streaming chunk:", e);
                            }
                        }
                        newlineIndex = buffer.indexOf('\n');
                    }
                });

                response.data.on('end', () => {
                    resolve();
                });

                response.data.on('error', (err) => {
                    reject(err);
                });
            });

        } catch (error) {
            console.error('[GenerationService] Failed to contact Ollama:', error.message);
            throw new Error('Failed to generate response. Is Ollama running locally on port 11434?');
        }
    }
}
