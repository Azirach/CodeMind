/* ═══════════════════════════════════════════
   CodeMind — Frontend JavaScript
   Talks to the Express backend at /api/*
   No API key ever touches this file.
═══════════════════════════════════════════ */

// ── Utilities ──────────────────────────────

const $ = (id) => document.getElementById(id);

function ts() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function md(text) {
  return text
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, l, c) => `<pre>${esc(c.trim())}</pre>`)
    .replace(/`([^`]+)`/g, (_, c) => `<code>${esc(c)}</code>`)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/^### (.*)/gm, "<h3>$1</h3>")
    .replace(/^## (.*)/gm, "<h2>$1</h2>")
    .replace(/^> (.*)/gm, "<blockquote>$1</blockquote>")
    .replace(/^- (.*)/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>")
    .replace(/\n\n+/g, "</p><p>")
    .replace(/\n/g, "<br>");
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function thinkingHTML() {
  return `<div class="thinking-wrap"><div class="dot-b"></div><div class="dot-b"></div><div class="dot-b"></div></div>`;
}

function loadingRow(label) {
  return `<div class="loading-row">${thinkingHTML()} ${label}</div>`;
}

async function apiFetch(endpoint, body) {
  const res = await fetch(`/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Server error");
  return data;
}

// ── App Core ───────────────────────────────

const App = (() => {
  let msgCount = 0;

  function launch() {
    const w = $("welcome");
    w.classList.add("gone");
    setTimeout(() => (w.style.display = "none"), 420);
  }

  function switchPanel(name, el) {
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    $(`panel-${name}`).classList.add("active");
    el.classList.add("active");
  }

  function quickAction(mode) {
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    $("panel-debug").classList.add("active");
    document.querySelector('[data-panel="debug"]').classList.add("active");
    setTimeout(() => Debug.run(mode), 80);
  }

  function incMsg() {
    msgCount++;
    $("msg-count").textContent = msgCount;
  }

  async function checkHealth() {
    try {
      const res = await fetch("/api/health");
      const data = await res.json();

      // ✅ Updated for Ollama
      $("hero-status").textContent = "// local AI ready · running on Ollama (Llama3)";
      $("hero-status").style.color = "var(--g)";

      $("status-pill").classList.remove("err");
      $("status-text").textContent = "local model";

      // OPTIONAL: if you have model label in UI
      const modelLabel = document.getElementById("model-label");
      if (modelLabel) {
        modelLabel.textContent = "Llama3 (Ollama)";
      }

    } catch {
      $("hero-status").textContent = "// server not running";
      $("hero-status").style.color = "var(--r)";
      $("status-pill").classList.add("err");
      $("status-text").textContent = "offline";
    }
  }

  // Init
  $("session-id").textContent = Math.random().toString(36).slice(2, 8).toUpperCase();
  checkHealth();

  return { launch, switchPanel, quickAction, incMsg };
})();

// ── Chat Module ────────────────────────────

