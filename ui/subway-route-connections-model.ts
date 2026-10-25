import { subwayStations } from '../src/research/subway-stations';
import type { StationTarget } from './subway-stations-model';

export type RouteFollowupTarget = Exclude<StationTarget, 'seoul-subway.route'>;
export type RouteStationSide = 'from' | 'to';
export interface RouteStationSource { stationName: string; line: string; retrievedAt: string; searchAt: string; jobId: string }
/** Exact name+line candidates only. A route station code is deliberately never read. */
export function routeStationSelection(data: unknown, index: number, side: RouteStationSide) {
  const value = data as any;
  if (value?.kind !== 'seoul-subway.route' || value.status !== 'available' || !Array.isArray(value.segments) || !Number.isSafeInteger(index) || index < 0 || !['from', 'to'].includes(side)) return null;
  const station = value.segments[index]?.[side];
  if (!station || typeof station.name !== 'string' || typeof station.line !== 'string') return null;
  for (const time of [value.retrievedAt, value.searchAt]) if (typeof time !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(time) || !Number.isFinite(Date.parse(time))) return null;
  const matches = subwayStations.filter(row => row.name === station.name && row.line === station.line);
  if (matches.length !== 1) return null;
  return { station: matches[0]!, source: { stationName: station.name, line: station.line, retrievedAt: value.retrievedAt as string, searchAt: value.searchAt as string } };
}
