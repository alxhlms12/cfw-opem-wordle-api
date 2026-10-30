const API = "/api/v1";
const dictionaryCache = new Map();
const profanityCache = new Map();

const SOURCES = {
  wordle: {
    name: "Wordle",
    description: "Curated five-letter answers and accepted guesses.",
    languages: ["en"],
    lengths: [5],
    source: "Atagoxx/wordle-beyond-the-list (answer and allowed lists)"
  },
  "wordle-list": {
    name: "Wordle accepted words",
    description: "Broad accepted-guess list for five-letter Wordle-style games.",
    languages: ["en"],
    lengths: [5],
    source: "tabatkins/wordle-list"
  },
  english: {
    name: "English",
    description: "Large general English vocabulary.",
    languages: ["en"],
    lengths: "variable",
    source: "dwyl/english-words (words_alpha.txt)"
  },
  enable: {
    name: "ENABLE",
    description: "English word-game vocabulary.",
    languages: ["en"],
    lengths: "variable",
    source: "dolph/dictionary (ENABLE1)"
  },
  "wordle-es": {
    name: "Wordle Spanish",
    description: "Spanish Wordle vocabulary; populated by your selected import source.",
    languages: ["es"],
    lengths: "variable",
    source: "Custom import"
  },
  "wordle-fr": {
    name: "Wordle French",
    description: "French Wordle vocabulary; populated by your selected import source.",
    languages: ["fr"],
    lengths: "variable",
    source: "Custom import"
  },
  "wordle-de": {
    name: "Wordle German",
    description: "German Wordle vocabulary; populated by your selected import source.",
    languages: ["de"],
    lengths: "variable",
    source: "Custom import"
  },
  "wordle-it": {
    name: "Wordle Italian",
    description: "Italian Wordle vocabulary; populated by your selected import source.",
    languages: ["it"],
    lengths: "variable",
    source: "Custom import"
  },
  "wordle-pt": {
    name: "Wordle Portuguese",
    description: "Portuguese Wordle vocabulary; populated by your selected import source.",
    languages: ["pt"],
    lengths: "variable",
    source: "Custom import"
  },
  "wordle-nl": {
    name: "Wordle Dutch",
    description: "Dutch Wordle vocabulary; populated by your selected import source.",
    languages: ["nl"],
    lengths: "variable",
    source: "Custom import"
  },
  "wordle-sv": {
    name: "Wordle Swedish",
    description: "Swedish Wordle vocabulary; populated by your selected import source.",
    languages: ["sv"],
    lengths: "variable",
    source: "Custom import"
  },
  "wordle-pl": {
    name: "Wordle Polish",
    description: "Polish Wordle vocabulary; populated by your selected import source.",
    languages: ["pl"],
    lengths: "variable",
    source: "Custom import"
  },
  "wordle-fi": {
    name: "Wordle Finnish",
    description: "Finnish Wordle vocabulary; populated by your selected import source.",
    languages: ["fi"],
    lengths: "variable",
    source: "Custom import"
  },
  "wordle-tr": {
    name: "Wordle Turkish",
    description: "Turkish Wordle vocabulary; populated by your selected import source.",
    languages: ["tr"],
    lengths: "variable",
    source: "Custom import"
  },
  "wordle-ja": {
    name: "Wordle Japanese",
    description: "Japanese word-game vocabulary; requires a compatible tokenizer/import format.",
    languages: ["ja"],
    lengths: "variable",
    source: "Custom import"
  }
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
      ...headers
    }
  });
}

function error(code, message, status = 400, details) {
  return json({ error: { code, message, ...(details ? { details } : {}) } }, status);
}

function normalizeWord(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function validWordShape(word) {
  return /^[\p{L}]+$/u.test(word);
}

function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function unb64url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function cryptoKey(secret) {
  if (!secret || secret.length < 32) throw new Error("GAME_SECRET must contain at least 32 characters.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(payload, secret) {
  const key = await cryptoKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return b64url(combined);
}

async function unseal(token, secret) {
  try {
    const raw = unb64url(token);
    if (raw.length < 29) throw new Error("short token");
    const key = await cryptoKey(secret);
    const iv = raw.slice(0, 12);
    const ciphertext = raw.slice(12);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error("Invalid or expired game token.");
  }
}

async function assetJson(env, path) {
  const response = await env.ASSETS.fetch(new Request(new URL(path, "https://speedle-assets.invalid")));
  if (!response.ok) return null;
  return response.json();
}

async function getDictionary(env, id) {
  if (!/^[a-z0-9-]{1,48}$/.test(id)) return null;
  if (dictionaryCache.has(id)) return dictionaryCache.get(id);
  const data = await assetJson(env, `/dictionaries/${id}.json`);
  if (!data || !Array.isArray(data.guesses) || !Array.isArray(data.answers)) return null;
  const dictionary = {
    ...data,
    guesses: new Set(data.guesses.map(normalizeWord)),
    answers: data.answers.map(normalizeWord)
  };
  dictionaryCache.set(id, dictionary);
  return dictionary;
}

async function getProfanity(env) {
  if (profanityCache.has("all")) return profanityCache.get("all");
  const data = await assetJson(env, "/filters/profanity.json");
  const words = new Set((data?.words || []).map(normalizeWord).filter(Boolean));
  profanityCache.set("all", words);
  return words;
}

function evaluateGuess(guess, answer) {
  const result = Array(guess.length).fill("absent");
  const remaining = new Map();

  for (let i = 0; i < answer.length; i++) {
    if (guess[i] === answer[i]) result[i] = "correct";
    else remaining.set(answer[i], (remaining.get(answer[i]) || 0) + 1);
  }

  for (let i = 0; i < guess.length; i++) {
    if (result[i] === "correct") continue;
    const count = remaining.get(guess[i]) || 0;
    if (count > 0) {
      result[i] = "present";
      remaining.set(guess[i], count - 1);
    }
  }
  return result;
}

function choose(pool, seed) {
  if (!pool.length) throw new Error("No eligible answer words exist for this dictionary and length.");
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return pool[(hash >>> 0) % pool.length];
}

function filterPool(words, profanity, mode) {
  if (mode === "off") return words;
  return words.filter(word => !profanity.has(normalizeWord(word)));
}

function getSettings(body, dictionaryId, url) {
  const params = url.searchParams;
  const length = Number(body.length ?? params.get("length") ?? 5);
  const maxAttempts = Number(body.maxAttempts ?? params.get("maxAttempts") ?? 6);
  const profanity = String(body.profanity ?? params.get("profanity") ?? "strict");
  const hardMode = Boolean(body.hardMode ?? params.get("hardMode") === "true");
  if (!Number.isInteger(length) || length < 2 || length > 15) throw new Error("length must be an integer from 2 to 15.");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new Error("maxAttempts must be an integer from 1 to 20.");
  if (!["strict", "off"].includes(profanity)) throw new Error("profanity must be 'strict' or 'off'.");
  return { dictionary: dictionaryId, length, maxAttempts, profanity, hardMode };
}

async function createGame(env, dictionaryId, settings, mode) {
  const dictionary = await getDictionary(env, dictionaryId);
  if (!dictionary) return { response: error("DICTIONARY_NOT_FOUND", `Dictionary '${dictionaryId}' is unavailable.`, 404) };

  const profanity = await getProfanity(env);
  const pool = filterPool(dictionary.answers, profanity, settings.profanity)
    .filter(word => word.length === settings.length && validWordShape(word));

  if (!pool.length) return { response: error("NO_ANSWERS", "No answer words are available for this dictionary, length, and filter configuration.", 422) };

  const date = new Date().toISOString().slice(0, 10);
  const answer = mode === "daily"
    ? choose(pool, `${dictionaryId}:${settings.length}:${date}`)
    : pool[crypto.getRandomValues(new Uint32Array(1))[0] % pool.length];

  const state = {
    v: 1,
    id: crypto.randomUUID(),
    mode,
    answer,
    guesses: [],
    settings,
    status: "playing",
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + (Number(env.TOKEN_TTL_SECONDS || 86400) * 1000),
    date: mode === "daily" ? date : null
  };

  const token = await seal(state, env.GAME_SECRET);
  return { data: publicState(state, token, true) };
}

function publicState(state, token, includeToken = false) {
  return {
    gameId: state.id,
    dictionary: state.settings.dictionary,
    mode: state.mode,
    date: state.date,
    length: state.settings.length,
    maxAttempts: state.settings.maxAttempts,
    hardMode: state.settings.hardMode,
    profanity: state.settings.profanity,
    guesses: state.guesses,
    attemptsUsed: state.guesses.length,
    remainingAttempts: Math.max(0, state.settings.maxAttempts - state.guesses.length),
    status: state.status,
    ...(state.status === "won" || state.status === "lost" ? { answer: state.answer } : {}),
    ...(includeToken ? { token } : {})
  };
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.slice(API.length).split("/").filter(Boolean);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  }});

  if (!parts.length && request.method === "GET") {
    return json({ name: "Speedle API", version: "1.0.0", docs: `${API}/docs`, dictionaries: `${API}/dictionaries` });
  }

  if (parts[0] === "health" && request.method === "GET") {
    return json({ ok: true, service: "speedle-api", timestamp: new Date().toISOString() });
  }

  if (parts[0] === "dictionaries" && request.method === "GET") {
    const items = [];
    for (const [id, meta] of Object.entries(SOURCES)) {
      const data = await getDictionary(env, id);
      items.push({ id, ...meta, available: Boolean(data), ...(data ? {
        answerCount: data.answers.length,
        guessCount: data.guesses.size,
        availableLengths: [...new Set(data.guesses.map(w => w.length))].sort((a,b) => a-b)
      } : {}) });
    }
    return json({ dictionaries: items });
  }

  if (parts[0] === "docs" && request.method === "GET") {
    return json({
      base: API,
      routes: [
        "GET /dictionaries",
        "GET /:dictionary/info",
        "GET /:dictionary/words/random?length=5",
        "GET /:dictionary/words/validate/:word?length=5",
        "POST /:dictionary/game/new",
        "POST /:dictionary/game/daily",
        "POST /:dictionary/game/guess",
        "POST /:dictionary/evaluate"
      ],
      gameToken: "AES-GCM encrypted, stateless token; store the returned token client-side and send it with each guess.",
      settings: { length: "2..15", maxAttempts: "1..20", hardMode: "boolean", profanity: ["strict", "off"] }
    });
  }

  const dictionaryId = parts[0];
  const action = parts[1];
  const dictionary = await getDictionary(env, dictionaryId);
  if (!dictionary) return error("DICTIONARY_NOT_FOUND", `Dictionary '${dictionaryId}' is unavailable or not imported.`, 404);

  if (action === "info" && request.method === "GET") {
    return json({
      id: dictionaryId,
      name: dictionary.name || SOURCES[dictionaryId]?.name || dictionaryId,
      description: dictionary.description || SOURCES[dictionaryId]?.description || "",
      language: dictionary.language || "en",
      source: dictionary.source || SOURCES[dictionaryId]?.source || "Custom",
      answerCount: dictionary.answers.length,
      guessCount: dictionary.guesses.size,
      availableLengths: [...new Set([...dictionary.guesses].map(w => w.length))].sort((a,b) => a-b)
    });
  }

  if (action === "words" && parts[2] === "random" && request.method === "GET") {
    const length = Number(url.searchParams.get("length") || 5);
    const profanityMode = url.searchParams.get("profanity") || "strict";
    if (!Number.isInteger(length) || length < 2 || length > 15) return error("INVALID_LENGTH", "length must be from 2 to 15.");
    const profanity = await getProfanity(env);
    const pool = filterPool(dictionary.guesses, profanity, profanityMode).filter(w => w.length === length);
    if (!pool.length) return error("NO_WORDS", "No words match the requested length and filter.", 404);
    return json({ dictionary: dictionaryId, word: pool[crypto.getRandomValues(new Uint32Array(1))[0] % pool.length], length });
  }

  if (action === "words" && parts[2] === "validate" && parts[3] && request.method === "GET") {
    const word = normalizeWord(parts[3]);
    const length = Number(url.searchParams.get("length") || word.length);
    const profanityMode = url.searchParams.get("profanity") || "strict";
    const profanity = await getProfanity(env);
    const isProfane = profanity.has(word);
    const valid = dictionary.guesses.has(word) && word.length === length && validWordShape(word) && (profanityMode === "off" || !isProfane);
    return json({ dictionary: dictionaryId, word, valid, length: word.length, ...(isProfane ? { filtered: true } : {}) });
  }

  if (action === "game" && (parts[2] === "new" || parts[2] === "daily") && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch {}
    let settings;
    try { settings = getSettings(body, dictionaryId, url); }
    catch (e) { return error("INVALID_SETTINGS", e.message); }
    const result = await createGame(env, dictionaryId, settings, parts[2] === "daily" ? "daily" : "unlimited");
    return result.response || json(result.data, 201);
  }

  if (action === "game" && parts[2] === "guess" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return error("INVALID_JSON", "Request body must be valid JSON."); }
    if (!body.token || !body.guess) return error("MISSING_FIELDS", "Both token and guess are required.");
    let state;
    try { state = await unseal(String(body.token), env.GAME_SECRET); }
    catch (e) { return error("INVALID_TOKEN", e.message, 401); }
    if (state.expiresAt && Date.now() > state.expiresAt) return error("TOKEN_EXPIRED", "This game token has expired. Start a new game.", 401);
    if (state.settings.dictionary !== dictionaryId) return error("TOKEN_DICTIONARY_MISMATCH", "Use the dictionary namespace that created this game token.", 400);
    if (state.status !== "playing") return error("GAME_FINISHED", "This game has already finished.", 409);
    const guess = normalizeWord(body.guess);
    if (!validWordShape(guess) || guess.length !== state.settings.length) {
      return error("INVALID_GUESS_SHAPE", `Guess must contain exactly ${state.settings.length} letters.`);
    }
    const dict = await getDictionary(env, state.settings.dictionary);
    const profanity = await getProfanity(env);
    if (!dict?.guesses.has(guess) || (state.settings.profanity !== "off" && profanity.has(guess))) {
      return error("UNKNOWN_WORD", "That word is not accepted by this dictionary.");
    }

    if (state.settings.hardMode && state.guesses.length) {
      const previous = state.guesses.map(g => ({ word: g.word, result: g.result }));
      for (let i = 0; i < previous.length; i++) {
        for (let j = 0; j < guess.length; j++) {
          if (previous[i].result[j] === "correct" && guess[j] !== previous[i].word[j]) {
            return error("HARD_MODE", "Hard mode requires previously revealed green letters to remain in place.");
          }
          if (previous[i].result[j] === "present" && !guess.includes(previous[i].word[j])) {
            return error("HARD_MODE", "Hard mode requires previously revealed yellow letters to be included.");
          }
        }
      }
    }

    const result = evaluateGuess(guess, state.answer);
    state.guesses.push({ word: guess, result });
    if (guess === state.answer) state.status = "won";
    else if (state.guesses.length >= state.settings.maxAttempts) state.status = "lost";
    const token = await seal(state, env.GAME_SECRET);
    return json(publicState(state, token, true));
  }

  if (action === "evaluate" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return error("INVALID_JSON", "Request body must be valid JSON."); }
    const guess = normalizeWord(body.guess);
    const answer = normalizeWord(body.answer);
    if (!guess || !answer || guess.length !== answer.length || !validWordShape(guess) || !validWordShape(answer)) {
      return error("INVALID_INPUT", "guess and answer must be alphabetic words of equal length.");
    }
    return json({ guess, length: guess.length, result: evaluateGuess(guess, answer) });
  }

  return error("NOT_FOUND", "Endpoint not found.", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith(API)) {
      try {
        return await handleApi(request, env);
      } catch (e) {
        return error("INTERNAL_ERROR", "The request could not be completed.", 500, { message: e.message });
      }
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Speedle API", { headers: { "content-type": "text/plain" } });
  }
};
