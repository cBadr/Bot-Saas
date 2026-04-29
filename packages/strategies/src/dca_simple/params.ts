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
/**
 * Multiplier mode for ladder progression.
 *   'flat'    → no progression. All rungs use the base value.
 *   'percent' → each successive value grows by N% (geometric).
 *               gap_i / size_i = base × (1 + value/100)^(i-1)
 *   'dollar'  → each successive value grows by N$ (arithmetic).
 *               gap_i / size_i = base + value × (i-1)
 */
export const MultiplierModeSchema = z.enum(['flat', 'percent', 'dollar']).default('flat');

export const DcaSimpleParamsSchema = z.object({
  /** BUY: accumulate below market, then liquidate at TP. SELL: distribute above market, then buy back. */
  direction: z.enum(['BUY', 'SELL']).default('BUY'),
  /** Number of orders in the ladder (1–200). */
  gridLevels: z.coerce.number().int().min(1).max(200),
  /** Absolute $ distance between adjacent ladder rungs (rung 1 from anchor). */
  gridSpread: z.coerce.number().positive(),
  /** Quote-currency size of the FIRST ladder rung (e.g. 10 = $10). */
  orderSize: z.coerce.number().positive(),
  /**
   * Profit target in $ above (BUY) or below (SELL) the running weighted-avg
   * fill price. The counter order (TP/BB) sits at this offset and is
   * recomputed every time a new ladder rung fills.
   */
  takeProfit: z.coerce.number().positive(),

  // ─── Multipliers (martingale-style ladder progression) ───
  /** How the price gap between rungs grows. flat = constant. */
  priceMultiplierMode: MultiplierModeSchema,
  /** Growth value for the price gap (% if mode=percent, $ if mode=dollar). */
  priceMultiplier: z.coerce.number().min(0).default(0),
  /** How the order size grows per rung. flat = constant. */
  sizeMultiplierMode: MultiplierModeSchema,
  /** Growth value for the order size (% if mode=percent, $ if mode=dollar). */
  sizeMultiplier: z.coerce.number().min(0).default(0),

  /**
   * Cooldown after each cycle close (minutes). When the counter fills,
   * the bot cancels remaining ladder orders, idles for this duration,
   * then rebuilds a fresh ladder around the new market price. 0 = no
   * cooldown (rebuild immediately, original behavior).
   */
  cooldownMinutes: z.coerce.number().int().min(0).max(60 * 24 * 30).default(0),

  /**
   * Recenter after inactivity (minutes). If NO ladder rung fills for this
   * many minutes (price drifted away from the ladder), the current cycle
   * is aborted: ladder orders are cancelled, cooldown starts (if set),
   * then a fresh ladder is built around the new market price.
   * 0 = disabled (the ladder waits indefinitely).
   */
  recenterAfterMinutes: z.coerce.number().int().min(0).max(60 * 24 * 30).default(0),

  /** Auto-stop after N minutes. 0 = run indefinitely. */
  durationMinutes: z.coerce.number().int().min(0).max(60 * 24 * 365).default(0),
  /** Optional: override the start price. If omitted, the live ticker at launch is used. */
  customStartPrice: z.coerce.number().positive().optional(),
});

export type MultiplierMode = z.infer<typeof MultiplierModeSchema>;

export type DcaSimpleParams = z.infer<typeof DcaSimpleParamsSchema>;
