const API = "/api/v1";
const cache = new Map();
const dictionaryCache = new Map();
const availabilityCache = new Map();
const REMOTE_CACHE_SECONDS = 86400;

export function normalizeWord(value, language = "en") {
  try { return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase(language); }
  catch { return String(value ?? "").normalize("NFKC").trim().toLowerCase(); }
}
function wordLength(word) { return Array.from(word).length; }

export function evaluateGuess(guess, answer) {
  const letters = Array.from(guess);
  const answerLetters = Array.from(answer);
  const result = Array(letters.length).fill("absent");
  const remaining = new Map();
  for (let i = 0; i < answerLetters.length; i++) {
    if (letters[i] === answerLetters[i]) result[i] = "correct";
    else remaining.set(answerLetters[i], (remaining.get(answerLetters[i]) || 0) + 1);
  }
  for (let i = 0; i < letters.length; i++) {
    if (result[i] === "correct") continue;
    const count = remaining.get(letters[i]) || 0;
    if (count > 0) { result[i] = "present"; remaining.set(letters[i], count - 1); }
  }
  return result;
}

export function validateHardMode(guess, history) {
  const requiredCounts = new Map();
  const fixed = new Map();

  for (const entry of history) {
    const counts = new Map();
    const wordLetters = Array.from(entry.word);
    for (let i = 0; i < wordLetters.length; i++) {
      const letter = wordLetters[i];
      const result = entry.result[i];
      if (result === "correct") fixed.set(i, letter);
      if (result === "correct" || result === "present") {
        counts.set(letter, (counts.get(letter) || 0) + 1);
      }
    }
    for (const [letter, count] of counts) {
      requiredCounts.set(letter, Math.max(requiredCounts.get(letter) || 0, count));
    }
  }

  for (const [position, letter] of fixed) {
    if (guess[position] !== letter) {
      return { valid: false, reason: "GREEN_LETTER", message: "Previously revealed green letters must remain in their positions." };
    }
  }

  for (const [letter, count] of requiredCounts) {
    const supplied = Array.from(guess).filter(char => char === letter).length;
    if (supplied < count) {
      return { valid: false, reason: "REQUIRED_LETTER", message: `Your guess must contain at least ${count} occurrence(s) of '${letter}'.` };
    }
  }

  // Yellow letters cannot remain in the exact position where they were yellow.
  for (const entry of history) {
    const wordLetters = Array.from(entry.word);
    const guessLetters = Array.from(guess);
    for (let i = 0; i < wordLetters.length; i++) {
      if (entry.result[i] === "present" && guessLetters[i] === wordLetters[i]) {
        return { valid: false, reason: "YELLOW_POSITION", message: "Previously revealed yellow letters cannot remain in the same position." };
      }
    }
  }
  return { valid: true };
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": "no-store",
      ...extra
    }
  });
}
function fail(code, message, status = 400, details) {
  return json({ error: { code, message, ...(details ? { details } : {}) } }, status);
}
function validShape(word) {
  return /^[\p{L}]+$/u.test(word);
}
function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function unbase64url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}
async function getKey(secret) {
  if (!secret || secret.length < 32) throw new Error("GAME_SECRET must be at least 32 characters.");
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encryptState(state, secret) {
  const key = await getKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode("speedle:v1") },
    key,
    new TextEncoder().encode(JSON.stringify(state))
  );
  const packed = new Uint8Array(iv.length + ciphertext.byteLength);
  packed.set(iv);
  packed.set(new Uint8Array(ciphertext), iv.length);
  return base64url(packed);
}
async function decryptState(token, secret) {
  try {
    const packed = unbase64url(token);
    if (packed.length < 29) throw new Error("Invalid token.");
    const key = await getKey(secret);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: packed.slice(0, 12), additionalData: new TextEncoder().encode("speedle:v1") },
      key,
      packed.slice(12)
    );
    const state = JSON.parse(new TextDecoder().decode(plain));
    if (state.v !== 1 || !state.id || !state.settings) throw new Error("Invalid token.");
    if (Date.now() - state.issuedAt > state.ttlMs) throw new Error("Token expired.");
    return state;
  } catch {
    throw new Error("Invalid or expired game token.");
  }
}
async function asset(env, path) {
  if (!env.ASSETS) return null;
  const response = await env.ASSETS.fetch(new Request(`https://speedle-assets.invalid${path}`));
  if (!response.ok) return null;
  return response.json();
}
function wordList(value) {
  // Accept the common JSON shapes used by imported word lists.
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(/[\s,;]+/).filter(Boolean);
  if (value && typeof value === "object") {
    if (Array.isArray(value.words)) return value.words;
    if (Array.isArray(value.list)) return value.list;
    return Object.keys(value).filter(key => value[key] !== false && value[key] != null);
  }
  return [];
}
const REMOTE_DICTIONARIES = {
  "wordle-list": {
    url: "https://raw.githubusercontent.com/tabatkins/wordle-list/main/words",
    language: "en", format: "lines", answersFrom: "wordle"
  },
  english: {
    url: "https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt",
    language: "en", format: "lines"
  },
  enable: {
    url: "https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt",
    language: "en", format: "lines"
  },
  unix: {
    url: "https://raw.githubusercontent.com/dolph/dictionary/master/unix-words",
    language: "en", format: "lines"
  },
  sowpods: {
    url: "https://raw.githubusercontent.com/FlandersBurger/scrabble-dictionary/main/en/sowpods.txt",
    language: "en", format: "lines"
  },
  twl: {
    url: "https://raw.githubusercontent.com/FlandersBurger/scrabble-dictionary/main/en/twl.txt",
    language: "en", format: "lines"
  },
  "wordle-es": {
    url: "https://raw.githubusercontent.com/FlandersBurger/scrabble-dictionary/main/es/file2017.txt",
    language: "es", format: "lines"
  },
  "wordle-fr": {
    url: "https://raw.githubusercontent.com/FlandersBurger/scrabble-dictionary/main/fr/ods8.txt",
    language: "fr", format: "lines"
  },
  "wordle-de": {
    url: "https://raw.githubusercontent.com/FlandersBurger/scrabble-dictionary/main/de/wordlist.txt",
    language: "de", format: "lines"
  },
  "wordle-it": {
    url: "https://raw.githubusercontent.com/FlandersBurger/scrabble-dictionary/main/it/zinga.txt",
    language: "it", format: "lines"
  },
  "wordle-pt": {
    url: "https://raw.githubusercontent.com/FlandersBurger/scrabble-dictionary/main/pt/wordlist.txt",
    language: "pt", format: "lines"
  },
  "wordle-nl": {
    url: "https://raw.githubusercontent.com/FlandersBurger/scrabble-dictionary/main/nl/letterlicious.txt",
    language: "nl", format: "lines"
  },
  "wordle-pl": {
    url: "https://raw.githubusercontent.com/FlandersBurger/scrabble-dictionary/main/pl/sjp.txt",
    language: "pl", format: "lines"
  },
  "wordle-tr": {
    url: "https://raw.githubusercontent.com/FlandersBurger/scrabble-dictionary/main/tr/kelimelik.txt",
    language: "tr", format: "lines"
  }
};

