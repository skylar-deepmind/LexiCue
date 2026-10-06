# Embedded Gemma inference

LiteRT-LM is pinned to v0.16.0 (C API 0.1.0). The official archive includes its
Apache-2.0 license and notices for its dependencies. These are copied into the
application with the runtime. Source: https://github.com/google-ai-edge/LiteRT-LM

The Intel macOS runtime statically embeds llama.cpp b9568 and its MIT license.
Its Metal shader source is embedded in the bridge, so it has no external shader
or service dependency. Source: https://github.com/ggml-org/llama.cpp

Gemma weights are not bundled. The pinned community conversions are listed in
models.json, including repository, source revision, size, and SHA-256. Gemma
model use is subject to Google's Gemma terms and the model repository notices:
https://ai.google.dev/gemma/terms
https://huggingface.co/litert-community
https://huggingface.co/ggml-org

Local text inference does not contact these repositories; they are used only
when the user downloads a model. Compatible imported files are verified locally.
