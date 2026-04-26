import { z } from 'zod';

export const GridParamsSchema = z
  .object({
    // ─── Range & granularity ─────────────────────────────
    upperPrice: z.coerce.number().positive(),
    lowerPrice: z.coerce.number().positive(),
    gridLevels: z.coerce.number().int().min(2).max(200),
    /** Total quote currency to deploy across BUY orders. */
    totalQuoteInvestment: z.coerce.number().positive(),

    // ─── Direction & inventory ───────────────────────────
    /**
     * - long:    BUYs below market, SELLs added above as inventory accumulates
     * - short:   SELLs above market, BUYs added below as inventory shrinks (needs initial inventory)
     * - neutral: BOTH BUYs and SELLs placed at start (requires initialPositionPct > 0)
     */
    gridMode: z.enum(['long', 'short', 'neutral']).default('long'),
    /**
     * % of `totalQuoteInvestment` to spend immediately on a market BUY
     * to seed inventory (so SELLs can fire on day-1 above current price).
     * 0 = no initial buy. 50 = buy half upfront, leaving half for grid BUYs.
     * Ignored when `useExistingInventory` is true.
     */
    initialPositionPct: z.coerce.number().min(0).max(100).default(0),
    /**
     * Use the user's existing free balance of the base asset (e.g. BTC for
     * BTCFDUSD) as inventory for SELL orders above anchor, instead of
     * market-buying. Pairs naturally with `gridMode: 'neutral' | 'short'`.
     * If true, takes precedence over `initialPositionPct`.
     */
    useExistingInventory: z.coerce.boolean().default(false),
    /**
     * % of available base balance to allocate to the grid (1-100).
     * Only used when `useExistingInventory` is true. Default 100 = use all.
     */
    existingInventoryPct: z.coerce.number().min(1).max(100).default(100),
    /**
     * Custom anchor price — the "current" reference for the grid.
     * If omitted, uses live ticker. Useful for backtesting hypotheses
     * or pre-loading orders before market reaches a level.
     */
    anchorPrice: z.coerce.number().positive().optional(),

    // ─── Spacing modes ───────────────────────────────────
    /**
     * - arithmetic:   equal $ price step between levels (derived from range/levels)
     * - geometric:    % multiplier between levels
     * - fixed_dollar: caller specifies exact $ between levels
     */
    spacingMode: z.enum(['arithmetic', 'geometric', 'fixed_dollar']).default('geometric'),
    /** Geometric multiplier (e.g. 1.01 = 1% gap). */
    priceMultiplier: z.coerce.number().gt(1).optional(),
    /** Fixed $ gap between adjacent levels (required if spacingMode=fixed_dollar). */
    spacingDollar: z.coerce.number().positive().optional(),

    // ─── Order sizing ────────────────────────────────────
    /** >1 = bigger orders at higher levels (martingale). =1 = equal sizing. */
    orderSizeMultiplier: z.coerce.number().gt(0).max(10).default(1),

    // ─── Profit/Loss controls ────────────────────────────
    takeProfitPrice: z.coerce.number().nonnegative().optional(),
    stopLossPrice: z.coerce.number().nonnegative().optional(),
    /** Trailing stop %: if price drops X% from running peak, exit. */
    trailingStopPct: z.coerce.number().min(0.1).max(50).optional(),
    /** Auto-stop after this many completed BUY→SELL cycles (round-trips). */
    stopAfterCycles: z.coerce.number().int().min(1).max(10_000).optional(),

    // ─── Legacy / advanced ───────────────────────────────
    trailingUp: z.coerce.boolean().default(false),
    /** If set, grid only activates once price crosses this trigger. */
    gridTriggerPrice: z.coerce.number().nonnegative().optional(),
  })
  .refine((p) => p.upperPrice > p.lowerPrice, {
    message: 'upperPrice must be greater than lowerPrice',
    path: ['upperPrice'],
  })
  .refine(
    (p) => p.spacingMode !== 'fixed_dollar' || (p.spacingDollar !== undefined && p.spacingDollar > 0),
    { message: 'spacingDollar required when spacingMode=fixed_dollar', path: ['spacingDollar'] },
  )
  .refine(
    (p) => p.gridMode !== 'neutral' || p.initialPositionPct > 0 || p.useExistingInventory,
    {
      message: 'neutral mode requires initialPositionPct > 0 or useExistingInventory=true',
      path: ['initialPositionPct'],
    },
  );

export type GridParams = z.infer<typeof GridParamsSchema>;
