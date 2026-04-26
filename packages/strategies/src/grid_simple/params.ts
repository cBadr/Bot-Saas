import { z } from 'zod';

/**
 * GridSimple — symmetric ladder around a fixed start price.
 *
 * Inspired by the proven x2 grid model:
 *   - Start price is captured ONCE at launch (from live ticker or user override)
 *     and persisted; never recomputed.
 *   - For each i in 1..gridLevels, place BOTH a BUY at (start - i * spread)
 *     AND a SELL at (start + i * spread).
 *   - On BUY fill → place SELL at fill+spread (one-spread profit per round-trip).
 *   - On SELL fill → place BUY at fill-spread.
 *   - Order type is LIMIT_MAKER (post-only, zero fees on FDUSD).
 *   - Insufficient-balance errors are non-fatal; orders mark themselves
 *     `ignored_balance` and are retried by the periodic reconcile loop.
 */
export const GridSimpleParamsSchema = z.object({
  /** Number of levels per side. Total orders placed = 2 * gridLevels. */
  gridLevels: z.coerce.number().int().min(1).max(200),
  /** Absolute $ distance between adjacent levels (and the BUY→SELL profit per round-trip). */
  gridSpread: z.coerce.number().positive(),
  /** Quote-currency amount per order (e.g. 10 = $10 per BUY/SELL). */
  orderSize: z.coerce.number().positive(),
  /** Auto-stop after N minutes. 0 = run indefinitely. */
  durationMinutes: z.coerce.number().int().min(0).max(60 * 24 * 365).default(0),
  /** Optional: override the start price. If omitted, the live ticker at launch is used. */
  customStartPrice: z.coerce.number().positive().optional(),
});

export type GridSimpleParams = z.infer<typeof GridSimpleParamsSchema>;
