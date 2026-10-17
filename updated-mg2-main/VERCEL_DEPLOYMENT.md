# MG Manager — Vercel + Local Ollama

## Architecture
`Vercel website → /api/ai/chat → Cloudflare Tunnel → Ollama → gemma4:12b`

The website itself runs on Vercel. Your PC only needs to keep Ollama running when you want AI responses. Firebase remains the live database.

## 1. Vercel environment variables
Add these in **Vercel → Project → Settings → Environment Variables**:

| Variable | Value |
|---|---|
| `OLLAMA_URL` | Your Cloudflare Tunnel URL ending in `/api/chat` |
| `OLLAMA_MODEL` | `gemma4:12b` |

Example:
`OLLAMA_URL=https://YOUR-TUNNEL.trycloudflare.com/api/chat`

## 2. Start Ollama
Make sure Ollama is running on the PC with `gemma4:12b` installed. Do not start a second `ollama serve` if Ollama Desktop is already running.

## 3. Start the Cloudflare Tunnel
Expose the local Ollama HTTP endpoint through your tunnel. Your tunnel URL must be reachable from the Vercel serverless function.

## 4. Deploy
Push this project to GitHub and import it into Vercel. Vercel uses:
- Build: `npm run build`
- Output: `dist`
- AI endpoint: `/api/ai/chat`

## AI reports
The AI can answer against the live Jobs and Inventory data supplied by the Firebase-backed UI and can generate downloadable **XLSX, CSV, and PDF** reports for requests such as:
- `Give me September 2026 completed jobs in Excel`
- `Show all pending jobs`
- `Give me current stock in Excel`
- `Export September inventory to PDF`

The backend filters the relevant records before sending them to Gemma, so the whole database is not unnecessarily pushed into the model for every question.

## Important
A Quick Cloudflare Tunnel URL can change when the tunnel restarts. If that happens, update `OLLAMA_URL` in Vercel and redeploy/reconfigure the environment variable. For a permanent setup, use a named Cloudflare Tunnel hostname.
