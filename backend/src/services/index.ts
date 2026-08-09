export { clientService, ClientService } from './client.service.js';
export { contactService, ContactService } from './contact.service.js';
export { callService, CallService } from './call.service.js';
export { userService, UserService } from './user.service.js';
export { ticketService, TicketService } from './ticket.service.js';
export { onboardingService, OnboardingService } from './onboarding.service.js';
export { actionItemService, ActionItemService } from './actionItem.service.js';
export { callRecordService, CallRecordService } from './callRecord.service.js';
export { provisioningService, ProvisioningService } from './provisioning.service.js';
export type { ProvisionOptions, ProvisionResult, RenderedAgent } from './provisioning.service.js';
export { agentSyncService, AgentSyncService, SYNC_DEBOUNCE_MS } from './agentSync.service.js';
export type { AgentSyncState } from './agentSync.service.js';
export { writeAuditLog, withAudit, auditTranscriptView } from './audit.service.js';
export type { AuditActor } from './audit.service.js';
export { clayLeadService, ClayLeadService, ClayIngestError, clayLeadSchema } from './clay-lead.service.js';
export type { ClayLeadInput, ClayLeadResult } from './clay-lead.service.js';
export { systemErrorService, SystemErrorService, fingerprintFor, normalizeMessage } from './systemError.service.js';
export type { ErrorSource, ErrorSeverity, RecordErrorInput } from './systemError.service.js';
export { systemAlertService, SystemAlertService, ALERT_OCCURRENCE_THRESHOLD, ALERT_WINDOW_MS } from './systemAlert.service.js';
export {
  getRolePermissions,
  getEffectivePermissions,
  roleHasPermission,
  listRolePermissions,
  invalidatePermissionCache,
} from './permission.service.js';
export {
  listOverrides,
  setOverride,
  clearOverride,
  PermissionOverlayError,
} from './clientPermission.service.js';
export type { OverrideRow } from './clientPermission.service.js';
export { knowledgeService, KnowledgeService } from './knowledge.service.js';
export type { ClientKnowledge, KnowledgeSearchResult } from './knowledge.service.js';
export {
  assertWithinPromptBoundary,
  isWithinPromptBoundary,
  describeBoundary,
  PromptBoundaryError,
  GRAVVIA_MANAGED_FIELDS,
} from './promptBoundary.service.js';
export type { BoundaryDescription, GravviaManagedField } from './promptBoundary.service.js';
export { diffConfig, IMPACT_AREAS } from './configDiff.service.js';
export type { ConfigDiff, DiffEntry, DiffKind, ImpactArea } from './configDiff.service.js';
export { integrationHealth, integrationHealthService } from './integrationHealth.service.js';
export type { ChannelHealth, HealthStatus } from './integrationHealth.service.js';
export { agentDraftService, DraftError, fingerprintSettings } from './agentDraft.service.js';
export type { DraftRow, DraftState, PublishResult } from './agentDraft.service.js';
