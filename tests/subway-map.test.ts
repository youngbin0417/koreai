import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { subwayMapSnapshot as snapshot } from '../src/research/subway-map.js';
import { subwayMapLayout, subwayMapCenterOffset } from '../ui/subway-map-model.js';
import { SubwayMap } from '../ui/SubwayMap.js';

test('bundled subway JPG is exactly the reviewed original with a separate license and source notice', () => {
  const bytes = readFileSync(resolve('public' + snapshot.assetUrl));
  assert.equal(bytes.length, snapshot.byteLength); assert.equal(createHash('sha256').update(bytes).digest('hex'), snapshot.sha256);
  assert.equal(bytes.readUInt16BE(0), 0xffd8); assert.equal(bytes.readUInt16BE(bytes.length - 2), 0xffd9);
  const notice = readFileSync('public/maps/NOTICE.txt', 'utf8'), thirdParty = readFileSync('THIRD_PARTY_NOTICES.md', 'utf8');
  for (const text of [snapshot.sha256, snapshot.sourceUrl, '제3유형', '출처표시', '변경금지', 'Apache-2.0']) { assert(notice.includes(text)); assert(thirdParty.includes(text)); }
  assert.equal(snapshot.declaredAsOf, '2025-12-08'); assert.equal(snapshot.pageModifiedOn, '2026-09-10');
});

test('map zoom fits the viewport, preserves original dimensions and clamps centers across mobile and desktop resize', () => {
  for (const viewport of [1, 280, 357, 390, 800, 1200, 9000, 0, -10, NaN, Infinity]) {
    const fit = subwayMapLayout(viewport, 100), full = subwayMapLayout(viewport, fit.maxZoom);
    assert(fit.width >= 1 && fit.width <= snapshot.width); assert.equal(fit.height, fit.width); assert.equal(full.width, snapshot.width); assert.equal(full.height, snapshot.height);
    assert.equal(subwayMapLayout(viewport, -1).zoom, 100); assert.equal(subwayMapLayout(viewport, NaN).zoom, 100); assert.equal(subwayMapLayout(viewport, 1e8).width, snapshot.width);
  }
  assert.equal(subwayMapLayout(390, 200).width, 780); assert.equal(subwayMapCenterOffset(0.5, 1000, 200), 400); assert.equal(subwayMapCenterOffset(0.5, 2000, 400), 800);
  assert.equal(subwayMapCenterOffset(-1, 1000, 200), 0); assert.equal(subwayMapCenterOffset(2, 1000, 200), 800); assert.equal(subwayMapCenterOffset(1, 100, 200), 0); assert.equal(subwayMapCenterOffset(NaN, 1000, 200), 400);
});

test('idle map renders its dated attribution and load size without requesting or preloading an image', () => {
  const html = renderToStaticMarkup(createElement(SubwayMap));
  for (const text of [snapshot.declaredAsOf, snapshot.pageModifiedOn, snapshot.checkedAt, '변경금지', '10.5MB', '국문 노선도 불러오기', snapshot.sourceUrl, snapshot.currentMapUrl]) assert(html.includes(text), text);
  assert(!html.includes('<img')); assert(!html.includes('rel="preload"')); assert(!html.includes('<canvas')); assert(!html.includes('<iframe'));
});
