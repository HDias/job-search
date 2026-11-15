import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from './client';
import type {
  ApplyConfirmInput,
  CandidateData,
  FitCheckInput,
  GenerateKitInput,
  Job,
  JobDetailResponse,
  JobFilters,
  LlmConfigPatch,
  NewProfile,
  PdfTheme,
  ProfilePatch,
  RespondInput,
} from './types';
import { hasActiveRuns, isRunActive } from '../lib/runs';
import type { Run } from './types';

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: api.stats,
  });
}

export function useJobs(filters: JobFilters) {
  return useQuery({
    queryKey: ['jobs', filters],
    queryFn: () => api.jobs(filters),
    placeholderData: keepPreviousData,
  });
}

export function useJob(id: string | undefined) {
  return useQuery({
    queryKey: ['job', id],
    queryFn: () => api.job(id as string),
    enabled: Boolean(id),
    // Enquanto houver run ativo ou confirmação pendente, acompanha o pipeline.
    refetchInterval: (query) => {
      const data = query.state.data as JobDetailResponse | undefined;
      return hasActiveRuns(data?.runs) ? 4000 : false;
    },
  });
}

/** One pipeline run, polled every 4 s while it is still active. */
export function useRun(id: string | null) {
  return useQuery({
    queryKey: ['run', id],
    queryFn: () => api.run(id as string),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const data = query.state.data as Run | undefined;
      return data && isRunActive(data) ? 4000 : false;
    },
  });
}

/** Interrupted checkpoints, polled while a run is still moving. */
const LIVE_STAGES = new Set(['queued', 'scraping', 'generating']);

export function useRuns() {
  return useQuery({
    queryKey: ['runs', 'unfinished'],
    queryFn: () => api.runs({ unfinished: true, limit: 200 }),
    refetchInterval: (query) => {
      const data = query.state.data as Run[] | undefined;
      return data?.some((run) => LIVE_STAGES.has(run.stage)) ? 4000 : false;
    },
  });
}

export function useDeleteRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.deleteRun(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });
}

export function useUpdateJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Job> }) =>
      api.updateJob(id, patch),
    onSuccess: (job) => {
      queryClient.setQueryData(['job', job.id], (current: unknown) =>
        current && typeof current === 'object'
          ? { ...current, job }
          : current,
      );
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

/** Removes the job and everything generated for it (runs, kits, chats). */
export function useDeleteJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.deleteJob(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: ['job', id] });
      queryClient.removeQueries({ queryKey: ['run'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

export function useBaseResumes() {
  return useQuery({
    queryKey: ['base-resumes'],
    queryFn: api.baseResumes,
  });
}

export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: api.profiles,
  });
}

export function useSaveProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      stack,
      language,
      patch,
    }: {
      stack: string;
      language: string;
      patch: ProfilePatch;
    }) => api.saveProfile(stack, language, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profiles'] });
      void queryClient.invalidateQueries({ queryKey: ['base-resumes'] });
    },
  });
}

export function useCreateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: NewProfile) => api.createProfile(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profiles'] });
      void queryClient.invalidateQueries({ queryKey: ['base-resumes'] });
    },
  });
}

export function useUploadResume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      stack,
      language,
      file,
    }: {
      stack: string;
      language: string;
      file: File;
    }) => api.uploadResume(stack, language, file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profiles'] });
      void queryClient.invalidateQueries({ queryKey: ['base-resumes'] });
    },
  });
}

export function useDeleteProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ stack, language }: { stack: string; language: string }) =>
      api.deleteProfile(stack, language),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profiles'] });
      void queryClient.invalidateQueries({ queryKey: ['base-resumes'] });
    },
  });
}

export function usePdfTheme() {
  return useQuery({
    queryKey: ['pdf-theme'],
    queryFn: api.pdfTheme,
  });
}

export function useSavePdfTheme() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (theme: PdfTheme) => api.savePdfTheme(theme),
    onSuccess: (data) => {
      queryClient.setQueryData(['pdf-theme'], data);
    },
  });
}

export function useCandidateData() {
  return useQuery({
    queryKey: ['candidate-data'],
    queryFn: api.candidateData,
  });
}

export function useSaveCandidateData() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (candidate: CandidateData) => api.saveCandidateData(candidate),
    onSuccess: (data) => {
      queryClient.setQueryData(['candidate-data'], data);
    },
  });
}

/**
 * Answers an interactive checkpoint (`needs_input`). On success the run goes
 * back to `generating`, so the cached job is refetched and polling resumes.
 */
export function useRespondToRun(jobId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ runId, input }: { runId: string; input: RespondInput }) =>
      api.respondToRun(runId, input),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      void queryClient.invalidateQueries({ queryKey: ['run', variables.runId] });
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

export function useLlmConfig() {
  return useQuery({
    queryKey: ['llm-config'],
    queryFn: api.llmConfig,
  });
}

export function useSaveLlmConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: LlmConfigPatch) => api.saveLlmConfig(patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['llm-config'] });
    },
  });
}

/** Enqueues a fit-check for a job and lets the existing polling pick it up. */
export function useFitCheck(jobId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: FitCheckInput) => api.fitCheck(input),
    onSuccess: () => {
      if (jobId) void queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

/** Enqueues a kit generation/regeneration for a job (D2: 202 + polling). */
export function useGenerateKit(jobId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: GenerateKitInput) => api.generateKit(input),
    onSuccess: () => {
      if (jobId) void queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

/** Rebuilds an existing application's kit without re-scraping or re-running the fit. */
export function useRegenerateKit(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { artifacts?: string[]; guidance?: string } = {}) =>
      api.regenerateKit(jobId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

/**
 * Synchronous post-response chat. The reply is cached in the job detail without
 * a refetch, so the thread never flickers between turns.
 */
export function useChat(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (message: string) => api.chat(jobId, { message }),
    onSuccess: (data) => {
      queryClient.setQueryData(['job', jobId], (current: unknown) => {
        if (!current || typeof current !== 'object') return current;
        const detail = current as { job?: Job };
        if (!detail.job) return current;
        return {
          ...detail,
          job: { ...detail.job, chatHistory: data.chat },
        };
      });
    },
  });
}

/** Application-question extraction (`POST /api/jobs/:id/questions`). */
export function useQuestions(jobId: string) {
  return useMutation({
    mutationFn: (input: { applyUrl?: string } = {}) => api.questions(jobId, input),
  });
}

/** Manual confirmation; updates the detail cache and refreshes the lists. */
export function useApplyConfirm(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ApplyConfirmInput) => api.applyConfirm(jobId, input),
    onSuccess: (data) => {
      queryClient.setQueryData(['job', jobId], (current: unknown) =>
        current && typeof current === 'object'
          ? { ...current, job: data.job }
          : current,
      );
      void queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}
