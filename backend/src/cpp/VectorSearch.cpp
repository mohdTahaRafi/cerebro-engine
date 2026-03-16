#include "VectorSearch.h"
#include <iostream>

namespace Cerebro {

void VectorSearchImpl::AddDocumentVectors(const float* vectorData, size_t totalVectors, size_t dimensions) {
    // Implementation for later
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
    // Constructor logic
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
    
    // Zero-Copy Bridge: Access raw pointer directly from memory
    const float* dataPtr = floatArray.Data();
    size_t length = floatArray.ElementLength();

    std::cout << "[C++ Core] Zero-Copy Bridge: Received " << length << " floats at " << dataPtr << "." << std::endl;

    Napi::Object result = Napi::Object::New(env);
    result.Set("floatsReceived", Napi::Number::New(env, (double)length));
    return result;
}

Napi::Value CerebroEngine::SearchVectors(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsTypedArray() || !info[1].IsTypedArray()) {
        Napi::TypeError::New(env, "Expects two arguments (Query Vector, Dataset)").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Float32Array queryArr = info[0].As<Napi::Float32Array>();
    Napi::Float32Array datasetArr = info[1].As<Napi::Float32Array>();

    const float* queryPtr = queryArr.Data();
    const float* datasetPtr = datasetArr.Data();

    size_t dim = 384;
    size_t numVectors = datasetArr.ElementLength() / dim;

    // Create result array
    Napi::Float32Array results = Napi::Float32Array::New(env, numVectors);
    float* resultsPtr = results.Data();

    // The Similarity Loop
    for (size_t i = 0; i < numVectors; i++) {
        resultsPtr[i] = SimdDotProduct(queryPtr, datasetPtr + (i * dim));
    }

    return results;
}

} // namespace Cerebro
