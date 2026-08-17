// This file implements a Top-K priority queue using a Min-Heap to efficiently retrieve the most relevant search results.
#include "VectorSearch.h"
#include <iostream>
#include <queue>
#include <vector>
#include <algorithm>
#include <string>

namespace Cerebro {

struct SearchResult {
    int index;
    float score;
};

struct CompareResults {
    bool operator()(const SearchResult& a, const SearchResult& b) {
        return a.score > b.score;
    }
};

Napi::Object CerebroEngine::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "CerebroEngine", {
        InstanceMethod("InitEngine", &CerebroEngine::InitEngine),
        InstanceMethod("ReceiveVectors", &CerebroEngine::ReceiveVectors),
        InstanceMethod("SearchVectors", &CerebroEngine::SearchVectors)
    });

    Napi::FunctionReference* constructor = new Napi::FunctionReference();
    *constructor = Napi::Persistent(func);
    env.SetInstanceData(constructor);

    exports.Set("CerebroEngine", func);
    return exports;
}

CerebroEngine::CerebroEngine(const Napi::CallbackInfo& info) : Napi::ObjectWrap<CerebroEngine>(info) {
}

Napi::Value CerebroEngine::InitEngine(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::cout << "[C++ Core] Engine Initialized." << std::endl;
    return env.Undefined();
}

Napi::Value CerebroEngine::ReceiveVectors(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsTypedArray()) {
        Napi::TypeError::New(env, "Argument 0 must be a TypedArray").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::TypedArray typedArray = info[0].As<Napi::TypedArray>();
    if (typedArray.TypedArrayType() != napi_float32_array) {
        Napi::TypeError::New(env, "Argument 0 must be a Float32Array").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Float32Array floatArray = info[0].As<Napi::Float32Array>();
    
    const float* dataPtr = floatArray.Data();
    size_t length = floatArray.ElementLength();

    std::cout << "[C++ Core] Zero-Copy Bridge: Received " << length << " floats at " << dataPtr << "." << std::endl;

    Napi::Object result = Napi::Object::New(env);
    result.Set("floatsReceived", Napi::Number::New(env, (double)length));
    return result;
}

// Brute-force scan over whatever dataset buffer the caller passes in. There is no
// server-side index retained between calls — the caller rebuilds `dataset` fresh on every
// invocation and hands the whole thing in here each time. This addon has not been on the
// query serving path since Phase 3 (Qdrant took over hybrid retrieval); it survives now as
// the benchmark artifact bench/cppVsQdrant.js measures (phase 6 §3, §5.2).
Napi::Value CerebroEngine::SearchVectors(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 3 || !info[0].IsTypedArray() || !info[1].IsTypedArray() || !info[2].IsNumber()) {
        Napi::TypeError::New(env, "Expects strings (Query Vector, Dataset, K)").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Float32Array queryArr = info[0].As<Napi::Float32Array>();
    Napi::Float32Array datasetArr = info[1].As<Napi::Float32Array>();
    int k = info[2].As<Napi::Number>().Int32Value();

    // Dimension is derived from the query vector itself rather than hardcoded, then the
    // dataset buffer is strictly validated against it. A malformed/truncated dataset
    // (length not an exact multiple of dim) previously fell through silent integer
    // division and corrupted results — it now throws instead.
    size_t dim = queryArr.ElementLength();
    if (dim == 0) {
        Napi::RangeError::New(env, "Query vector must not be empty").ThrowAsJavaScriptException();
        return env.Null();
    }
    if (datasetArr.ElementLength() % dim != 0) {
        Napi::RangeError::New(env,
            "Dataset buffer length (" + std::to_string(datasetArr.ElementLength()) +
            ") is not an exact multiple of the query vector's dimension (" + std::to_string(dim) + ")")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    const float* queryPtr = queryArr.Data();
    const float* datasetPtr = datasetArr.Data();

    size_t numVectors = datasetArr.ElementLength() / dim;

    std::priority_queue<SearchResult, std::vector<SearchResult>, CompareResults> minHeap;

    for (size_t i = 0; i < numVectors; i++) {
        float score = SimdDotProduct(queryPtr, datasetPtr + (i * dim), dim);
        minHeap.push({(int)i, score});
        if ((int)minHeap.size() > k) {
            minHeap.pop();
        }
    }

    std::vector<SearchResult> topK;
    while (!minHeap.empty()) {
        topK.push_back(minHeap.top());
        minHeap.pop();
    }
    std::reverse(topK.begin(), topK.end());

    Napi::Array results = Napi::Array::New(env, topK.size());
    for (size_t i = 0; i < topK.size(); i++) {
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("index", Napi::Number::New(env, topK[i].index));
        obj.Set("score", Napi::Number::New(env, topK[i].score));
        results[i] = obj;
    }

    return results;
}

} // namespace Cerebro
