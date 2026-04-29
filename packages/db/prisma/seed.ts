import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ─── Default Plans ───
  const plans = [
    {
      code: 'free',
      name: 'Free',
      description: 'Try Orca with 1 bot',
      priceUsd: '0.00',
      maxBots: 1,
      maxApiKeys: 1,
      maxCustomStrategies: 0,
      sortOrder: 0,
    },
    {
      code: 'starter',
      name: 'Starter',
      description: 'Up to 3 bots, basic strategies',
      priceUsd: '19.00',
      maxBots: 3,
      maxApiKeys: 2,
      maxCustomStrategies: 1,
      sortOrder: 1,
    },
    {
      code: 'pro',
      name: 'Pro',
      description: 'Up to 10 bots, all strategies, custom builder',
      priceUsd: '49.00',
      maxBots: 10,
      maxApiKeys: 5,
      maxCustomStrategies: 10,
      sortOrder: 2,
    },
    {
      code: 'elite',
      name: 'Elite',
      description: 'Unlimited bots, priority support',
      priceUsd: '149.00',
      maxBots: 100,
      maxApiKeys: 20,
      maxCustomStrategies: 100,
      sortOrder: 3,
    },
  ];

  for (const p of plans) {
    await prisma.plan.upsert({
      where: { code: p.code },
      create: p,
      update: p,
    });
  }
  console.log(`  ✓ ${plans.length} plans`);

  // ─── Built-in Grid Strategy ───
  await prisma.strategy.upsert({
    where: { builtinKey: 'grid_v1' },
    create: {
      name: 'Grid Trading',
      description:
        'Classic grid trading with arithmetic or geometric (multiplier) price spacing. Default Orca strategy.',
      type: 'GRID',
      visibility: 'BUILTIN',
      builtinKey: 'grid_v1',
      version: 1,
      definition: {
        engine: 'grid_v1',
        defaultMode: 'geometric',
      },
      paramsSchema: {
        type: 'object',
        required: ['upperPrice', 'lowerPrice', 'gridLevels', 'totalQuoteInvestment'],
        properties: {
          upperPrice: { type: 'number', exclusiveMinimum: 0 },
          lowerPrice: { type: 'number', exclusiveMinimum: 0 },
          gridLevels: { type: 'integer', minimum: 2, maximum: 200 },
          totalQuoteInvestment: { type: 'number', exclusiveMinimum: 0 },
          spacingMode: { type: 'string', enum: ['arithmetic', 'geometric'], default: 'geometric' },
          priceMultiplier: { type: 'number', minimum: 1.0001, default: 1.01 },
          takeProfitPrice: { type: 'number', minimum: 0 },
          stopLossPrice: { type: 'number', minimum: 0 },
          trailingUp: { type: 'boolean', default: false },
          gridTriggerPrice: { type: 'number', minimum: 0 },
        },
      },
    },
    update: {},
  });
  console.log('  ✓ Built-in Grid strategy');

  // ─── Grid Simple strategy (x2-style symmetric ladder) ───
  await prisma.strategy.upsert({
    where: { builtinKey: 'grid_simple' },
    create: {
      name: 'Grid Simple',
      description:
        'Symmetric ladder around start price with LIMIT_MAKER orders, periodic reconciliation, and balance-aware retries. Battle-tested simple model.',
      type: 'GRID',
      visibility: 'BUILTIN',
      builtinKey: 'grid_simple',
      version: 1,
      definition: { engine: 'grid_simple' },
      paramsSchema: {
        type: 'object',
        required: ['gridLevels', 'gridSpread', 'orderSize'],
        properties: {
          gridLevels: { type: 'integer', minimum: 1, maximum: 200 },
          gridSpread: { type: 'number', exclusiveMinimum: 0 },
          orderSize: { type: 'number', exclusiveMinimum: 0 },
          durationMinutes: { type: 'integer', minimum: 0, default: 0 },
          customStartPrice: { type: 'number', exclusiveMinimum: 0 },
        },
      },
    },
    update: {
      description:
        'Symmetric ladder around start price with LIMIT_MAKER orders, periodic reconciliation, and balance-aware retries. Battle-tested simple model.',
    },
  });
  console.log('  ✓ Built-in Grid Simple strategy');

  // ─── DCA strategy ───
  await prisma.strategy.upsert({
    where: { builtinKey: 'dca_v1' },
    create: {
      name: 'DCA (Dollar-Cost Averaging)',
      description:
        'Periodic BUY (accumulate) or SELL (distribute) with flexible time and/or price gates.',
      type: 'DCA',
      visibility: 'BUILTIN',
      builtinKey: 'dca_v1',
      version: 2,
      definition: { engine: 'dca_v1' },
      paramsSchema: {
        type: 'object',
        required: ['totalQuoteInvestment', 'direction'],
        properties: {
          direction: { type: 'string', enum: ['BUY', 'SELL'], default: 'BUY' },
          totalQuoteInvestment: { type: 'number', exclusiveMinimum: 0 },
          totalOrders: { type: 'integer', minimum: 1, maximum: 1000, default: 20 },
          intervalMinutes: { type: 'integer', minimum: 1, maximum: 43200 },
          minPriceMovePct: { type: 'number', minimum: 0.01, maximum: 100 },
          takeProfitPct: { type: 'number', minimum: 0.1, maximum: 1000 },
          stopLossPct: { type: 'number', minimum: 0.1, maximum: 100 },
        },
      },
    },
    update: {
      description: '[Deprecated — use DCA Simple] Periodic BUY/SELL with time/price gates. Kept for legacy bots.',
      version: 2,
    },
  });
  console.log('  ✓ Built-in DCA strategy (legacy)');

  // ─── DCA Simple strategy (x2-style ladder DCA) ───
  await prisma.strategy.upsert({
    where: { builtinKey: 'dca_simple' },
    create: {
      name: 'DCA Simple',
      description:
        'Ladder DCA with single dynamic TP/BB. Places N LIMIT_MAKER orders descending (BUY) or ascending (SELL); maintains one counter at avg±takeProfit; on counter fill, realizes PnL and rebuilds ladder around new market.',
      type: 'DCA',
      visibility: 'BUILTIN',
      builtinKey: 'dca_simple',
      version: 1,
      definition: { engine: 'dca_simple' },
      paramsSchema: {
        type: 'object',
        required: ['direction', 'gridLevels', 'gridSpread', 'orderSize', 'takeProfit'],
        properties: {
          direction: { type: 'string', enum: ['BUY', 'SELL'], default: 'BUY' },
          gridLevels: { type: 'integer', minimum: 1, maximum: 200 },
          gridSpread: { type: 'number', exclusiveMinimum: 0 },
          orderSize: { type: 'number', exclusiveMinimum: 0 },
          takeProfit: { type: 'number', exclusiveMinimum: 0 },
          priceMultiplierMode: { type: 'string', enum: ['flat', 'percent', 'dollar'], default: 'flat' },
          priceMultiplier: { type: 'number', minimum: 0, default: 0 },
          sizeMultiplierMode: { type: 'string', enum: ['flat', 'percent', 'dollar'], default: 'flat' },
          sizeMultiplier: { type: 'number', minimum: 0, default: 0 },
          cooldownMinutes: { type: 'integer', minimum: 0, default: 0 },
          recenterAfterMinutes: { type: 'integer', minimum: 0, default: 0 },
          durationMinutes: { type: 'integer', minimum: 0, default: 0 },
          customStartPrice: { type: 'number', exclusiveMinimum: 0 },
        },
      },
    },
    update: {
      description:
        'Ladder DCA with single dynamic TP/BB. Places N LIMIT_MAKER orders descending (BUY) or ascending (SELL); maintains one counter at avg±takeProfit; on counter fill, realizes PnL and rebuilds ladder around new market. Supports percent/dollar multipliers on price gap and order size, plus optional cooldown between cycles.',
    },
  });
  console.log('  ✓ Built-in DCA Simple strategy');

  // ─── MA Cross strategy ───
  await prisma.strategy.upsert({
    where: { builtinKey: 'ma_cross_v1' },
    create: {
      name: 'MA Crossover',
      description:
        'Buys when a fast SMA crosses above a slow SMA; sells when it crosses below. Optional TP/SL.',
      type: 'CUSTOM',
      visibility: 'BUILTIN',
      builtinKey: 'ma_cross_v1',
      version: 1,
      definition: { engine: 'ma_cross_v1' },
      paramsSchema: {
        type: 'object',
        required: ['fastPeriod', 'slowPeriod', 'quoteAmountPerTrade'],
        properties: {
          fastPeriod: { type: 'integer', minimum: 2, maximum: 500, default: 9 },
          slowPeriod: { type: 'integer', minimum: 2, maximum: 500, default: 21 },
          quoteAmountPerTrade: { type: 'number', exclusiveMinimum: 0 },
          takeProfitPct: { type: 'number', minimum: 0.1, maximum: 1000 },
          stopLossPct: { type: 'number', minimum: 0.1, maximum: 100 },
        },
      },
    },
    update: {},
  });
  console.log('  ✓ Built-in MA Crossover strategy');

  // ─── Default Admin ───
  const adminEmail = process.env.ADMIN_DEFAULT_EMAIL ?? 'admin@orca.local';
  const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD ?? 'ChangeMe123!';
  const passwordHash = await argon2.hash(adminPassword);

  await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      passwordHash,
      fullName: 'Orca Admin',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
    update: {},
  });
  console.log(`  ✓ Default admin: ${adminEmail}`);

  // ─── Default App Settings ───
  const settings = [
    { key: 'platform.name', value: 'Orca', isPublic: true, category: 'branding' },
    { key: 'platform.maintenanceMode', value: false, isPublic: true, category: 'system' },
    { key: 'platform.allowRegistration', value: true, isPublic: true, category: 'system' },
    { key: 'trading.feeFreeQuoteAsset', value: 'FDUSD', isPublic: true, category: 'trading' },
    { key: 'trading.allowedOrderTypes', value: ['LIMIT', 'LIMIT_MAKER'], isPublic: true, category: 'trading' },
    { key: 'referral.commissionPct', value: 10, isPublic: true, category: 'referral' },
  ];
  for (const s of settings) {
    await prisma.appSetting.upsert({
      where: { key: s.key },
      create: s,
      update: { value: s.value, category: s.category, isPublic: s.isPublic },
    });
  }
  console.log(`  ✓ ${settings.length} app settings`);

  console.log('✅ Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
