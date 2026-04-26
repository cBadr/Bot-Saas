import { Decimal } from '@orca/shared';
import type { BinanceSymbolInfo } from '@orca/shared';

export interface SymbolFilters {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  baseAssetPrecision: number;
  quoteAssetPrecision: number;
  tickSize: string;
  stepSize: string;
  minQty: string;
  maxQty: string;
  minNotional: string;
}

export function extractFilters(info: BinanceSymbolInfo): SymbolFilters {
  const get = <T = Record<string, unknown>>(type: string): T | undefined =>
    info.filters.find((f) => f.filterType === type) as T | undefined;

  const priceFilter = get<{ tickSize: string }>('PRICE_FILTER');
  const lotSize = get<{ stepSize: string; minQty: string; maxQty: string }>('LOT_SIZE');
  const notional =
    get<{ minNotional: string }>('NOTIONAL') ?? get<{ minNotional: string }>('MIN_NOTIONAL');

  return {
    symbol: info.symbol,
    baseAsset: info.baseAsset,
    quoteAsset: info.quoteAsset,
    baseAssetPrecision: info.baseAssetPrecision,
    quoteAssetPrecision: info.quoteAssetPrecision,
    tickSize: priceFilter?.tickSize ?? '0.00000001',
    stepSize: lotSize?.stepSize ?? '0.00000001',
    minQty: lotSize?.minQty ?? '0',
    maxQty: lotSize?.maxQty ?? '0',
    minNotional: notional?.minNotional ?? '0',
  };
}

export function validateOrder(
  filters: SymbolFilters,
  price: string,
  quantity: string,
): { ok: true } | { ok: false; reason: string } {
  const p = new Decimal(price);
  const q = new Decimal(quantity);
  const minQty = new Decimal(filters.minQty);
  const minNotional = new Decimal(filters.minNotional);
  if (q.lt(minQty)) return { ok: false, reason: `quantity < minQty (${filters.minQty})` };
  const notional = p.mul(q);
  if (notional.lt(minNotional)) {
    return { ok: false, reason: `notional ${notional} < minNotional (${filters.minNotional})` };
  }
  return { ok: true };
}
