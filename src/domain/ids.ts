import { randomUUID } from 'node:crypto';

/** IDs com prefixo legível (app_, proc_, art_) para manter compatibilidade com o v1. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
