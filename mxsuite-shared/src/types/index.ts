// =====================================================
// MXSuite Domain Types
// =====================================================

export type TenantType = 'PLATFORM' | 'CUSTOMER';
export type UserRole = 'PLATFORM_ADMIN' | 'PLATFORM_SUPPORT' | 'TENANT_ADMIN' | 'TENANT_USER';
export type PlanStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type RunType = 'DRY_RUN' | 'FULL_RUN';
export type RunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type AccessLevel = 'VIEWER' | 'EDITOR' | 'ADMIN';
export type OnboardingStatus = 'WELCOME' | 'UPLOAD' | 'MAPPING' | 'REVIEW' | 'SUBMITTED' | 'COMPLETED';
export type FeatureKey = 'onboarding' | 'projects' | 'migration' | 'my-onboarding';

// Migration lifecycle types
export type MigrationPhase = 'DISCOVER' | 'MAP' | 'GENERATE' | 'DRY_RUN' | 'MIGRATE' | 'CUT_OVER';
export type MigrationStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
export type GateStatus = 'PENDING' | 'CLEARED' | 'BLOCKED' | 'SKIPPED';

/** Maps each UserRole to the list of features enabled for that role */
export type FeatureConfig = Record<string, FeatureKey[]>;

export interface ThemeConfig {
  colorPrimary?: string;
  colorSuccess?: string;
  colorWarning?: string;
  colorError?: string;
  borderRadius?: number;
  siderBg?: string;
  headerBg?: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  tenantType: TenantType;
  active: boolean;
  brandName?: string;
  logoUrl?: string;
  themeConfig?: ThemeConfig;
  featureConfig?: FeatureConfig;
  openToAllCoaches?: boolean;
  createdBy?: string;
  createdAt: string;
  lastModifiedAt: string;
  administratorId?: string;
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  tenantId: string;
  active: boolean;
  avatarUrl?: string;
  title?: string;
  bio?: string;
  lastLoginAt?: string;
  preferences?: Record<string, unknown>;
  createdAt: string;
  lastModifiedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  tenantId?: string;
  crossTenant: boolean;
  projects?: Project[];
  accessList?: AccessEntry[];
  createdAt: string;
  lastModifiedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  tenantId: string;
  ownerId: string;
  plans?: Plan[];
  assets?: ProjectAsset[];
  accessList?: AccessEntry[];
  createdAt: string;
  lastModifiedAt: string;
}

export interface ProjectAsset {
  id: string;
  filename: string;
  contentType?: string;
  fileSize?: number;
  storagePath: string;
  assetType?: string;
  projectId: string;
  uploadedBy?: string;
  createdAt: string;
}

export interface Plan {
  id: string;
  name: string;
  description?: string;
  status: PlanStatus;
  version: number;
  definition?: PlanDefinition;
  projectId: string;
  sourceAssetId?: string;
  createdAt: string;
  lastModifiedAt: string;
}

export interface PlanDefinition {
  sourceSchema?: SchemaField[];
  targetSchema?: SchemaField[];
  mappings: FieldMapping[];
  validationRules?: ValidationRule[];
  transformations?: TransformationStep[];
}

export interface SchemaField {
  name: string;
  type: string;
  path: string;
  required?: boolean;
  children?: SchemaField[];
}

export interface FieldMapping {
  id: string;
  sourceField: string;
  targetField: string;
  transformation?: string;
  defaultValue?: string;
  required?: boolean;
}

export interface ValidationRule {
  field: string;
  rule: string;
  params?: Record<string, unknown>;
  message: string;
}

export interface TransformationStep {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

export interface PlanRun {
  id: string;
  planId: string;
  runType: RunType;
  status: RunStatus;
  triggeredBy?: string;
  startedAt?: string;
  completedAt?: string;
  recordsProcessed?: number;
  recordsSucceeded?: number;
  recordsFailed?: number;
  resultSummary?: Record<string, unknown>;
  errors?: Record<string, unknown>;
  planVersion: number;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  tenantId?: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  platformAction: boolean;
  action: string;
  entityType: string;
  entityId: string;
  entityName?: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  timestamp: string;
  ipAddress?: string;
  traceId?: string;
}

export interface AccessEntry {
  id?: string;
  userId: string;
  accessLevel: AccessLevel;
  userName?: string;
}

export interface PlatformAssignment {
  id: string;
  platformUserId: string;
  tenantId: string;
  active: boolean;
  platformUserName?: string;
  tenantName?: string;
  createdAt: string;
}

export interface SourceColumn {
  name: string;
  sampleValues: string[];
}

export interface TargetField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface Onboarding {
  id: string;
  tenantId: string;
  name: string;
  status: OnboardingStatus;
  currentStep: number;
  originalFilename?: string;
  fileSize?: number;
  rowCount?: number;
  sourceColumns?: SourceColumn[];
  targetSchema?: TargetField[];
  mappings?: FieldMapping[];
  assignedToId?: string;
  notes?: string;
  createdAt: string;
  lastModifiedAt: string;
  lastModifiedBy?: string;
  lastModifiedByName?: string;
}

// API Response types
export interface PaginatedResponse<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
}

