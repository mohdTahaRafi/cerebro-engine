import axios from 'axios';
import CircuitBreaker from 'opossum';

async function fetchEmbeddingFromHF(text: string): Promise<number[]> {
    const hfToken = process.env.HF_TOKEN;
    const modelUrl = 'https://router.huggingface.co/hf-inference/models/BAAI/bge-small-en-v1.5';
    
    const response = await axios.post(
        modelUrl,
        { inputs: text },
        { headers: { Authorization: `Bearer ${hfToken}` } }
    );
    return response.data;
}

const breakerOptions = {
    timeout: 5000, // Timeout if API call takes longer than 5000ms
    errorThresholdPercentage: 50, // Trip circuit if failure rate exceeds 50%
    resetTimeout: 30000 // Wait 30 seconds before testing 'Half-Open'
};

export const hfCircuitBreaker = new CircuitBreaker(fetchEmbeddingFromHF, breakerOptions);

// 3. Fallback Logic: Check if the circuit is open and return specialized error
hfCircuitBreaker.fallback(() => {
    return { error: 'Embedding Service Unavailable', status: 'Circuit Open' };
});

export async function getEmbeddingRobust(text: string): Promise<number[] | { error: string, status: string }> {
    return await hfCircuitBreaker.fire(text);
}
