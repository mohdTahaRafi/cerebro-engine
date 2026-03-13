#include <napi.h>
#include <cmath>

Napi::Value CalculateSimilarity(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // 4. Safety: Add a check to ensure both input vectors are of the same length.
    if (info.Length() < 2 || !info[0].IsTypedArray() || !info[1].IsTypedArray()) {
        Napi::TypeError::New(env, "Expected two Float32Array arguments").ThrowAsJavaScriptException();
        return env.Null();
    }

    // 1. Memory Access: Use Napi::TypedArrayOf<float> (which is Float32Array) for zero-copy
    Napi::Float32Array arrA = info[0].As<Napi::Float32Array>();
    Napi::Float32Array arrB = info[1].As<Napi::Float32Array>();

    size_t length = arrA.ElementLength();
    if (length != arrB.ElementLength()) {
        Napi::TypeError::New(env, "Input arrays must be of the same length").ThrowAsJavaScriptException();
        return env.Null();
    }

    const float* a = arrA.Data();
    const float* b = arrB.Data();

    float dotProduct = 0.0f;
    float normA = 0.0f;
    float normB = 0.0f;

    size_t i = 0;
    
    // 3. Loop Unrolling (SIMD Simulation): Unroll the main loop by a factor of 4
    for (; i + 3 < length; i += 4) {
        float a0 = a[i];
        float b0 = b[i];
        float a1 = a[i + 1];
        float b1 = b[i + 1];
        float a2 = a[i + 2];
        float b2 = b[i + 2];
        float a3 = a[i + 3];
        float b3 = b[i + 3];

        // 2. The Calculation: Dot product and sums of squares
        dotProduct += (a0 * b0) + (a1 * b1) + (a2 * b2) + (a3 * b3);
        normA += (a0 * a0) + (a1 * a1) + (a2 * a2) + (a3 * a3);
        normB += (b0 * b0) + (b1 * b1) + (b2 * b2) + (b3 * b3);
    }

    // Handle any remaining elements if length is not a multiple of 4
    for (; i < length; ++i) {
        float ai = a[i];
        float bi = b[i];
        dotProduct += ai * bi;
        normA += ai * ai;
        normB += bi * bi;
    }

    // Prevent division by zero
    if (normA == 0.0f || normB == 0.0f) {
        return Napi::Number::New(env, 0.0);
    }

    // Similarity = (Sum Ai * Bi) / (sqrt(Sum Ai^2) * sqrt(Sum Bi^2))
    float similarity = dotProduct / (std::sqrt(normA) * std::sqrt(normB));

    return Napi::Number::New(env, similarity);
}

// 5. Export: Wrap this in a function called CalculateSimilarity and export it as getSimilarityScore
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "getSimilarityScore"),
                Napi::Function::New(env, CalculateSimilarity));
    return exports;
}

NODE_API_MODULE(cerebro_core, Init)
