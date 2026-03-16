#ifndef VECTOR_SEARCH_H
#define VECTOR_SEARCH_H

#include <napi.h>
#include "VectorMath.h"

namespace Cerebro {

class VectorSearchImpl : public VectorSearch {
public:
    void AddDocumentVectors(const float* vectorData, size_t totalVectors, size_t dimensions) override;
};

class CerebroEngine : public Napi::ObjectWrap<CerebroEngine> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    CerebroEngine(const Napi::CallbackInfo& info);

private:
    Napi::Value InitEngine(const Napi::CallbackInfo& info);
    Napi::Value ReceiveVectors(const Napi::CallbackInfo& info);
    Napi::Value SearchVectors(const Napi::CallbackInfo& info);
};

} // namespace Cerebro

#endif // VECTOR_SEARCH_H
