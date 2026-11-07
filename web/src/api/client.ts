import type {
  BaseResumeMap,
  CandidateData,
  Job,
  JobDetailResponse,
  JobFilters,
  JobList,
  JobStats,
  NewProfile,
  PdfTheme,
  Profile,
  ProfilePatch,
} from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set('content-type', 'application/json');

  const response = await fetch(path, { ...init, headers });

  if (!response.ok) {
    let message = `Erro ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // resposta sem JSON: mantém a mensagem padrão
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function toQuery(filters: JobFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.q) params.set('q', filters.q);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset) params.set('offset', String(filters.offset));
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const api = {
  stats: () => request<JobStats>('/api/stats'),

  jobs: (filters: JobFilters = {}) =>
    request<JobList>(`/api/jobs${toQuery(filters)}`),

  job: (id: string) =>
    request<JobDetailResponse>(`/api/jobs/${encodeURIComponent(id)}`),

  updateJob: (id: string, patch: Partial<Job>) =>
    request<Job>(`/api/jobs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  baseResumes: () => request<BaseResumeMap>('/api/base-resumes'),

  profiles: () => request<Profile[]>('/api/profiles'),

  saveProfile: (stack: string, language: string, patch: ProfilePatch) =>
    request<Profile>(
      `/api/profiles/${encodeURIComponent(stack)}/${encodeURIComponent(language)}`,
      {
        method: 'PUT',
        body: JSON.stringify(patch),
      },
    ),

  createProfile: (input: NewProfile) =>
    request<Profile>('/api/profiles', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  deleteProfile: (stack: string, language: string) =>
    request<void>(
      `/api/profiles/${encodeURIComponent(stack)}/${encodeURIComponent(language)}`,
      { method: 'DELETE' },
    ),

  pdfTheme: () => request<{ success: boolean; theme: PdfTheme }>('/api/pdf-theme'),

  savePdfTheme: (theme: PdfTheme) =>
    request<{ success: boolean; theme: PdfTheme }>('/api/pdf-theme', {
      method: 'PUT',
      body: JSON.stringify(theme),
    }),

  candidateData: () =>
    request<{ success: boolean; candidate: CandidateData }>('/api/candidate-data'),

  saveCandidateData: (candidate: CandidateData) =>
    request<{ success: boolean; candidate: CandidateData }>('/api/candidate-data', {
      method: 'PUT',
      body: JSON.stringify(candidate),
    }),
};
