// ============================================================
//  Code Tutor Chatbot — server
//
//  Stack: Node.js + Express. Il motore AI è configurabile:
//    - "ollama"    -> modello open eseguito in locale (default)
//    - "anthropic" -> API Claude
//  Si sceglie con la variabile d'ambiente LLM_PROVIDER nel file .env.
//
//  Le risposte sono trasmesse in streaming token-per-token via
//  Server-Sent Events (SSE). Include un registro degli accessi
//  (terminale + file + dashboard protetta) per vedere chi usa il sito.
// ============================================================

import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import rateLimit from "express-rate-limit";
import Anthropic from "@anthropic-ai/sdk";
import geoip from "geoip-lite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- Configurazione generale ----
const PORT = Number(process.env.PORT) || 3000;
const PROVIDER = (process.env.LLM_PROVIDER || "ollama").toLowerCase(); // "ollama" | "anthropic"
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 30;
const RATE_LIMIT_WINDOW_SECONDS = Number(process.env.RATE_LIMIT_WINDOW_SECONDS) || 60;

// Token per la dashboard di monitoraggio. Se vuoto, la dashboard è disabilitata.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

// ---- Configurazione Ollama (modello locale, API compatibile OpenAI) ----
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5-coder:7b";
// Nasconde il blocco di ragionamento <think>...</think> dei "thinking models"
// (es. Qwen3.5). Metti HIDE_THINKING=false nel .env per mostrarlo.
const HIDE_THINKING = (process.env.HIDE_THINKING ?? "true").toLowerCase() !== "false";
// URL dell'API nativa di Ollama (serve per passare "think": false). Derivato
// dall'URL OpenAI-compat togliendo il suffisso /v1.
const OLLAMA_NATIVE_URL = OLLAMA_BASE_URL.replace(/\/v1\/?$/, "");

// ---- Configurazione Anthropic (Claude) ----
const ANTHROPIC_MODEL = process.env.MODEL || "claude-opus-4-8";
const EFFORT = process.env.EFFORT || "medium"; // low | medium | high | max
const MAX_TOKENS = Number(process.env.MAX_TOKENS) || 8000;

// Limiti difensivi sulla conversazione, per robustezza.
const MAX_MESSAGES = 50;
// Lunghezza massima di ogni singolo messaggio (vale anche per le risposte salvate
// nella cronologia). Configurabile dal .env. Metti MAX_CHARS_PER_MESSAGE=0 per
// togliere del tutto il limite. Default generoso: 100000 caratteri.
const MAX_CHARS_PER_MESSAGE = Number(process.env.MAX_CHARS_PER_MESSAGE ?? 100000);

// ---- File di log degli accessi ----
const LOG_DIR = path.join(__dirname, "logs");
const LOG_FILE = path.join(LOG_DIR, "requests.log");
fs.mkdirSync(LOG_DIR, { recursive: true });

// ---- Istruzioni di sistema: definiscono il comportamento del tutor ----
const SYSTEM_PROMPT = `Sei un tutor di programmazione esperto, paziente e amichevole.
Il tuo pubblico sono i NEOFITI: persone che stanno imparando a programmare.

Regole di comportamento:
- Rispondi sempre nella stessa lingua dell'utente (di default in italiano).
- Quando generi codice, fornisci esempi COMPLETI e funzionanti, in blocchi di
  codice markdown con il tag del linguaggio (es. \`\`\`python).
- Dopo il codice, spiega SEMPRE nel dettaglio cosa fa, riga per riga o blocco
  per blocco, con un linguaggio semplice e senza dare per scontati i prerequisiti.
- Copri qualsiasi argomento legittimo di programmazione: dallo sviluppo web fino
  al C di basso livello (puntatori, gestione manuale della memoria, ecc.).
- Spiega i concetti chiave, gli errori comuni dei principianti e le buone pratiche
  (leggibilità, sicurezza, gestione degli errori).
- Se una richiesta è ambigua, fai una scelta ragionevole e dichiara le tue assunzioni.
- Sii incoraggiante: l'obiettivo è far capire, non solo dare la soluzione.

Formatta le risposte in markdown: usa titoli, elenchi puntati e blocchi di codice
per rendere tutto chiaro e leggibile.`;

// ---- Inizializzazione del client del provider attivo ----
let anthropic;
if (PROVIDER === "anthropic") {
  anthropic = new Anthropic(); // legge ANTHROPIC_API_KEY dall'ambiente
}
// Per Ollama non serve un client SDK: il ramo Ollama usa direttamente l'API
// nativa (/api/chat) via fetch, vedi più sotto.

