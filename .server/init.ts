import { DB } from '../.database/connection';
import { Logger, log } from './logger';
import { match } from './utils';

Object.assign(globalThis, {
  respond: (callback: any) => callback,
  defineConfig: (config: any) => config,
  any: (x: any) => x,
  assert: (condition: any, message?: string): asserts condition => {
    if (!condition) throw new Error(message || 'Assertion failed');
  },
  match,
  log,
  DB,
  Logger,
});