async function fetchRemoteText(url) {
  const request = new Request(url, { headers: { "accept": "text/plain" } });
  const edgeCache = globalThis.caches?.default;
  if (edgeCache) {
    try {
      const cached = await edgeCache.match(request);
      if (cached) return cached.text();
    } catch { /* Fall through to the upstream fetch. */ }
  }
  const response = await fetch(request);
  if (!response.ok) throw new Error(`Dictionary source returned HTTP ${response.status}.`);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > 12 * 1024 * 1024) throw new Error("Dictionary source exceeds the 12 MB limit.");
  const text = await response.text();
  if (!text || text.length > 12 * 1024 * 1024) throw new Error("Dictionary source is empty or too large.");
  if (edgeCache) {
    try {
      await edgeCache.put(request, new Response(text, { headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": `public, max-age=${REMOTE_CACHE_SECONDS}`
      }}));
    } catch { /* Cache failures must not make a healthy upstream unavailable. */ }
  }
  return text;
}
function parseRemoteWords(text, language) {
  const words = text.split(/[\r\n\t ,;]+/)
    .map(value => normalizeWord(value, language))
    .filter(value => value && validShape(value) && wordLength(value) <= 32);
  return [...new Set(words)];
}
async function loadDictionary(env, id) {
  const local = await asset(env, `/dictionaries/${id}.json`);
  if (local && typeof local === "object") return local;
  const source = REMOTE_DICTIONARIES[id];
  if (!source) return null;
  const raw = await fetchRemoteText(source.url);
  const words = parseRemoteWords(raw, source.language);
  if (!words.length) throw new Error(`Dictionary '${id}' returned no usable words.`);
  let answers = words;
  if (source.answersFrom === "wordle") {
    const answerData = await asset(env, `/dictionaries/${source.answersFrom}.json`);
    answers = wordList(answerData?.answers).map(word => normalizeWord(word, source.language));
  }
  return {
    id, name: id, language: source.language,
    description: `Live word list proxied from GitHub raw content.`,
    source: source.url, guesses: words, answers: answers.length ? answers : words
  };
}
async function dictionary(env, id) {
  if (!/^[a-z0-9-]{1,48}$/.test(id)) return null;
  if (dictionaryCache.has(id)) {
    const value = dictionaryCache.get(id);
    dictionaryCache.delete(id); dictionaryCache.set(id, value);
    return value;
  }
  let data;
  try { data = await loadDictionary(env, id); }
  catch { return null; }
  if (!data || typeof data !== "object") return null;
  const language = data.language || REMOTE_DICTIONARIES[id]?.language || "en";
  const guesses = [...new Set(wordList(data.guesses ?? data.validGuesses ?? data.words)
    .map(word => normalizeWord(word, language)).filter(word => word && validShape(word)))];
  const answers = [...new Set(wordList(data.answers ?? data.answerWords)
    .map(word => normalizeWord(word, language)).filter(word => word && validShape(word)))];
  if (!guesses.length || !answers.length) return null;
  const value = { ...data, language, guesses: new Set(guesses), answers };
  dictionaryCache.set(id, value);
  while (dictionaryCache.size > 2) dictionaryCache.delete(dictionaryCache.keys().next().value);
  return value;
}
async function probeDictionary(env, id) {
  const cached = availabilityCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const local = await asset(env, `/dictionaries/${id}.json`);
  if (local && typeof local === "object") {
    const value = await dictionary(env, id);
    const result = value ? {
      available: true, remote: false,
      answerCount: value.answers.length, guessCount: value.guesses.size,
      lengths: [...new Set([...value.guesses].map(wordLength))].sort((a,b) => a-b)
    } : { available: false, remote: false };
    availabilityCache.set(id, { value: result, expiresAt: Date.now() + 15 * 60 * 1000 });
    return result;
  }
  const source = REMOTE_DICTIONARIES[id];
  if (!source) return { available: false, remote: false };
  let available = false;
  try {
    const response = await fetch(source.url, { method: "HEAD", headers: { "accept": "text/plain" } });
    available = response.ok;
  } catch { available = false; }
  const result = { available, remote: true, source: source.url };
  availabilityCache.set(id, { value: result, expiresAt: Date.now() + 15 * 60 * 1000 });
  return result;
}

