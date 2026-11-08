import { describe, expect, it, vi } from 'vitest';
import { createRunQueue } from '../src/pipeline/queue.js';

describe('createRunQueue', () => {
  it('runs tasks FIFO, one at a time', async () => {
    let running = 0;
    let maxRunning = 0;
    const order: string[] = [];

    const queue = createRunQueue(async (task) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      order.push(task.runId);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
    });

    queue.enqueue({ kind: 'fit-check', runId: 'proc_1', payload: {} });
    queue.enqueue({ kind: 'fit-check', runId: 'proc_2', payload: {} });
    queue.enqueue({ kind: 'fit-check', runId: 'proc_3', payload: {} });

    expect(queue.pending()).toBe(0);
    await queue.idle();

    expect(order).toEqual(['proc_1', 'proc_2', 'proc_3']);
    expect(maxRunning).toBe(1);
    expect(queue.pending()).toBe(0);
  });

  it('keeps draining after a failing task and reports it', async () => {
    const handler = vi.fn(async (task: { runId: string }) => {
      if (task.runId === 'proc_bad') throw new Error('boom');
    });
    const onError = vi.fn();
    const queue = createRunQueue(handler, { onError, warn: () => undefined });

    queue.enqueue({ kind: 'fit-check', runId: 'proc_bad', payload: {} });
    queue.enqueue({ kind: 'fit-check', runId: 'proc_ok', payload: {} });
    await queue.idle();

    expect(handler).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'proc_bad' }),
      expect.any(Error),
    );
  });
});
