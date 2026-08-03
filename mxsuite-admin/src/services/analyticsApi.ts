import { api } from '@mxsuite/shared';
import type {
  CrossOrgAnalyticsDto,
  PhaseBenchmarkDto,
  SlaAlertDto,
  CoachLeaderboardDto,
} from '@mxsuite/shared';

export interface CoachChatStatsDto {
  coachId: string;
  coachName: string;
  conversations: number;
  avgSentiment: number;
  helpRequested: number;
  activeCount: number;
}

export interface ChatVolumeTrendPoint {
  month: string;
  total: number;
  aiMode: number;
  humanMode: number;
  helpRequested: number;
}

export interface ChatSentimentTrendPoint {
  month: string;
  avgSentiment: number;
  count: number;
}

export interface ChatAnalyticsDto {
  totalConversations: number;
  activeConversations: number;
  aiModeCount: number;
  humanModeCount: number;
  helpRequestedCount: number;
  avgSentimentScore: number;
  avgUnreadCoachMessages: number;
  volumeTrend: ChatVolumeTrendPoint[];
  sentimentTrend: ChatSentimentTrendPoint[];
  coachStats: CoachChatStatsDto[];
}

export const analyticsApi = {
  getCrossOrgAnalytics: () =>
    api.get<CrossOrgAnalyticsDto>('/admin/analytics/cross-org'),

  getProjectBenchmarks: (projectId: string) =>
    api.get<PhaseBenchmarkDto[]>(`/admin/analytics/projects/${projectId}/benchmarks`),

  getAlerts: () =>
    api.get<SlaAlertDto[]>('/admin/analytics/alerts'),

  getAlertCount: () =>
    api.get<{ count: number }>('/admin/analytics/alerts/count'),

  getCoachPerformance: () =>
    api.get<CoachLeaderboardDto>('/admin/analytics/coach-performance'),

  exportPhaseTimes: (status?: string) =>
    api.get('/admin/analytics/export/phase-times', {
      params: status ? { status } : undefined,
      responseType: 'blob',
    }),

  exportProjectSummary: (status?: string) =>
    api.get('/admin/analytics/export/project-summary', {
      params: status ? { status } : undefined,
      responseType: 'blob',
    }),

  getChatAnalytics: () =>
    api.get<ChatAnalyticsDto>('/admin/analytics/chat'),
};
