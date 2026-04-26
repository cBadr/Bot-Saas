/**
 * Orca — Binance Connector Test CLI
 *
 * Interactive script to verify the @orca/exchange package end-to-end:
 *   1. Time sync with Binance
 *   2. Redis-backed rate limiter
 *   3. Public endpoints (server time, exchange info, ticker)
 *   4. Signed endpoints (account, balances, open orders)
 *   5. Symbol filters & order validation
 *   6. Dry-run order placement (validation only — no real order)
 *   7. Optional REAL order placement (with explicit confirmation)
 *
 * Run:
 *   pnpm tsx scripts/test-binance.ts
 */

import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import Redis from 'ioredis';
import {
  binanceTimeSync,
  BinanceRateLimiter,
  createBinanceClient,
  createPublicBinanceClient,
  extractFilters,
  validateOrder,
  type BinanceCredentials,
} from '@orca/exchange';
import {
  Decimal,
  FEE_FREE_QUOTE_ASSET,
  roundToTickSize,
  roundToStepSize,
} from '@orca/shared';
import { env } from '@orca/config';

// ─── Tiny CLI helpers ──────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
};
const banner = (t: string) =>
  console.log(`\n${C.bold}${C.cyan}━━━ ${t} ━━━${C.reset}`);
const ok = (t: string) => console.log(`  ${C.green}✓${C.reset} ${t}`);
const fail = (t: string, e?: unknown) => {
  console.log(`  ${C.red}✗${C.reset} ${t}`);
  if (e) console.log(`    ${C.dim}${e instanceof Error ? e.message : String(e)}${C.reset}`);
};
const info = (label: string, v: unknown) =>
  console.log(`  ${C.gray}${label.padEnd(22)}${C.reset} ${C.bold}${v}${C.reset}`);

async function main() {
  console.log(`${C.bold}${C.magenta}\n╔══════════════════════════════════════╗`);
  console.log(`║   Orca — Binance Connector Tester    ║`);
  console.log(`╚══════════════════════════════════════╝${C.reset}`);

  const rl = readline.createInterface({ input, output });

  // ─── 1. Credentials ───
  banner('1. Credentials');
  let apiKey = process.env.BINANCE_TEST_KEY ?? '';
  let apiSecret = process.env.BINANCE_TEST_SECRET ?? '';
  if (!apiKey) apiKey = (await rl.question('  Binance API Key: ')).trim();
  if (!apiSecret) apiSecret = (await rl.question('  Binance API Secret: ')).trim();
  if (!apiKey || !apiSecret) {
    console.log(`\n${C.red}API key and secret are required.${C.reset}`);
    rl.close();
    process.exit(1);
  }
  ok(`Loaded credentials (key starts with ${apiKey.slice(0, 6)}...)`);

  // ─── 2. Time Sync ───
  banner('2. Time Sync');
  try {
    await binanceTimeSync.syncNow();
    info('Local now', new Date().toISOString());
    info('Binance offset (ms)', binanceTimeSync.getOffset());
    info('Adjusted now', new Date(binanceTimeSync.now()).toISOString());
    ok('Time sync successful');
  } catch (e) { fail('Time sync', e); rl.close(); process.exit(1); }

  // ─── 3. Redis & Rate Limiter ───
  banner('3. Redis Rate Limiter');
  const redis = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
  try {
    await redis.connect();
    const pong = await redis.ping();
    ok(`Redis ${pong}`);
  } catch (e) { fail('Redis connect', e); rl.close(); process.exit(1); }
  const rateLimiter = new BinanceRateLimiter(redis);

  // ─── 4. Public Endpoints ───
  banner('4. Public Endpoints');
  const pub = createPublicBinanceClient();
  try {
    const t = await pub.getServerTime();
    info('Server time', new Date(t).toISOString());
    ok('GET /api/v3/time');
  } catch (e) { fail('GET /api/v3/time', e); }

  // ─── 5. Signed Endpoints ───
  banner('5. Signed Endpoints (Account)');
  const credentials: BinanceCredentials = {
    apiKeyId: 'test-key',
    apiKey,
    apiSecret,
  };
  const client = createBinanceClient(credentials, rateLimiter);
  try {
    const acct = await client.getAccount();
    info('canTrade', acct.canTrade);
    info('accountType', acct.accountType);
    const nonZero = acct.balances.filter(
      (b) => Number(b.free) + Number(b.locked) > 0,
    );
    info('Non-zero balances', nonZero.length);
    nonZero.slice(0, 10).forEach((b) =>
      console.log(`    ${C.gray}•${C.reset} ${b.asset.padEnd(8)} free=${b.free}  locked=${b.locked}`),
    );
    ok('GET /api/v3/account');
  } catch (e) { fail('GET /api/v3/account', e); }

  // ─── 6. Pick a symbol ───
  banner('6. Symbol Info');
  const defaultSymbol = `BTC${FEE_FREE_QUOTE_ASSET}`;
  const symbol = (
    (await rl.question(`  Symbol to inspect [${defaultSymbol}]: `)).trim() || defaultSymbol
  ).toUpperCase();
  let filters;
  try {
    const ex = await pub.getExchangeInfo([symbol]);
    if (!ex.symbols.length) throw new Error(`Symbol ${symbol} not found`);
    filters = extractFilters(ex.symbols[0]!);
    info('Symbol', filters.symbol);
    info('Base / Quote', `${filters.baseAsset} / ${filters.quoteAsset}`);
    info('Tick size', filters.tickSize);
    info('Step size', filters.stepSize);
    info('Min qty', filters.minQty);
    info('Min notional', filters.minNotional);
    if (!symbol.endsWith(FEE_FREE_QUOTE_ASSET)) {
      console.log(`  ${C.yellow}⚠ Symbol does not use ${FEE_FREE_QUOTE_ASSET} → fees apply${C.reset}`);
    }
    ok('Exchange info loaded');
  } catch (e) { fail('Exchange info', e); rl.close(); process.exit(1); }

  // ─── 7. Open orders ───
  banner('7. Open Orders');
  try {
    const open = await client.getOpenOrders(symbol);
    info('Open orders', open.length);
    open.slice(0, 5).forEach((o) =>
      console.log(`    ${C.gray}•${C.reset} ${o.side} ${o.origQty} @ ${o.price} (${o.status})`),
    );
    ok('GET /api/v3/openOrders');
  } catch (e) { fail('GET /api/v3/openOrders', e); }

  // ─── 8. Dry-run order ───
  banner('8. Order Validation (dry-run)');
  try {
    const ticker = await pub.getTickerPrice(symbol);
    const last = new Decimal(ticker.price);
    info('Last price', last.toString());
    // 0.5% below market — typical grid BUY level
    const testPrice = roundToTickSize(last.mul('0.995'), filters!.tickSize);
    const desiredNotional = new Decimal(filters!.minNotional).mul(2);
    const testQty = roundToStepSize(desiredNotional.div(testPrice), filters!.stepSize);
    info('Proposed BUY price', testPrice);
    info('Proposed BUY qty', testQty);
    info('Notional', new Decimal(testPrice).mul(testQty).toFixed(2));
    const v = validateOrder(filters!, testPrice, testQty);
    if (v.ok) ok('Order would pass exchange filters');
    else fail(`Validation: ${v.reason}`);

    // Real order? (default NO)
    const ans = (await rl.question(`\n  ${C.yellow}Place this LIMIT BUY for real on Binance? [y/N]:${C.reset} `)).trim().toLowerCase();
    if (ans === 'y' || ans === 'yes') {
      const placed = await client.placeOrder({
        symbol,
        side: 'BUY',
        type: 'LIMIT',
        timeInForce: 'GTC',
        price: testPrice,
        quantity: testQty,
        newClientOrderId: `orca-test-${Date.now()}`,
      });
      ok(`Order placed: id=${placed.orderId} status=${placed.status}`);
      const cancelAns = (await rl.question(`  Cancel it now? [Y/n]: `)).trim().toLowerCase();
      if (cancelAns !== 'n' && cancelAns !== 'no') {
        const c = await client.cancelOrder({ symbol, orderId: placed.orderId });
        ok(`Order canceled: status=${c.status}`);
      }
    } else {
      console.log(`  ${C.dim}Skipped real order placement.${C.reset}`);
    }
  } catch (e) { fail('Order test', e); }

  // ─── 9. Rate Limiter Usage ───
  banner('9. Rate Limiter State');
  try {
    const usage = await rateLimiter.getUsage('test-key');
    Object.entries(usage).forEach(([k, v]) => info(k, v));
  } catch (e) { fail('Rate limiter usage', e); }

  // ─── Cleanup ───
  binanceTimeSync.stop();
  await redis.quit();
  rl.close();
  console.log(`\n${C.bold}${C.green}✅ All tests complete.${C.reset}\n`);
}

main().catch((err) => {
  console.error(`\n${C.red}${C.bold}Fatal error:${C.reset}`, err);
  process.exit(1);
});
