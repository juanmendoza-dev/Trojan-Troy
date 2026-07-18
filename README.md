# Trojan-Troy
Trojan Troy smuggles your conversations past everyone but the person you're talking to. Text and voice messages encrypted end-to-end, a safety-number handshake so you know it's really them, no server ever sees plaintext.

## Development

Two packages, run separately:

```bash
cd server && npm install && npm run dev   # relay on ws://localhost:8080
cd client && npm install && npm run dev   # web app, prints its own URL
```

Open the client URL in two browser windows to simulate two users: "Start a chat" in one, "Join a chat" with the shown code in the other.
