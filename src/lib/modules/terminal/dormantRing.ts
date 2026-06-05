/**
 * Bounded output buffer for a hibernated (renderer-released) terminal: PTY
 * output is accumulated here while the pane has no live xterm, then drained
 * back when it is reactivated. Capped by total chars; oldest chunks are
 * dropped on overflow (a single oversized chunk is trimmed to its tail).
 */
export class DormantRing {
  private chunks: string[] = [];
  private total = 0;
  constructor(private readonly maxChars = 200_000) {}

  push(chunk: string): void {
    if (!chunk) return;
    this.chunks.push(chunk);
    this.total += chunk.length;
    while (this.total > this.maxChars && this.chunks.length > 1) {
      this.total -= this.chunks.shift()!.length;
    }
    if (this.total > this.maxChars && this.chunks.length === 1) {
      const tail = this.chunks[0].slice(this.chunks[0].length - this.maxChars);
      this.chunks[0] = tail;
      this.total = tail.length;
    }
  }

  /** Return the buffered output (oldest→newest) and clear the ring. */
  drain(): string {
    const out = this.chunks.join('');
    this.clear();
    return out;
  }

  get size(): number { return this.total; }

  clear(): void { this.chunks = []; this.total = 0; }
}
