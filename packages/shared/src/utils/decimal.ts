import Decimal from 'decimal.js';

Decimal.set({ precision: 30, rounding: Decimal.ROUND_DOWN });

export { Decimal };

export function toFixedDown(value: Decimal.Value, decimals: number): string {
  return new Decimal(value).toFixed(decimals, Decimal.ROUND_DOWN);
}

export function roundToTickSize(price: Decimal.Value, tickSize: Decimal.Value): string {
  const p = new Decimal(price);
  const t = new Decimal(tickSize);
  if (t.isZero()) return p.toString();
  return p.div(t).floor().mul(t).toFixed(t.decimalPlaces());
}

export function roundToStepSize(qty: Decimal.Value, stepSize: Decimal.Value): string {
  const q = new Decimal(qty);
  const s = new Decimal(stepSize);
  if (s.isZero()) return q.toString();
  return q.div(s).floor().mul(s).toFixed(s.decimalPlaces());
}
