import { api } from '@mxsuite/shared';
import type { Onboarding } from '@mxsuite/shared';

export const onboardingApi = {
  get: () =>
    api.get<Onboarding>('/onboarding'),

  create: () =>
    api.post<Onboarding>('/onboarding'),

  update: (id: string, data: {
    status?: string;
    currentStep?: number;
    targetSchema?: any[];
    mappings?: any[];
    notes?: string;
  }) => api.put<Onboarding>(`/onboarding/${id}`, data),

  upload: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post(`/onboarding/${id}/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  selectSheet: (id: string, sheetIndex: number) =>
    api.post<Onboarding>(`/onboarding/${id}/select-sheet`, { sheetIndex }),

  preview: (id: string) =>
    api.get<{ headers: string[]; rows: string[][]; totalRows: number }>(`/onboarding/${id}/preview`),

  submit: (id: string) =>
    api.post<Onboarding>(`/onboarding/${id}/submit`),

  reopen: (id: string) =>
    api.post<Onboarding>(`/onboarding/${id}/reopen`),

  reset: (id: string) =>
    api.delete(`/onboarding/${id}`),
};

export default api;