async function profanityWords(env) {
  if (cache.has("profanity")) return cache.get("profanity");
  const data = await asset(env, "/filters/profanity.json");
  const words = new Set((data?.words || []).map(word => normalizeWord(word)));
  cache.set("profanity", words);
  return words;
}
function settingsFrom(body, query, dictionaryId) {
  const length = Number(body.length ?? query.get("length") ?? 5);
  const maxAttempts = Number(body.maxAttempts ?? query.get("maxAttempts") ?? 6);
  const hardMode = body.hardMode ?? (query.get("hardMode") === "true");
  const profanity = String(body.profanity ?? query.get("profanity") ?? "strict");
  const answerPolicy = String(body.answerPolicy ?? query.get("answerPolicy") ?? "curated");
  const tokenTtlHours = Number(body.tokenTtlHours ?? query.get("tokenTtlHours") ?? 24);
  if (!Number.isInteger(length) || length < 2 || length > 15) throw new Error("length must be an integer from 2 to 15.");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new Error("maxAttempts must be an integer from 1 to 20.");
  if (typeof hardMode !== "boolean") throw new Error("hardMode must be a boolean.");
  if (!["strict", "off"].includes(profanity)) throw new Error("profanity must be 'strict' or 'off'.");
  if (!["curated", "all-valid"].includes(answerPolicy)) throw new Error("answerPolicy must be 'curated' or 'all-valid'.");
  if (!Number.isFinite(tokenTtlHours) || tokenTtlHours < 1 || tokenTtlHours > 168) throw new Error("tokenTtlHours must be between 1 and 168.");
  return { dictionary: dictionaryId, length, maxAttempts, hardMode, profanity, answerPolicy, tokenTtlHours };
}
function choose(pool, seed) {
  if (!pool.length) return null;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return pool[(hash >>> 0) % pool.length];
}
function publicGame(state, token) {
  const finished = state.status !== "playing";
  return {
    gameId: state.id,
    dictionary: state.settings.dictionary,
    mode: state.mode,
    date: state.date,
    length: state.settings.length,
    maxAttempts: state.settings.maxAttempts,
    hardMode: state.settings.hardMode,
    profanity: state.settings.profanity,
    answerPolicy: state.settings.answerPolicy,
    guesses: state.guesses,
    attemptsUsed: state.guesses.length,
    remainingAttempts: Math.max(0, state.settings.maxAttempts - state.guesses.length),
    status: state.status,
    ...(finished ? { answer: state.answer } : {}),
    token
  };
}
async function createGame(env, id, settings, mode) {
  const dict = await dictionary(env, id);
  if (!dict) return { response: fail("DICTIONARY_NOT_FOUND", `Dictionary '${id}' is unavailable.`, 404) };
  const blocked = await profanityWords(env);
  const source = settings.answerPolicy === "all-valid" ? [...dict.guesses] : dict.answers;
  const pool = source.filter(word =>
    wordLength(word) === settings.length &&
    validShape(word) &&
    (settings.profanity === "off" || !blocked.has(word))
  );
  if (!pool.length) return { response: fail("NO_ANSWERS", "No eligible answer words exist for these settings.", 422) };
  const date = new Date().toISOString().slice(0, 10);
  const answer = mode === "daily"
    ? choose(pool, `${id}:${settings.length}:${settings.answerPolicy}:${date}`)
    : pool[crypto.getRandomValues(new Uint32Array(1))[0] % pool.length];
  const issuedAt = Date.now();
  const state = {
    v: 1,
    id: crypto.randomUUID(),
    mode,
    answer,
    guesses: [],
    settings,
    status: "playing",
    date: mode === "daily" ? date : null,
    issuedAt,
    ttlMs: settings.tokenTtlHours * 60 * 60 * 1000
  };
  const token = await encryptState(state, env.GAME_SECRET);
  return { data: publicGame(state, token) };
}

