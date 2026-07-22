import { api } from '@mxsuite/shared';

export const workspaceApi = {
  list: (params?: any) => api.get('/workspaces', { params }),
  get: (id: string) => api.get(`/workspaces/${id}`),
  create: (data: any) => api.post('/workspaces', data),
  update: (id: string, data: { name?: string; description?: string }) => api.put(`/workspaces/${id}`, data),
  delete: (id: string) => api.delete(`/workspaces/${id}`),
  share: (id: string, data: any) => api.post(`/workspaces/${id}/share`, data),
};

export const projectApi = {
  list: (params?: any) => api.get('/projects', { params }),
  get: (id: string) => api.get(`/projects/${id}`),
  create: (data: any) => api.post('/projects', data),
  update: (id: string, data: any) => api.put(`/projects/${id}`, data),
  delete: (id: string) => api.delete(`/projects/${id}`),
};

export const planApi = {
  list: (projectId: string, params?: any) => api.get(`/projects/${projectId}/plans`, { params }),
  create: (projectId: string, data: any) => api.post(`/projects/${projectId}/plans`, data),
};

export const assetApi = {
  list: (projectId: string, params?: any) => api.get(`/projects/${projectId}/assets`, { params }),
  upload: (projectId: string, file: File, assetType: string = 'DATA') => {
    const form = new FormData();
    form.append('file', file);
    form.append('assetType', assetType);
    return api.post(`/projects/${projectId}/assets/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  download: (projectId: string, assetId: string) =>
    api.get(`/projects/${projectId}/assets/${assetId}/download`, { responseType: 'blob' }),
  delete: (projectId: string, assetId: string) =>
    api.delete(`/projects/${projectId}/assets/${assetId}`),
};

export default api;
