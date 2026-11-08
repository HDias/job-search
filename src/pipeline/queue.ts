/**
 * In-process FIFO queue: one pipeline execution at a time. Long requests are
 * not blocked on it — the native routes answer `202 {runId}` and the UI polls
 * the run (D2).
 */

export type QueueTaskKind = 'fit-check' | 'generate-kit';

export interface FitCheckPayload {
  url?: string | null;
  rawText?: string | null;
  extraQuestions?: string | null;
  recruiterMessage?: string | null;
  languagePreference?: string | null;
  stack?: string | null;
}

export interface QueueTask {
  kind: QueueTaskKind;
  runId: string;
  payload: FitCheckPayload | Record<string, unknown>;
}

export type QueueTaskHandler = (task: QueueTask) => Promise<void>;

export interface RunQueue {
  enqueue(task: QueueTask): void;
  /** Resolves when every task enqueued so far has finished (tests/shutdown). */
  idle(): Promise<void>;
  size(): number;
  pending(): number;
}

export interface RunQueueOptions {
  onError?: (task: QueueTask, error: unknown) => void;
  warn?: (message: string) => void;
}

export function createRunQueue(
  handler: QueueTaskHandler,
  options: RunQueueOptions = {},
): RunQueue {
  const warn =
    options.warn ?? ((message: string) => console.warn(`[pipeline] ${message}`));
  const tasks: QueueTask[] = [];
  let chain: Promise<void> = Promise.resolve();
  let pending = 0;

  const runTask = async (task: QueueTask): Promise<void> => {
    pending++;
    tasks.push(task);
    try {
      await handler(task);
    } catch (error) {
      options.onError?.(task, error);
      warn(
        `task ${task.kind} do run ${task.runId} falhou: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      tasks.pop();
      pending--;
    }
  };

  return {
    enqueue(task) {
      chain = chain.then(() => runTask(task));
    },
    idle() {
      return chain;
    },
    size() {
      return pending;
    },
    pending() {
      return pending;
    },
  };
}
