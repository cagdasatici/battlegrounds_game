import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { saveAdminPassword } from "./lib/adminSetup.js";

/** Read without echo, shell arguments, shell history or plaintext files. */
async function hidden(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || !process.stdout.isTTY) throw new Error("Run pnpm admin:setup in an interactive terminal on the host.");
  process.stdout.write(prompt);
  const wasRaw = input.isRaw; input.setRawMode(true); input.setEncoding("utf8"); input.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const done = (error?: Error): void => {
      input.removeListener("data", read); input.setRawMode(wasRaw); input.pause(); process.stdout.write("\n");
      if (error) reject(error); else resolve(value);
    };
    const read = (chunk: string): void => {
      for (const ch of chunk.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")) {
        if (ch === "\x03" || ch === "\x04") { done(new Error("Setup cancelled; no password was saved.")); return; }
        if (ch === "\r" || ch === "\n") { done(); return; }
        if (ch === "\x7f" || ch === "\b") value = [...value].slice(0, -1).join("");
        else if (ch >= " ") { if (value.length + ch.length > 256) { done(new Error("Password is too long; nothing was saved.")); return; } value += ch; }
      }
    };
    input.on("data", read);
  });
}
async function main(): Promise<void> {
  if (process.argv.length > 2) throw new Error("No password arguments are accepted. Run pnpm admin:setup.");
  console.log("Set the host admin password (12–256 characters). Input is hidden.");
  const password = await hidden("Password: ");
  if (password !== await hidden("Confirm password: ")) throw new Error("Passwords did not match; nothing was saved.");
  await saveAdminPassword(resolve(process.env["DATA_DIR"] ?? join(homedir(), "eb-data")), password);
  console.log("Admin configured. Restart pnpm play, then open its Admin address and sign in.");
}
void main().catch(e => { console.error((e as Error).message); process.exitCode = 1; });
