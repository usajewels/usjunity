import { api } from '@mxsuite/shared';
import type {
  TenantOnboardingDto, UploadPreviewDto, UploadResultDto, ImportStatusDto,
  MappingVersionDto, MappingVersionDetailDto, FieldChangeHistoryDto,
} from '@mxsuite/shared';

export const tenantOnboardingApi = {
  // Overview — get or auto-create the tenant's onboarding project
  getMyOnboarding: () =>
    api.get<TenantOnboardingDto>('/my-onboarding'),

  // Upload
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<UploadResultDto>('/my-onboarding/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  selectSheet: (sheetIndex: number) =>
    api.post<UploadResultDto>('/my-onboarding/select-sheet', { sheetIndex }),

  confirmUpload: (preserveApproved: boolean) =>
    api.post<UploadResultDto>('/my-onboarding/upload/confirm', { preserveApproved }),

  getUploadPreview: () =>
    api.get<UploadPreviewDto>('/my-onboarding/upload/preview'),

  // Preview upload — send extracted CSV text for large files
  uploadPreview: (csvText: string, originalFilename: string, totalFileSize: number) =>
    api.post<UploadResultDto>('/my-onboarding/upload-preview', {
      csvText, originalFilename, totalFileSize,
    }),

  // Chunked upload for large file import
  uploadChunk: (chunkIndex: number, totalChunks: number, chunk: Blob, filename: string) => {
    const form = new FormData();
    form.append('file', chunk, `chunk_${chunkIndex}`);
    form.append('chunkIndex', chunkIndex.toString());
    form.append('totalChunks', totalChunks.toString());
    form.append('filename', filename);
    return api.post('/my-onboarding/import/chunk', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  // Batch import
  startImport: () =>
    api.post<ImportStatusDto>('/my-onboarding/import/start'),

  getImportStatus: () =>
    api.get<ImportStatusDto>('/my-onboarding/import/status'),

  // Mappings
  listMappings: (params?: Record<string, unknown>) =>
    api.get('/my-onboarding/mappings', { params }),

  updateMapping: (id: string, data: Record<string, unknown>) =>
    api.put(`/my-onboarding/mappings/${id}`, data),

  approveMapping: (id: string) =>
    api.post(`/my-onboarding/mappings/${id}/approve`),

  getMappingStats: () =>
    api.get('/my-onboarding/mappings/stats'),

  // Decisions
  listDecisions: (params?: Record<string, unknown>) =>
    api.get('/my-onboarding/decisions', { params }),

  updateDecision: (id: string, data: Record<string, unknown>) =>
    api.put(`/my-onboarding/decisions/${id}`, data),

  // Versions
  listVersions: (params?: { page?: number; size?: number; search?: string }) =>
    api.get<{ content: MappingVersionDto[]; totalElements: number }>(
      '/my-onboarding/versions', { params }),

  getVersion: (versionId: string) =>
    api.get<MappingVersionDetailDto>(`/my-onboarding/versions/${versionId}`),

  rollbackVersion: (targetVersion: number) =>
    api.post('/my-onboarding/versions/rollback', { targetVersion }),

  // Field change history
  getFieldChangeHistory: (mappingId: string, params?: { page?: number; size?: number }) =>
    api.get<{ content: FieldChangeHistoryDto[]; totalElements: number; totalPages: number }>(
      `/my-onboarding/mappings/${mappingId}/change-history`, { params }),

  // Status / Reconciliation
  getStatus: () =>
    api.get('/my-onboarding/status'),

  // Audit trail — fetch history for a specific mapping
  getEntityAudit: (entityType: string, entityId: string, params?: { page?: number; size?: number }) =>
    api.get<{ content: AuditEventDto[]; totalElements: number }>(
      `/audit/entity/${entityType}/${entityId}`, { params }),
};

export interface AuditEventDto {
  id: string;
  actorName: string;
  actorRole: string;
  platformAction: boolean;
  action: string;
  entityType: string;
  entityId: string;
  entityName?: string;
  timestamp: string;
}
