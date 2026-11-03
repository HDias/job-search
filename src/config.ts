import path from 'node:path';

export interface AppConfig {
  port: number;
  dbFile: string;
  applicationsDir: string;
  baseProfileDir: string;
}

/**
 * O v2 roda ao lado do v1. Por padrão aponta para os artefatos e perfis do v1,
 * mas tudo pode ser sobrescrito por variável de ambiente.
 */
export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 3344),
    dbFile: process.env.DB_FILE ?? path.resolve('data/job-search.db'),
    applicationsDir:
      process.env.APPLICATIONS_DIR ?? path.resolve('..', 'job-search', 'applications'),
    baseProfileDir:
      process.env.BASE_PROFILE_DIR ?? path.resolve('..', 'job-search', 'base_profile'),
  };
}
