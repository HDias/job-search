import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from './client';
import type { Job, JobFilters } from './types';

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
