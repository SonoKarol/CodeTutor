// ============================================================
//  Code Tutor — logica del frontend
//  - Mantiene la cronologia della conversazione
//  - Invia i messaggi a /api/chat
//  - Legge la risposta in streaming (SSE) e la mostra in tempo reale
//  - Renderizza il markdown con evidenziazione della sintassi
// ============================================================

// Configura marked per usare highlight.js sui blocchi di codice.
marked.setOptions({
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
});

const chatEl = document.getElementById("chat");
const welcomeEl = document.getElementById("welcome");
const formEl = document.getElementById("composer");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");

// Cronologia inviata al server ad ogni richiesta (l'API è stateless).
const history = [];
let isStreaming = false;

// ---- Utilità ----

// Trasforma il markdown in HTML sicuro (sanitizzato contro XSS).
function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(text));
}

function scrollToBottom() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

// Crea il DOM di un messaggio e restituisce l'elemento "bubble" interno.
function addMessage(role, initialText = "") {
  if (welcomeEl) welcomeEl.remove();

  const msg = document.createElement("div");
  msg.className = `msg ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "Tu" : "</>";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (role === "user") {
    bubble.textContent = initialText; // i messaggi utente sono testo semplice
  } else {
    bubble.innerHTML = renderMarkdown(initialText);
  }

  msg.appendChild(avatar);
  msg.appendChild(bubble);
  chatEl.appendChild(msg);
  scrollToBottom();
  return bubble;
}

function showError(text) {
  const banner = document.createElement("div");
  banner.className = "error-banner";
  banner.textContent = `⚠️ ${text}`;
  chatEl.appendChild(banner);
  scrollToBottom();
}

function setBusy(busy) {
  isStreaming = busy;
  sendBtn.disabled = busy;
  inputEl.disabled = busy;
}

// ---- Invio + streaming della risposta ----

async function sendMessage(text) {
  const content = text.trim();
  if (!content || isStreaming) return;

  addMessage("user", content);
  history.push({ role: "user", content });

  setBusy(true);
  const bubble = addMessage("assistant", "");
  bubble.classList.add("cursor");

  let answer = "";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });

    // Errori restituiti come JSON (es. chiave mancante, rate limit).
    if (!res.ok) {
      let msg = `Errore ${res.status}`;
      try {
        const data = await res.json();
        if (data.error) msg = data.error;
      } catch {
        /* corpo non JSON */
      }
      bubble.classList.remove("cursor");
      bubble.parentElement.remove();
      showError(msg);
      return;
    }

    // Lettura dello stream SSE.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Gli eventi SSE sono separati da una riga vuota.
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop(); // l'ultimo pezzo può essere incompleto

      for (const chunk of chunks) {
        const event = parseSSE(chunk);
        if (!event) continue;

        if (event.name === "delta" && event.data.text) {
          answer += event.data.text;
          bubble.innerHTML = renderMarkdown(answer);
          scrollToBottom();
        } else if (event.name === "error") {
          showError(event.data.message || "Errore durante la generazione.");
        }
      }
    }

    bubble.classList.remove("cursor");

    if (answer) {
      history.push({ role: "assistant", content: answer });
    } else {
      bubble.parentElement.remove();
      showError("Nessuna risposta ricevuta. Riprova.");
    }
  } catch (err) {
    bubble.classList.remove("cursor");
    if (!answer) bubble.parentElement.remove();
    showError("Problema di connessione. Controlla che il server sia attivo.");
  } finally {
    setBusy(false);
    inputEl.focus();
  }
}

// Estrae nome evento e dati JSON da un blocco SSE ("event: ...\ndata: ...").
function parseSSE(chunk) {
  let name = "message";
  let dataStr = "";
  for (const line of chunk.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
  }
  if (!dataStr) return null;
  try {
    return { name, data: JSON.parse(dataStr) };
  } catch {
    return null;
  }
}

// ---- Eventi UI ----

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = inputEl.value;
  inputEl.value = "";
  autoresize();
  sendMessage(text);
});

// Invio con Invio; a capo con Shift+Invio.
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    formEl.requestSubmit();
  }
});

// Il textarea cresce con il contenuto.
function autoresize() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + "px";
}
inputEl.addEventListener("input", autoresize);

// Pulsanti di esempio nella schermata di benvenuto.
document.querySelectorAll(".suggestion").forEach((btn) => {
  btn.addEventListener("click", () => sendMessage(btn.textContent));
});

inputEl.focus();
