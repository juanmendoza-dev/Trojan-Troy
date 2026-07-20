# Trojan-Troy
Trojan Troy smuggles your conversations past everyone but the person you're talking to. Text and voice messages encrypted end-to-end, a safety-number handshake so you know it's really them, no server ever sees plaintext.

## Development

Two packages, run separately:

```bash
cd server && npm install && npm run dev   # relay on ws://localhost:8080
cd client && npm install && npm run dev   # web app, prints its own URL
```

Open the client URL in two browser windows to simulate two users: "Start a chat" in one, "Join a chat" with the shown code in the other.

## Deployment

Client and relay deploy separately — the relay is a stateful WebSocket
server (in-memory room state), which doesn't fit Vercel's serverless
model, so only the client goes there.

**Relay (Render):**
1. In the Render dashboard: "New" → "Blueprint", point it at this repo.
   `render.yaml` at the repo root configures the `trojan-troy-relay`
   service automatically (free plan, builds/runs from `server/`).
2. Note the resulting URL, e.g. `https://trojan-troy-relay.onrender.com`.

**Client (Vercel):**
1. In the Vercel dashboard: "Add New" → "Project", import this repo.
2. Set "Root Directory" to `client`.
3. Add an environment variable `VITE_RELAY_URL` set to the relay's
   `wss://` URL (swap `https://` for `wss://` from the Render URL, e.g.
   `wss://trojan-troy-relay.onrender.com`).
4. Deploy — Vercel auto-detects the Vite build.

Render's free tier cold-starts after 15 minutes of inactivity — the first
connection after idle can take 30-60 seconds while it spins back up.
