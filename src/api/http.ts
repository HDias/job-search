import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, 'Dados inválidos', parsed.error.issues);
  }
  return parsed.data;
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: 'Rota não encontrada', path: req.path });
}

interface ErrorWithStatus {
  status?: unknown;
  statusCode?: unknown;
  type?: unknown;
}

/**
 * O `body-parser` do Express sinaliza erros de requisição (JSON malformado,
 * corpo grande demais) com `status`/`statusCode` no próprio erro. Sem isso,
 * eles cairiam no ramo genérico e virariam 500.
 */
function clientErrorStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;

  const { status, statusCode } = err as ErrorWithStatus;
  const value = status ?? statusCode;
  if (typeof value !== 'number') return null;
  return value >= 400 && value < 500 ? value : null;
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Dados inválidos', details: err.issues });
    return;
  }

  const status = clientErrorStatus(err);
  if (status) {
    const message =
      status === 413
        ? 'Corpo da requisição muito grande'
        : status === 400
          ? 'JSON inválido ou corpo malformado'
          : 'Requisição inválida';
    res.status(status).json({ error: message });
    return;
  }

  console.error('[api] erro não tratado:', err);
  res.status(500).json({ error: 'Erro interno' });
}