const REGISTRY = [
  ["wordle", "Wordle curated", "en", "Five-letter curated answer list"],
  ["wordle-list", "Wordle accepted guesses", "en", "Five-letter accepted guess vocabulary"],
  ["english", "English (dwyl)", "en", "Large general English vocabulary"],
  ["enable", "ENABLE", "en", "English word-game vocabulary"],
  ["sowpods", "SOWPODS", "en", "Collins international Scrabble vocabulary"],
  ["twl", "TWL", "en", "North American Scrabble vocabulary"],
  ["unix", "Unix words", "en", "Unix word-list vocabulary"],
  ["wordle-es", "Spanish", "es", "Spanish word-game vocabulary"],
  ["wordle-fr", "French", "fr", "French word-game vocabulary"],
  ["wordle-de", "German", "de", "German word-game vocabulary"],
  ["wordle-it", "Italian", "it", "Italian word-game vocabulary"],
  ["wordle-pt", "Portuguese", "pt", "Portuguese word-game vocabulary"],
  ["wordle-nl", "Dutch", "nl", "Dutch word-game vocabulary"],
  ["wordle-sv", "Wordle Swedish", "sv", "Swedish word-game vocabulary"],
  ["wordle-pl", "Polish", "pl", "Polish word-game vocabulary"],
  ["wordle-fi", "Wordle Finnish", "fi", "Finnish word-game vocabulary"],
  ["wordle-tr", "Turkish", "tr", "Turkish word-game vocabulary"]
];

async function route(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
    "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  }});
  const parts = url.pathname.slice(API.length).split("/").filter(Boolean);
  if (!parts.length && request.method === "GET") {
    return json({ name: "Speedle API", version: "1.3.0", base: API, docs: `${API}/docs`, frontend: "/" });
  }
  if (parts[0] === "health" && request.method === "GET") {
    return json({ ok: true, service: "speedle-api", version: "1.3.0", timestamp: new Date().toISOString() });
  }
  if (parts[0] === "config" && request.method === "GET") {
    return json({
      wordLength: { min: 2, max: 15, default: 5 },
      maxAttempts: { min: 1, max: 20, default: 6 },
      tokenTtlHours: { min: 1, max: 168, default: 24 },
      modes: ["daily", "unlimited"],
      profanity: ["strict", "off"],
      answerPolicy: ["curated", "all-valid"],
      hardMode: true,
      stateless: true,
      accounts: false
    });
  }
  if (parts[0] === "dictionaries" && request.method === "GET") {
    // Probe upstream availability without downloading every multi-megabyte list.
    const result = await Promise.all(REGISTRY.map(async ([id, name, language, description]) => {
      try {
        const status = await probeDictionary(env, id);
        return { id, name, language, description, ...status };
      } catch {
        return { id, name, language, description, available: false, remote: Boolean(REMOTE_DICTIONARIES[id]) };
      }
    }));
    return json({ count: result.length, availableCount: result.filter(x => x.available).length, dictionaries: result });
  }
  if (parts[0] === "docs" && request.method === "GET") {
    return json({
      base: API,
      routes: [
        "GET /health", "GET /config", "GET /dictionaries",
        "GET /{dictionary}/info",
        "GET /{dictionary}/words/random?length=5",
        "GET /{dictionary}/words/search?q=cr&length=5&limit=20",
        "GET /{dictionary}/words/validate/{word}",
        "POST /{dictionary}/game/new",
        "POST /{dictionary}/game/daily",
        "POST /{dictionary}/game/guess",
        "POST /{dictionary}/game/resume",
        "POST /{dictionary}/evaluate"
      ],
      token: "AES-GCM authenticated encryption; client must send the newest returned token after each guess.",
      note: "Stateless tokens cannot prevent replay or duplicate daily starts without server-side storage."
    });
  }

  const id = parts[0];
  const dict = await dictionary(env, id);
  if (!dict) return fail("DICTIONARY_NOT_FOUND", `Dictionary '${id}' is unavailable or its upstream source could not be reached.`, 404);
  const action = parts[1];

  if (action === "info" && request.method === "GET") {
    return json({
      id, name: dict.name || id, description: dict.description || "",
      language: dict.language || "en", source: dict.source || "Custom dataset",
      answerCount: dict.answers.length, guessCount: dict.guesses.size,
      lengths: [...new Set([...dict.guesses].map(wordLength))].sort((a,b) => a-b)
    });
  }

  if (action === "words" && parts[2] === "random" && request.method === "GET") {
    const length = Number(url.searchParams.get("length") || 5);
    const filter = url.searchParams.get("profanity") || "strict";
    if (!Number.isInteger(length) || length < 2 || length > 15) return fail("INVALID_LENGTH", "length must be 2–15.");
    if (!["strict", "off"].includes(filter)) return fail("INVALID_FILTER", "profanity must be strict or off.");
    const blocked = await profanityWords(env);
    const pool = [...dict.guesses].filter(w => wordLength(w) === length && (filter === "off" || !blocked.has(w)));
    if (!pool.length) return fail("NO_WORDS", "No words match the requested length and filter.", 404);
    return json({ dictionary: id, word: pool[crypto.getRandomValues(new Uint32Array(1))[0] % pool.length], length });
  }

  if (action === "words" && parts[2] === "search" && request.method === "GET") {
    const q = normalizeWord(url.searchParams.get("q") || "", dict.language);
    const length = Number(url.searchParams.get("length") || 0);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 25)));
    if (!q && !length) return fail("MISSING_QUERY", "Provide q or length.");
    const matches = [...dict.guesses].filter(word =>
      (!q || word.includes(q)) && (!length || wordLength(word) === length)
    ).sort().slice(0, limit);
    return json({ dictionary: id, query: q, length: length || null, count: matches.length, words: matches });
  }

  if (action === "words" && parts[2] === "validate" && parts[3] && request.method === "GET") {
    const word = normalizeWord(parts[3], dict.language);
    const length = Number(url.searchParams.get("length") || word.length);
    const filter = url.searchParams.get("profanity") || "strict";
    const blocked = await profanityWords(env);
    const isBlocked = blocked.has(word);
    const valid = dict.guesses.has(word) && wordLength(word) === length && validShape(word) && (filter === "off" || !isBlocked);
    return json({ dictionary: id, word, valid, length: wordLength(word), ...(isBlocked ? { filtered: true } : {}) });
  }

  if (action === "game" && ["new", "daily"].includes(parts[2]) && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch {}
    let settings;
    try { settings = settingsFrom(body, url.searchParams, id); }
    catch (e) { return fail("INVALID_SETTINGS", e.message); }
    const created = await createGame(env, id, settings, parts[2]);
    return created.response || json(created.data, 201);
  }

  if (action === "game" && parts[2] === "resume" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return fail("INVALID_JSON", "Body must be JSON."); }
    if (!body.token) return fail("MISSING_TOKEN", "token is required.");
    try {
      const state = await decryptState(body.token, env.GAME_SECRET);
      if (state.settings.dictionary !== id) return fail("DICTIONARY_MISMATCH", "Token belongs to another dictionary.", 409);
      return json(publicGame(state, body.token));
    } catch (e) {
      return fail("INVALID_TOKEN", e.message, 401);
    }
  }

  if (action === "game" && parts[2] === "guess" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return fail("INVALID_JSON", "Body must be JSON."); }
    if (!body.token || !body.guess) return fail("MISSING_FIELDS", "token and guess are required.");
    let state;
    try { state = await decryptState(String(body.token), env.GAME_SECRET); }
    catch (e) { return fail("INVALID_TOKEN", e.message, 401); }
    if (state.settings.dictionary !== id) return fail("DICTIONARY_MISMATCH", "Token belongs to another dictionary.", 409);
    if (state.status !== "playing") return fail("GAME_FINISHED", "This game has already finished.", 409);
    const guess = normalizeWord(body.guess, dict.language);
    if (!validShape(guess) || wordLength(guess) !== state.settings.length) {
      return fail("INVALID_GUESS_SHAPE", `Guess must contain exactly ${state.settings.length} letters.`);
    }
    const currentDict = await dictionary(env, id);
    const blocked = await profanityWords(env);
    if (!currentDict.guesses.has(guess) || (state.settings.profanity === "strict" && blocked.has(guess))) {
      return fail("UNKNOWN_WORD", "That word is not accepted by this dictionary.");
    }
    if (state.settings.hardMode) {
      const check = validateHardMode(guess, state.guesses);
      if (!check.valid) return fail("HARD_MODE", check.message, 422, { rule: check.reason });
    }
    const result = evaluateGuess(guess, state.answer);
    state.guesses.push({ word: guess, result });
    if (guess === state.answer) state.status = "won";
    else if (state.guesses.length >= state.settings.maxAttempts) state.status = "lost";
    const token = await encryptState(state, env.GAME_SECRET);
    return json(publicGame(state, token));
  }

  if (action === "evaluate" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return fail("INVALID_JSON", "Body must be JSON."); }
    const guess = normalizeWord(body.guess, dict.language);
    const answer = normalizeWord(body.answer);
    if (!guess || !answer || wordLength(guess) !== wordLength(answer) || !validShape(guess) || !validShape(answer)) {
      return fail("INVALID_INPUT", "guess and answer must be alphabetic words of equal length.");
    }
    return json({ guess, length: wordLength(guess), result: evaluateGuess(guess, answer) });
  }

  return fail("NOT_FOUND", "Endpoint not found.", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith(API)) {
      try { return await route(request, env); }
      catch (error) {
        return fail("INTERNAL_ERROR", "The request could not be completed.", 500, { message: error.message });
      }
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Speedle", { headers: { "content-type": "text/plain" } });
  }
};
