# Griha — Full-Stack Interior Design Platform

## Project structure

```
griha/
├── index.html              ← Marketing site (already hosted on GitHub Pages)
├── app.html                ← The actual design tool (the real product)
│
├── js/
│   ├── ai-analyzer.js      ← Sends images to Worker, returns structured data
│   ├── vastu-engine.js     ← Vastu rules engine (pure logic, no API calls)
│   ├── palette-engine.js   ← Colour palette recommendation engine
│   └── product-catalog.js  ← Product + affiliate link engine
│
├── data/
│   ├── vastu-rules.json    ← ALL Vastu rules. Edit here to add/change rules.
│   └── palettes.json       ← ALL colour palettes. Edit here to add palettes.
│
└── worker/
    └── index.js            ← Cloudflare Worker (the secure backend)
```

---

## How the modules connect

```
User uploads photo
       ↓
  ai-analyzer.js  →  worker/index.js  →  Anthropic API (Claude)
       ↓
  vastu-engine.js  ←  data/vastu-rules.json
       ↓
  palette-engine.js  ←  data/palettes.json
       ↓
  product-catalog.js  ←  Airtable API (or sample data fallback)
       ↓
  app.html renders results
```

---

## Setup in order

### Step 1 — Host the frontend on GitHub Pages

1. Create a repo named `griha` on github.com
2. Upload all files (maintain the folder structure above)
3. Go to Settings → Pages → Source: Deploy from branch → main → Save
4. Your site is live at `https://yourusername.github.io/griha/`

### Step 2 — Deploy the Cloudflare Worker (the AI backend)

This is the most important step. Without it, photo upload does nothing.

```bash
# Install Wrangler (Cloudflare's CLI)
npm install -g wrangler

# Log in
wrangler login

# Go to the worker folder
cd worker

# Deploy
wrangler deploy

# Set your Anthropic API key (stored encrypted — never in code)
wrangler secret put ANTHROPIC_API_KEY
# Paste your key from console.anthropic.com when prompted
```

Your worker will deploy to a URL like:
`https://griha-worker.YOURUSERNAME.workers.dev`

### Step 3 — Connect the frontend to the Worker

Open `js/ai-analyzer.js` and update line 28:
```javascript
const WORKER_URL = 'https://griha-worker.YOURUSERNAME.workers.dev';
```

Commit and push to GitHub. Done.

### Step 4 — Connect Airtable (when ready)

Open `js/product-catalog.js` and update the AIRTABLE_CONFIG block:
```javascript
const AIRTABLE_CONFIG = {
  enabled: true,               // ← change to true
  apiKey:  'patXXXXXXXXXXXX', // ← your Personal Access Token
  baseId:  'appXXXXXXXXXXXX', // ← from your Airtable base URL
  tableId: 'Products',         // ← your table name
};
```

---

## How to improve each module independently

| What you want to change | Which file to edit |
|---|---|
| Add a new Vastu rule | `data/vastu-rules.json` only |
| Add a new colour palette | `data/palettes.json` only |
| Improve AI room analysis | `worker/index.js` → edit ROOM_ANALYSIS_PROMPT |
| Add a new product | `js/product-catalog.js` → add to SAMPLE_PRODUCTS array |
| Connect Airtable | `js/product-catalog.js` → update AIRTABLE_CONFIG |
| Change AI model | `worker/index.js` → update AI_MODEL constant |
| Add a new AI endpoint | `worker/index.js` → add handler function |
| Change affiliate tags | `js/product-catalog.js` → update AFFILIATE_TAGS |
| Improve Vastu scoring | `js/vastu-engine.js` → update `_computeScore()` |

---

## Cost estimate (bootstrapped)

| Service | Free tier | Cost when you exceed free |
|---|---|---|
| GitHub Pages | Unlimited | Free forever |
| Cloudflare Workers | 100,000 req/day | $5/month for 10M req |
| Anthropic API | Pay per use | ~₹2–5 per room analysis |
| Airtable | 1,200 rows | $10/month for 5,000 rows |
| Custom domain | — | ~₹800/year |

**Estimated cost for first 100 users: ₹500–2,000 total** (mostly API calls)

---

## Security notes

- Your Anthropic API key is stored as a Cloudflare Worker secret — encrypted at rest, never visible in code
- Before launch, update `ALLOWED_ORIGIN` in `worker/index.js` from `'*'` to your GitHub Pages domain
- Never commit API keys to the repository
