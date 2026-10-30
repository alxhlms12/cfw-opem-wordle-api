# Speedle 1.1

Speedle is a dictionary-driven, stateless Wordle-style REST API and a minimal frontend for Cloudflare Workers.

## Run

```powershell
npm install
npm run dictionaries:build
Copy-Item .dev.vars.example .dev.vars
```

Set `GAME_SECRET` in `.dev.vars` to a random secret with at least 32 characters.

```powershell
npm run dev
```

Deploy:

```powershell
npx wrangler secret put GAME_SECRET
npm run deploy
```

## Features

### API
- Dictionary namespaces: `/api/v1/{dictionary}/...`
- Stateless AES-GCM encrypted game tokens.
- Daily and unlimited games.
- Variable word lengths: 2–15.
- Configurable attempts: 1–20.
- Hard mode with green-position, yellow-position, and revealed-letter-count constraints.
- Configurable answer pool: curated answers or all accepted words.
- Configurable token lifetime: 1–168 hours.
- Duplicate-letter-safe feedback.
- Word validation, random words, dictionary search, metadata, and health/config endpoints.
- CORS and consistent JSON errors.
- No accounts, D1, KV, or Durable Objects required.

### Frontend
- Responsive desktop/mobile layout.
- Instant, animation-free interactions.
- API base URL override.
- Dictionary selection and metadata.
- Daily/unlimited modes.
- Word length, attempt count, hard mode, answer policy, profanity, and token lifetime controls.
- Resume saved game.
- Physical and on-screen keyboard support.
- High-contrast and no-color modes.
- Optional result labels.
- Dictionary validation and random-word tools.
- API response inspector.

## API routes

Base: `/api/v1`

| Method | Route | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/config` | Supported configuration limits |
| GET | `/dictionaries` | Dictionary registry and availability |
| GET | `/docs` | Machine-readable route overview |
| GET | `/{dictionary}/info` | Dictionary metadata |
| GET | `/{dictionary}/words/random?length=5` | Random accepted word |
| GET | `/{dictionary}/words/search?q=app&length=5` | Search vocabulary |
| GET | `/{dictionary}/words/validate/{word}` | Validate guess |
| POST | `/{dictionary}/game/new` | Unlimited game |
| POST | `/{dictionary}/game/daily` | Daily game |
| POST | `/{dictionary}/game/guess` | Submit guess |
| POST | `/{dictionary}/game/resume` | Validate and restore token |
| POST | `/{dictionary}/evaluate` | Evaluate guess against answer |

Example game settings:

```json
{
  "length": 6,
  "maxAttempts": 7,
  "hardMode": true,
  "profanity": "strict",
  "answerPolicy": "curated",
  "tokenTtlHours": 24
}
```

The latest token returned by every successful guess must replace the previous token.

## Stateless security model

The answer and game state are encrypted using AES-GCM with a Worker secret. The browser only receives ciphertext. The server does not persist game sessions.

Statelessness has inherent limits:
- A user can replay an earlier token.
- Daily games can be restarted.
- There is no server-side per-user statistics or history.
- Clearing the browser's saved token loses the current game.
- A stateless API cannot guarantee one daily attempt per person without identity or storage.

The API does not claim to prevent replay. Add server-side storage if that becomes a requirement.

## Dictionary import

```powershell
npm run dictionaries:build
```

The importer creates local snapshots in `public/dictionaries/`. It includes English source lists for Wordle, dwyl English words, and ENABLE. Other dictionary IDs in the registry remain unavailable until you add datasets.

The registry is not a claim that every listed language dataset is already bundled. Only imported files are advertised as available.

## Profanity filtering

The importer merges the configured LDNOOBW, Google Profanity Words, and Censor-Text sources into a local exact-match list. Review the source repository and license before redistribution. Filtering can have false positives. The API supports `profanity: "off"` for dictionaries where strict filtering is unsuitable.

## Tests

```powershell
npm test
npm run check
```

Tests cover normalization, duplicate-letter evaluation, and hard-mode constraints.

## Production checklist

- Review dictionary source URLs, data quality, and licenses.
- Add and curate answer pools separately from accepted-guess lists.
- Add Cloudflare rate limiting/WAF rules for public traffic.
- Set a strong `GAME_SECRET`; rotating it invalidates existing sessions.
- Add per-language Unicode normalization and alphabet rules before importing non-Latin dictionaries.
- Consider a durable store only if you need one-play-per-day enforcement, server-side statistics, or replay prevention.

## Layout

```text
speedle/
├── src/index.js
├── tests/engine.test.js
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
