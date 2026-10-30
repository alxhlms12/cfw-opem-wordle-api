const $ = id => document.getElementById(id);
const state = { game: null, token: null, current: "", busy: false, dicts: [] };
const rows = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
const config = () => ({
  length: Number($("length").value),
  maxAttempts: Number($("attempts").value),
  hardMode: $("hardMode").checked,
  profanity: $("profanity").value,
  answerPolicy: $("answerPolicy").value,
  tokenTtlHours: Number($("ttl").value)
});
const apiBase = () => $("apiBase").value.trim().replace(/\/+$/, "");
const url = (dict, path) => `${apiBase()}/${encodeURIComponent(dict)}/${path}`;
function showOutput(data) {
  $("apiOutput").textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}
async function request(target, options = {}) {
  const response = await fetch(target, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!$("apiOutput").hidden) showOutput({ status: response.status, response: data });
  if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
  return data;
}
function notify(text, type = "") {
  $("notice").textContent = text;
  $("notice").dataset.type = type;
}
async function loadDictionaries() {
  const data = await request(`${apiBase()}/dictionaries`);
  state.dicts = data.dictionaries || [];
  const select = $("dictionary");
  const previous = select.value || "wordle";
  select.replaceChildren();
  for (const item of state.dicts) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.name} · ${item.available ? `${item.guessCount} guesses` : "not imported"}`;
    option.disabled = !item.available;
    select.append(option);
  }
  const usable = [...select.options].find(x => x.value === previous && !x.disabled)
    || [...select.options].find(x => !x.disabled);
  if (usable) select.value = usable.value;
  updateDictionaryInfo();
}
function updateDictionaryInfo() {
  const item = state.dicts.find(x => x.id === $("dictionary").value);
  $("dictionaryInfo").textContent = item
    ? `${item.description} · ${item.available ? `${item.answerCount} answers / ${item.guessCount} accepted guesses` : "Dataset not installed"}`
    : "No dictionary selected.";
}
function paint() {
  const length = config().length;
  const attempts = config().maxAttempts;
  const board = $("board");
  board.replaceChildren();
  board.style.setProperty("--length", length);
  for (let r = 0; r < attempts; r++) {
    const row = document.createElement("div");
    row.className = "board-row";
    for (let c = 0; c < length; c++) {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.dataset.r = r;
      tile.dataset.c = c;
      row.append(tile);
    }
    board.append(row);
  }
  (state.game?.guesses || []).forEach((guess, r) => {
    [...guess.word].forEach((letter, c) => {
      const tile = board.querySelector(`[data-r="${r}"][data-c="${c}"]`);
      if (!tile) return;
      tile.textContent = letter;
      tile.classList.add(guess.result[c]);
      if ($("tileLabels").checked) {
        const label = document.createElement("small");
        label.textContent = guess.result[c];
        tile.append(label);
      }
    });
  });
  if (state.game?.status === "playing") {
    [...state.current].forEach((letter, c) => {
      const tile = board.querySelector(`[data-r="${state.game.guesses.length}"][data-c="${c}"]`);
      if (tile) tile.textContent = letter;
    });
  }
  $("remaining").textContent = state.game
    ? `${state.game.remainingAttempts} guesses left`
    : `Guess the ${length}-letter word`;
  $("keyboard").hidden = !$("keyboardEnabled").checked;
  renderKeyboard();
}
function renderKeyboard() {
  const keyboard = $("keyboard");
  keyboard.replaceChildren();
  const feedback = new Map();
  const rank = { absent: 1, present: 2, correct: 3 };
  for (const item of state.game?.guesses || []) {
    [...item.word].forEach((letter, i) => {
      const old = feedback.get(letter);
      if (!old || rank[item.result[i]] > rank[old]) feedback.set(letter, item.result[i]);
    });
  }
  rows.forEach((letters, r) => {
    const row = document.createElement("div");
    row.className = "key-row";
    if (r === 2) row.append(makeKey("Enter", "wide", submit));
    for (const letter of letters) row.append(makeKey(letter, feedback.get(letter) || "", () => type(letter)));
    if (r === 2) row.append(makeKey("⌫", "wide", backspace));
    keyboard.append(row);
  });
}
function makeKey(label, cls, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `key ${cls}`;
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}
function type(letter) {
  if (state.busy || state.game?.status !== "playing") return;
  if (state.current.length < config().length) state.current += letter.toLowerCase();
  paint();
}
function backspace() {
  if (state.busy) return;
  state.current = state.current.slice(0, -1);
  paint();
}
async function start(mode = $("mode").value) {
  if (state.busy) return;
  state.busy = true;
  notify("Starting game…");
  try {
    const endpoint = mode === "daily" ? "game/daily" : "game/new";
    const data = await request(url($("dictionary").value, endpoint), {
      method: "POST", body: JSON.stringify(config())
    });
    state.game = data;
    state.token = data.token;
    state.current = "";
    $("mode").value = mode;
    localStorage.setItem("speedle:session", JSON.stringify({ dictionary: $("dictionary").value, token: state.token }));
    notify(mode === "daily" ? `Daily puzzle · ${data.date}` : "Unlimited game started.", "success");
    paint();
  } catch (error) { notify(error.message, "error"); }
  finally { state.busy = false; }
}
async function submit() {
  if (state.busy || state.game?.status !== "playing") return;
  if (state.current.length !== config().length) return notify(`Enter exactly ${config().length} letters.`, "error");
  state.busy = true;
  try {
    const data = await request(url($("dictionary").value, "game/guess"), {
      method: "POST", body: JSON.stringify({ token: state.token, guess: state.current })
    });
    state.game = data;
    state.token = data.token;
    state.current = "";
    localStorage.setItem("speedle:session", JSON.stringify({ dictionary: $("dictionary").value, token: state.token }));
    if (data.status === "won") notify(`Solved in ${data.attemptsUsed} guesses. Answer: ${data.answer.toUpperCase()}`, "success");
    else if (data.status === "lost") notify(`No attempts remaining. Answer: ${data.answer.toUpperCase()}`, "error");
    else notify(`${data.remainingAttempts} attempts remaining.`);
    paint();
  } catch (error) { notify(error.message, "error"); }
  finally { state.busy = false; }
}
async function resume() {
  const saved = JSON.parse(localStorage.getItem("speedle:session") || "null");
  if (!saved?.token) return notify("No saved game token found.");
  $("dictionary").value = saved.dictionary;
  try {
    const data = await request(url(saved.dictionary, "game/resume"), {
      method: "POST", body: JSON.stringify({ token: saved.token })
    });
    state.game = data;
    state.token = saved.token;
    state.current = "";
    paint();
    notify("Saved game restored.", "success");
  } catch (error) { notify(error.message, "error"); }
}
async function validateWord() {
  const word = $("utilityWord").value.trim();
  if (!word) return notify("Enter a word to validate.", "error");
  try {
    const data = await request(`${url($("dictionary").value, `words/validate/${encodeURIComponent(word)}`)}?length=${word.length}&profanity=${$("profanity").value}`);
    notify(data.valid ? "Word is accepted." : "Word is not accepted.", data.valid ? "success" : "error");
  } catch (error) { notify(error.message, "error"); }
}
async function randomWord() {
  try {
    const data = await request(`${url($("dictionary").value, "words/random")}?length=${config().length}&profanity=${config().profanity}`);
    $("utilityWord").value = data.word;
    notify(`Random ${data.length}-letter word retrieved.`);
  } catch (error) { notify(error.message, "error"); }
}
async function apiHealth() {
  try {
    const data = await request(`${apiBase()}/health`);
    notify(data.ok ? "API is healthy." : "API health check failed.", data.ok ? "success" : "error");
  } catch (error) { notify(error.message, "error"); }
}
function setDisplay() {
  document.body.classList.toggle("no-colors", !$("colorFeedback").checked);
  document.body.classList.toggle("high-contrast", $("highContrast").checked);
  $("keyboard").hidden = !$("keyboardEnabled").checked;
  paint();
}
$("newGame").addEventListener("click", () => start("unlimited"));
$("dailyGame").addEventListener("click", () => start("daily"));
$("resume").addEventListener("click", resume);
$("validateWord").addEventListener("click", validateWord);
$("randomWord").addEventListener("click", randomWord);
$("health").addEventListener("click", apiHealth);
$("dictionary").addEventListener("change", () => {
  updateDictionaryInfo();
  state.game = null;
  state.token = null;
  state.current = "";
  localStorage.removeItem("speedle:session");
  paint();
  notify("Dictionary changed. Start a new game to apply it.");
});
["length","attempts","hardMode","profanity","answerPolicy","ttl"].forEach(id => {
  $(id).addEventListener("change", () => {
    if (state.game) {
      state.game = null;
      state.token = null;
      state.current = "";
      localStorage.removeItem("speedle:session");
      paint();
      notify("Game settings changed. Start a new game to apply them.");
    }
  });
});
$("settings").addEventListener("change", event => {
  if (event.target.matches("#colorFeedback,#highContrast,#keyboardEnabled,#tileLabels")) setDisplay();
});
$("settings").addEventListener("input", event => {
  if (event.target.matches("#length,#attempts")) {
    $("lengthValue").textContent = $("length").value;
    $("attemptsValue").textContent = $("attempts").value;
  }
});
$("refresh").addEventListener("click", () => loadDictionaries().catch(e => notify(e.message, "error")));
$("settingsOpen").addEventListener("click", () => $("settingsDialog").showModal());
$("settingsClose").addEventListener("click", () => $("settingsDialog").close());
$("settingsDialog").addEventListener("click", event => {
  if (event.target === $("settingsDialog")) $("settingsDialog").close();
});
$("apiBase").addEventListener("change", () => loadDictionaries().catch(e => notify(e.message, "error")));
document.addEventListener("keydown", event => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (/^[a-z]$/i.test(event.key)) type(event.key);
  else if (event.key === "Backspace") backspace();
  else if (event.key === "Enter") submit();
});
loadDictionaries().then(() => {
  const saved = JSON.parse(localStorage.getItem("speedle:session") || "null");
  if (saved?.token) resume();
  else start("unlimited");
}).catch(error => notify(`API unavailable: ${error.message}`, "error"));
