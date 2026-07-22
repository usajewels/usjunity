import { api } from '@mxsuite/shared';

export const planApi = {
  listByProject: (projectId: string, params?: any) => api.get(`/projects/${projectId}/plans`, { params }),
  get: (projectId: string, planId: string) => api.get(`/projects/${projectId}/plans/${planId}`),
  create: (projectId: string, data: any) => api.post(`/projects/${projectId}/plans`, data),
  updateDefinition: (projectId: string, planId: string, definition: any) =>
    api.put(`/projects/${projectId}/plans/${planId}/definition`, { definition }),
  publish: (projectId: string, planId: string) => api.post(`/projects/${projectId}/plans/${planId}/publish`),
  archive: (projectId: string, planId: string) => api.post(`/projects/${projectId}/plans/${planId}/archive`),
  execute: (projectId: string, planId: string, runType: string) =>
    api.post(`/projects/${projectId}/plans/${planId}/execute`, { runType }),
  listRuns: (projectId: string, planId: string, params?: any) =>
    api.get(`/projects/${projectId}/plans/${planId}/runs`, { params }),
};

export const projectApi = {
  list: (params?: any) => api.get('/projects', { params }),
};

export default api;