const Chat = (() => {
  const history = [];

  function quickPrompt(text) {
    $("chat-input").value = text;
    send();
  }

  function onKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function appendMsg(role, html, isHTML = false) {
    const container = $("chat-messages");
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    const avatar = role === "user" ? "ME" : "CM";
    const label  = role === "user" ? "you" : "CodeMind";
    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    bubble.innerHTML = isHTML ? html : md(html);
    div.innerHTML = `<div class="msg-avatar">${avatar}</div><div class="msg-content"><div class="msg-meta">${label} · ${ts()}</div></div>`;
    div.querySelector(".msg-content").appendChild(bubble);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    App.incMsg();
    return bubble;
  }

  function addThinking() {
    const container = $("chat-messages");
    const div = document.createElement("div");
    div.className = "msg ai";
    div.id = "thinking-msg";
    div.innerHTML = `<div class="msg-avatar">CM</div><div class="msg-content"><div class="msg-meta">CodeMind · thinking</div><div class="msg-bubble">${thinkingHTML()}</div></div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  async function send() {
    const input = $("chat-input");
    const btn   = $("send-btn");
    const text  = input.value.trim();
    if (!text) return;

    input.value = "";
    btn.disabled = true;
    appendMsg("user", text);
    history.push({ role: "user", content: text });
    addThinking();

    try {
      const data = await apiFetch("chat", { messages: history });
      $("thinking-msg")?.remove();
      history.push({ role: "assistant", content: data.reply });
      appendMsg("ai", data.reply);
    } catch (err) {
      $("thinking-msg")?.remove();
      appendMsg("ai", `⚠ **Error:** ${err.message}\n\nMake sure the server is running and Ollama is active.`);
    }

    btn.disabled = false;
    input.focus();
  }

  return { send, onKey, quickPrompt };
})();

// ── Debug Module ───────────────────────────

const Debug = (() => {
  const labels   = { debug: "debug analysis", explain: "explanation", refactor: "refactor suggestions", complexity: "complexity report", tests: "generated tests" };
  const tagClass = { debug: "tag-amb", explain: "tag-g", refactor: "tag-g", complexity: "tag-amb", tests: "tag-g" };

  async function run(mode) {
    const code = $("debug-code").value.trim();
    const lang = $("lang-select").value;
    const out  = $("debug-output");

    if (!code) {
      out.innerHTML = `<div class="empty-state">paste some code first</div>`;
      return;
    }

    out.innerHTML = loadingRow(`analyzing ${lang} code…`);
    document.querySelectorAll(".btn").forEach((b) => (b.disabled = true));

    try {
      const data = await apiFetch("debug", { code, language: lang, mode });
      out.innerHTML = `<div class="result-card"><div class="result-tag ${tagClass[mode]}">◈ ${labels[mode]}</div>${md(data.reply)}</div>`;
    } catch (err) {
      out.innerHTML = `<div class="result-card"><div class="result-tag tag-r">⚠ error</div>${err.message}</div>`;
    }

    document.querySelectorAll(".btn").forEach((b) => (b.disabled = false));
  }

  return { run };
})();

// ── Error Analyzer Module ──────────────────

const ErrorAnalyzer = (() => {
  async function run() {
    const errorText = $("error-input").value.trim();
    const out = $("error-output");
    const btn = $("err-btn");

    if (!errorText) {
      out.innerHTML = `<div class="empty-state">paste an error or stack trace above</div>`;
      return;
    }

    btn.disabled = true;
    out.innerHTML = loadingRow("diagnosing error…");

    try {
      const data = await apiFetch("error", { errorText });
      out.innerHTML = `<div class="result-card"><div class="result-tag tag-r">⚠ error diagnosis</div>${md(data.reply)}</div>`;
    } catch (err) {
      out.innerHTML = `<div class="result-card"><div class="result-tag tag-r">⚠ failed</div>${err.message}</div>`;
    }

    btn.disabled = false;
  }

  function clear() {
    $("error-input").value = "";
    $("error-output").innerHTML = `<div class="empty-state">paste a stack trace above<br><span>get root cause + fix instantly</span></div>`;
  }

  return { run, clear };
})();

// ── File Analyzer Module ───────────────────

const FileAnalyzer = (() => {
  let files = [];
  let current = null;

  function handleFiles(fileList) {
    Array.from(fileList).forEach((f) => {
      if (!files.find((u) => u.name === f.name)) files.push(f);
    });
    render();
  }

  function render() {
    const list = $("file-list");
    list.innerHTML = "";
    files.forEach((f, i) => {
      const ext  = f.name.split(".").pop().toUpperCase();
      const size = f.size < 1024 ? `${f.size} B` : `${(f.size / 1024).toFixed(1)} KB`;
      const card = document.createElement("div");
      card.className = "file-card" + (current?.name === f.name ? " active" : "");
      card.innerHTML = `<div class="fext">.${ext}</div><div class="finfo"><div class="fname">${esc(f.name)}</div><div class="fsize">${size}</div></div><button class="frem" onclick="FileAnalyzer.remove(event,${i})">✕</button>`;
      card.onclick = () => select(i);
      list.appendChild(card);
    });
  }

  function remove(e, i) {
    e.stopPropagation();
    if (current?.name === files[i].name) deselect();
    files.splice(i, 1);
    render();
  }

  function select(i) {
    current = files[i];
    $("file-empty").style.display = "none";
    $("file-active").style.display = "flex";
    $("file-output").innerHTML = `<div class="empty-state">choose an analysis type above</div>`;
    render();
  }

  function deselect() {
    current = null;
    $("file-empty").style.display = "flex";
    $("file-active").style.display = "none";
  }

  async function analyze(mode) {
    if (!current) return;
    const out = $("file-output");
    const modeLabels = { full: "full analysis", bugs: "bug report", explain: "explanation", security: "security audit" };

    out.innerHTML = loadingRow(`reading ${current.name}…`);
    document.querySelectorAll(".btn").forEach((b) => (b.disabled = true));

    try {
      const formData = new FormData();
      formData.append("file", current);
      formData.append("mode", mode);

      const res = await fetch("/api/file", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Server error");

      out.innerHTML = `<div class="result-card"><div class="result-tag tag-blu">⬆ ${esc(current.name)} — ${modeLabels[mode]}</div>${md(data.reply)}</div>`;
    } catch (err) {
      out.innerHTML = `<div class="result-card"><div class="result-tag tag-r">⚠ error</div>${err.message}</div>`;
    }

    document.querySelectorAll(".btn").forEach((b) => (b.disabled = false));
  }

  // Drag & drop
  const dz = $("drop-zone");
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("over"));
  dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); handleFiles(e.dataTransfer.files); });

  return { handleFiles, remove, analyze };
})();

// ── RAG Module ─────────────────────────────

const RAG = (() => {

  async function loadStats() {
    try {
      const res  = await fetch("/api/rag/stats");
      const data = await res.json();
      $("rag-files").textContent  = data.files.length;
      $("rag-chunks").textContent = data.totalChunks;
      $("rag-count").textContent  = data.totalChunks;
      $("rag-status").textContent = data.totalChunks > 0 ? "ready" : "empty";
      $("rag-status").className   = data.totalChunks > 0 ? "stat-val" : "stat-val dim";

      const list = $("rag-file-list");
      list.innerHTML = "";
      for (const f of data.files) {
        const ext  = f.filename.split(".").pop().toUpperCase();
        const div  = document.createElement("div");
        div.className = "rag-file-item";
        div.innerHTML = `<span class="fext">.${ext}</span><span>${esc(f.filename)}</span><span class="fchunks">${f.chunks} chunks</span>`;
        list.appendChild(div);
      }
    } catch (e) {
      console.warn("RAG stats error:", e.message);
    }
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList);
    if (!files.length) return;

    const sidebar = $("rag-sidebar") || document.querySelector(".rag-sidebar");
    const progress = document.createElement("div");
    progress.className = "ingest-progress";
    progress.innerHTML = files.map(f =>
      `<div class="ingest-row" id="ing-${esc(f.name)}"><span class="spin">⟳</span> ${esc(f.name)}</div>`
    ).join("");
    $("rag-file-list").prepend(progress);

    const formData = new FormData();
    files.forEach(f => formData.append("files", f));

    try {
      const res  = await fetch("/api/rag/ingest", { method: "POST", body: formData });
      const data = await res.json();

      for (const r of (data.ingested || [])) {
        const row = $(`ing-${r.filename}`);
        if (row) row.innerHTML = `<span class="ok">✓</span> ${esc(r.filename)} — ${r.totalChunks} chunks`;
      }

      setTimeout(() => { progress.remove(); loadStats(); }, 1200);
      toast(`Indexed ${files.length} file${files.length > 1 ? "s" : ""} into vector store`);
    } catch (e) {
      progress.innerHTML = `<div class="ingest-row" style="color:var(--r)">⚠ ${e.message}</div>`;
    }
  }

  async function ask() {
    const input    = $("rag-input");
    const question = input.value.trim();
    const out      = $("rag-output");
    if (!question) return;

    out.innerHTML = loadingRow("searching vector index…");

    try {
      const res  = await fetch("/api/rag/query", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ question }),
      });
      const data = await res.json();

      if (data.warning === "empty-index") {
        out.innerHTML = `<div class="empty-state">No files indexed yet.<br><span>Upload files in the left panel first.</span></div>`;
        return;
      }

      const chunksHTML = (data.chunks || []).map((c, i) =>
        `<div class="rag-chunk">
          <div class="rag-chunk-meta">
            <span>[${i+1}] ${esc(c.filename)}</span>
            <span>chunk ${c.chunkIdx}</span>
            <span class="rag-chunk-score">similarity: ${c.score}</span>
          </div>
          <div class="rag-chunk-text">${esc(c.text.slice(0, 280))}${c.text.length > 280 ? "…" : ""}</div>
        </div>`
      ).join("");

      out.innerHTML = `
        <div class="rag-answer">
          <div class="rag-answer-tag">&#9670; RAG answer</div>
          <div style="font-size:13px;line-height:1.75">${md(data.answer)}</div>
          <div class="rag-sources">
            <div class="rag-sources-label">retrieved chunks (${data.chunks.length})</div>
            ${chunksHTML}
          </div>
        </div>`;
    } catch (e) {
      out.innerHTML = `<div class="result-card"><div class="result-tag tag-r">⚠ error</div>${e.message}</div>`;
    }
  }

  function quickAsk(q) {
    $("rag-input").value = q;
    ask();
  }

  async function clear() {
    if (!confirm("Clear all indexed files from the vector store?")) return;
    try {
      await fetch("/api/rag/clear", { method: "DELETE" });
      toast("Vector index cleared");
      loadStats();
      $("rag-output").innerHTML = `<div class="empty-state">index some files on the left<br><span>then ask anything about your codebase</span></div>`;
    } catch (e) {
      toast("Error clearing index: " + e.message);
    }
  }

  // Drag & drop on RAG zone
  const dz = $("rag-drop-zone");
  if (dz) {
    dz.addEventListener("dragover",  e => { e.preventDefault(); dz.classList.add("over"); });
    dz.addEventListener("dragleave", ()  => dz.classList.remove("over"));
    dz.addEventListener("drop", e => {
      e.preventDefault(); dz.classList.remove("over");
      handleFiles(e.dataTransfer.files);
    });
  }

  // Load stats on init
  loadStats();
  // Expose sidebar ref for progress injection
  window._ragSidebar = document.querySelector(".rag-sidebar");

  return { handleFiles, ask, quickAsk, clear };
})();
