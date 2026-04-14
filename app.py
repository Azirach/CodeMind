# ─────────────────────────────────────────────
#  CodeMind — Flask App Entry Point
#  Run with:  python app.py
# ─────────────────────────────────────────────

import os
from flask import Flask, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv

# Load .env before anything else
load_dotenv()

from server.routes import api

app = Flask(__name__, static_folder="public", static_url_path="")
CORS(app)

# ── Mount API blueprint at /api ──
app.register_blueprint(api, url_prefix="/api")

# ── Serve frontend static files ──
@app.route("/")
def index():
    return send_from_directory("public", "index.html")

@app.route("/<path:path>")
def static_files(path):
    return send_from_directory("public", path)


# ── Start server ──
if __name__ == "__main__":
    port = int(os.getenv("PORT", 3000))
    print("─────────────────────────────────────────")
    print("  CodeMind server running  (Python/Flask)")
    print(f"  Local:   http://localhost:{port}")
    print(f"  Mode:    {os.getenv('FLASK_ENV', 'development')}")
    print("─────────────────────────────────────────")
    app.run(host="0.0.0.0", port=port, debug=True)
