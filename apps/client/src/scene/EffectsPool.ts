/** Empty effects pool (T18a). Later tasks register pooled effects; dispose() must release all of them. */
export class EffectsPool {
  private disposers: Array<() => void> = [];
  get size(): number { return this.disposers.length; }
  register(dispose: () => void): void { this.disposers.push(dispose); }
  dispose(): void {
    for (const d of this.disposers.splice(0)) d();
  }
}
