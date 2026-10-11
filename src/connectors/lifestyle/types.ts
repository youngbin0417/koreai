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
  stages: { id: string; title: string; state: 'available' | 'planned' }[];
}
