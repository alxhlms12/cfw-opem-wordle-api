const $ = (id) => document.getElementById(id);
const state = { game: null, token: null, current: "", dictionaries: [], busy: false };
const keys = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

function base() {
  return $("apiBase").value.trim().replace(/\/+$/, "");
}
function endpoint(dictionary, path) {
  return `${base()}/${encodeURIComponent(dictionary)}/${path}`;
}
function settings() {
  return {
    length: Number($("length").value),
    maxAttempts: Number($("maxAttempts").value),
    hardMode: $("hardMode").value === "true",
    profanity: $("profanity").value
  };
}
function output(value) {
  $("apiOutput").textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  output(data);
  if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
  return data;
}
async function loadDictionaries() {
  const response = await fetch(`${base()}/dictionaries`);
  const data = await response.json();
  if (!response.ok) throw new Error("Could not load dictionaries.");
  state.dictionaries = data.dictionaries || [];
  const select = $("dictionary");
  const previous = select.value || "wordle";
  select.innerHTML = "";
  for (const dict of state.dictionaries) {
    const option = document.createElement("option");
    option.value = dict.id;
    option.textContent = `${dict.name}${dict.available ? "" : " (not imported)"}`;
    option.disabled = !dict.available;
    select.append(option);
  }
  if ([...select.options].some(o => o.value === previous && !o.disabled)) select.value = previous;
  else if ([...select.options].some(o => o.value === "wordle" && !o.disabled)) select.value = "wordle";
  output({ loaded: state.dictionaries.length, available: state.dictionaries.filter(d => d.available).length });
}
function makeBoard() {
  const length = settings().length;
  const attempts = settings().maxAttempts;
  const board = $("board");
  board.innerHTML = "";
  board.style.setProperty("--length", length);
  for (let row = 0; row < attempts; row++) {
    const line = document.createElement("div");
    line.className = "board-row";
    for (let col = 0; col < length; col++) {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.dataset.row = row;
      tile.dataset.col = col;
      line.append(tile);
    }
    board.append(line);
  }
}
function paintBoard() {
  makeBoard();
  const guesses = state.game?.guesses || [];
  guesses.forEach((guess, row) => {
    guess.word.split("").forEach((letter, col) => {
      const tile = document.querySelector(`.tile[data-row="${row}"][data-col="${col}"]`);
      if (!tile) return;
      tile.textContent = letter;
      tile.classList.add(guess.result[col]);
      if ($("showLabels").checked) {
        const small = document.createElement("small");
        small.textContent = guess.result[col];
        tile.append(small);
      }
    });
  });
  const row = guesses.length;
  if (state.game?.status === "playing" && row < settings().maxAttempts) {
    state.current.split("").forEach((letter, col) => {
      const tile = document.querySelector(`.tile[data-row="${row}"][data-col="${col}"]`);
      if (tile) tile.textContent = letter;
    });
  }
  $("status").textContent = state.game?.status || "Ready";
  $("modeLabel").textContent = ($("mode").value || "unlimited").toUpperCase();
  $("gameSubtitle").textContent = `${$("dictionary").selectedOptions[0]?.textContent || "Dictionary"} · ${settings().length} letters · ${settings().maxAttempts} attempts`;
  renderKeyboard();
}
function renderKeyboard() {
  const keyboard = $("keyboard");
  keyboard.innerHTML = "";
  keyboard.hidden = !$("keyboardEnabled").checked;
  const feedback = new Map();
  for (const guess of state.game?.guesses || []) {
    guess.word.split("").forEach((letter, i) => {
      const old = feedback.get(letter);
      const next = guess.result[i];
      const rank = { absent: 1, present: 2, correct: 3 };
      if (!old || rank[next] > rank[old]) feedback.set(letter, next);
    });
  }
  keys.forEach((row, rowIndex) => {
    const line = document.createElement("div");
    line.className = "key-row";
    if (rowIndex === 2) {
      const enter = document.createElement("button");
      enter.className = "key wide";
      enter.textContent = "Enter";
      enter.onclick = submitGuess;
      line.append(enter);
    }
    for (const letter of row) {
      const button = document.createElement("button");
      button.className = `key ${feedback.get(letter) || ""}`;
      button.textContent = letter;
      button.onclick = () => addLetter(letter);
      line.append(button);
    }
    if (rowIndex === 2) {
      const back = document.createElement("button");
      back.className = "key wide";
      back.textContent = "⌫";
      back.onclick = removeLetter;
      line.append(back);
    }
    keyboard.append(line);
  });
}
function message(text) { $("message").textContent = text; }
function addLetter(letter) {
  if (!state.game || state.game.status !== "playing" || state.busy) return;
  if (state.current.length < settings().length) state.current += letter.toLowerCase();
  paintBoard();
}
function removeLetter() {
  if (state.busy) return;
  state.current = state.current.slice(0, -1);
  paintBoard();
}
async function startGame() {
  try {
    state.busy = true;
    state.current = "";
    const dict = $("dictionary").value;
    const mode = $("mode").value;
    const route = mode === "daily" ? "game/daily" : "game/new";
    const data = await api(endpoint(dict, route), { method: "POST", body: JSON.stringify(settings()) });
    state.game = data;
    state.token = data.token;
    localStorage.setItem("speedle:lastGame", JSON.stringify({ game: data, token: data.token }));
    message("Game started.");
    paintBoard();
  } catch (error) {
    message(error.message);
  } finally {
    state.busy = false;
  }
}
async function submitGuess() {
  if (!state.game || state.game.status !== "playing" || state.busy) return;
  if (state.current.length !== settings().length) return message(`Enter ${settings().length} letters.`);
  try {
    state.busy = true;
    const data = await api(endpoint($("dictionary").value, "game/guess"), {
      method: "POST",
      body: JSON.stringify({ token: state.token, guess: state.current })
    });
    state.game = data;
    state.token = data.token;
    state.current = "";
    localStorage.setItem("speedle:lastGame", JSON.stringify({ game: data, token: data.token }));
    if (data.status === "won") message(`Solved in ${data.attemptsUsed} guesses. Answer: ${data.answer.toUpperCase()}`);
    else if (data.status === "lost") message(`Game over. Answer: ${data.answer.toUpperCase()}`);
    else message(`${data.remainingAttempts} attempts remaining.`);
    paintBoard();
  } catch (error) {
    message(error.message);
  } finally {
    state.busy = false;
  }
}
$("newGame").addEventListener("click", startGame);
$("submitGuess").addEventListener("click", submitGuess);
$("clearGuess").addEventListener("click", () => { state.current = ""; paintBoard(); });
$("settingsToggle").addEventListener("click", () => $("settingsPanel").classList.toggle("open"));
$("settingsClose").addEventListener("click", () => $("settingsPanel").classList.remove("open"));
$("refreshDictionaries").addEventListener("click", () => loadDictionaries().catch(e => message(e.message)));
$("apiHealth").addEventListener("click", async () => {
  try { output(await api(`${base()}/health`)); message("API is reachable."); }
  catch (e) { message(e.message); }
});
$("dictionaryInfo").addEventListener("click", async () => {
  try { output(await api(endpoint($("dictionary").value, "info"))); }
  catch (e) { message(e.message); }
});
$("validateButton").addEventListener("click", async () => {
  const word = encodeURIComponent($("validateWord").value.trim());
  if (!word) return message("Enter a word to validate.");
  try { output(await api(`${endpoint($("dictionary").value, `words/validate/${word}`)}?length=${word.length}&profanity=${$("profanity").value}`)); }
  catch (e) { message(e.message); }
});
$("randomWord").addEventListener("click", async () => {
  try { output(await api(`${endpoint($("dictionary").value, "words/random")}?length=${settings().length}&profanity=${$("profanity").value}`)); }
  catch (e) { message(e.message); }
});
$("evaluateButton").addEventListener("click", async () => {
  try { output(await api(endpoint($("dictionary").value, "evaluate"), { method: "POST", body: JSON.stringify({ guess: $("evalGuess").value, answer: $("evalAnswer").value }) })); }
  catch (e) { message(e.message); }
});
["length","maxAttempts","dictionary","mode","hardMode","profanity","showLabels","keyboardEnabled","colorHints","highContrast"].forEach(id => {
  $(id).addEventListener("change", () => {
    if (id === "highContrast") document.body.classList.toggle("high-contrast", $("highContrast").checked);
    if (id === "colorHints") document.body.classList.toggle("no-colors", !$("colorHints").checked);
    if (["length","maxAttempts","dictionary","mode","hardMode","profanity"].includes(id)) {
      state.game = null; state.token = null; state.current = "";
      paintBoard();
    } else paintBoard();
  });
});
document.addEventListener("keydown", event => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (/^[a-z]$/i.test(event.key)) addLetter(event.key);
  else if (event.key === "Backspace") removeLetter();
  else if (event.key === "Enter") submitGuess();
});
$("apiBase").addEventListener("change", () => loadDictionaries().catch(e => message(e.message)));
loadDictionaries().then(() => {
  try {
    const saved = JSON.parse(localStorage.getItem("speedle:lastGame") || "null");
    if (saved?.game?.token && saved?.token && saved.game.status === "playing") {
      state.game = saved.game;
      state.token = saved.token;
      $("dictionary").value = saved.game.dictionary;
      $("length").value = saved.game.length;
      $("maxAttempts").value = saved.game.maxAttempts;
      $("hardMode").value = String(saved.game.hardMode);
      $("profanity").value = saved.game.profanity;
      $("mode").value = saved.game.mode;
      paintBoard();
      message("Restored your saved game.");
      return;
    }
  } catch {}
  startGame();
}).catch(error => {
  message(`Could not connect to the API: ${error.message}`);
  makeBoard();
});
