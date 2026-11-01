import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname } from "node:path";

/** Small JSON file store: write temp, fsync, rename; permissions 0600 (spec section 20). */
export class AtomicJsonStore<T> {
  constructor(private readonly path: string, private readonly empty: () => T) {}

  read(): T {
    if (!existsSync(this.path)) return this.empty();
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as T;
    } catch {
      return this.empty();
    }
  }

  write(value: T): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.tmp`;
    const fd = openSync(tmp, "w", 0o600);
    try {
      writeSync(fd, JSON.stringify(value));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.path);
  }
}
