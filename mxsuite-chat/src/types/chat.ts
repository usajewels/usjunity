export type ChatMode = 'AI' | 'HUMAN';
export type MessageSender = 'MEMBER' | 'COACH' | 'AI' | 'SYSTEM';
export type ConversationStatus = 'ACTIVE' | 'ARCHIVED' | 'CLOSED';

export interface ConversationDto {
  id: string;
  tenantId: string;
  memberId: string;
  memberName: string | null;
  memberAvatarUrl: string | null;
  assignedCoachId: string | null;
  assignedCoachName: string | null;
  controllingCoachId: string | null;
  controllingCoachName: string | null;
  mode: ChatMode;
  status: ConversationStatus;
  subject: string | null;
  sentimentScore: number | null;
  sentimentLabel: string | null;
  helpRequested: boolean;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCoachCount: number;
  unreadMemberCount: number;
  createdAt: string;
}

export interface ChatMessageDto {
  id: string;
  conversationId: string;
  senderType: MessageSender;
  senderId: string | null;
  senderName: string | null;
  senderAvatarUrl: string | null;
  content: string;
  sentimentScore: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface FileAttachment {
  fileId: string;
  url: string;
  filename: string;
  fileSize: number;
  contentType: string;
}

export interface DashboardStats {
  activeChats: number;
  helpRequests: number;
  sentimentAlerts: number;
  visibleTenantIds?: string[];
}

export interface ChatEvent {
  type: string;
  conversationId?: string;
  mode?: ChatMode;
  coachName?: string;
  [key: string]: unknown;
}