const ACTIVE_MODEL = PROVIDER === "anthropic" ? ANTHROPIC_MODEL : OLLAMA_MODEL;

const app = express();
// Dietro al tunnel Cloudflare la connessione arriva da localhost: fidandoci del
// proxy di loopback, req.ip riflette l'IP reale del visitatore (header X-Forwarded-For).
app.set("trust proxy", "loopback");
app.use(express.json({ limit: "1mb" }));

// Gestione pulita degli errori del body-parser: un JSON malformato o un corpo
// troppo grande devono restituire un errore JSON, non lo stack trace HTML di
// default di Express (che esporrebbe i percorsi interni dei file).
app.use((err, req, res, next) => {
  if (!err) return next();
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Richiesta troppo grande (limite 1MB)." });
  }
  if (err.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({ error: "Il corpo della richiesta non è JSON valido." });
  }
  return next(err);
});

app.use(express.static(path.join(__dirname, "public")));

// ============================================================
//  Registro degli accessi
// ============================================================

// Ricava l'IP reale del client. Dietro Cloudflare l'IP vero è in CF-Connecting-IP;
// altrimenti si usa X-Forwarded-For e infine l'IP della connessione diretta.
function getClientIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (cf) return String(cf).trim();
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return (req.ip || req.socket?.remoteAddress || "").trim();
}

// Riconosce browser e sistema operativo dallo User-Agent (in forma breve e leggibile).
function shortBrowser(ua) {
  if (!ua) return "sconosciuto";
  let browser = "Browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";
  let os = "";
  if (/Windows/.test(ua)) os = "Windows";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
  else if (/Linux/.test(ua)) os = "Linux";
  return os ? `${browser} su ${os}` : browser;
}

// Mette insieme IP, posizione geografica e dispositivo del visitatore.
function getClientInfo(req) {
  const ip = getClientIp(req).replace(/^::ffff:/, "");
  const ua = req.headers["user-agent"] || "";
  const cfCountry = req.headers["cf-ipcountry"];
  let location = "sconosciuta";

  if (ip === "127.0.0.1" || ip === "::1" || ip === "") {
    location = "locale (questo PC)";
  } else {
    const geo = geoip.lookup(ip); // database offline, nessuna chiamata esterna
    if (geo) {
      location = [geo.city, geo.region, geo.country].filter(Boolean).join(", ");
    } else if (cfCountry && cfCountry !== "XX") {
      location = String(cfCountry);
    }
  }
  return { ip: ip || "sconosciuto", browser: shortBrowser(ua), location };
}

// Buffer in memoria delle ultime richieste (per la dashboard) + log su file.
const recentRequests = [];
function recordRequest(entry) {
  recentRequests.unshift(entry); // la più recente in cima
  if (recentRequests.length > 200) recentRequests.pop();
  fs.appendFile(LOG_FILE, JSON.stringify(entry) + "\n", () => {});
  console.log(
    `📥 ${new Date(entry.time).toLocaleString("it-IT")} | IP ${entry.ip} | ${entry.location} | ${entry.browser} | "${entry.question}"`,
  );
}

const app_json_limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_SECONDS * 1000,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Troppe richieste. Riprova tra qualche istante." },
});
app.use("/api/", app_json_limiter);

// ============================================================
//  Dashboard di monitoraggio (protetta da token)
// ============================================================

function requireAdmin(req, res) {
  if (!ADMIN_TOKEN) {
    res.status(403).send("Dashboard disabilitata: imposta ADMIN_TOKEN nel file .env e riavvia.");
    return false;
  }
  const token = req.query.token || req.headers["x-admin-token"];
  if (token !== ADMIN_TOKEN) {
    res.status(401).send("Token non valido.");
    return false;
  }
  return true;
}

// Dati grezzi (JSON) delle richieste recenti.
app.get("/admin/data", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ count: recentRequests.length, requests: recentRequests });
});

// Pagina HTML della dashboard (si auto-aggiorna ogni 5 secondi).
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Monitoraggio accessi — Code Tutor</title>
<style>
 body{font-family:system-ui,Segoe UI,sans-serif;background:#0f1117;color:#e6e8ee;margin:0;padding:20px}
 h1{font-size:18px;margin:0 0 4px}
 .meta{color:#9aa3b2;font-size:13px;margin-bottom:16px}
 table{width:100%;border-collapse:collapse;font-size:14px}
 th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #262b38;vertical-align:top}
 th{color:#58a6ff;position:sticky;top:0;background:#0f1117}
 tr:hover{background:#171a23}
 .ip{font-family:Consolas,monospace;color:#58a6ff}
 .q{color:#c9d1d9;max-width:380px;overflow-wrap:anywhere}
 .empty{color:#9aa3b2;padding:24px 0}
</style></head>
<body>
 <h1>📡 Accessi al sito</h1>
 <div class="meta">Aggiornamento automatico ogni 5s · <span id="count">0</span> richieste recenti</div>
 <table><thead><tr>
   <th>Ora</th><th>Indirizzo IP</th><th>Posizione</th><th>Dispositivo</th><th>Domanda</th>
 </tr></thead><tbody id="rows"></tbody></table>
 <div id="empty" class="empty" style="display:none">Nessuna richiesta ancora registrata.</div>
<script>
 var token = new URLSearchParams(location.search).get("token") || "";
 function esc(s){var d=document.createElement("div");d.textContent=(s==null?"":s);return d.innerHTML;}
 function load(){
   fetch("/admin/data?token="+encodeURIComponent(token))
     .then(function(r){ if(!r.ok) throw 0; return r.json(); })
     .then(function(d){
       document.getElementById("count").textContent=d.count;
       document.getElementById("empty").style.display=d.count?"none":"block";
       document.getElementById("rows").innerHTML=d.requests.map(function(e){
         var t=new Date(e.time).toLocaleString("it-IT");
         return "<tr><td>"+esc(t)+"</td><td class='ip'>"+esc(e.ip)+"</td><td>"+
           esc(e.location)+"</td><td>"+esc(e.browser)+"</td><td class='q'>"+esc(e.question)+"</td></tr>";
       }).join("");
     })
     .catch(function(){ document.body.innerHTML="<p style='color:#ffb3b8'>Token non valido o dashboard non disponibile.</p>"; });
 }
 load(); setInterval(load,5000);
</script>
</body></html>`;

app.get("/admin", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.type("html").send(ADMIN_HTML);
});

// ---- Healthcheck ----
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    provider: PROVIDER,
    model: ACTIVE_MODEL,
    ...(PROVIDER === "ollama" ? { ollamaBaseUrl: OLLAMA_BASE_URL } : {}),
    ...(PROVIDER === "anthropic"
      ? { hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY) }
      : {}),
  });
});

// ---- Validazione dell'input ----
function validateMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "Il campo 'messages' deve essere un array non vuoto." };
  }
  if (raw.length > MAX_MESSAGES) {
    return { error: `Troppi messaggi (massimo ${MAX_MESSAGES}).` };
  }

  const messages = [];
  for (const m of raw) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) {
      return { error: "Ogni messaggio deve avere role 'user' o 'assistant'." };
    }
    if (typeof m.content !== "string" || m.content.trim() === "") {
      return { error: "Ogni messaggio deve avere un 'content' testuale non vuoto." };
    }
    if (MAX_CHARS_PER_MESSAGE > 0 && m.content.length > MAX_CHARS_PER_MESSAGE) {
      return {
        error: `Messaggio troppo lungo (massimo ${MAX_CHARS_PER_MESSAGE} caratteri).`,
      };
    }
    messages.push({ role: m.role, content: m.content });
  }

  if (messages[0].role !== "user") {
    return { error: "La conversazione deve iniziare con un messaggio dell'utente." };
  }
  return { messages };
}

// ---- Endpoint principale: chat in streaming (SSE) ----
app.post("/api/chat", async (req, res) => {
  const { error, messages } = validateMessages(req.body?.messages);
  if (error) return res.status(400).json({ error });

  // Registra l'accesso (chi, da dove, con cosa, e l'inizio della domanda).
  const info = getClientInfo(req);
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const question = (lastUser?.content || "").replace(/\s+/g, " ").slice(0, 100);
  recordRequest({ time: new Date().toISOString(), ...info, question });

  // Controlli pre-volo prima di aprire lo stream (così possiamo rispondere JSON).
  if (PROVIDER === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error:
        "ANTHROPIC_API_KEY non configurata. Imposta la chiave nel file .env oppure usa LLM_PROVIDER=ollama.",
    });
  }

  // Prepara la risposta come stream di Server-Sent Events.
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Se il client chiude la connessione, interrompiamo la generazione.
  const ac = new AbortController();
  req.on("close", () => ac.abort());

  try {
    if (PROVIDER === "anthropic") {
      // --- Claude (Anthropic) ---
      const stream = anthropic.messages.stream(
        {
          model: ANTHROPIC_MODEL,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          thinking: { type: "adaptive" },
          output_config: { effort: EFFORT },
          messages,
        },
        { signal: ac.signal },
      );
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          send("delta", { text: event.delta.text });
        }
      }
    } else {
      // --- Ollama (modello locale, API nativa) ---
      // Usiamo l'endpoint nativo /api/chat (NDJSON) invece di quello
      // OpenAI-compat per poter passare "think": false: così i "thinking model"
      // (es. Qwen3.5) non producono il blocco di ragionamento e lo stream
      // contiene solo la risposta. Con HIDE_THINKING=false il ragionamento viene
      // comunque mostrato, inviato come testo prima della risposta.
      const resp = await fetch(`${OLLAMA_NATIVE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
          stream: true,
          think: !HIDE_THINKING,
        }),
        signal: ac.signal,
      });
      if (!resp.ok || !resp.body) {
        const detail = await resp.text().catch(() => "");
        throw new Error(`Ollama ${resp.status}: ${detail || resp.statusText}`);
      }

      // Lo stream nativo è NDJSON: una riga JSON per chunk.
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let lineBuf = "";
      let thinkingOpen = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        lineBuf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = lineBuf.indexOf("\n")) !== -1) {
          const line = lineBuf.slice(0, nl).trim();
          lineBuf = lineBuf.slice(nl + 1);
          if (!line) continue;
          let obj;
          try {
            obj = JSON.parse(line);
          } catch {
            continue;
          }
          if (obj.error) throw new Error(obj.error);
          const msg = obj.message;
          if (!msg) continue;
          // Ragionamento (solo se HIDE_THINKING=false): lo mostriamo in citazione.
          if (!HIDE_THINKING && msg.thinking) {
            if (!thinkingOpen) {
              send("delta", { text: "> 🤔 " });
              thinkingOpen = true;
            }
            send("delta", { text: msg.thinking });
          }
          if (msg.content) {
            if (thinkingOpen) {
              send("delta", { text: "\n\n" });
              thinkingOpen = false;
            }
            send("delta", { text: msg.content });
          }
        }
      }
    }

    send("done", {});
    res.end();
  } catch (err) {
    if (ac.signal.aborted) {
      try {
        res.end();
      } catch {
        /* già chiuso */
      }
      return;
    }

    console.error("Errore durante lo streaming:", err?.message || err);
    const status = err?.status;
    const raw = `${err?.message || ""} ${err?.cause?.code || ""}`;
    let message = "Si è verificato un errore nel generare la risposta.";

    if (PROVIDER === "ollama") {
      if (/ECONNREFUSED|fetch failed|Connection error/i.test(raw)) {
        message = `Impossibile contattare Ollama su ${OLLAMA_BASE_URL}. Assicurati che Ollama sia avviato (comando: ollama serve, oppure apri l'app Ollama).`;
      } else if (/not found|404/i.test(raw)) {
        message = `Modello "${OLLAMA_MODEL}" non trovato. Scaricalo con: ollama pull ${OLLAMA_MODEL}`;
      }
    } else {
      if (status === 401) message = "Chiave API non valida.";
      else if (status === 429) message = "Limite di richieste raggiunto, riprova tra poco.";
      else if (status === 529) message = "Il servizio è temporaneamente sovraccarico.";
    }

    if (!res.headersSent) {
      res.status(status || 500).json({ error: message });
    } else {
      send("error", { message });
      res.end();
    }
  }
});

app.listen(PORT, () => {
  console.log(`\n  Code Tutor Chatbot avviato su http://localhost:${PORT}`);
  console.log(`  Provider: ${PROVIDER} | Modello: ${ACTIVE_MODEL}`);
  if (PROVIDER === "ollama") {
    console.log(`  Endpoint Ollama: ${OLLAMA_BASE_URL}`);
  } else if (!process.env.ANTHROPIC_API_KEY) {
    console.log("  ATTENZIONE: ANTHROPIC_API_KEY non impostata (vedi .env.example).");
  }
  if (ADMIN_TOKEN) {
    console.log(`  Dashboard accessi: http://localhost:${PORT}/admin?token=${ADMIN_TOKEN}`);
  } else {
    console.log("  Dashboard accessi disabilitata (imposta ADMIN_TOKEN nel .env per attivarla).");
  }
  console.log("");
});
