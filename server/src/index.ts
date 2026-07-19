import { startRelay } from "./server.js";

const PORT = Number(process.env.PORT) || 8080;
startRelay(PORT);
console.log(`Relay listening on ws://localhost:${PORT}`);
