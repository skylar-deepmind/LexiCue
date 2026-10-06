#include "bridge.h"
#include "engine.h"
#include "conversation.h"
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <string>
#include <cstring>
#include <memory>

// JSON string escaping, including controls; user text is never interpolated raw.
static std::string quoted(const char * s) {
    std::string out = "\"";
    for (const unsigned char * p = (const unsigned char *)s; *p; ++p) {
        if (*p == '"' || *p == '\\') { out += '\\'; out += char(*p); }
        else if (*p < 32) { char b[7]; snprintf(b, sizeof(b), "\\u%04x", *p); out += b; }
        else out += char(*p);
    }
    return out + "\"";
}
static std::string message(const char * role, const char * text) {
    return "{\"role\":" + quoted(role) + ",\"content\":" + quoted(text) + "}";
}
static LiteRtLmConversation * conversation(LiteRtLmEngine * engine, const char * system) {
    auto system_message = message("system", system);
    auto * config = litert_lm_conversation_config_create();
    auto * session = litert_lm_session_config_create();
    // v0.16's compiled executor implements TopP. TopK=1 makes the
    // distribution deterministic on both CPU and GPU.
    auto * sampler = litert_lm_sampler_params_create(kLiteRtLmSamplerTypeTopP);
    auto * thinking = litert_lm_thinking_config_create();
    if (!config || !session || !sampler || !thinking) {
        if (thinking) litert_lm_thinking_config_delete(thinking);
        if (sampler) litert_lm_sampler_params_delete(sampler);
        if (session) litert_lm_session_config_delete(session);
        if (config) litert_lm_conversation_config_delete(config);
        return nullptr;
    }
    litert_lm_sampler_params_set_top_k(sampler, 1);
    litert_lm_sampler_params_set_top_p(sampler, 1.0f);
    litert_lm_sampler_params_set_temperature(sampler, 1.0f);
    litert_lm_sampler_params_set_seed(sampler, 0);
    litert_lm_session_config_set_max_output_tokens(session, 2048);
    litert_lm_session_config_set_sampler_params(session, sampler);
    litert_lm_conversation_config_set_session_config(config, session);
    litert_lm_conversation_config_set_system_message(config, system_message.c_str());
    litert_lm_thinking_config_set_enable_thinking(thinking, false);
    litert_lm_conversation_config_set_thinking_config(config, thinking);
    litert_lm_conversation_config_set_enable_constrained_decoding(config, true);
    LiteRtLmConstraintProviderType provider = kLiteRtLmConstraintProviderTypeLlGuidance;
    litert_lm_conversation_config_set_constraint_provider(config, &provider);
    auto * result = litert_lm_conversation_create(engine, config);
    litert_lm_thinking_config_delete(thinking);
    litert_lm_sampler_params_delete(sampler);
    litert_lm_session_config_delete(session);
    litert_lm_conversation_config_delete(config);
    return result;
}
LX_API int lx_abi() { return 1; }
LX_API void * lx_create(const char * path, const char * backend, const char * cache) {
    try {
    auto * settings = litert_lm_engine_settings_create(path, backend, nullptr, nullptr);
    if (!settings) return nullptr;
    litert_lm_engine_settings_set_max_num_tokens(settings, 8192);
    if (strcmp(backend, "cpu") == 0) litert_lm_engine_settings_set_num_threads(settings, 4);
    litert_lm_engine_settings_set_cache_dir(settings, cache);
    litert_lm_engine_settings_enable_benchmark(settings);
    auto * result = litert_lm_engine_create(settings);
    litert_lm_engine_settings_delete(settings);
    return result;
    } catch (...) { return nullptr; }
}
LX_API void lx_destroy(void * handle) { litert_lm_engine_delete((LiteRtLmEngine *)handle); }
LX_API int64_t lx_count(void * handle, const char * system, const char * prompt) {
    try {
    auto * engine = (LiteRtLmEngine *)handle;
    std::unique_ptr<LiteRtLmConversation, decltype(&litert_lm_conversation_delete)> owner(conversation(engine, system), litert_lm_conversation_delete);
    auto * conv = owner.get();
    if (!conv) return -1;
    const char * preface = litert_lm_conversation_render_preface_to_string(conv);
    std::string rendered = preface ? preface : "";
    const char * text = litert_lm_conversation_render_message_to_string(conv, message("user", prompt).c_str());
    if (!text) return -1;
    rendered += text;
    auto * tokens = litert_lm_engine_tokenize(engine, rendered.c_str());
    int64_t count = tokens ? litert_lm_tokenize_result_get_num_tokens(tokens) : -1;
    if (tokens) litert_lm_tokenize_result_delete(tokens);
    return count;
    } catch (...) { return -1; }
}
struct Stream {
    std::mutex mutex;
    std::condition_variable wake;
    bool done = false;
    bool failed = false;
    lx_fragment fragment;
    void * data;
};
static void receive(void * data, const LiteRtLmStreamChunk * chunk) {
    auto & stream = *(Stream *)data;
    // Final notification is synchronized with the owner before callback data
    // can be destroyed. The library owns chunk, so copy content immediately.
    std::lock_guard<std::mutex> lock(stream.mutex);
    if (const char * error = litert_lm_stream_chunk_get_error(chunk)) { stream.failed = true; fprintf(stderr, "Gemma stream: %s\n", error); }
    if (const char * text = litert_lm_stream_chunk_get_text(chunk)) stream.fragment(stream.data, text);
    if (litert_lm_stream_chunk_is_final(chunk)) stream.done = true;
    stream.wake.notify_all();
}
LX_API int lx_generate(void * handle, const char * system, const char * prompt,
    const char * schema, lx_fragment fragment, lx_cancel cancel, void * data, lx_usage * usage) {
    try {
    auto input = message("user", prompt);
    // Destroy the conversation (which joins its tasks) before callback data,
    // including on an exceptional exit.
    Stream stream; stream.fragment = fragment; stream.data = data;
    std::unique_ptr<LiteRtLmConversation, decltype(&litert_lm_conversation_delete)> owner(conversation((LiteRtLmEngine *)handle, system), litert_lm_conversation_delete);
    auto * conv = owner.get();
    if (!conv) return 1;
    std::unique_ptr<LiteRtLmConversationOptionalArgs, decltype(&litert_lm_conversation_optional_args_delete)> args_owner(litert_lm_conversation_optional_args_create(), litert_lm_conversation_optional_args_delete);
    auto * args = args_owner.get();
    if (!args) return 1;
    litert_lm_conversation_optional_args_set_constraint(args, kLiteRtLmConstraintTypeJsonSchema, schema);
    int result = litert_lm_conversation_send_message_stream(conv, input.c_str(), nullptr, args, receive, &stream);
    bool cancelled = false;
    if (!result) {
        std::unique_lock<std::mutex> lock(stream.mutex);
        while (!stream.done) {
            stream.wake.wait_for(lock, std::chrono::milliseconds(25));
            if (!cancelled && cancel(data)) {
                cancelled = true;
                lock.unlock(); litert_lm_conversation_cancel_process(conv); lock.lock();
            }
        }
        result = cancelled ? 2 : stream.failed ? 1 : 0;
    }
    auto * info = litert_lm_conversation_get_benchmark_info(conv);
    usage->input = usage->output = -1;
    if (info) {
        usage->input = litert_lm_benchmark_info_get_prefill_token_count_at(info, 0);
        usage->output = litert_lm_benchmark_info_get_decode_token_count_at(info, 0);
        litert_lm_benchmark_info_delete(info);
        if (result == 0 && usage->output >= 2048) result = 4;
    }
    return result;
    } catch (...) { return 1; }
}
