/**
 * DevChatScenarioPage — Step-by-step chat scenario debugger.
 *
 * Runs 12 scripted steps that exercise every chat feature:
 *   Member greeting → help request → @mention → file upload
 *   Coach availability → takeover → reply → @mention → release
 *   Notification verification
 *
 * Layout: Step list (left) | Conversation view (centre) | API log (right)
 *
 * Route: /dev/scenario  (visible only when isDevLogin)
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Button, Tag, Typography, Alert, Select, Avatar, Spin,
} from 'antd';
import {
  CheckCircleOutlined, LoadingOutlined, StopOutlined,
  PlayCircleOutlined, MinusCircleOutlined,
  UserOutlined, TeamOutlined, ReloadOutlined,
  BugOutlined, MessageOutlined, RobotOutlined,
} from '@ant-design/icons';
import { api } from '@mxsuite/shared';
import { useAuth } from '../store/AuthContext';

const { Text } = Typography;

// ─── Storage keys ─────────────────────────────────────────────────────────────

const SK_STEP  = 'dev_scenario_step';
const SK_DATA  = 'dev_scenario_data';
const SK_MEML  = 'dev_scenario_member_email';
const SK_COACHL = 'dev_scenario_coach_email';

// ─── Types ────────────────────────────────────────────────────────────────────

type LogType    = 'req' | 'ok' | 'err' | 'info';
type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

interface LogEntry   { id: number; time: string; type: LogType; text: string; }
interface MsgEntry   { id: string; content: string; senderType: string; senderName: string | null; senderId: string | null; createdAt: string; }

interface ScenarioData {
  convId:           string;
  memberName:       string;
  memberFirstName:  string;
  coachName:        string;
  coachFirstName:   string;
  currentMode:      string;
}

interface DevUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantName: string;
}

const COACH_ROLES = ['COACH_ADMIN', 'PLATFORM_SUPPORT', 'PLATFORM_ADMIN'];

interface StepDef {
  id:           number;
  title:        string;
  detail:       string;
  requiredRole: 'MEMBER' | 'COACH' | 'ANY';
  run: (
    data:    ScenarioData,
    addLog:  (e: Omit<LogEntry, 'id'>) => void,
  ) => Promise<{ ok: boolean; detail: string; dataUpdate?: Partial<ScenarioData> }>;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function ts(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function apiCall<T>(
  method: 'get' | 'post' | 'put',
  path: string,
  addLog: (e: Omit<LogEntry, 'id'>) => void,
  body?: unknown,
  opts?: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  addLog({ time: ts(), type: 'req', text: `${method.toUpperCase()} /api${path}` });
  try {
    const res = method === 'get'
      ? await api.get<T>(path)
      : method === 'put'
      ? await api.put<T>(path, body, opts)
      : await api.post<T>(path, body, opts);
    return { ok: true, data: res.data };
  } catch (e: unknown) {
    const msg = (e as { message?: string })?.message ?? 'Request failed';
    addLog({ time: ts(), type: 'err', text: msg });
    return { ok: false, error: msg };
  }
}

// ─── Step definitions ─────────────────────────────────────────────────────────

const STEPS: StepDef[] = [
  // ── Step 1 ──────────────────────────────────────────────────────────────────
  {
    id: 1,
    title: 'Setup — find or create conversation',
    detail: 'Lists member conversations and uses the first one. Creates a new test conversation if none exist.',
    requiredRole: 'MEMBER',
    run: async (_, addLog) => {
      const list = await apiCall<any[]>('get', '/chat/conversations', addLog);
      if (!list.ok) return { ok: false, detail: list.error };

      let conv: any;
      if (list.data.length > 0) {
        conv = list.data[0];
        addLog({ time: ts(), type: 'ok', text: `Found ${list.data.length} conversation(s). Using: ${conv.id.slice(0,8)}…\nMember: ${conv.memberName}\nCoach: ${conv.assignedCoachName ?? '(unassigned)'}` });
      } else {
        addLog({ time: ts(), type: 'info', text: 'No conversations found. Creating one…' });
        const created = await apiCall<any>('post', '/chat/conversations', addLog, { subject: 'Dev Scenario Test' });
        if (!created.ok) return { ok: false, detail: created.error };
        conv = created.data;
        addLog({ time: ts(), type: 'ok', text: `Created: ${conv.id.slice(0,8)}…` });
      }

      const memberName      = conv.memberName ?? 'Member';
      const coachName       = conv.assignedCoachName ?? conv.controllingCoachName ?? 'Coach';
      return {
        ok: true,
        detail: `Conversation ${conv.id.slice(0,8)}… loaded`,
        dataUpdate: {
          convId:          conv.id,
          memberName,
          memberFirstName: memberName.split(' ')[0],
          coachName,
          coachFirstName:  coachName.split(' ')[0],
          currentMode:     conv.mode ?? 'AI',
        },
      };
    },
  },

  // ── Step 2 ──────────────────────────────────────────────────────────────────
  {
    id: 2,
    title: 'Member — send greeting',
    detail: 'Member sends a plain text message to open the conversation.',
    requiredRole: 'MEMBER',
    run: async (data, addLog) => {
      const content = 'Hello! I need some help understanding my migration plan.';
      const res = await apiCall<any>('post', `/chat/conversations/${data.convId}/messages`, addLog, { content });
      if (!res.ok) return { ok: false, detail: res.error };
      addLog({ time: ts(), type: 'ok', text: `id: ${res.data.id.slice(0,8)}…` });
      return { ok: true, detail: `Sent: "${content}"` };
    },
  },

  // ── Step 3 ──────────────────────────────────────────────────────────────────
  {
    id: 3,
    title: 'Member — request coach help',
    detail: 'Flags the conversation as help-requested. The coach will see a badge in their dashboard.',
    requiredRole: 'MEMBER',
    run: async (data, addLog) => {
      const res = await apiCall<any>('post', `/chat/conversations/${data.convId}/help-request`, addLog);
      if (!res.ok) return { ok: false, detail: res.error };
      addLog({ time: ts(), type: 'ok', text: `helpRequested: ${res.data.helpRequested}` });
      return { ok: true, detail: 'Help requested → coach dashboard badge increments' };
    },
  },

  // ── Step 4 ──────────────────────────────────────────────────────────────────
  {
    id: 4,
    title: 'Member — @mention the coach',
    detail: 'Sends a message mentioning @CoachFirstName. A CHAT_MENTION notification is created for the coach.',
    requiredRole: 'MEMBER',
    run: async (data, addLog) => {
      const content = `@${data.coachFirstName || 'Coach'} I have a question about phase 2 of the plan.`;
      const res = await apiCall<any>('post', `/chat/conversations/${data.convId}/messages`, addLog, { content });
      if (!res.ok) return { ok: false, detail: res.error };
      addLog({ time: ts(), type: 'ok', text: `→ CHAT_MENTION notification queued for coach's bell badge` });
      return { ok: true, detail: `Mention sent: "${content}"` };
    },
  },

  // ── Step 5 ──────────────────────────────────────────────────────────────────
  {
    id: 5,
    title: 'Member — upload a test file',
    detail: 'Creates a tiny TXT file in the browser and uploads it. A CHAT_FILE_SHARED notification is created for the coach.',
    requiredRole: 'MEMBER',
    run: async (data, addLog) => {
      addLog({ time: ts(), type: 'info', text: 'Building dummy file in browser…' });
      const fileContent = [
        'MXSuite Dev Scenario Test File',
        `Generated: ${new Date().toISOString()}`,
        `Conversation: ${data.convId}`,
        'This file was auto-generated by the scenario debugger.',
      ].join('\n');
      const blob  = new Blob([fileContent], { type: 'text/plain' });
      const file  = new File([blob], 'scenario-test.txt', { type: 'text/plain' });
      const form  = new FormData();
      form.append('file', file);
      form.append('content', 'Here is the test document I mentioned.');
      addLog({ time: ts(), type: 'req', text: `POST /api/chat/conversations/${data.convId.slice(0,8)}…/files\n  scenario-test.txt (${fileContent.length} bytes)` });
      try {
        const res = await api.post<any>(`/chat/conversations/${data.convId}/files`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        addLog({ time: ts(), type: 'ok', text: `Uploaded → CHAT_FILE_SHARED notification queued for coach` });
        return { ok: true, detail: `Uploaded scenario-test.txt (${(fileContent.length / 1024).toFixed(1)} KB)` };
      } catch (e: unknown) {
        const msg = (e as { message?: string })?.message ?? 'Upload failed';
        addLog({ time: ts(), type: 'err', text: msg });
        return { ok: false, detail: msg };
      }
    },
  },

  // ── Step 6 ──────────────────────────────────────────────────────────────────
  {
    id: 6,
    title: 'Coach — set availability to AWAY',
    detail: 'Status dot turns yellow (🟡) in the member\'s chat header and AppLayout badge.',
    requiredRole: 'COACH',
    run: async (_data, addLog) => {
      const res = await apiCall('put', '/chat/presence/availability', addLog,
        { status: 'AWAY', statusMessage: 'In a session – back in 30 mins' });
      if (!res.ok) return { ok: false, detail: (res as { error: string }).error };
      addLog({ time: ts(), type: 'ok', text: 'Availability → AWAY 🟡\nBroadcasted via /topic/presence.{tenantId}' });
      return { ok: true, detail: 'Coach is now AWAY' };
    },
  },

  // ── Step 7 ──────────────────────────────────────────────────────────────────
  {
    id: 7,
    title: 'Coach — take over conversation',
    detail: 'Mode switches AI → HUMAN. Member receives a MODE_CHANGE WebSocket event.',
    requiredRole: 'COACH',
    run: async (data, addLog) => {
      const res = await apiCall<any>('post', `/chat/coach/conversations/${data.convId}/takeover`, addLog);
      if (!res.ok) return { ok: false, detail: `${res.error} (coach must be assigned to this conversation)` };
      addLog({ time: ts(), type: 'ok', text: `mode: ${res.data.mode}\ncontrollingCoach: ${res.data.controllingCoachName}` });
      return { ok: true, detail: 'Took over → mode is HUMAN', dataUpdate: { currentMode: 'HUMAN' } };
    },
  },

  // ── Step 8 ──────────────────────────────────────────────────────────────────
  {
    id: 8,
    title: 'Coach — send reply to member',
    detail: 'Coach sends a message. Member\'s unread count increments.',
    requiredRole: 'COACH',
    run: async (data, addLog) => {
      const content = `Hi ${data.memberFirstName || 'there'}! I'm here to help. I've reviewed your file and have some feedback on phase 2.`;
      const res = await apiCall<any>('post', `/chat/coach/conversations/${data.convId}/messages`, addLog, { content });
      if (!res.ok) return { ok: false, detail: `${res.error} (coach must have taken over first)` };
      addLog({ time: ts(), type: 'ok', text: `id: ${res.data.id.slice(0,8)}…\n→ member unreadMemberCount +1` });
      return { ok: true, detail: `Coach replied to member` };
    },
  },

  // ── Step 9 ──────────────────────────────────────────────────────────────────
  {
    id: 9,
    title: 'Coach — @mention the member',
    detail: '@MemberFirstName triggers a CHAT_MENTION notification. Member\'s bell badge increments within 30 s.',
    requiredRole: 'COACH',
    run: async (data, addLog) => {
      const content = `@${data.memberFirstName || 'Member'} I've added comments on page 3. Take a look when you can.`;
      const res = await apiCall<any>('post', `/chat/coach/conversations/${data.convId}/messages`, addLog, { content });
      if (!res.ok) return { ok: false, detail: res.error };
      addLog({ time: ts(), type: 'ok', text: `→ CHAT_MENTION notification queued for member's bell badge` });
      return { ok: true, detail: `Mention sent: "${content}"` };
    },
  },

  // ── Step 10 ─────────────────────────────────────────────────────────────────
  {
    id: 10,
    title: 'Coach — set availability to ONLINE',
    detail: 'Status dot turns green (🟢). Member\'s chat header updates via WebSocket.',
    requiredRole: 'COACH',
    run: async (_data, addLog) => {
      const res = await apiCall('put', '/chat/presence/availability', addLog, { status: 'ONLINE' });
      if (!res.ok) return { ok: false, detail: (res as { error: string }).error };
      addLog({ time: ts(), type: 'ok', text: 'Availability → ONLINE 🟢' });
      return { ok: true, detail: 'Coach is now ONLINE' };
    },
  },

  // ── Step 11 ─────────────────────────────────────────────────────────────────
  {
    id: 11,
    title: 'Coach — release back to AI',
    detail: 'Mode switches HUMAN → AI. A system message "has left" appears in the conversation.',
    requiredRole: 'COACH',
    run: async (data, addLog) => {
      const res = await apiCall<any>('post', `/chat/coach/conversations/${data.convId}/release`, addLog);
      if (!res.ok) return { ok: false, detail: `${res.error} (coach must be the controlling coach)` };
      addLog({ time: ts(), type: 'ok', text: `mode: ${res.data.mode} — conversation returned to AI` });
      return { ok: true, detail: 'Released → mode is AI', dataUpdate: { currentMode: 'AI' } };
    },
  },

  // ── Step 12 ─────────────────────────────────────────────────────────────────
  {
    id: 12,
    title: 'Verify — check notification count',
    detail: 'Fetches unread notification count for the current user. Switch users to check the other side.',
    requiredRole: 'ANY',
    run: async (_data, addLog) => {
      const res = await apiCall<{ count: number }>('get', '/notifications/unread-count', addLog);
      if (!res.ok) return { ok: false, detail: (res as { error: string }).error };
      const count = res.data.count;
      addLog({ time: ts(), type: 'ok', text: `Unread notifications for current user: ${count}` });
      if (count === 0) addLog({ time: ts(), type: 'info', text: 'Switch to the other user and re-run this step to verify their notifications.' });
      return { ok: true, detail: `${count} unread notification${count !== 1 ? 's' : ''} for current user` };
    },
  },
];

// ─── Inline message bubble ────────────────────────────────────────────────────

function renderTokens(text: string): React.ReactNode {
  const parts = text.split(/(@\w+)/g);
  return parts.map((p, i) =>
    /^@\w+$/.test(p)
      ? <span key={i} style={{ background: '#e0d4f5', color: '#2d1854', borderRadius: 4, padding: '0 4px', fontWeight: 700, fontSize: 11 }}>{p}</span>
      : p
  );
}

function MiniMsgBubble({ content, senderType, senderName, isOwn, createdAt }: {
  content: string; senderType: string; senderName: string | null;
  isOwn: boolean; createdAt: string;
}) {
  if (senderType === 'SYSTEM') {
    return (
      <div style={{ textAlign: 'center', margin: '6px 0' }}>
        <Text style={{ fontSize: 10, color: '#8c8c8c', fontStyle: 'italic' }}>{content}</Text>
      </div>
    );
  }
  const bg       = isOwn ? '#2d1854' : senderType === 'AI' ? '#e8e0ff' : '#f3eeff';
  const textColor = isOwn ? '#fff' : '#1a1a1a';
  const icon     = senderType === 'AI'    ? <RobotOutlined /> :
                   senderType === 'COACH' ? <TeamOutlined />  : <UserOutlined />;
  return (
    <div style={{ display: 'flex', flexDirection: isOwn ? 'row-reverse' : 'row', gap: 6, marginBottom: 10, alignItems: 'flex-end' }}>
      <Avatar size={24} style={{ background: isOwn ? '#6b4fa0' : '#f0e6ff', color: isOwn ? '#fff' : '#6b4fa0', flexShrink: 0, fontSize: 10 }} icon={icon} />
      <div style={{ maxWidth: 240 }}>
        {!isOwn && senderName && <Text style={{ fontSize: 10, color: '#8c8c8c', display: 'block', marginBottom: 2 }}>{senderName}</Text>}
        <div style={{
          background: bg, color: textColor,
          padding: '6px 10px',
          borderRadius: isOwn ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
          fontSize: 12, wordBreak: 'break-word', whiteSpace: 'pre-wrap',
        }}>
          {renderTokens(content)}
        </div>
        <Text style={{ fontSize: 9, color: '#bbb', display: 'block', textAlign: isOwn ? 'right' : 'left', marginTop: 1 }}>
          {new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </div>
    </div>
  );
}

// ─── Step status icon ─────────────────────────────────────────────────────────

function StatusIcon({ status, isCurrent }: { status: StepStatus; isCurrent: boolean }) {
  if (isCurrent && status === 'running') return <LoadingOutlined style={{ color: '#1890ff' }} />;
  if (status === 'done')    return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
  if (status === 'failed')  return <StopOutlined style={{ color: '#ff4d4f' }} />;
  if (status === 'skipped') return <MinusCircleOutlined style={{ color: '#bbb' }} />;
  if (isCurrent)            return <PlayCircleOutlined style={{ color: '#2d1854' }} />;
  return <span style={{ color: '#d9d9d9', fontSize: 12 }}>○</span>;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DevChatScenarioPage() {
  const { user, isDevLogin, devLogin } = useAuth();

  const [statuses, setStatuses]         = useState<StepStatus[]>(STEPS.map(() => 'pending'));
  const [currentStep, setCurrentStep]   = useState(0);
  const [data, setData]                 = useState<ScenarioData>({ convId: '', memberName: '', memberFirstName: '', coachName: '', coachFirstName: '', currentMode: 'AI' });
  const [log, setLog]                   = useState<LogEntry[]>([]);
  const [messages, setMessages]         = useState<MsgEntry[]>([]);
  const [loadingMsgs, setLoadingMsgs]   = useState(false);
  const [memberEmail, setMemberEmail]   = useState(() => sessionStorage.getItem(SK_MEML)  || '');
  const [coachEmail, setCoachEmail]     = useState(() => sessionStorage.getItem(SK_COACHL) || '');
  const [switching, setSwitching]       = useState(false);
  const [devUsers, setDevUsers]         = useState<DevUser[]>([]);

  const logId     = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  // ── Restore state from sessionStorage on mount ───────────────────────────────
  useEffect(() => {
    const savedStep = sessionStorage.getItem(SK_STEP);
    const savedData = sessionStorage.getItem(SK_DATA);
    if (savedData) {
      try {
        const d = JSON.parse(savedData) as ScenarioData;
        setData(d);
        if (savedStep) {
          const stepIdx = parseInt(savedStep, 10);
          setCurrentStep(stepIdx);
          setStatuses(prev => {
            const next = [...prev];
            for (let i = 0; i < Math.min(stepIdx, next.length); i++) next[i] = 'done';
            return next;
          });
        }
      } catch { /* ignore */ }
    }
  }, []);

  // ── Fetch dev users for Quick Switch ──────────────────────────────────────────
  useEffect(() => {
    if (!isDevLogin) return;
    api.get<DevUser[]>('/auth/dev/users')
      .then(({ data: users }) => setDevUsers(users))
      .catch(() => {});
  }, [isDevLogin]);

  const memberUsers = devUsers.filter(u => !COACH_ROLES.includes(u.role));
  const coachUsers  = devUsers.filter(u => COACH_ROLES.includes(u.role));

  // ── Persist data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (data.convId) sessionStorage.setItem(SK_DATA, JSON.stringify(data));
  }, [data]);

  // ── Auto-scroll log ──────────────────────────────────────────────────────────
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  const addLog = useCallback((entry: Omit<LogEntry, 'id'>) => {
    setLog(prev => [...prev, { ...entry, id: ++logId.current }]);
  }, []);

  // ── Fetch messages ───────────────────────────────────────────────────────────
  const fetchMessages = useCallback(async (convId: string) => {
    if (!convId) return;
    setLoadingMsgs(true);
    const isCoach = ['COACH_ADMIN', 'PLATFORM_SUPPORT', 'PLATFORM_ADMIN'].includes(user?.role ?? '');
    const path    = isCoach
      ? `/chat/coach/conversations/${convId}/messages?size=50`
      : `/chat/conversations/${convId}/messages?size=50`;
    try {
      const res = await api.get<any>(path);
      const items: MsgEntry[] = res.data?.content ?? (Array.isArray(res.data) ? res.data : []);
      setMessages(items);
    } catch { /* silent */ }
    setLoadingMsgs(false);
  }, [user?.role]);

  useEffect(() => {
    if (data.convId) fetchMessages(data.convId);
  }, [data.convId, fetchMessages]);

  // ── Role helpers ─────────────────────────────────────────────────────────────
  const isCoachRole = ['COACH_ADMIN', 'PLATFORM_SUPPORT', 'PLATFORM_ADMIN'].includes(user?.role ?? '');
  const currentRole: 'MEMBER' | 'COACH' = isCoachRole ? 'COACH' : 'MEMBER';

  const stepDef  = currentStep < STEPS.length ? STEPS[currentStep] : null;
  const roleOk   = !stepDef || stepDef.requiredRole === 'ANY' ||
    (stepDef.requiredRole === 'MEMBER' && !isCoachRole) ||
    (stepDef.requiredRole === 'COACH'  &&  isCoachRole);
  const isRunning = statuses[currentStep] === 'running';
  const allDone   = currentStep >= STEPS.length;

  // ── Run current step ─────────────────────────────────────────────────────────
  const runStep = async () => {
    if (!stepDef || isRunning || !roleOk) return;

    setStatuses(prev => { const n = [...prev]; n[currentStep] = 'running'; return n; });
    addLog({ time: ts(), type: 'info', text: `▶ Step ${stepDef.id}: ${stepDef.title}` });

    let result: { ok: boolean; detail: string; dataUpdate?: Partial<ScenarioData> };
    try {
      result = await stepDef.run(data, addLog);
    } catch (e: unknown) {
      result = { ok: false, detail: (e as Error).message ?? 'Unexpected error' };
    }

    setStatuses(prev => { const n = [...prev]; n[currentStep] = result.ok ? 'done' : 'failed'; return n; });
    addLog({ time: ts(), type: result.ok ? 'ok' : 'err', text: result.ok ? `✅ ${result.detail}` : `❌ ${result.detail}` });

    if (result.dataUpdate) setData(prev => ({ ...prev, ...result.dataUpdate }));

    if (result.ok) {
      const nextIdx = currentStep + 1;
      setCurrentStep(nextIdx);
      sessionStorage.setItem(SK_STEP, String(nextIdx));
      const convId = result.dataUpdate?.convId ?? data.convId;
      setTimeout(() => { if (convId) fetchMessages(convId); }, 600);
    }
  };

  const skipStep = () => {
    setStatuses(prev => { const n = [...prev]; n[currentStep] = 'skipped'; return n; });
    setCurrentStep(prev => prev + 1);
  };

  const resetAll = () => {
    setStatuses(STEPS.map(() => 'pending'));
    setCurrentStep(0);
    setData({ convId: '', memberName: '', memberFirstName: '', coachName: '', coachFirstName: '', currentMode: 'AI' });
    setLog([]);
    setMessages([]);
    sessionStorage.removeItem(SK_STEP);
    sessionStorage.removeItem(SK_DATA);
  };

  const switchToUser = async (email: string, storageKey: string) => {
    sessionStorage.setItem(storageKey, email);
    sessionStorage.setItem(SK_STEP, String(currentStep));
    sessionStorage.setItem(SK_DATA, JSON.stringify(data));
    setSwitching(true);
    await devLogin(email);
    window.location.reload();
  };

  // ── Role colour for step list dots ───────────────────────────────────────────
  const roleColor = (r: 'MEMBER' | 'COACH' | 'ANY') =>
    r === 'MEMBER' ? '#1890ff' : r === 'COACH' ? '#6b4fa0' : '#52c41a';

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fafafa' }}>

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div style={{ background: '#1a0e3a', color: '#fff', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <BugOutlined style={{ fontSize: 17 }} />
        <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: 0.5 }}>Chat Scenario Debugger</span>

        <Tag color={isCoachRole ? '#6b4fa0' : '#1890ff'} style={{ margin: 0 }}>
          {isCoachRole ? '🎓' : '👤'} {user?.firstName} {user?.lastName} · {user?.role}
        </Tag>

        {data.convId && (
          <Tag style={{ fontFamily: 'monospace', fontSize: 10, margin: 0, background: 'rgba(255,255,255,0.1)', color: '#ccc', border: 'none' }}>
            conv {data.convId.slice(0, 8)}…
          </Tag>
        )}

        {data.currentMode && data.convId && (
          <Tag color={data.currentMode === 'HUMAN' ? 'green' : 'purple'} style={{ margin: 0 }}>
            {data.currentMode === 'HUMAN' ? '👨 HUMAN' : '🤖 AI'}
          </Tag>
        )}

        <div style={{ flex: 1 }} />

        <Button size="small" icon={<ReloadOutlined />} onClick={resetAll}
          style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.3)', color: '#ccc' }}>
          Reset All
        </Button>
      </div>

      {/* ── Three-column body ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── LEFT: step list ──────────────────────────────────────────────── */}
        <div style={{ width: 264, borderRight: '1px solid #e8e0f5', background: '#fff', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>

          {/* Header */}
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #f0e6ff', background: '#f3eeff' }}>
            <Text style={{ fontSize: 11, fontWeight: 700, color: '#6b4fa0', textTransform: 'uppercase', letterSpacing: 1 }}>Steps</Text>
            <Text style={{ fontSize: 11, color: '#8c8c8c', display: 'block' }}>
              {allDone ? '✅ All complete!' : `${currentStep} / ${STEPS.length} done`}
            </Text>
          </div>

          {/* Step rows */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {STEPS.map((step, idx) => {
              const status    = statuses[idx];
              const isCurrent = idx === currentStep;
              return (
                <div key={step.id} style={{
                  padding: '8px 12px',
                  borderBottom: '1px solid #f5f0ff',
                  background: isCurrent ? '#f3eeff' : 'transparent',
                  borderLeft: `3px solid ${isCurrent ? '#2d1854' : 'transparent'}`,
                  opacity: idx > currentStep && status === 'pending' ? 0.5 : 1,
                  transition: 'opacity 0.2s',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StatusIcon status={status} isCurrent={isCurrent} />
                    <Text style={{ fontSize: 12, fontWeight: isCurrent ? 600 : 400, flex: 1, lineHeight: 1.3 }}>
                      {step.id}. {step.title}
                    </Text>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: roleColor(step.requiredRole), flexShrink: 0 }}
                      title={`Requires: ${step.requiredRole}`} />
                  </div>
                  {isCurrent && (
                    <Text style={{ fontSize: 11, color: '#8c8c8c', display: 'block', marginTop: 4, marginLeft: 24, lineHeight: 1.4 }}>
                      {step.detail}
                    </Text>
                  )}
                  {status === 'failed' && !isCurrent && (
                    <Text style={{ fontSize: 10, color: '#ff4d4f', marginLeft: 24, display: 'block' }}>Failed</Text>
                  )}
                </div>
              );
            })}
          </div>

          {/* Controls */}
          <div style={{ padding: '10px 12px', borderTop: '1px solid #e0d4f5' }}>
            {allDone ? (
              <div style={{ textAlign: 'center' }}>
                <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 28 }} />
                <Text style={{ display: 'block', color: '#52c41a', fontWeight: 600, marginTop: 4 }}>Scenario complete!</Text>
                <Button size="small" onClick={resetAll} style={{ marginTop: 8 }}>Run Again</Button>
              </div>
            ) : (
              <>
                {!roleOk && stepDef && (
                  <Alert
                    type="warning"
                    showIcon
                    message={`Needs ${stepDef.requiredRole} role`}
                    description={`You are logged in as ${user?.role ?? '?'}. Switch accounts below.`}
                    style={{ marginBottom: 8, fontSize: 11 }}
                  />
                )}
                <Button type="primary" block onClick={runStep} loading={isRunning}
                  disabled={!roleOk || isRunning} icon={<PlayCircleOutlined />}
                  style={{ background: '#6b4fa0', borderColor: '#6b4fa0', color: '#fff', fontWeight: 600, marginBottom: 6 }}>
                  Run Step {stepDef?.id}
                </Button>
                <Button block size="small" onClick={skipStep} disabled={isRunning}>Skip this step</Button>
              </>
            )}
          </div>

          {/* DevLogin quick-switch */}
          {isDevLogin && (
            <div style={{ padding: '10px 12px', borderTop: '1px solid #ffe58f', background: '#fffbe6' }}>
              <Text style={{ fontSize: 11, fontWeight: 700, color: '#d48806', display: 'block', marginBottom: 6 }}>⚡ Quick Switch</Text>

              <Text style={{ fontSize: 10, color: '#8c8c8c', display: 'block', marginBottom: 2 }}>Member</Text>
              <Select
                size="small"
                placeholder="Select member…"
                value={memberEmail || undefined}
                onChange={(val: string) => { setMemberEmail(val); sessionStorage.setItem(SK_MEML, val); }}
                style={{ width: '100%', marginBottom: 4, fontSize: 11 }}
                showSearch
                optionFilterProp="label"
                options={memberUsers.map(u => ({
                  value: u.email,
                  label: `${u.firstName} ${u.lastName}`,
                  desc: `${u.role} · ${u.tenantName}`,
                }))}
                optionRender={(opt) => (
                  <div>
                    <span style={{ fontSize: 12 }}>{opt.label}</span>
                    <span style={{ fontSize: 10, color: '#8c8c8c', marginLeft: 6 }}>{(opt.data as any).desc}</span>
                  </div>
                )}
              />
              <Button block size="small" icon={<UserOutlined />} loading={switching}
                disabled={!memberEmail || switching}
                onClick={() => switchToUser(memberEmail, SK_MEML)}
                style={{ marginBottom: 8, fontSize: 11 }}>
                Switch → Member
              </Button>

              <Text style={{ fontSize: 10, color: '#8c8c8c', display: 'block', marginBottom: 2 }}>Coach</Text>
              <Select
                size="small"
                placeholder="Select coach…"
                value={coachEmail || undefined}
                onChange={(val: string) => { setCoachEmail(val); sessionStorage.setItem(SK_COACHL, val); }}
                style={{ width: '100%', marginBottom: 4, fontSize: 11 }}
                showSearch
                optionFilterProp="label"
                options={coachUsers.map(u => ({
                  value: u.email,
                  label: `${u.firstName} ${u.lastName}`,
                  desc: `${u.role} · ${u.tenantName}`,
                }))}
                optionRender={(opt) => (
                  <div>
                    <span style={{ fontSize: 12 }}>{opt.label}</span>
                    <span style={{ fontSize: 10, color: '#8c8c8c', marginLeft: 6 }}>{(opt.data as any).desc}</span>
                  </div>
                )}
              />
              <Button block size="small" icon={<TeamOutlined />} loading={switching}
                disabled={!coachEmail || switching}
                onClick={() => switchToUser(coachEmail, SK_COACHL)}
                style={{ fontSize: 11 }}>
                Switch → Coach
              </Button>
            </div>
          )}

          {/* Role legend */}
          <div style={{ padding: '8px 12px', borderTop: '1px solid #f0e6ff', background: '#fafafa', fontSize: 10, color: '#8c8c8c' }}>
            <span style={{ color: '#1890ff' }}>●</span> Member&nbsp;&nbsp;
            <span style={{ color: '#6b4fa0' }}>●</span> Coach&nbsp;&nbsp;
            <span style={{ color: '#52c41a' }}>●</span> Any role
          </div>
        </div>

        {/* ── CENTRE: conversation ─────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* Centre header */}
          <div style={{ padding: '8px 16px', borderBottom: '1px solid #e0d4f5', background: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
            <MessageOutlined style={{ color: '#6b4fa0' }} />
            <Text style={{ fontWeight: 600, fontSize: 13 }}>Conversation</Text>
            <Text style={{ fontSize: 11, color: '#8c8c8c' }}>
              {messages.length} message{messages.length !== 1 ? 's' : ''}
              {data.memberName  && <> · Member: <strong>{data.memberName}</strong></>}
              {data.coachName   && <> · Coach: <strong>{data.coachName}</strong></>}
            </Text>
            {data.convId && (
              <Button size="small" onClick={() => fetchMessages(data.convId)} loading={loadingMsgs}
                style={{ marginLeft: 'auto', fontSize: 11 }}>
                ↻ Refresh
              </Button>
            )}
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, background: '#f5f0ff' }}>
            {!data.convId ? (
              <div style={{ textAlign: 'center', paddingTop: 60, color: '#bbb' }}>
                <MessageOutlined style={{ fontSize: 48, opacity: 0.2 }} />
                <Text style={{ display: 'block', marginTop: 16, color: '#bbb', fontSize: 13 }}>
                  Run <strong>Step 1</strong> to load a conversation
                </Text>
              </div>
            ) : loadingMsgs ? (
              <div style={{ textAlign: 'center', paddingTop: 60 }}><Spin /></div>
            ) : messages.length === 0 ? (
              <Text style={{ color: '#bbb', display: 'block', textAlign: 'center', paddingTop: 40 }}>No messages yet</Text>
            ) : (
              messages.map(msg => (
                <MiniMsgBubble
                  key={msg.id}
                  content={msg.content}
                  senderType={msg.senderType}
                  senderName={msg.senderName}
                  isOwn={msg.senderId === user?.id}
                  createdAt={msg.createdAt}
                />
              ))
            )}
          </div>

          {/* Centre footer — feature indicators */}
          <div style={{ padding: '6px 16px', borderTop: '1px solid #e0d4f5', background: '#fff', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <span style={{ fontSize: 10, color: '#8c8c8c' }}>
              Your messages appear on the <strong>right</strong> · @mentions show as <span style={{ background: '#e0d4f5', color: '#2d1854', padding: '0 3px', borderRadius: 3, fontWeight: 700 }}>chips</span>
            </span>
            <span style={{ fontSize: 10, color: '#8c8c8c' }}>
              Bell badge updates within <strong>30 s</strong> (polling) · Presence dots via <strong>WebSocket</strong>
            </span>
          </div>
        </div>

        {/* ── RIGHT: API log ────────────────────────────────────────────────── */}
        <div style={{ width: 290, borderLeft: '1px solid #e0d4f5', background: '#0f0f1a', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>

          <div style={{ padding: '10px 12px', borderBottom: '1px solid #1e1e3a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 11, fontWeight: 700, color: '#7070a0', textTransform: 'uppercase', letterSpacing: 1 }}>API Log</Text>
            <Button type="text" size="small" onClick={() => setLog([])}
              style={{ color: '#3a3a5a', fontSize: 10, padding: '0 4px', height: 'auto' }}>
              Clear
            </Button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', fontFamily: "'JetBrains Mono', Consolas, monospace" }}>
            {log.length === 0 && (
              <Text style={{ color: '#2a2a4a', fontSize: 11 }}>No events yet. Run a step to start.</Text>
            )}
            {log.map(entry => {
              const color = {
                req:  '#69c0ff',   // blue
                ok:   '#52c41a',   // green
                err:  '#ff4d4f',   // red
                info: '#ffd591',   // amber
              }[entry.type];
              return (
                <div key={entry.id} style={{ marginBottom: 8, lineHeight: 1.5 }}>
                  <span style={{ color: '#3a3a5a', fontSize: 9 }}>{entry.time}  </span>
                  <span style={{ color, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', display: 'block' }}>
                    {entry.text}
                  </span>
                </div>
              );
            })}
            <div ref={logEndRef} />
          </div>
        </div>

      </div>
    </div>
  );
}
