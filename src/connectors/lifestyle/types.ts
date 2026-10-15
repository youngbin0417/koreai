export interface ConnectionRoute {
  id: string;
  title: string;
  kind: 'handoff' | 'partnership';
  url: string;
  description: string;
}
export interface ConnectionDefinition {
  serviceId: string;
  name: string;
  version: string;
  domains: string[];
  routes: ConnectionRoute[];
  boundary: string;
  sources: { title: string; url: string; checkedAt: string }[];
  firstRead?: FirstReadPlan;
}
/** KoreAI's proposed contract; this does not describe a verified provider API. */
export interface FirstReadPlan {
  actionId: string;
  title: string;
  description: string;
  state: 'defined';
  access: 'provider-confirmation-required';
  checkedAt: string;
  manualUrl: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  example: Record<string, unknown>;
  accountRequirement: string;
  resultCheck: string;
  nextChecks: string[];
}
export interface ConnectionProfile {
  serviceId: string;
  routeId: string;
  preparedAt: string;
  updatedAt: string;
}
export interface BasicConnection extends ConnectionDefinition {
  state: 'unprepared' | 'prepared';
  profile: ConnectionProfile | null;
  accountVerified: false;
  automaticActions: 0;
  stages: { id: string; title: string; state: 'available' | 'defined' | 'planned' }[];
}
