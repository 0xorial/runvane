#!/usr/bin/env python3
"""LightRAG extraction sidecar for runvane.

Speaks newline-delimited JSON on stdio (stdout is protocol-only; logs go to
stderr). The Node `lightrag` GraphBuilder keeps one of these alive and sends:

    {"id": 1, "op": "ping"}
    {"id": 2, "op": "extract", "text": "...", "config": {
        "model": "...", "base_url": "https://.../v1", "api_key": "...",
        "max_gleaning": 1}}

Replies: {"id": n, "ok": true, ...} | {"id": n, "ok": false, "error": "..."}.

Each extract runs a throwaway LightRAG instance in a temp working dir: runvane
owns all persistent state (its per-storage SQLite), so only the extracted
entities/relations are harvested — LightRAG's own vector store is fed a cheap
deterministic embedding and discarded with the temp dir.

Requires: pip install lightrag-hku  (python >= 3.10)
"""

import asyncio
import glob
import hashlib
import json
import os
import shutil
import sys
import tempfile
import urllib.request


def log(msg: str) -> None:
    print(f"[lightrag-sidecar] {msg}", file=sys.stderr, flush=True)


def reply(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


# --- OpenAI-compatible chat call via stdlib (no client-lib version drift) ----

def chat_completion(config: dict, prompt: str, system_prompt, history_messages) -> str:
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    for m in history_messages or []:
        if isinstance(m, dict) and m.get("role") and m.get("content") is not None:
            messages.append({"role": m["role"], "content": m["content"]})
    messages.append({"role": "user", "content": prompt})

    body = json.dumps({"model": config["model"], "messages": messages, "temperature": 0}).encode()
    headers = {"Content-Type": "application/json"}
    if config.get("api_key"):
        headers["Authorization"] = f"Bearer {config['api_key']}"
    req = urllib.request.Request(
        config["base_url"].rstrip("/") + "/chat/completions", data=body, headers=headers
    )
    with urllib.request.urlopen(req, timeout=300) as res:
        data = json.loads(res.read().decode())
    return data["choices"][0]["message"]["content"] or ""


# --- cheap deterministic embedding (LightRAG requires one; output unused) ----

EMBED_DIM = 64


def hash_embedding(texts):
    import numpy as np

    out = np.zeros((len(texts), EMBED_DIM), dtype=np.float32)
    for i, text in enumerate(texts):
        for token in str(text).lower().split():
            h = int(hashlib.sha1(token.encode()).hexdigest()[:8], 16)
            out[i][h % EMBED_DIM] += 1.0
        norm = float(np.linalg.norm(out[i]))
        out[i] /= norm if norm > 0 else 1.0
    return out


async def run_extract(text: str, config: dict) -> dict:
    from lightrag import LightRAG
    from lightrag.utils import EmbeddingFunc

    async def llm_model_func(prompt, system_prompt=None, history_messages=[], **kwargs) -> str:
        return await asyncio.to_thread(chat_completion, config, prompt, system_prompt, history_messages)

    async def embedding_fn(texts):
        return hash_embedding(texts)

    workdir = tempfile.mkdtemp(prefix="runvane-lightrag-")
    try:
        rag = LightRAG(
            working_dir=workdir,
            llm_model_func=llm_model_func,
            embedding_func=EmbeddingFunc(embedding_dim=EMBED_DIM, max_token_size=8192, func=embedding_fn),
            entity_extract_max_gleaning=int(config.get("max_gleaning", 1)),
        )
        await rag.initialize_storages()
        # Method on newer releases; standalone helper on older ones.
        if hasattr(rag, "initialize_pipeline_status"):
            await rag.initialize_pipeline_status()
        else:
            from lightrag.kg.shared_storage import initialize_pipeline_status

            await initialize_pipeline_status()

        await rag.ainsert(text)
        try:
            await rag.finalize_storages()
        except Exception as e:  # harvesting still possible; storage is on disk
            log(f"finalize_storages failed (continuing): {e}")

        return harvest_graph(workdir)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def clean_name(raw) -> str:
    return str(raw).strip().strip('"').strip()


def harvest_graph(workdir: str) -> dict:
    """Read the NetworkX graphml LightRAG wrote and normalize it."""
    import networkx as nx

    files = glob.glob(os.path.join(workdir, "*.graphml"))
    if not files:
        return {"entities": [], "relations": []}
    graph = nx.read_graphml(files[0])

    entities = []
    for node, attrs in graph.nodes(data=True):
        name = clean_name(node)
        if not name:
            continue
        etype = clean_name(attrs.get("entity_type", ""))
        entities.append(
            {
                "name": name,
                "type": "" if etype.upper() == "UNKNOWN" else etype,
                "description": str(attrs.get("description", "")).strip(),
            }
        )

    relations = []
    for source, target, attrs in graph.edges(data=True):
        keywords = str(attrs.get("keywords", "")).strip()
        relations.append(
            {
                "source": clean_name(source),
                "target": clean_name(target),
                "relation": keywords or "related to",
                "description": str(attrs.get("description", "")).strip(),
            }
        )
    return {"entities": entities, "relations": relations}


async def handle(request: dict) -> dict:
    op = request.get("op")
    if op == "ping":
        import lightrag

        return {"ok": True, "lightrag": getattr(lightrag, "__version__", "unknown"),
                "python": sys.version.split()[0]}
    if op == "extract":
        config = request.get("config") or {}
        for key in ("model", "base_url"):
            if not config.get(key):
                raise ValueError(f"extract config missing '{key}'")
        text = request.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("extract needs non-empty 'text'")
        result = await run_extract(text, config)
        return {"ok": True, **result}
    raise ValueError(f"unknown op '{op}'")


async def main() -> None:
    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
    while True:
        line = await reader.readline()
        if not line:
            return  # parent closed stdin
        line = line.decode().strip()
        if not line:
            continue
        rid = None
        try:
            request = json.loads(line)
            rid = request.get("id")
            reply({"id": rid, **(await handle(request))})
        except Exception as e:  # one bad request must not kill the sidecar
            log(f"request failed: {e}")
            reply({"id": rid, "ok": False, "error": str(e)[:500]})


if __name__ == "__main__":
    asyncio.run(main())
