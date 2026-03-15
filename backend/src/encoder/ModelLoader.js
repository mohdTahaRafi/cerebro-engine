import { pipeline } from '@huggingface/transformers';

/**
 * ModelLoader class implements a Singleton pattern to ensure the ML model
 * is loaded exactly once into memory.
 */
export class ModelLoader {
    static instance = null;
    static loadPromise = null;

    /**
     * Gets the single instance of the feature-extraction pipeline.
     * Handles concurrent calls by returning a tracked promise if loading is in progress.
     * 
     * @returns {Promise<Function>} The transformer pipeline instance.
     */
    static async getInstance() {
        if (this.instance) {
            return this.instance;
        }

        // Check if a load is already in progress to handle concurrency
        if (this.loadPromise) {
            return this.loadPromise;
        }

        console.log('[ModelLoader] Initializing cold start for Xenova/all-MiniLM-L6-v2...');
        
        // Wrap the loading process in a promise that concurrent callers can await
        this.loadPromise = (async () => {
            try {
                this.instance = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
                console.log('[ModelLoader] Model loaded successfully.');
                return this.instance;
            } catch (error) {
                this.loadPromise = null; // Reset on failure so we can retry
                console.error('[ModelLoader] Error loading model:', error);
                throw error;
            } finally {
                this.loadPromise = null; // Clear the promise state after success or failure
            }
        })();

        return this.loadPromise;
    }
}
