# ─────────────────────────────────────────────
#  CodeMind — RAG Engine (Python)
#
#  Pipeline:
#    1. Chunk  — split file into overlapping windows
#    2. Embed  — convert each chunk to a vector
#    3. Store  — save in ChromaDB (local vector DB)
#    4. Query  — embed question, find top-K chunks
#    5. Answer — inject chunks into Claude prompt
# ─────────────────────────────────────────────

import os
import re
import hashlib
import chromadb
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("all-MiniLM-L6-v2")
# ── ChromaDB client (persists to ./chroma_db on disk) ──
chroma_client = chromadb.PersistentClient(path="./chroma_db")
collection = chroma_client.get_or_create_collection(
    name="codemind",
    metadata={"hnsw:space": "cosine"},
)

# ── Config ──
CHUNK_SIZE    = 400   # characters per chunk
CHUNK_OVERLAP = 80    # overlap between chunks
TOP_K         = 5     # chunks to retrieve per query
EMBED_MODEL   = "voyage-code-2"   # Anthropic embedding model


# ─────────────────────────────────────────────
#  1. CHUNKING
#  Splits text into overlapping windows.
#  Overlap preserves context at boundaries.
# ─────────────────────────────────────────────
def chunk_text(text: str, filename: str) -> list[dict]:
    """Split file content into overlapping chunks."""
    chunks = []
    start  = 0
    idx    = 0

    while start < len(text):
        end  = min(start + CHUNK_SIZE, len(text))
        body = text[start:end].strip()

        if len(body) > 20:
            chunk_id = hashlib.md5(f"{filename}::{idx}".encode()).hexdigest()
            chunks.append({
                "id":        chunk_id,
                "filename":  filename,
                "chunk_idx": idx,
                "text":      body,
                "start":     start,
                "end":       end,
            })
            idx += 1

        if end >= len(text):
            break
        start = end - CHUNK_OVERLAP

    return chunks


# ─────────────────────────────────────────────
#  2. EMBEDDING
#  Uses Anthropic's voyage-code-2 model — 
#  specifically trained on source code.
# ─────────────────────────────────────────────
def embed(text: str) -> list[float]:
    """Convert text to vector using HuggingFace SentenceTransformer."""
    try:
        return model.encode(text, normalize_embeddings=True).tolist()
    except Exception:
        # Fallback: deterministic pseudo-embedding (128 dims)
        vec = [0.0] * 128
        for i, ch in enumerate(text):
            vec[i % 128] += ord(ch) / 255.0
        norm = sum(v * v for v in vec) ** 0.5 or 1.0
        return [v / norm for v in vec]


# ─────────────────────────────────────────────
#  3. INGEST
#  Chunk → embed → store in ChromaDB.
#  Called when user uploads files in the UI.
# ─────────────────────────────────────────────
def ingest(filename: str, content: str) -> dict:
    """Index a file into the ChromaDB vector store."""
    chunks = chunk_text(content, filename)
    if not chunks:
        return {"filename": filename, "total_chunks": 0}

    ids        = [c["id"]       for c in chunks]
    texts      = [c["text"]     for c in chunks]
    embeddings = [embed(t)      for t in texts]
    metadatas  = [
        {
            "filename":  c["filename"],
            "chunk_idx": c["chunk_idx"],
            "start":     c["start"],
            "end":       c["end"],
        }
        for c in chunks
    ]

    # Upsert so re-indexing the same file doesn't duplicate
    collection.upsert(
        ids=ids,
        embeddings=embeddings,
        documents=texts,
        metadatas=metadatas,
    )

    return {
        "filename":     filename,
        "total_chunks": len(chunks),
    }


# ─────────────────────────────────────────────
#  4. QUERY
#  Embed the question → cosine similarity search
#  → return top-K most relevant chunks.
# ─────────────────────────────────────────────
def query(question: str, top_k: int = TOP_K) -> list[dict]:
    """Find the most relevant chunks for a question."""
    count = collection.count()
    if count == 0:
        return []

    query_vector = embed(question)
    results = collection.query(
        query_embeddings=[query_vector],
        n_results=min(top_k, count),
        include=["documents", "metadatas", "distances"],
    )

    chunks = []
    for i, doc in enumerate(results["documents"][0]):
        meta  = results["metadatas"][0][i]
        dist  = results["distances"][0][i]
        score = round(1 - dist, 3)   # cosine distance → similarity

        chunks.append({
            "score":     score,
            "filename":  meta["filename"],
            "chunk_idx": meta["chunk_idx"],
            "text":      doc,
        })

    return chunks


# ─────────────────────────────────────────────
#  5. RAG ANSWER
#  Retrieve chunks → build augmented prompt →
#  call Claude → return grounded answer.
# ─────────────────────────────────────────────
import ollama

def rag_answer(question: str) -> dict:
    """Answer using RAG + local LLM (Ollama)."""
    chunks = query(question)

    if not chunks:
        return {
            "answer": "No documents indexed yet.",
            "chunks": [],
        }

    # Build context (keep your structure)
    context = "\n\n".join(
        f"[{i+1}] File: {c['filename']} (chunk {c['chunk_idx']}, similarity: {c['score']})\n{c['text']}"
        for i, c in enumerate(chunks)
    )

    prompt = f"""
You are CodeMind, an expert AI code assistant.

Use ONLY the provided context to answer the question.

If the answer is not in the context, say: "Not enough information."

Always reference file names and chunks.

Context:
{context}

Question:
{question}
"""

    response = ollama.chat(
        model="llama3",
        messages=[{"role": "user", "content": prompt}]
    )

    answer = response["message"]["content"]

    return {
        "answer": answer,
        "chunks": chunks
    }


# ─────────────────────────────────────────────
#  UTILITIES
# ─────────────────────────────────────────────
def get_stats() -> dict:
    """Return counts of indexed files and chunks."""
    count = collection.count()
    if count == 0:
        return {"total_chunks": 0, "files": []}

    all_items = collection.get(include=["metadatas"])
    file_map  = {}
    for meta in all_items["metadatas"]:
        f = meta["filename"]
        file_map[f] = file_map.get(f, 0) + 1

    return {
        "total_chunks": count,
        "files": [{"filename": k, "chunks": v} for k, v in file_map.items()],
    }


def clear_index() -> dict:
    """Delete and recreate the ChromaDB collection."""
    global collection
    chroma_client.delete_collection("codemind")
    collection = chroma_client.get_or_create_collection(
        name="codemind",
        metadata={"hnsw:space": "cosine"},
    )
    return {"cleared": True}
