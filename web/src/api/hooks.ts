import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from './client';
import type {
  CandidateData,
  Job,
  JobDetailResponse,
  JobFilters,
  PdfTheme,
  ProfileContent,
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
      content,
    }: {
      stack: string;
      language: string;
      content: ProfileContent;
    }) => api.saveProfile(stack, language, content),
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
