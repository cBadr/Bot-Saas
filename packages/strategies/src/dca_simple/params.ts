import { z } from 'zod';

/**
 * DCA Simple — ladder DCA inspired by the proven x2 model.
 *
 * Behavior:
 *   • At launch, captures `initialStartPrice` (custom override or live ticker).
 *   • Places `gridLevels` LIMIT_MAKER orders in a ladder:
 *       BUY mode  → descending below start  (start − i*spread, i=1..N)
 *       SELL mode → ascending above start   (start + i*spread, i=1..N)
 *   • Each opening fill updates a weighted-avg cost basis.
 *   • A SINGLE counter order (TP for BUY, BB for SELL) is maintained at:
 *       BUY  → avg + takeProfit  (target price to liquidate)
 *       SELL → avg − takeProfit  (target price to buy back)
 *     Recomputed on every fill via cancel-and-replace, serialized via mutex.
 *   • When the counter fills → realize PnL, complete cycle, cancel the rest,
 *     and rebuild a fresh ladder around the new market price.
 *
 * Fees: LIMIT_MAKER (post-only) for zero fees on FDUSD. If the TP/BB price
 * would cross the book, falls back to LIMIT GTC.
 */
export const DcaSimpleParamsSchema = z.object({
  /** BUY: accumulate below market, then liquidate at TP. SELL: distribute above market, then buy back. */
  direction: z.enum(['BUY', 'SELL']).default('BUY'),
  /** Number of orders in the ladder (1–200). */
  gridLevels: z.coerce.number().int().min(1).max(200),
  /** Absolute $ distance between adjacent ladder rungs. */
  gridSpread: z.coerce.number().positive(),
  /** Quote-currency size per ladder order (e.g. 10 = $10/order). */
  orderSize: z.coerce.number().positive(),
  /**
   * Profit target in $ above (BUY) or below (SELL) the running weighted-avg
   * fill price. The counter order (TP/BB) sits at this offset and is
   * recomputed every time a new ladder rung fills.
   */
  takeProfit: z.coerce.number().positive(),
  /** Auto-stop after N minutes. 0 = run indefinitely. */
  durationMinutes: z.coerce.number().int().min(0).max(60 * 24 * 365).default(0),
  /** Optional: override the start price. If omitted, the live ticker at launch is used. */
  customStartPrice: z.coerce.number().positive().optional(),
});

export type DcaSimpleParams = z.infer<typeof DcaSimpleParamsSchema>;
