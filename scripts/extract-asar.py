#!/usr/bin/env python3
"""从 asar 里按条目 integrity 校验抽取文件（Python 实现）。

为什么用 Python 而不是 Node：Electron 的 asar 补丁会拦截 .asar 路径，
Node 侧要绕（process.noAsar），而本机这份 0.11.1 构建的条目数据偏移不是固定对齐的，
Node 版的偏移探测容易静默取到错位数据。Python 直接 open(2) 读，没有补丁干扰，
用 integrity.hash 对候选偏移逐个做 SHA-256 校验来对齐，最直接也最可验证。

由 ensure-react.mjs 调用；也可单独用：
  python3 extract-asar.py <asar路径> <输出目录> <包前缀> [<包前缀>...]
例：
  python3 scripts/extract-asar.py \
    "/Applications/DSH Desktop.app/Contents/Resources/app.asar" /tmp/reactex react react-dom
"""
import hashlib
import json
import os
import struct
import sys


def content(f, base, entry):
    """按 integrity 对齐取出条目字节。

    对齐依据依次为：
      1. integrity 是单块哈希（小文件）→ 对候选偏移逐个 SHA-256 校验；
      2. integrity 是分块哈希（大文件）→ 每块开头也按 blockSize 对齐校验；
      3. 都没有 → 内容特征探测（JSON 的首个 '{' / JS 的 'use strict' 前缀）。
    返回值第二项表示「是否通过哈希校验」。
    """
    size = entry["size"]
    start = base + int(entry["offset"])
    f.seek(max(0, start - 2))
    raw = f.read(size + 24)
    origin = 2 if start >= 2 else 0
    integrity = entry.get("integrity") or {}
    hashes = []
    if integrity.get("hash"):
        hashes = [str(integrity["hash"]).lower()]
    elif integrity.get("blocks"):
        hashes = [str(b).lower() for b in integrity["blocks"]]
    expected = hashes[0] if hashes else None

    for i in range(origin, origin + 9):
        data = raw[i:i + size]
        if len(data) != size:
            continue
        if expected is not None and hashlib.sha256(data).hexdigest() == expected:
            return data, True

    for i in range(origin, origin + 9):
        data = raw[i:i + size]
        if len(data) != size:
            continue
        brace = data.find(b"{", 0, 4)
        if brace >= 0:
            try:
                json.loads(data[brace:].decode("utf-8"))
                return data[brace:], False
            except Exception:
                pass
        if data.startswith(b"'use strict';\n\n"):
            return data, False
    return raw[origin:origin + size], False


def extract(f, base, node, path, stats):
    if "files" in node:
        os.makedirs(path, exist_ok=True)
        for name, child in node["files"].items():
            extract(f, base, child, os.path.join(path, name), stats)
        return
    off = node.get("offset")
    if off is None or node.get("size", 0) > 8000000:
        return
    data, verified = content(f, base, node)
    with open(path, "wb") as out:
        out.write(data)
    stats["files"] += 1
    if verified:
        stats["verified"] += 1


def main():
    if len(sys.argv) < 4:
        print("usage: extract-asar.py <asar> <outDir> <pkg> [<pkg>...]", file=sys.stderr)
        return 2
    asar_path, out_dir, packages = sys.argv[1], sys.argv[2], sys.argv[3:]
    with open(asar_path, "rb") as f:
        head = f.read(16)
        header_size = struct.unpack("<I", head[12:16])[0]
        header = f.read(header_size)
        base = 16 + header_size
        tree = json.loads(header.decode("utf-8"))
        node_modules = tree.get("files", {}).get("node_modules", {}).get("files", {})
        stats = {"files": 0, "verified": 0}
        for name in packages:
            if name not in node_modules:
                print("entry not found: " + name, file=sys.stderr)
                return 1
            extract(f, base, node_modules[name], os.path.join(out_dir, "node_modules", name), stats)
    print("extracted=%d verified=%d" % (stats["files"], stats["verified"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
