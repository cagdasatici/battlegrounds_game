import { createGameServer } from "./createServer.js";

const port = Number(process.env["PORT"] ?? 2567);
const server = createGameServer();
await server.listen(port);
console.log(JSON.stringify({ level: "info", msg: "server listening", port }));
