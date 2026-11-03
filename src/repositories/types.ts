import type { Artifact } from '../domain/artifact.js';
import type {
  Job,
  JobFilter,
  JobList,
  JobPatch,
  JobStats,
  NewJob,
} from '../domain/job.js';
import type { Profile, SettingsEntry } from '../domain/profile.js';
import type { NewRun, Run, RunFilter, RunPatch } from '../domain/run.js';

export interface JobRepository {
  list(filter?: JobFilter): JobList;
  get(id: string): Job | null;
  create(input: NewJob): Job;
  update(id: string, patch: JobPatch): Job | null;
  delete(id: string): boolean;
  stats(ownerId?: string): JobStats;
}

export interface RunRepository {
  list(filter?: RunFilter): Run[];
  get(id: string): Run | null;
  create(input: NewRun): Run;
  update(id: string, patch: RunPatch): Run | null;
  delete(id: string): boolean;
}

export type NewArtifact = Omit<
  Artifact,
  'id' | 'createdAt' | 'runId' | 'mime' | 'sizeBytes'
> & {
  id?: string;
  createdAt?: string;
  runId?: string | null;
  mime?: string | null;
  sizeBytes?: number | null;
};

export interface ArtifactRepository {
  listByJob(jobId: string): Artifact[];
  addMany(inputs: NewArtifact[]): void;
  deleteByJob(jobId: string): void;
}

export interface ProfileRepository {
  list(): Profile[];
  get(stack: string, language: string): Profile | null;
  upsert(profile: Omit<Profile, 'updatedAt'> & { updatedAt?: string }): Profile;
}

export interface SettingsRepository {
  list(): SettingsEntry[];
  get<T = unknown>(key: string): T | null;
  set(key: string, value: unknown): SettingsEntry;
  delete(key: string): boolean;
}

export interface Store {
  jobs: JobRepository;
  runs: RunRepository;
  artifacts: ArtifactRepository;
  profiles: ProfileRepository;
  settings: SettingsRepository;
  close(): void;
}
