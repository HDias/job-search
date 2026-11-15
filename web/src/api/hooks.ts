import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from './client';
import type {
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
import { hasActiveRuns } from '../lib/runs';

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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['job', jobId] });
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
export function useFitCheck(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: FitCheckInput) => api.fitCheck(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

/** Enqueues a kit generation/regeneration for a job (D2: 202 + polling). */
export function useGenerateKit(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: GenerateKitInput) => api.generateKit(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}
