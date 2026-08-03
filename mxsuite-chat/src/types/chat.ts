export type ChatMode = 'AI' | 'HUMAN';
export type MessageSender = 'MEMBER' | 'COACH' | 'AI' | 'SYSTEM';
export type ConversationStatus = 'ACTIVE' | 'ARCHIVED' | 'CLOSED';
export type AvailabilityStatus = 'ONLINE' | 'BUSY' | 'DO_NOT_DISTURB' | 'BE_RIGHT_BACK' | 'AWAY' | 'APPEAR_OFFLINE';

export interface PresenceDetail {
  online: boolean;
  availabilityStatus: AvailabilityStatus | null;
  statusMessage: string | null;
}

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
  coachInitiated: boolean;
  chatFilesEnabled: boolean;
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
  coachId?: string;
  coachName?: string;
  [key: string]: unknown;
}

export interface CannedResponseDto {
  id: string;
  category: string | null;
  title: string;
  content: string;
  sortOrder: number;
}

export interface TypingEvent {
  userId: string;
  name: string;
  isPlatformUser: boolean;
}
