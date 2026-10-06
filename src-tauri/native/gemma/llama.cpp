#include "bridge.h"
#include "llama.h"
#include "chat.h"
#include "json-schema-to-grammar.h"
#include <nlohmann/json.hpp>
#include <algorithm>
#include <memory>
#include <string>
#include <vector>

struct Model {
    llama_model * weights;
    common_chat_templates_ptr templates;
    bool gpu;
    ~Model() { templates.reset(); llama_model_free(weights); }
};
static std::string render(Model & model, const char * system, const char * prompt) {
    common_chat_templates_inputs input;
    input.messages = {{"system", system}, {"user", prompt}};
    input.enable_thinking = false;
    input.force_pure_content = true;
    return common_chat_templates_apply(model.templates.get(), input).prompt;
}
static std::vector<llama_token> tokenize(Model & model, const std::string & text) {
    auto * vocab = llama_model_get_vocab(model.weights);
    int n = llama_tokenize(vocab, text.data(), text.size(), nullptr, 0, true, true);
    if (n >= 0) return {};
    std::vector<llama_token> tokens(-n);
    n = llama_tokenize(vocab, text.data(), text.size(), tokens.data(), tokens.size(), true, true);
    if (n < 0) return {};
    tokens.resize(n); return tokens;
}
LX_API int lx_abi() { return 1; }
LX_API void * lx_create(const char * path, const char * backend, const char *) {
    const bool gpu = std::string(backend) == "gpu";
    if (gpu && !llama_supports_gpu_offload()) return nullptr;
    llama_backend_init();
    auto config = llama_model_default_params(); config.n_gpu_layers = gpu ? -1 : 0;
    auto * weights = llama_model_load_from_file(path, config);
    if (!weights) return nullptr;
    try { return new Model{weights, common_chat_templates_init(weights, ""), gpu}; }
    catch (...) { llama_model_free(weights); return nullptr; }
}
LX_API void lx_destroy(void * handle) { delete (Model *)handle; }
LX_API int64_t lx_count(void * handle, const char * system, const char * prompt) {
    try { auto & model = *(Model *)handle; return tokenize(model, render(model, system, prompt)).size(); }
    catch (...) { return -1; }
}
struct Cancellation { lx_cancel callback; void * data; };
static bool cancelled(void * data) { auto & c = *(Cancellation *)data; return c.callback(c.data); }
LX_API int lx_generate(void * handle, const char * system, const char * prompt,
    const char * schema, lx_fragment fragment, lx_cancel cancel, void * data, lx_usage * usage) {
    llama_context * ctx = nullptr; llama_sampler * sampler = nullptr;
    int result = 1;
    try {
        auto & model = *(Model *)handle;
        auto * vocab = llama_model_get_vocab(model.weights);
        auto tokens = tokenize(model, render(model, system, prompt));
        if (tokens.empty() || tokens.size() + 2048 + 64 > 8192) return 3;
        Cancellation cancellation{cancel, data};
        auto params = llama_context_default_params();
        params.offload_kqv = model.gpu; params.op_offload = model.gpu;
        params.n_ctx = 8192; params.n_batch = 256; params.n_ubatch = 128;
        params.n_threads = params.n_threads_batch = 4;
        params.abort_callback = cancelled; params.abort_callback_data = &cancellation;
        ctx = llama_init_from_model(model.weights, params);
        if (!ctx) return 1;
        sampler = llama_sampler_chain_init(llama_sampler_chain_default_params());
        auto grammar = json_schema_to_grammar(nlohmann::ordered_json::parse(schema), true);
        auto * constraint = llama_sampler_init_grammar(vocab, grammar.c_str(), "root");
        if (!constraint) throw std::runtime_error("invalid schema");
        llama_sampler_chain_add(sampler, constraint);
        llama_sampler_chain_add(sampler, llama_sampler_init_greedy());
        for (size_t start = 0; start < tokens.size(); start += 256) {
            if (cancel(data)) { result = 2; break; }
            auto batch = llama_batch_get_one(tokens.data() + start, std::min(size_t(256), tokens.size() - start));
            if (llama_decode(ctx, batch)) throw std::runtime_error("prefill failed");
        }
        usage->input = tokens.size(); usage->output = 0;
        if (result != 2) {
            for (int i = 0; i < 2048; ++i) {
                if (cancel(data)) { result = 2; break; }
                auto token = llama_sampler_sample(sampler, ctx, -1);
                if (llama_vocab_is_eog(vocab, token)) { result = 0; break; }
                std::vector<char> piece(256);
                int n = llama_token_to_piece(vocab, token, piece.data(), piece.size(), 0, false);
                if (n < 0) { piece.resize(-n); n = llama_token_to_piece(vocab, token, piece.data(), piece.size(), 0, false); }
                if (n < 0) throw std::runtime_error("decode failed");
                auto text = std::string(piece.data(), n); fragment(data, text.c_str());
                usage->output++;
                if (llama_decode(ctx, llama_batch_get_one(&token, 1))) throw std::runtime_error("decode failed");
                result = 4; // Token limit: never present a partial JSON result as success.
            }
        }
    } catch (...) { result = cancel(data) ? 2 : 1; }
    if (sampler) llama_sampler_free(sampler);
    if (ctx) llama_free(ctx);
    return result;
}
