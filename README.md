<div align="center">

# 🤖💻 Code Tutor Chatbot

### A chatbot that **generates code and explains it step by step**, built for beginners — from web development down to low-level C.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Ollama](https://img.shields.io/badge/Ollama-local%20LLM-0A0A0A?logo=ollama&logoColor=white)](https://ollama.com/)
[![Anthropic](https://img.shields.io/badge/Claude-API-D97757?logo=anthropic&logoColor=white)](https://www.anthropic.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#-license)
[![Streaming](https://img.shields.io/badge/Streaming-SSE-blueviolet)](#)

</div>

---

Responses arrive via **streaming** (text appears as it's generated) and the server handles **many concurrent requests**. The AI engine is an **open model running locally through [Ollama](https://ollama.com/)** — no external APIs, fully self-hosted and under your control. Alternatively, you can use the **Claude API** by changing a single environment variable.

## ✨ Features

- 🧑‍🏫 **Explains while it generates** — not just code, but the *why* behind each choice, in plain language.
- ⚡ **Token-by-token streaming** via Server-Sent Events (SSE).
- 🔌 **Dual engine** — Ollama locally *(default)* or Claude, swappable from the `.env`.
- 🎨 **Clean frontend** — rendered markdown, syntax highlighting, zero frameworks.
- 🛡️ **Robust** — input validation, per-IP rate limiting, generation stops when the client disconnects.
- 📊 **Access dashboard** — logs to terminal, file, and a token-protected panel (`/admin?token=...`).

## 🏗️ Architecture

| Layer | Technology |
| --- | --- |
| **Backend** | Node.js + [Express](https://expressjs.com/) |
| **AI engine** | [Ollama](https://ollama.com/) (default, OpenAI-compatible API) · [Claude](https://www.anthropic.com/) (official SDK) |
| **Streaming** | Server-Sent Events (SSE), token by token |
| **Frontend** | Vanilla HTML/CSS/JS · [marked](https://marked.js.org/) · [DOMPurify](https://github.com/cure53/DOMPurify) · [highlight.js](https://highlightjs.org/) |

Model calls are I/O-bound, so a single Node process serves many simultaneous conversations.

## 📋 Prerequisites

- [Node.js](https://nodejs.org/) 18+ (tested on v24)
- [Ollama](https://ollama.com/) installed and running, with at least one model pulled

## 🚀 Installation & startup

```bash
# 1. Install the Node dependencies
npm install

# 2. Pull a model with Ollama (if you haven't already)
ollama pull qwen2.5-coder:7b

# 3. Start the server
npm start
```

Open your browser at <http://localhost:3000>. No `.env` file is required: the defaults already point to Ollama with the `qwen2.5-coder:7b` model.

> 💡 During development, use `npm run dev` for automatic restart on every change.

## 🔄 How to change the model

### Use a different local Ollama model

```bash
ollama pull llama3.1:8b      # 1) pull the model
ollama list                  #    (check the exact name in the NAME column)
```

Then point the chatbot to it, via environment variable or `.env` file:

```bash
# Quick (PowerShell):
$env:OLLAMA_MODEL = "llama3.1:8b"; npm start

# Persistent (.env):
OLLAMA_MODEL=llama3.1:8b
```

### Switch to Claude (Anthropic API)

In the `.env` file:

```ini
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...      # your key
MODEL=claude-opus-4-8             # or claude-sonnet-4-6 / claude-haiku-4-5
```

Restart. To go back to Ollama, set `LLM_PROVIDER=ollama` again.

## ⚙️ Configuration (`.env`)

See `.env.example` for the commented list. In short:

| Variable | Default | Applies to |
| --- | --- | --- |
| `LLM_PROVIDER` | `ollama` | both |
| `PORT` | `3000` | both |
| `OLLAMA_MODEL` | `qwen2.5-coder:7b` | ollama |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | ollama |
| `ANTHROPIC_API_KEY` | — | anthropic |
| `MODEL` | `claude-opus-4-8` | anthropic |
| `EFFORT` | `medium` | anthropic |
| `MAX_TOKENS` | `8000` | anthropic |
| `RATE_LIMIT_MAX` | `30` | both |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | both |
| `ADMIN_TOKEN` | — | dashboard |

## 🧩 Custom GGUF model (optional)

The repo includes a `Modelfile` to register a local GGUF model in Ollama:

```bash
ollama create qwen3.5-9b-custom -f Modelfile
ollama run qwen3.5-9b-custom
```

> ⚠️ The `.gguf` weights file (several GB) is **not included** in the repository — it exceeds GitHub's 100 MB limit and is excluded via `.gitignore`. Download it separately and place it next to the `Modelfile`.

## 🩺 Troubleshooting

- **"Cannot reach Ollama..."** → Ollama isn't running. Open the app or run `ollama serve`, then retry.
- **"Model ... not found"** → pull it with `ollama pull <name>` (check with `ollama list`).
- **Slow responses** → local models run on your CPU/GPU. A smaller model (e.g. `llama3.2:3b`) is faster; a larger one is more accurate but slower.

## 🔐 Security & notes

- With Ollama, **no data leaves your machine**: everything runs locally.
- If you use Claude, the API key stays **on the server only** (the browser never sees it). **Never commit `.env`**.
- For larger-scale production: multiple instances behind a load balancer (or the `cluster` module) and HTTPS.

## 📁 Project structure

```
CodeTutor/
├── server.js          # Express server + streaming (Ollama or Claude)
├── Modelfile          # GGUF model definition for Ollama
├── package.json       # Dependencies and npm scripts
├── .env.example       # Configuration template (copy it to .env)
├── .gitignore
├── public/
│   ├── index.html     # Page structure
│   ├── styles.css     # Theme and layout
│   └── app.js         # Chat logic + SSE streaming parsing
└── logs/
    └── requests.log   # Access log
```

## 📄 License

Released under the **MIT** license. See the `license` field in `package.json`.

---

<div align="center">
<sub>Built with ❤️ for people learning to code.</sub>
</div>
