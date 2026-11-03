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

  console.error('[api] erro não tratado:', err);
  res.status(500).json({ error: 'Erro interno' });
}
