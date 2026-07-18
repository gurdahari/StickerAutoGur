# StickerOS — OpenAI + Seedream 5.0 Pro

StickerOS is an autonomous digital-sticker production app for Etsy. This version replaces the original Google AI Studio integration with:

- **OpenAI Responses API** for niche analysis, prompt creation, structured listing copy, chat, and live trend research.
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

- Sticker PNGs are generated against a flat matte, cleaned with edge-connected background removal, decontaminated at the cut line, and tightly cropped to the artwork's real aspect ratio with only a minimal transparent safety margin.
- Downloadable sticker files never contain a baked-in drop shadow. Shadows are added only while composing marketing images.
- Main covers and grid previews are built deterministically in browser Canvas from the completed sticker files. The image model cannot invent, redraw, or duplicate cover stickers.
- Lifestyle mockups use Seedream only for generic empty scenery. Product frames and the real sticker PNGs are composited and clipped to safe placement regions afterward in code.
- Cover badges and listing copy use the actual number of completed stickers, including partial test runs.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | required | OpenAI server API key |
| `OPENAI_MODEL` | `gpt-5.6` | Brain model used by the Responses API |
| `OPENAI_REASONING_EFFORT` | `low` | Cost/quality control for brain calls |
| `SEEDREAM_API_KEY` | required | BytePlus ModelArk API key; `ARK_API_KEY` also works |
| `SEEDREAM_MODEL` | `dola-seedream-5-0-pro-260628` | Seedream model endpoint ID |
| `SEEDREAM_BASE_URL` | `https://ark.ap-southeast.bytepluses.com/api/v3` | BytePlus regional API base URL |
| `PORT` | `8787` | Node API/production server port |

Model IDs and regional availability can vary by BytePlus account. If the default Seedream model is not enabled in your region, set `SEEDREAM_MODEL` and `SEEDREAM_BASE_URL` to the values shown in your ModelArk console.

## Security note

API keys are server-only and are never injected into Vite. Before exposing this app publicly, add user authentication and persistent rate limits so anonymous visitors cannot spend your provider credits.
