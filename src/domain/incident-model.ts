/**
 * SignalRoom domain vocabulary — the single source of truth for every
 * enumerated value. Imported by schemas (select options), server actions
 * (validation) and the UI (form options), so the three can never drift.
 */

export const INCIDENT_SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number]

/** `Creating` is an internal fail-closed state used only during creation. */
export const INCIDENT_STATUSES = ['Creating', 'Open', 'Investigating', 'Resolved', 'Closed'] as const
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]
/** Statuses an Owner may set after creation. */
export const SETTABLE_INCIDENT_STATUSES = ['Open', 'Investigating', 'Resolved', 'Closed'] as const

export const INCIDENT_ROLES = ['Owner', 'Investigator', 'Viewer'] as const
export type IncidentRole = (typeof INCIDENT_ROLES)[number]
/** Roles an Owner may grant. Ownership itself is not transferable here. */
export const ASSIGNABLE_ROLES = ['Investigator', 'Viewer'] as const
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number]

export const MEMBERSHIP_STATUSES = ['active', 'removed'] as const
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number]

export const EVIDENCE_TYPES = [
  'Log',
  'Metric',
  'Alert',
  'Trace',
  'Screenshot',
  'Message',
  'Document',
  'Observation',
  'Other',
] as const
export type EvidenceType = (typeof EVIDENCE_TYPES)[number]

export const VERIFICATION_STATUSES = ['Unverified', 'Verified', 'Disputed'] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

export const HYPOTHESIS_STATUSES = [
  'Proposed',
  'Under Investigation',
  'Supported',
  'Rejected',
  'Inconclusive',
] as const
export type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number]

export const EVIDENCE_RELATIONSHIPS = ['Supports', 'Contradicts', 'Neutral'] as const
export type EvidenceRelationship = (typeof EVIDENCE_RELATIONSHIPS)[number]

/** Field length limits shared by the server validators and the form inputs. */
export const LIMITS = {
  title: 160,
  description: 4000,
  category: 80,
  source: 300,
  email: 254,
  timestamp: 40,
} as const

// ---------------------------------------------------------------------------
// Record shapes (the `data` of each collection's records)
// ---------------------------------------------------------------------------

export interface IncidentData {
  incidentId: string
  title: string
  description: string
  category: string
  severity: IncidentSeverity
  status: IncidentStatus
  ownerId: string
  initialTimestamp: string
}

export interface TeamMemberData {
  teamId: string
  userId: string
  role: IncidentRole
  status: MembershipStatus
}

export interface EvidenceData {
  incidentId: string
  title: string
  description: string
  type: EvidenceType
  source: string
  verificationStatus: VerificationStatus
}

export interface TimelineEventData {
  incidentId: string
  title: string
  description: string
  occurredAt: string
  /** Empty string when the event is not tied to a piece of evidence. */
  sourceEvidenceId: string
  /** 1 = highlighted as an important event, 0 = normal. */
  important: number
}

export interface HypothesisData {
  incidentId: string
  title: string
  explanation: string
  status: HypothesisStatus
}

export interface EvidenceLinkData {
  incidentId: string
  evidenceId: string
  hypothesisId: string
  relationship: EvidenceRelationship
}

/** A member as returned by the `listIncidentMembers` action. */
export interface IncidentMemberView {
  userId: string
  name: string
  /** Only included for the incident Owner, who manages membership. */
  email?: string
  role: IncidentRole
  status: MembershipStatus
}

/** Deterministic membership record id: one row per (incident, user). */
export function membershipRecordId(incidentId: string, userId: string): string {
  return `${incidentId}:${userId}`
}

/** Deterministic link record id: one relationship per (evidence, hypothesis). */
export function evidenceLinkRecordId(evidenceId: string, hypothesisId: string): string {
  return `${evidenceId}:${hypothesisId}`
}
