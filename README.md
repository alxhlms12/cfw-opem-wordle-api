# Speedle

A stateless, dictionary-driven Wordle-style REST API and a minimal frontend.

## Included

- Cloudflare Worker REST API.
- Speedle frontend with no animation/transition system.
- Dictionary namespace: `/api/v1/{dictionary}/...`.
- Variable word lengths (2–15) and attempt counts (1–20).
- Daily and unlimited games.
- Hard mode.
- Optional profanity filtering.
- Duplicate-letter-safe Wordle evaluation.
- AES-GCM encrypted stateless game tokens.
- Dictionary importer and profanity-list importer.
- Browser UI settings for API URL, dictionary, mode, word length, attempts, hard mode, profanity, keyboard, feedback colors, contrast, and tile labels.

## Important: first build

The repository includes a small five-letter starter dictionary so the project can run immediately. Import the larger upstream lists before deploying:

```powershell
npm install
npm run dictionaries:build
```

The importer writes datasets into `public/dictionaries/` and merged profanity data into `public/filters/profanity.json`.

Then create `.dev.vars` from `.dev.vars.example` and set a random secret of at least 32 characters.

```powershell
Copy-Item .dev.vars.example .dev.vars
npm run dev
```

Deploy:

```powershell
npx wrangler secret put GAME_SECRET
npm run deploy
```

Use the same secret across all Worker instances. Rotating it invalidates existing game tokens.

## API

Base path: `/api/v1`

| Method | Route | Description |
|---|---|---|
| GET | `/dictionaries` | List dictionaries and import status |
| GET | `/{dictionary}/info` | Dictionary metadata |
| GET | `/{dictionary}/words/random?length=5` | Random accepted word |
| GET | `/{dictionary}/words/validate/{word}` | Validate a guess |
| POST | `/{dictionary}/game/new` | Start unlimited game |
| POST | `/{dictionary}/game/daily` | Start deterministic daily game |
| POST | `/{dictionary}/game/guess` | Submit guess using encrypted token |
| POST | `/{dictionary}/evaluate` | Evaluate a guess against a supplied answer |

Example:

```http
POST /api/v1/wordle/game/new
Content-Type: application/json

{
  "length": 5,
  "maxAttempts": 6,
  "hardMode": false,
  "profanity": "strict"
}
```

A game response contains an encrypted `token`. Send the newest token with each guess:

```json
{
  "token": "RETURNED_TOKEN",
  "guess": "crane"
}
```

The token is AES-GCM encrypted. The answer is not readable by decoding the token. The server does not store game sessions or require accounts. The client must retain the newest token; losing it loses that game.

## Dictionaries

The importer currently includes:

- `wordle`: curated answers + accepted guesses from Atagoxx/wordle-beyond-the-list.
- `wordle-list`: five-letter accepted-guess vocabulary from tabatkins/wordle-list.
- `english`: dwyl/english-words `words_alpha.txt`.
- `enable`: ENABLE1 word list.

The API registry also reserves language-specific IDs for custom imports (`wordle-es`, `wordle-fr`, `wordle-de`, `wordle-it`, `wordle-pt`, `wordle-nl`, `wordle-sv`, `wordle-pl`, `wordle-fi`, `wordle-tr`, `wordle-ja`). They will report unavailable until matching datasets are imported. Japanese requires a tokenizer/normalization strategy beyond the current alphabetic importer.

Do not treat every dictionary word as a suitable puzzle answer. General dictionaries are accepted-guess pools by default; the importer currently uses the same list as the answer pool when no separate answer list is provided. For production, curate answer pools per language and source.

## Profanity sources

`npm run dictionaries:build` attempts to merge:

- LDNOOBW English list (CC BY 4.0).
- coffee-and-fun/google-profanity-words English list (MIT).
- censor-text/profanity-list English list (Unlicense; archived).

The filter is exact-word matching. It is applied to answer selection and guess acceptance. It can produce false positives; `profanity=off` disables it. Review each upstream license and retain attribution in redistributed builds.

## External dictionary lookup providers

The game engine does not call public APIs on each guess. Optional definition/enrichment providers can be added separately:
- Datamuse word-finding API: https://www.datamuse.com/api/
- Free Dictionary API: https://dictionaryapi.dev/
- Tapdict dictionary API: https://tapdict.com/developers
- Merriam-Webster API requires an API key: https://dictionaryapi.com/

Third-party APIs are not authoritative guess validators and should not be in the gameplay critical path.

## Known limitations to address before public production

- Daily puzzles are deterministic by UTC date and dictionary/length; there is no global used-answer history in stateless mode.
- Daily mode is not account-bound and can be replayed by starting a new token.
- Hard mode currently enforces revealed green/yellow letters, but does not yet enforce duplicate-letter count constraints.
- `words/random` returns a word to the caller and should not be used as a secret answer endpoint.
- Word list licensing and source terms vary. Review every dataset before redistribution.
- API rate limiting is not enabled in this starter. Add Cloudflare rate limiting/WAF rules before exposing it publicly.
- For multilingual datasets, update normalization and `validWordShape` to support each language's alphabet and writing system.

## Project structure

```text
speedle/
├── src/index.js
├── scripts/build-dictionaries.mjs
├── public/
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── dictionaries/
│   └── filters/
├── wrangler.toml
└── package.json
```
