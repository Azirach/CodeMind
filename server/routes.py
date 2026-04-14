# ─────────────────────────────────────────────
#  CodeMind — Flask API Routes (Ollama Version)
# ─────────────────────────────────────────────

import os
from flask import Blueprint, request, jsonify
from . import rag as rag_engine
import ollama

api = Blueprint("api", __name__)

MODEL = "llama3 (ollama)"
MAX_TOKENS = 1500


# ── Utility ──────────────────────────────────
def ask_claude(messages: list, system: str) -> str:
    """Use Ollama instead of Claude with proper chat formatting"""

    ollama_messages = []

    # Add system prompt
    ollama_messages.append({
        "role": "system",
        "content": system
    })

    # Preserve roles (user / assistant)
    for m in messages:
        ollama_messages.append({
            "role": m.get("role", "user"),
            "content": m.get("content", "")
        })

    response = ollama.chat(
        model="llama3",
        messages=ollama_messages
    )

    return response["message"]["content"]


# ── GET /api/health ──────────────────────────
@api.route("/health")
def health():
    return jsonify({
    "status": "ok",
    "model": "Llama3",
    "provider": "Ollama (Local)",
    "apiKeyRequired": False
})


# ── POST /api/chat ───────────────────────────
@api.route("/chat", methods=["POST"])
def chat():
    data     = request.get_json()
    messages = data.get("messages", [])

    if not messages:
        return jsonify({"error": "messages array is required"}), 400

    system = """You are CodeMind, an expert AI code assistant.
Help developers debug, understand, refactor, and improve their code.
Be concise but thorough. Use markdown and proper code blocks."""

    try:
        reply = ask_claude(messages, system)
        return jsonify({"reply": reply})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── POST /api/debug ──────────────────────────
@api.route("/debug", methods=["POST"])
def debug():
    data     = request.get_json()
    code     = data.get("code", "").strip()
    language = data.get("language", "python")
    mode     = data.get("mode", "debug")

    if not code:
        return jsonify({"error": "code is required"}), 400

    prompts = {
        "debug":      f"Debug this {language} code and fix all issues:\n```{language}\n{code}\n```",
        "explain":    f"Explain this {language} code clearly:\n```{language}\n{code}\n```",
        "refactor":   f"Refactor this {language} code with improvements:\n```{language}\n{code}\n```",
        "complexity": f"Analyze time and space complexity:\n```{language}\n{code}\n```",
        "tests":      f"Generate unit tests:\n```{language}\n{code}\n```",
    }

    system = "You are an expert software engineer."

    try:
        reply = ask_claude(
            [{"role": "user", "content": prompts.get(mode, prompts["debug"])}],
            system,
        )
        return jsonify({"reply": reply, "mode": mode})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── POST /api/error ──────────────────────────
@api.route("/error", methods=["POST"])
def analyze_error():
    data       = request.get_json()
    error_text = data.get("errorText", "").strip()

    if not error_text:
        return jsonify({"error": "errorText is required"}), 400

    prompt = f"""
Analyze this error and provide:
1. Root Cause
2. Fix
3. Prevention

Error:
{error_text}
"""

    try:
        reply = ask_claude(
            [{"role": "user", "content": prompt}],
            "You are an expert debugger."
        )
        return jsonify({"reply": reply})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── POST /api/file ───────────────────────────
@api.route("/file", methods=["POST"])
def analyze_file():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file     = request.files["file"]
    filename = file.filename
    content  = file.read().decode("utf-8", errors="ignore")[:10000]

    prompt = f"""
Analyze this file:

{filename}

Code:
{content}
"""

    try:
        reply = ask_claude(
            [{"role": "user", "content": prompt}],
            "You are an expert code reviewer."
        )
        return jsonify({"reply": reply, "filename": filename})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── RAG ENDPOINTS ────────────────────────────
@api.route("/rag/ingest", methods=["POST"])
def rag_ingest():
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "No files uploaded"}), 400

    results = []
    for f in files:
        content = f.read().decode("utf-8", errors="ignore")
        result  = rag_engine.ingest(f.filename, content)
        results.append(result)

    return jsonify({"ingested": results})


@api.route("/rag/query", methods=["POST"])
def rag_query():
    data     = request.get_json()
    question = data.get("question", "").strip()

    if not question:
        return jsonify({"error": "question is required"}), 400

    try:
        result = rag_engine.rag_answer(question)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/rag/stats")
def rag_stats():
    return jsonify(rag_engine.get_stats())


@api.route("/rag/clear", methods=["DELETE"])
def rag_clear():
    return jsonify(rag_engine.clear_index())