export interface ApiError {
  status: number;
  message: string;
  details?: string;
  timestamp: string;
  traceId?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
  tenant: Tenant;
  featureConfig?: FeatureConfig;
}

export interface LoginRequest {
  email: string;
  password: string;
}

// Migration types
export interface PhaseGateDto {
  id: string;
  phase: MigrationPhase;
  gateStatus: GateStatus;
  clearedByName?: string;
  clearedAt?: string;
  blockedReason?: string;
}

export interface MigrationProject {
  id: string;
  name: string;
  sourceSystem?: string;
  targetSystem?: string;
  migrationPhase: MigrationPhase;
  migrationStatus: MigrationStatus;
  reconciliationPct: number;
  ownerName?: string;
  tenantName?: string;
  phaseGates: PhaseGateDto[];
  createdAt: string;
}

export interface MigrationStats {
  activeMigrations: number;
  gatesAwaitingApproval: number;
  avgCycleTimeDays: number;
  reconciliationPassRate: number;
}

export interface MigrationBlueprint {
  id: string;
  name: string;
  description?: string;
  sourceSystem: string;
  targetSystem: string;
  proven: boolean;
  createdAt: string;
}

// Field mapping types
export type MappingStatus = 'MAPPED' | 'NEEDS_REVIEW' | 'CFV_PROPOSAL' | 'REJECTED' | 'UNMAPPED';

export interface MappingCandidateDto {
  id: string;
  targetField: string;
  matchPct: number;
  description?: string;
}

export interface FieldMappingEntryDto {
  id: string;
  sourceEntity: string;
  sourceField: string;
  sampleValue?: string;
  targetEntity?: string;
  targetField?: string;
  coercion?: string;
  confidencePct?: number;
  mappingStatus: MappingStatus;
  ownerId?: string;
  customerComment?: string;
  candidates: MappingCandidateDto[];
  createdAt: string;
}

export interface SchemaNodeDto {
  id: string;
  nodeName: string;
  nodeType: 'ENTITY' | 'FIELD';
  recordCount?: number;
  children: SchemaNodeDto[];
}

export interface MappingStatsDto {
  // From TenantOnboardingController (tenant view)
  total?: number;
  // From FieldMappingController (coach view)
  all?: number;
  cfvProposals?: number;
  rejected?: number;
  // Common fields
  needsReview: number;
  mapped: number;
  unmapped: number;
}

// Mapping version types
export type MappingVersionSource = 'EDIT' | 'ROLLBACK' | 'IMPORT' | 'AI_MAPPING';

export interface MappingVersionDto {
  id: string;
  versionNumber: number;
  changeCount: number;
  label: string;
  description: string;
  source: MappingVersionSource;
  createdBy?: string;
  createdByName: string;
  createdAt: string;
  closedAt?: string;
}

export interface MappingVersionChangeDto {
  id: string;
  fieldMappingId: string;
  changeType: string;
  fieldName: string;
  oldValue: string;
  newValue: string;
  sourceEntity: string;
  sourceField: string;
  createdAt: string;
}

export interface MappingVersionDetailDto extends MappingVersionDto {
  changes: MappingVersionChangeDto[];
}

export interface MappingVersionDiffDto {
  mappingId: string;
  sourceEntity: string;
  sourceField: string;
  changes: { field: string; from: string; to: string }[];
}

export interface FieldChangeHistoryDto {
  id: string;
  changeType: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
  versionNumber: number;
  source: MappingVersionSource;
  createdByName: string;
}

// Semantic decision types
export type DecisionStatus = 'OPEN' | 'APPROVED' | 'REJECTED';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface DecisionOptionDto {
  label: string;
  description?: string;
  isRecommended?: boolean;
}

export interface SemanticDecisionDto {
  id: string;
  title: string;
  summary?: string;
  projectId?: string;
  projectName?: string;
  fieldContext?: string;
  decisionStatus: DecisionStatus;
  ownerId?: string;
  ownerName?: string;
  options?: DecisionOptionDto[];
  selectedOption?: number;
  requirements?: Record<string, unknown>[];
  createdAt: string;
}

export interface DecisionStatsDto {
  all: number;
  open: number;
  approved: number;
  rejected: number;
}

export interface ApprovalRequestDto {
  id: string;
  projectId: string;
  projectName?: string;
  phaseGateId: string;
  title: string;
  description?: string;
  gateType: string;
  approvalStatus: ApprovalStatus;
  requiredRole?: string;
  assignedTo?: string;
  approvedBy?: string;
  approvedAt?: string;
  artifactRef?: string;
  createdAt: string;
}

