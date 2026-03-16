#include <napi.h>
#include "VectorSearch.h"

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return Cerebro::CerebroEngine::Init(env, exports);
}

NODE_API_MODULE(cerebro_core, Init)
