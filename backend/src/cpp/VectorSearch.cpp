// This file implements a Top-K priority queue using a Min-Heap to efficiently retrieve the most relevant search results.
#include "VectorSearch.h"
#include <iostream>
#include <queue>
#include <vector>
#include <algorithm>

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

void VectorSearchImpl::AddDocumentVectors(const float* vectorData, size_t totalVectors, size_t dimensions) {
}

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

Napi::Value CerebroEngine::SearchVectors(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 3 || !info[0].IsTypedArray() || !info[1].IsTypedArray() || !info[2].IsNumber()) {
        Napi::TypeError::New(env, "Expects strings (Query Vector, Dataset, K)").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Float32Array queryArr = info[0].As<Napi::Float32Array>();
    Napi::Float32Array datasetArr = info[1].As<Napi::Float32Array>();
    int k = info[2].As<Napi::Number>().Int32Value();

    const float* queryPtr = queryArr.Data();
    const float* datasetPtr = datasetArr.Data();

    size_t dim = 384;
    size_t numVectors = datasetArr.ElementLength() / dim;

    std::priority_queue<SearchResult, std::vector<SearchResult>, CompareResults> minHeap;

    for (size_t i = 0; i < numVectors; i++) {
        float score = SimdDotProduct(queryPtr, datasetPtr + (i * dim));
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
