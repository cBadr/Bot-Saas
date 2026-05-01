export type { Strategy, StrategyContext, StrategyOrderEvent } from './base';
export { gridStrategy, GridStrategy } from './grid/strategy';
export { GridParamsSchema, type GridParams } from './grid/params';
export { gridSimpleStrategy, GridSimpleStrategy } from './grid_simple/strategy';
export { GridSimpleParamsSchema, type GridSimpleParams } from './grid_simple/params';
export { graphStrategy, GraphStrategy } from './graph/strategy';
export { GraphParamsSchema, type GraphParams, type GraphNode, type GraphEdge } from './graph/strategy';
export { dcaSimpleStrategy, DcaSimpleStrategy } from './dca_simple/strategy';
export { DcaSimpleParamsSchema, type DcaSimpleParams } from './dca_simple/params';
export { maCrossStrategy, MACrossStrategy, MACrossParamsSchema, type MACrossParams } from './ma_cross/strategy';
export { RollingRSI, RollingSMA, RisingEdge } from './graph/indicators';

import { gridStrategy } from './grid/strategy';
import { gridSimpleStrategy } from './grid_simple/strategy';
import { graphStrategy } from './graph/strategy';
import { dcaSimpleStrategy } from './dca_simple/strategy';
import { maCrossStrategy } from './ma_cross/strategy';
import type { Strategy } from './base';

const registry = new Map<string, Strategy<unknown>>();
registry.set(gridStrategy.key, gridStrategy as unknown as Strategy<unknown>);
registry.set(gridSimpleStrategy.key, gridSimpleStrategy as unknown as Strategy<unknown>);
registry.set(graphStrategy.key, graphStrategy as unknown as Strategy<unknown>);
registry.set(dcaSimpleStrategy.key, dcaSimpleStrategy as unknown as Strategy<unknown>);
registry.set(maCrossStrategy.key, maCrossStrategy as unknown as Strategy<unknown>);

export function getStrategy(key: string): Strategy<unknown> | undefined {
  return registry.get(key);
}

export function listStrategies(): string[] {
  return [...registry.keys()];
}
