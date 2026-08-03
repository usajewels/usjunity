import { apiClient, api } from '@mxsuite/shared';
import type { ConversationDto, ChatMessageDto, DashboardStats, PresenceDetail, CannedResponseDto } from '../types/chat';

interface PaginatedResponse<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
}

export const chatApi = {
  /* ---- Member ---- */

  listConversations: () =>
    apiClient.get<ConversationDto[]>('/chat/conversations'),

  createConversation: (subject?: string) =>
    apiClient.post<ConversationDto>('/chat/conversations', { subject }),

  getMessages: (conversationId: string, page = 0, size = 50) =>
    apiClient.get<PaginatedResponse<ChatMessageDto>>(
      `/chat/conversations/${conversationId}/messages?page=${page}&size=${size}`),

  sendMessage: (conversationId: string, content: string) =>
    apiClient.post<ChatMessageDto>(`/chat/conversations/${conversationId}/messages`, { content }),

  requestHelp: (conversationId: string) =>
    apiClient.post<ConversationDto>(`/chat/conversations/${conversationId}/help-request`),

  markRead: (conversationId: string) =>
    apiClient.put<void>(`/chat/conversations/${conversationId}/read`),

  /* ---- Coach ---- */

  coachListConversations: () =>
    apiClient.get<ConversationDto[]>('/chat/coach/conversations'),

  coachGetMessages: (conversationId: string, page = 0, size = 50) =>
    apiClient.get<PaginatedResponse<ChatMessageDto>>(
      `/chat/coach/conversations/${conversationId}/messages?page=${page}&size=${size}`),

  coachSendMessage: (conversationId: string, content: string) =>
    apiClient.post<ChatMessageDto>(`/chat/coach/conversations/${conversationId}/messages`, { content }),

  coachMarkRead: (conversationId: string) =>
    apiClient.put<void>(`/chat/coach/conversations/${conversationId}/read`),

  takeover: (conversationId: string) =>
    apiClient.post<ConversationDto>(`/chat/coach/conversations/${conversationId}/takeover`),

  release: (conversationId: string) =>
    apiClient.post<ConversationDto>(`/chat/coach/conversations/${conversationId}/release`),

  coachInitiateConversation: (memberId: string, subject?: string) =>
    apiClient.post<ConversationDto>('/chat/coach/conversations/initiate', { memberId, subject }),

  getDashboardStats: () =>
    apiClient.get<DashboardStats>('/chat/coach/dashboard'),

  /* ---- File Sharing ---- */

  sendFileMessage: (conversationId: string, file: File, content?: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('content', content || '');
    return apiClient.post<ChatMessageDto>(`/chat/conversations/${conversationId}/files`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  coachSendFileMessage: (conversationId: string, file: File, content?: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('content', content || '');
    return apiClient.post<ChatMessageDto>(`/chat/coach/conversations/${conversationId}/files`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  /* ---- Presence ---- */

  getPresence: (userIds: string[]) =>
    apiClient.get<Record<string, boolean>>(`/chat/presence?userIds=${userIds.join(',')}`),

  /** Detailed presence including availability status. */
  getPresenceDetail: (userIds: string[]) =>
    apiClient.get<Record<string, PresenceDetail>>(`/chat/presence/detail?userIds=${userIds.join(',')}`),

  /** Set the current user's availability status (coaches/admins only). */
  setAvailability: (status: string, statusMessage?: string) =>
    apiClient.put<void>('/chat/presence/availability', { status, statusMessage }),

  /* ---- Canned Responses ---- */

  getCannedResponses: () =>
    apiClient.get<CannedResponseDto[]>('/chat/canned-responses'),

  createCannedResponse: (data: { category?: string; title: string; content: string; sortOrder?: number }) =>
    apiClient.post<CannedResponseDto>('/chat/canned-responses', data),

  deleteCannedResponse: (id: string) =>
    apiClient.delete(`/chat/canned-responses/${id}`),

  /* ---- Export ---- */

  exportPdf: async (conversationId: string) => {
    const response = await api.get(`/chat/conversations/${conversationId}/export/pdf`, {
      responseType: 'blob',
    });
    triggerDownload(response.data, `chat-transcript-${conversationId}.pdf`);
  },

  coachExportPdf: async (conversationId: string) => {
    const response = await api.get(`/chat/coach/conversations/${conversationId}/export/pdf`, {
      responseType: 'blob',
    });
    triggerDownload(response.data, `chat-transcript-${conversationId}.pdf`);
  },
};

function triggerDownload(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}
