import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public", "dictionaries");
const FILTER_OUT = path.join(ROOT, "public", "filters");
await mkdir(OUT, { recursive: true });
await mkdir(FILTER_OUT, { recursive: true });

const SOURCES = [
  {
    id: "wordle",
    name: "Wordle",
    language: "en",
    description: "Curated five-letter answers and accepted guesses.",
    answers: "https://raw.githubusercontent.com/Atagoxx/wordle-beyond-the-list/main/data/answers.txt",
    guesses: "https://raw.githubusercontent.com/Atagoxx/wordle-beyond-the-list/main/data/allowed.txt"
  },
  {
    id: "wordle-list",
    name: "Wordle accepted words",
    language: "en",
    description: "Five-letter accepted-guess list.",
    guesses: "https://raw.githubusercontent.com/tabatkins/wordle-list/main/words",
    answers: "https://raw.githubusercontent.com/Atagoxx/wordle-beyond-the-list/main/data/answers.txt"
  },
  {
    id: "english",
    name: "English",
    language: "en",
    description: "Large general English vocabulary.",
    guesses: "https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt"
  },
  {
    id: "enable",
    name: "ENABLE",
    language: "en",
    description: "English word-game vocabulary.",
    guesses: "https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt"
  }
];

const PROFANITY_SOURCES = [
  {
    id: "ldnoobw-en",
    url: "https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en"
  },
  {
    id: "google-profanity-en",
    url: "https://raw.githubusercontent.com/coffee-and-fun/google-profanity-words/main/data/en.txt"
  },
  {
    id: "censor-text-en",
    url: "https://raw.githubusercontent.com/censor-text/profanity-list/main/list/en.txt"
  }
];

function parseLines(text) {
  return [...new Set(text.split(/\r?\n/).map(x => x.normalize("NFKC").trim().toLocaleLowerCase("en-US"))
    .filter(x => x && !x.startsWith("#") && /^[a-z]+$/.test(x)))];
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": "Speedle-Dictionary-Builder/1.0" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.text();
}

for (const source of SOURCES) {
  try {
    const guessRaw = await fetchText(source.guesses);
    const guesses = parseLines(guessRaw);
    const answerRaw = source.answers ? await fetchText(source.answers) : guessRaw;
    const answers = parseLines(answerRaw).filter(word => guesses.includes(word));
    if (!guesses.length || !answers.length) throw new Error("Source returned an empty list.");
    const data = {
      id: source.id,
      name: source.name,
      language: source.language,
      description: source.description,
      source: [source.guesses, source.answers].filter(Boolean),
      importedAt: new Date().toISOString(),
      guesses,
      answers
    };
    await writeFile(path.join(OUT, `${source.id}.json`), JSON.stringify(data));
    console.log(`${source.id}: ${answers.length} answers, ${guesses.length} guesses`);
  } catch (error) {
    console.error(`Skipping ${source.id}: ${error.message}`);
  }
}

const profanity = new Set();
for (const source of PROFANITY_SOURCES) {
  try {
    const words = parseLines(await fetchText(source.url));
    words.forEach(word => profanity.add(word));
    console.log(`${source.id}: ${words.length} terms`);
  } catch (error) {
    console.error(`Could not import ${source.id}: ${error.message}`);
  }
}
await writeFile(path.join(FILTER_OUT, "profanity.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  sources: PROFANITY_SOURCES,
  words: [...profanity]
}));
console.log(`Profanity filter: ${profanity.size} unique terms`);
