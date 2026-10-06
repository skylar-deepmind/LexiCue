"""Reproducible desktop bridge checks; does not read or write learning data."""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import sys
import time


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--runtime", type=Path, required=True)
parser.add_argument("--model", type=Path)
parser.add_argument("--backend", choices=["auto", "cpu", "gpu"], default="auto")
parser.add_argument("--abi-only", action="store_true")
args = parser.parse_args()
directory = args.runtime.resolve()
manifest = json.loads((directory / "runtime.json").read_text())
for item in manifest["files"]:
    assert digest(directory / item["name"]) == item["sha256"], "runtime hash mismatch"
dependency = None
search_path = None
if sys.platform == "win32":
    search_path = os.add_dll_directory(str(directory))
    dependency = ctypes.CDLL(str(directory / "litert-lm.dll"))
    name = "lexicue_gemma.dll"
else:
    name = "liblexicue_gemma.dylib" if sys.platform == "darwin" else "liblexicue_gemma.so"
bridge = ctypes.CDLL(str(directory / name))
bridge.lx_abi.restype = ctypes.c_int
assert bridge.lx_abi() == manifest["abi"] == 1
if args.abi_only:
    print(json.dumps({"abi": 1, "target": manifest["target"], "librariesLoaded": True}))
    sys.exit(0)
assert args.model, "provide --model, or use --abi-only"
model = args.model.resolve()
catalog = json.loads((Path(__file__).resolve().parent.parent / "src-tauri/native/gemma/models.json").read_text())
checksum = digest(model)
asset = next((item for item in catalog if item["sha256"] == checksum), None)
assert asset and model.stat().st_size == asset["bytes"], "not a pinned, compatible asset"
assert manifest["target"] in asset["targets"], "asset format does not match runtime target"
bridge.lx_create.argtypes = [ctypes.c_char_p] * 3
bridge.lx_create.restype = ctypes.c_void_p
bridge.lx_destroy.argtypes = [ctypes.c_void_p]
bridge.lx_count.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p]
bridge.lx_count.restype = ctypes.c_int64


class Usage(ctypes.Structure):
    _fields_ = [("input", ctypes.c_int64), ("output", ctypes.c_int64)]


Fragment = ctypes.CFUNCTYPE(None, ctypes.c_void_p, ctypes.c_char_p)
Cancel = ctypes.CFUNCTYPE(ctypes.c_bool, ctypes.c_void_p)
bridge.lx_generate.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p,
                               Fragment, Cancel, ctypes.c_void_p, ctypes.POINTER(Usage)]
bridge.lx_generate.restype = ctypes.c_int
cache = directory / "smoke-cache"
cache.mkdir(exist_ok=True)
started = time.monotonic()
handle = None
for backend in ["gpu", "cpu"] if args.backend == "auto" else [args.backend]:
    handle = bridge.lx_create(str(model).encode(), backend.encode(), str(cache).encode())
    if handle:
        break
assert handle, "native load failed"
load_ms = round((time.monotonic() - started) * 1000)
chunks = []
first_fragment_ms = None
stopped = False
cancel_on_fragment = False


@Fragment
def receive(_data, text):
    global first_fragment_ms, stopped
    chunks.append(text)
    if first_fragment_ms is None:
        first_fragment_ms = round((time.monotonic() - started) * 1000)
    if cancel_on_fragment:
        stopped = True


@Cancel
def cancelled(_data):
    return stopped


system = b"Return only valid JSON that matches the schema."
schema = {"type": "object", "properties": {"marker": {"const": "lexicue-native-smoke"}},
          "required": ["marker"], "additionalProperties": False}
try:
    count = bridge.lx_count(handle, system, b"Return the marker.")
    assert count > 0, "tokenizer failed"
    started = time.monotonic()
    usage = Usage()
    result = bridge.lx_generate(handle, system, b"Return the marker.", json.dumps(schema).encode(),
                                receive, cancelled, None, ctypes.byref(usage))
    assert result == 0
    if asset["runtime"] == "litert":
        content = "".join(part["text"] for chunk in chunks for part in json.loads(chunk)["content"] if part["type"] == "text")
    else:
        content = b"".join(chunks).decode()
    assert json.loads(content) == {"marker": "lexicue-native-smoke"}, "schema constraint was not enforced"
    assert first_fragment_ms is not None, "no streamed fragments"
    generation_ms = round((time.monotonic() - started) * 1000)
    cancel_on_fragment = True
    long_schema = {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}
    result = bridge.lx_generate(handle, system, "生成一百条中文长句。".encode(), json.dumps(long_schema).encode(),
                                receive, cancelled, None, ctypes.byref(usage))
    assert result == 2 and stopped, "native cancellation did not finish"
finally:
    bridge.lx_destroy(handle)
print(json.dumps({"asset": asset["id"], "target": manifest["target"], "backend": backend,
                  "loadMs": load_ms, "firstFragmentMs": first_fragment_ms, "generationMs": generation_ms,
                  "tokenCount": count, "constraint": True, "stream": True, "cancel": True, "unload": True,
                  "businessQualityVerified": False}))
