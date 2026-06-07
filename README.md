<div align="center">

# 🤖💻 Code Tutor Chatbot

### Un chatbot che **genera codice e te lo spiega passo passo**, pensato per neofiti — dallo sviluppo web fino al C di basso livello.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Ollama](https://img.shields.io/badge/Ollama-local%20LLM-0A0A0A?logo=ollama&logoColor=white)](https://ollama.com/)
[![Anthropic](https://img.shields.io/badge/Claude-API-D97757?logo=anthropic&logoColor=white)](https://www.anthropic.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#-licenza)
[![Streaming](https://img.shields.io/badge/Streaming-SSE-blueviolet)](#)

</div>

---

Le risposte arrivano in **streaming** (il testo compare mentre viene generato) e il server regge **molte richieste in parallelo**. Il motore AI è un **modello open eseguito in locale tramite [Ollama](https://ollama.com/)** — niente API esterne, tutto self-hosted e sotto il tuo controllo. In alternativa si può usare l'**API Claude** cambiando una sola variabile d'ambiente.

## ✨ Caratteristiche

- 🧑‍🏫 **Spiega mentre genera** — non solo codice, ma il *perché* di ogni scelta, in linguaggio semplice.
- ⚡ **Streaming token-per-token** via Server-Sent Events (SSE).
- 🔌 **Doppio motore** — Ollama in locale *(default)* oppure Claude, intercambiabili dal `.env`.
- 🎨 **Frontend pulito** — markdown renderizzato, sintassi evidenziata, zero framework.
- 🛡️ **Robusto** — validazione input, rate limiting per IP, stop alla disconnessione del client.
- 📊 **Dashboard accessi** — log su terminale, file e pannello protetto da token (`/admin?token=...`).

## 🏗️ Architettura

| Livello | Tecnologia |
| --- | --- |
| **Backend** | Node.js + [Express](https://expressjs.com/) |
| **Motore AI** | [Ollama](https://ollama.com/) (default, API OpenAI-compatibile) · [Claude](https://www.anthropic.com/) (SDK ufficiale) |
| **Streaming** | Server-Sent Events (SSE), token per token |
| **Frontend** | HTML/CSS/JS vanilla · [marked](https://marked.js.org/) · [DOMPurify](https://github.com/cure53/DOMPurify) · [highlight.js](https://highlightjs.org/) |

Le chiamate al modello sono I/O-bound, quindi un singolo processo Node serve molte conversazioni simultanee.

## 📋 Prerequisiti

- [Node.js](https://nodejs.org/) 18+ (testato su v24)
- [Ollama](https://ollama.com/) installato e in esecuzione, con almeno un modello scaricato

## 🚀 Installazione e avvio

```bash
# 1. Installa le dipendenze Node
npm install

# 2. Scarica un modello con Ollama (se non l'hai già fatto)
ollama pull qwen2.5-coder:7b

# 3. Avvia il server
npm start
```

Apri il browser su <http://localhost:3000>. Non serve nessun file `.env`: i default puntano già a Ollama con il modello `qwen2.5-coder:7b`.

> 💡 In sviluppo usa `npm run dev` per il riavvio automatico ad ogni modifica.

## 🔄 Come cambiare modello

### Usare un altro modello locale di Ollama

```bash
ollama pull llama3.1:8b      # 1) scarica il modello
ollama list                  #    (verifica il nome esatto nella colonna NAME)
```

Poi indica il nome al chatbot, via variabile d'ambiente o file `.env`:

```bash
# Veloce (PowerShell):
$env:OLLAMA_MODEL = "llama3.1:8b"; npm start

# Stabile (.env):
OLLAMA_MODEL=llama3.1:8b
```

### Passare a Claude (API Anthropic)

Nel file `.env`:

```ini
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...      # la tua chiave
MODEL=claude-opus-4-8             # oppure claude-sonnet-4-6 / claude-haiku-4-5
```

Riavvia. Per tornare a Ollama, rimetti `LLM_PROVIDER=ollama`.

## ⚙️ Configurazione (`.env`)

Vedi `.env.example` per l'elenco commentato. In sintesi:

| Variabile | Default | Vale per |
| --- | --- | --- |
| `LLM_PROVIDER` | `ollama` | entrambi |
| `PORT` | `3000` | entrambi |
| `OLLAMA_MODEL` | `qwen2.5-coder:7b` | ollama |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | ollama |
| `ANTHROPIC_API_KEY` | — | anthropic |
| `MODEL` | `claude-opus-4-8` | anthropic |
| `EFFORT` | `medium` | anthropic |
| `MAX_TOKENS` | `8000` | anthropic |
| `RATE_LIMIT_MAX` | `30` | entrambi |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | entrambi |
| `ADMIN_TOKEN` | — | dashboard |

## 🧩 Modello GGUF personalizzato (opzionale)

Il repo include un `Modelfile` per registrare un modello GGUF locale in Ollama:

```bash
ollama create qwen3.5-9b-custom -f Modelfile
ollama run qwen3.5-9b-custom
```

> ⚠️ Il file dei pesi `.gguf` (diversi GB) **non è incluso** nel repository — supera il limite di 100 MB di GitHub ed è escluso via `.gitignore`. Scaricalo separatamente e mettilo accanto al `Modelfile`.

## 🩺 Risoluzione dei problemi

- **"Impossibile contattare Ollama..."** → Ollama non è avviato. Apri l'app o esegui `ollama serve`, poi riprova.
- **"Modello ... non trovato"** → scaricalo con `ollama pull <nome>` (controlla con `ollama list`).
- **Risposte lente** → i modelli locali girano sulla tua CPU/GPU. Un modello più piccolo (es. `llama3.2:3b`) è pi