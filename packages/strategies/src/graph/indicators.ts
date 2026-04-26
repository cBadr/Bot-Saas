/**
 * Lightweight rolling-window indicator calculators.
 * Each instance keeps its own bounded ring buffer.
 */

export class RollingSMA {
  private readonly values: number[] = [];
  constructor(public readonly period: number) {
    if (period < 1) throw new Error('SMA period must be >= 1');
  }
  push(value: number): number | undefined {
    this.values.push(value);
    if (this.values.length > this.period) this.values.shift();
    return this.value;
  }
  get value(): number | undefined {
    if (this.values.length < this.period) return undefined;
    let sum = 0;
    for (const v of this.values) sum += v;
    return sum / this.period;
  }
  get ready(): boolean {
    return this.values.length >= this.period;
  }
}

/**
 * Wilder's RSI (the one most platforms use). Period N typically 14.
 * Returns undefined until at least N+1 values have been pushed.
 */
export class RollingRSI {
  private prev?: number;
  private avgGain = 0;
  private avgLoss = 0;
  private count = 0;
  constructor(public readonly period: number) {
    if (period < 2) throw new Error('RSI period must be >= 2');
  }
  push(value: number): number | undefined {
    if (this.prev === undefined) {
      this.prev = value;
      return undefined;
    }
    const change = value - this.prev;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    this.count += 1;
    if (this.count <= this.period) {
      // Seed: simple averages over first `period` deltas
      this.avgGain += gain / this.period;
      this.avgLoss += loss / this.period;
    } else {
      this.avgGain = (this.avgGain * (this.period - 1) + gain) / this.period;
      this.avgLoss = (this.avgLoss * (this.period - 1) + loss) / this.period;
    }
    this.prev = value;
    if (this.count < this.period) return undefined;
    if (this.avgLoss === 0) return 100;
    const rs = this.avgGain / this.avgLoss;
    return 100 - 100 / (1 + rs);
  }
}

/**
 * Detects edges (transitions) for boolean conditions.
 * Returns true on the tick when `now` becomes true after being false.
 */
export class RisingEdge {
  private prev = false;
  test(now: boolean): boolean {
    const fired = !this.prev && now;
    this.prev = now;
    return fired;
  }
  reset() { this.prev = false; }
}
