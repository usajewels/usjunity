import { apiClient } from '@mxsuite/shared';
import type { ConversationDto, ChatMessageDto, DashboardStats } from '../types/chat';

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
};
