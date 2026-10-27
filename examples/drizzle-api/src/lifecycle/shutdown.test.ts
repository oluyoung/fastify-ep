import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { registerShutdownHandlers } from './shutdown.js';

function exitSpy() {
  let resolve!: (code: number) => void;
  const done = new Promise<number>((r) => (resolve = r));
  return { exit: (code: number) => resolve(code), done };
}

describe('registerShutdownHandlers', () => {
  it('closes the app on SIGTERM and exits 0', async () => {
    const app = await buildApp();
    const proc = new EventEmitter();
    let closed = false;
    app.addHook('onClose', async () => {
      closed = true;
    });
    const { exit, done } = exitSpy();
    registerShutdownHandlers(app, { exit, proc });

    proc.emit('SIGTERM');

    expect(await done).toBe(0);
    expect(closed).toBe(true);
  });

  it('exits 1 when closing fails', async () => {
    const app = await buildApp();
    const proc = new EventEmitter();
    app.addHook('onClose', async () => {
      throw new Error('resource would not close');
    });
    const { exit, done } = exitSpy();
    registerShutdownHandlers(app, { exit, proc });

    proc.emit('SIGINT');

    expect(await done).toBe(1);
  });

  it('forces exit 1 when closing exceeds the timeout', async () => {
    const app = await buildApp();
    const proc = new EventEmitter();
    app.addHook('onClose', () => new Promise(() => {}));
    const { exit, done } = exitSpy();
    registerShutdownHandlers(app, { exit, proc, timeoutMs: 20 });

    proc.emit('SIGTERM');

    expect(await done).toBe(1);
  });

  it('reports not ready once shutdown begins', async () => {
    const app = await buildApp();
    let status: string | undefined;
    app.addHook('preClose', async () => {
      status = (await app.healthService.getReadiness()).status;
    });
    await app.ready();

    await app.close();

    expect(status).toBe('unavailable');
  });
});