export interface ApprovalStatsDto {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

// Reconciliation types
export type ReconStatus = 'PASS' | 'WARN' | 'FAIL';

export interface ReconTierDto {
  tier: string;
  status: ReconStatus;
  threshold?: number;
  sourceRows?: number;
  targetRows?: number;
  matched?: number;
  mismatched?: number;
  variance?: number;
  columnsHashed?: number;
  fieldsSampled?: number;
  matchRate?: number;
  orphanRows?: number;
  [key: string]: unknown;
}

export interface ReconTableRowDto {
  table: string;
  sourceRows: number;
  targetRows: number;
  rowCount: ReconStatus;
  checksum: ReconStatus;
  refIntegrity: ReconStatus;
  fieldLevel: ReconStatus;
  [key: string]: unknown;
}

export interface ReconciliationReportDto {
  id: string;
  projectId: string;
  overallStatus: ReconStatus;
  warningCount: number;
  signedOff: boolean;
  signerName?: string;
  signerRole?: string;
  signedAt?: string;
  tiers: ReconTierDto[];
  tableBreakdown?: ReconTableRowDto[];
  warningDetail?: string;
  createdAt: string;
}

// Tenant onboarding types
export interface TenantOnboardingDto {
  projectId: string;
  projectName: string;
  migrationPhase: MigrationPhase;
  migrationStatus: MigrationStatus;
  reconciliationPct: number;
  phaseGates: PhaseGateDto[];
  uploadStatus: 'NONE' | 'UPLOADED' | 'PARSED';
  uploadFilename?: string;
  uploadRowCount?: number;
  mappingStats?: MappingStatsDto;
  decisionStats?: DecisionStatsDto;
  createdAt: string;
}

export interface UploadPreviewDto {
  headers: string[];
  rows: string[][];
  totalRows: number;
}

export interface UploadResultDto {
  id: string;
  originalFilename: string;
  rowCount: number;
  sourceColumns: { name: string; sampleValues: string[] }[];
  needsSheetSelection?: boolean;
  sheets?: { name: string; rowCount: number }[];
  hasExistingMappings?: boolean;
  existingMappedCount?: number;
}

// Coach dashboard types
export interface CoachDashboardDto {
  myOrganizations: number;
  totalMappingsToReview: number;
  openDecisions: number;
  pendingApprovals: number;
  organizations: OrgProgressDto[];
  phaseDistribution: Record<string, number>;
  recentActivity: CoachActivityDto[];
  attentionItems: AttentionItemDto[];
}

export interface OrgProgressDto {
  id: string;
  name: string;
  slug: string;
  phase: string | null;
  mappedCount: number;
  totalMappings: number;
  needsReview: number;
  hasBlockedGate: boolean;
  lastActivity: string | null;
}

export interface CoachActivityDto {
  id: string;
  actorName: string;
  action: string;
  entityType: string;
  entityName: string;
  tenantName: string;
  timestamp: string;
}

export interface AttentionItemDto {
  type: 'INACTIVE' | 'BLOCKED_GATE' | 'NO_UPLOAD';
  orgName: string;
  orgId: string;
  detail: string;
}

// Admin dashboard types
export interface AdminDashboardDto {
  totalOrganizations: number;
  totalUsers: number;
  activeCoaches: number;
  onboardingsInProgress: number;
  systemHealth: SystemHealthDto;
  dependencies: DependencyDto[];
  activeSessions: ActiveSessionDto[];
  apiMetrics: ApiMetricsDto;
  storage: StorageDto;
  auditStats: AuditStatsDto;
  invitationStats: InvitationStatsDto;
}

export interface ActiveSessionDto {
  userId: string;
  email: string;
  fullName: string;
  role: string;
  tenantName: string;
  firstSeen: string;
  lastActive: string;
  ipAddress: string;
}

export interface ApiMetricsDto {
  totalRequests: number;
  avgResponseMs: number;
  maxResponseMs: number;
  clientErrors: number;
  serverErrors: number;
  topEndpoints: EndpointMetricDto[];
}

export interface EndpointMetricDto {
  method: string;
  uri: string;
  count: number;
  avgMs: number;
}

export interface StorageDto {
  totalFiles: number;
  totalBytes: number;
}

export interface AuditStatsDto {
  eventsToday: number;
  eventsThisWeek: number;
  eventsThisMonth: number;
}

export interface InvitationStatsDto {
  pending: number;
  accepted: number;
  total: number;
}

export interface SystemHealthDto {
  heapUsed: number;
  heapMax: number;
  nonHeapUsed: number;
  threadCount: number;
  peakThreadCount: number;
  daemonThreadCount: number;
  cpuUsage: number;
  uptimeMillis: number;
  javaVersion: string;
  springBootVersion: string;
  osName: string;
  availableProcessors: number;
  dbPoolActive: number;
  dbPoolIdle: number;
  dbPoolMax: number;
}

export interface DependencyDto {
  group: string;
  name: string;
  version: string;
  category: string;
}

// Log viewer types
export interface LogEntryDto {
  timestamp: string;
  thread: string;
  traceId: string | null;
  spanId: string | null;
  level: string;
  logger: string;
  message: string;
}

export interface LogPageDto {
  entries: LogEntryDto[];
  fileSize: number;
  fileName: string;
}

export interface LoggerDto {
  name: string;
  configuredLevel: string | null;
  effectiveLevel: string | null;
}

// WebSocket event types
export interface WsEvent {
  type: string;
  tenantId?: string;
  entityType?: string;
  entityId?: string;
  payload: Record<string, unknown>;
  timestamp: string;
}
