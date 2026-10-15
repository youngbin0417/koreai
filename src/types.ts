import type { ZodTypeAny } from 'zod';

export type Method = 'api' | 'browser' | 'mcp' | 'handoff' | 'partnership';
export type Verification = 'unresearched' | 'documented' | 'account_verified' | 'supported' | 'suspended';
export type JobState = 'queued' | 'pending_approval' | 'running' | 'awaiting_auth' | 'awaiting_user' | 'needs_review' | 'succeeded' | 'failed' | 'cancelled';
export interface Action {
  id: string; serviceId: string; connectorId: string; title: string; description: string;
  category: string; effect: 'read' | 'write'; method: Method;
  schema: ZodTypeAny; inputSchema: Record<string, unknown>;
  credentialType?: string; requiredSecrets: string[]; scopes: string[];
  sourceUrl: string; checkedAt: string | null; verification: Verification;
  resultCheck: string; domains: string[]; version: string; maintainer: string;
  origin: 'bundled' | 'user'; implemented: boolean;
}
export interface Service {
  id: string; name: string; category: string; homeUrl: string;
  candidateActions: string[]; sourceUrl?: string; note: string;
}
export interface Account {
  id: string; label: string; credentialType: string; allowedActions: string[];
  enabled: boolean; createdAt: string; updatedAt: string; sealed: string;
}
export interface Principal {
  id: string; name: string; role: 'admin' | 'agent'; allowedActions: string[];
  allowedAccountIds: string[];
}
export interface ClientRecord extends Principal { tokenHash: string; revoked: boolean; createdAt: string }
export interface Job {
  id: string; clientId: string; actionId: string; accountId?: string;
  input: Record<string, unknown>; idempotencyKey: string; requestHash: string;
  effect: 'read' | 'write';
  state: JobState; revision: number; approvalHash?: string; dispatched: boolean;
  createdAt: string; updatedAt: string; startedAt?: string; finishedAt?: string;
  result?: unknown; error?: { code: string; message: string }; handoff?: string;
  workflowId?: string; stepName?: string; interventions: number;
  events: { at: string; state: JobState; message: string }[];
}
export interface ExecutionContext {
  job: Job; secrets: Record<string, string>; signal: AbortSignal;
  dispatch: () => void;
}
export interface ExecutionResult { data: unknown; evidence: string }
export type Executor = (action: Action, context: ExecutionContext) => Promise<ExecutionResult>;
export class ActionError extends Error {
  constructor(public code: string, message: string, public state: JobState = 'failed', public handoff?: string) { super(message); }
}
export interface Evidence {
  actionId: string; kind: 'mock' | 'live'; outcome: 'passed' | 'failed';
  note: string; at: string; jobId?: string; connectorVersion: string;
}
export interface RemoteServer {
  id: string; name: string; url: string; sealed: string;
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
  enabled: boolean; createdAt: string;
  authType?: 'bearer' | 'oauth';
  authStatus?: 'connected' | 'awaiting_auth';
  accountId?: string; requestedTools?: string[];
  presetId?: 'toss-console';
  oauthIssuer?: string; oauthExpiresAt?: number; oauthScope?: string; oauthError?: string; oauthPending?: boolean;
}
