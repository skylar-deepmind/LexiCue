"""Read-only MDX/MDD access for private dictionary validation experiments.

This is tooling, not an application dependency or a distributable dictionary.
Install readmdict==0.1.1 separately. The source dictionary is never modified.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import bisect
import ctypes
import ctypes.util
import importlib.util
import struct
import sys
import types
import zlib


def _readers():
    # readmdict unnecessarily requires python-lzo even for zlib-only MDX2.
    # Supply the same decompression operation through an optional system LZO.
    if "lzo" not in sys.modules and importlib.util.find_spec("lzo") is None:
        module = types.ModuleType("lzo")

        def decompress(data):
            library_path = ctypes.util.find_library("lzo2")
            if not library_path:
                raise RuntimeError("This source uses LZO; install python-lzo or liblzo2")
            if data[:1] != b"\xf0":
                raise ValueError("Unsupported LZO header")
            expected = struct.unpack(">I", data[1:5])[0]
            library = ctypes.CDLL(library_path)
            output = ctypes.create_string_buffer(expected)
            size = ctypes.c_size_t(expected)
            result = library.lzo1x_decompress_safe(
                data[5:], len(data) - 5, output, ctypes.byref(size), None
            )
            if result != 0 or size.value != expected:
                raise ValueError("LZO decompression failed")
            return output.raw

        module.decompress = decompress
        sys.modules["lzo"] = module
    from readmdict import MDX, MDD

    class StrictKeys:
        def _split_key_block(self, data):
            result = []
            cursor = 0
            width = 2 if self._encoding.upper() == "UTF-16" else 1
            terminator = b"\0" * width
            while cursor < len(data):
                offset = struct.unpack(
                    self._number_format, data[cursor : cursor + self._number_width]
                )[0]
                start = cursor + self._number_width
                end = start
                while end < len(data) and data[end : end + width] != terminator:
                    end += width
                if end >= len(data):
                    raise ValueError("Unterminated dictionary key")
                key = data[start:end].decode(self._encoding, errors="strict").strip()
                result.append((offset, key.encode("utf-8")))
                cursor = end + width
            return result

        def _read_keys_brutal(self):
            raise ValueError("Dictionary index could not be verified")

    return type("StrictMDX", (StrictKeys, MDX), {}), type("StrictMDD", (StrictKeys, MDD), {})


class MdictSource:
    def __init__(self, path, *, media=False):
        self.path = Path(path)
        mdx, mdd = _readers()
        self.dictionary = (mdd if media else mdx)(str(self.path))
        self.keys = [(o, key.decode("utf-8")) for o, key in self.dictionary._key_list]
        self.file = self.path.open("rb")
        self.file.seek(self.dictionary._record_block_offset)
        self.width = self.dictionary._number_width

        def number():
            return struct.unpack(self.dictionary._number_format, self.file.read(self.width))[0]

        blocks, entries, info_size, _ = (number() for _ in range(4))
        if entries != len(self.keys) or info_size != blocks * self.width * 2:
            raise ValueError("Record directory does not match the key directory")
        sizes = [(number(), number()) for _ in range(blocks)]
        compressed, plain = self.file.tell(), 0
        self.blocks = []
        for compressed_size, plain_size in sizes:
            self.blocks.append((compressed, compressed_size, plain, plain_size))
            compressed += compressed_size
            plain += plain_size
        if compressed != self.path.stat().st_size:
            raise ValueError("Dictionary file is truncated or has unexpected trailing data")
        offsets = [o for o, _ in self.keys]
        if offsets != sorted(offsets):
            raise ValueError("Record offsets are not ordered")
        unique = sorted(set(offsets))
        self.ends = {o: unique[i + 1] if i + 1 < len(unique) else plain for i, o in enumerate(unique)}
        self.starts = [block[2] for block in self.blocks]
        self.total_plain = plain
        self.validated_blocks = set()

    @lru_cache(maxsize=8)
    def block(self, index):
        offset, compressed_size, _, expected_size = self.blocks[index]
        self.file.seek(offset)
        data = self.file.read(compressed_size)
        mode = struct.unpack("<I", data[:4])[0]
        checksum = struct.unpack(">I", data[4:8])[0]
        if mode == 0:
            result = data[8:]
        elif mode == 2:
            result = zlib.decompress(data[8:])
        elif mode == 1:
            import lzo
            result = lzo.decompress(b"\xf0" + struct.pack(">I", expected_size) + data[8:])
        else:
            raise ValueError(f"Unsupported compression type {mode}")
        if len(result) != expected_size or zlib.adler32(result) & 0xFFFFFFFF != checksum:
            raise ValueError(f"Record block {index} failed verification")
        self.validated_blocks.add(index)
        return result

    def record(self, index):
        cursor = self.keys[index][0]
        end = self.ends[cursor]
        block = bisect.bisect_right(self.starts, cursor) - 1
        result = []
        while cursor < end:
            data = self.block(block)
            local = cursor - self.starts[block]
            length = min(end - cursor, len(data) - local)
            if length <= 0:
                raise ValueError("Invalid record boundary")
            result.append(data[local : local + length])
            cursor += length
            block += 1
        return b"".join(result)

    def text(self, index):
        return self.record(index).decode(self.dictionary._encoding, errors="strict").strip("\0")

    def close(self):
        self.file.close()
        self.block.cache_clear()
