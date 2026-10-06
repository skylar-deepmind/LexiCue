#pragma once
#include <stdint.h>
#ifdef _WIN32
#define LX_API extern "C" __declspec(dllexport)
#else
#define LX_API extern "C" __attribute__((visibility("default")))
#endif
using lx_fragment = void (*)(void *, const char *);
using lx_cancel = bool (*)(void *);
struct lx_usage { int64_t input; int64_t output; };
// ABI 1. All handles stay on the dedicated inference worker. Callbacks do not
// outlive lx_generate; cancellation must never destroy an active handle.
LX_API int lx_abi();
LX_API void * lx_create(const char * path, const char * backend, const char * cache);
LX_API void lx_destroy(void * handle);
LX_API int64_t lx_count(void * handle, const char * system, const char * prompt);
LX_API int lx_generate(void * handle, const char * system, const char * prompt,
    const char * schema, lx_fragment fragment, lx_cancel cancel, void * data, lx_usage * usage);
