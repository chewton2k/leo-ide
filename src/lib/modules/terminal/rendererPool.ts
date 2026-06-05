export const POOL_MAX_SIZE = 5;

/**
 * Tracks which terminal panes currently hold a live renderer (xterm/WebGL),
 * capping the count so a deep tab stack can't exhaust GPU contexts. Pure
 * bookkeeping: callers do the actual renderer create/dispose driven by the
 * returned eviction id. LRU — least-recently-touched pane is evicted first.
 */
export class RendererPool {
  private order: number[] = []; // front = least-recently-used
  constructor(private readonly maxSize = POOL_MAX_SIZE) {}

  private bump(id: number): void {
    const i = this.order.indexOf(id);
    if (i >= 0) this.order.splice(i, 1);
    this.order.push(id);
  }

  /** Acquire a renderer slot for `id`. Returns the evicted pane id, or null. */
  acquire(id: number): number | null {
    if (this.order.includes(id)) { this.bump(id); return null; }
    let evicted: number | null = null;
    if (this.order.length >= this.maxSize) evicted = this.order.shift() ?? null;
    this.order.push(id);
    return evicted;
  }

  /** Mark `id` as most-recently-used (does nothing if not held). */
  touch(id: number): void {
    if (this.order.includes(id)) this.bump(id);
  }

  release(id: number): void {
    const i = this.order.indexOf(id);
    if (i >= 0) this.order.splice(i, 1);
  }

  has(id: number): boolean { return this.order.includes(id); }
  get size(): number { return this.order.length; }
  held(): number[] { return [...this.order]; }
}
