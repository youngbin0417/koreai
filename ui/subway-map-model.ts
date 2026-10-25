import { subwayMapSnapshot } from '../src/research/subway-map';

export function subwayMapLayout(viewportWidth: number, requestedZoom: number) {
  const fitWidth = Math.min(subwayMapSnapshot.width, Math.max(1, Math.floor(Number.isFinite(viewportWidth) ? viewportWidth : 1)));
  const maxZoom = Math.max(100, Math.ceil(subwayMapSnapshot.width / fitWidth * 100));
  const zoom = Math.min(maxZoom, Math.max(100, Number.isFinite(requestedZoom) ? requestedZoom : 100));
  const width = Math.min(subwayMapSnapshot.width, Math.round(fitWidth * zoom / 100));
  return { fitWidth, maxZoom, zoom, width, height: Math.round(width * subwayMapSnapshot.height / subwayMapSnapshot.width) };
}

export function subwayMapCenterOffset(fraction: number, imageLength: number, viewportLength: number) {
  const center = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0.5;
  return Math.max(0, Math.min(Math.max(0, imageLength - viewportLength), center * imageLength - viewportLength / 2));
}
