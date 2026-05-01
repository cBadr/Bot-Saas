import { defineWorkspace } from 'vitest/config';

/**
 * Workspace-level Vitest config: lists all packages that contain tests.
 * Each entry can have its own vitest.config.ts for per-package tweaks.
 */
export default defineWorkspace([
  'packages/strategies',
  'packages/shared',
  'apps/api',
]);
