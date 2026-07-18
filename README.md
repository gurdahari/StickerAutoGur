# StickerOS — OpenAI + Seedream 5.0 Pro

StickerOS is an autonomous digital-sticker production app for Etsy. This version replaces the original Google AI Studio integration with:

- **OpenAI Responses API** for niche analysis, prompt creation, multimodal visual QA, structured listing copy, chat, and live trend research.
- **BytePlus ModelArk / Seedream 5.0 Pro** for sticker images and marketing mockups.
- A small server layer that keeps both API keys out of the browser bundle.

## Architecture

```text
React/Vite browser
      |
      | /api/*
      v
Node API server
  |-- OpenAI Responses API (brain + web search)
  `-- BytePlus ModelArk (Seedream images)
```

## Run locally

Prerequisites: Node.js 20 or newer, an OpenAI API key, and a BytePlus ModelArk API key with Seedream 5.0 Pro enabled.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in the two keys:

   ```env
   OPENAI_API_KEY=...
   SEEDREAM_API_KEY=...
   ```

3. Start the API server and Vite app together:

   ```bash
   npm run dev
   ```

4. Open `http://localhost:3000`.

## Production

```bash
npm run build
npm start
```

The production server serves both the compiled React app and `/api/*` on `PORT` (default `8787`).

## Asset integrity

- Production Mode targets exactly 100 unique PNGs packaged as five valid ZIPs of 20 PNGs. Test Mode produces a smaller 10-sticker validation run.
- Fast seller QC is the default: every sticker receives free local PNG/alpha/crop/dimension checks and conservative near-exact duplicate detection. Only severe objective failures trigger a paid Seedream replacement. OpenAI visual judgment is not part of the automatic rejection gate, so usable art is not regenerated because of subjective scoring.
- Active runs are checkpointed in browser IndexedDB. Refreshes, browser crashes and restarts can resume missing/rejected stickers without regenerating approved inventory. A saved run must be resumed or explicitly discarded before starting another run.
- A current-market niche preflight scores demand, catalog variety, saturation and potential brand/franchise risk. High-risk niches are blocked unless the seller explicitly confirms a manual rights review; this is decision support, not legal clearance.
- Trend Intelligence searches two separate lanes: five broad buyer markets with room for a varied 100-design catalog and five emerging micro-trends. Each micro-trend is mapped to a broader production niche before import, while the UI shows demand evidence, competition, target buyer, selling logic and variety scores. These are research signals, not guaranteed sales or revenue.
- Sticker PNGs are generated against a flat matte, cleaned with edge-connected background removal plus conservative enclosed-hole detection for rings, frames, tubes and similar shapes, decontaminated at the cut line, and tightly cropped to the artwork's real aspect ratio with only a minimal transparent safety margin. The cleanup also recognizes enclosed pure-black matte when the model mistakenly renders a white outer background. A free local repair action can force this conservative hole pass on an existing PNG without another image-model request.
- Downloadable sticker files never contain a baked-in drop shadow. Shadows are added only while composing marketing images.
- Seedream 5.0 Pro receives 14 selected real sticker PNG references plus the exact title, quantity and selling points, then generates each complete main cover—typography, badges, background and sticker composition—in one cohesive render. The former exact-pixel Canvas cover remains available only as a provider-failure fallback.
- Lifestyle mockups send up to five completed sticker PNGs to Seedream as reference images for natural placement on tablets, laptops, and journals. They render at 1K and are finalized locally at 2K; four lifestyle requests can run in parallel. If reference generation fails, the app falls back to generic scenery with clipped exact-pixel placement.
- A 100-sticker product is delivered as five ZIPs of 20 PNGs. Original dimensions are preserved when possible; oversized batches are resized together with lossless PNG encoding to stay below 19 MB and target roughly 18–19 MB without adding filler data. Every volume includes a CSV manifest with dimensions, byte size and SHA-256 checksums; Volume 1 also includes a buyer-facing `START_HERE.txt` guide.
- OpenAI selects 14 representative real designs for three high-impact cover variants; selection is read-only and can never replace a sticker or trigger a Seedream request. Seedream uses those references to create the finished covers, while the listing set also includes a deterministic “What You Receive” infographic and enlarged transparency/edge-quality proof.
- Preview-grid count adapts to the number of completed stickers, and the customer-facing four-step Etsy download/unzip/import guide is composed locally without another image-model request.
- Niche analysis expands narrow phrases into a broader theme universe and 10–12 subject families. Direct motifs are capped while the selected visual style remains locked across the pack.
- Cover badges and listing copy use the actual number of completed stickers, including partial test runs.
- Listing copy follows a structured buyer-first format with an accurate file inventory, use cases, download steps, important digital-product details, and 13 validated Etsy tags.
- Where supported by the browser, the app creates a short listing-preview video from the actual completed listing images. The master kit also contains a production QA report and a blank performance-tracking CSV for feeding real listing results back into future product decisions.

## Production workflow

1. Choose **TEST · 10** to validate a new provider/model/style inexpensively, or **PRODUCTION · 100** for a sellable bundle.
2. The market/rights preflight runs before any paid Seedream request.
3. Seedream generates with adaptive concurrency. Rate-limit pressure automatically lowers the worker count and successful requests gradually restore it.
4. Free local inspection approves normal sellable variation and rejects only severe technical defects or near-exact duplicates. Only those failed slots receive replacement concepts.
5. Only QA-approved or explicitly manually accepted files reach ZIP packaging, covers, mockups, listing copy and the final download.
6. **PAUSE SAFELY** finishes active requests and saves the run. **RESUME SAVED RUN** continues only unfinished work.
7. If the replacement budget ends but all target PNGs exist, **FINISH WITH 100 GENERATED** explicitly accepts the remaining rejected images for manual seller review and continues directly to ZIPs, mockups and listing copy without another replacement loop.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | required | OpenAI server API key |
| `OPENAI_MODEL` | `gpt-5.6` | Brain model used by the Responses API |
| `OPENAI_REASONING_EFFORT` | `low` | Cost/quality control for brain calls |
| `SEEDREAM_API_KEY` | required | BytePlus ModelArk API key; `ARK_API_KEY` also works |
| `SEEDREAM_MODEL` | `dola-seedream-5-0-pro-260628` | Seedream model endpoint ID |
| `SEEDREAM_BASE_URL` | `https://ark.ap-southeast.bytepluses.com/api/v3` | BytePlus regional API base URL |
| `SEEDREAM_MAX_CONCURRENCY` | `10` | Account-aware cap for adaptive parallel image workers (1-15) |
| `PORT` | `8787` | Node API/production server port |

Model IDs, regional availability and concurrency quotas can vary by BytePlus account. If the default Seedream model is not enabled in your region, set `SEEDREAM_MODEL` and `SEEDREAM_BASE_URL` to the values shown in your ModelArk console. Keep `SEEDREAM_MAX_CONCURRENCY=10` unless your account quota explicitly supports more; the browser queue automatically reduces pressure after rate-limit or server errors.

### Verify provider configuration

`GET /api/health` reports whether each provider is configured and which model is selected. Masked key diagnostics remain available only in the local server terminal and are not exposed over HTTP.

```powershell
Invoke-RestMethod http://localhost:8787/api/health | ConvertTo-Json -Depth 5
```

`.env.local` is loaded before `.env`, so update `.env.local` when both files exist. During development, changing either environment file restarts both the API and Vite processes; after replacing the development script itself, stop the old process and run `npm run dev` once.

## Security note

API keys are server-only and are never injected into Vite. Both development servers bind to `127.0.0.1`, so use `http://localhost:3000`; LAN addresses such as `192.168.x.x` are intentionally unavailable. Cross-origin API calls are rejected and sensitive key diagnostics are terminal-only.

This is a local development application, not a public deployment. Before exposing it through a domain, tunnel, port-forward, or cloud host, add HTTPS, user authentication, CSRF protection, and persistent rate limits so anonymous visitors cannot spend provider credits.
