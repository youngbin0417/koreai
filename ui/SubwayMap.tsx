import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { subwayMapSnapshot as snapshot } from '../src/research/subway-map';
import { subwayMapCenterOffset, subwayMapLayout } from './subway-map-model';

export function SubwayMap() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [attempt, setAttempt] = useState(0);
  const [fitWidth, setFitWidth] = useState(300);
  const [zoom, setZoom] = useState(100);
  const viewport = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null);
  const center = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const instructionId = useId(), sliderId = useId(), requested = status !== 'idle';
  const layout = subwayMapLayout(fitWidth, zoom), ready = status === 'ready';

  function rememberCenter() {
    const el = viewport.current, image = stage.current;
    if (el && image && image.clientWidth) center.current = { x: (el.scrollLeft + el.clientWidth / 2) / image.clientWidth, y: (el.scrollTop + el.clientHeight / 2) / image.clientHeight };
  }
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    let measured = false;
    const measure = () => { if (measured) rememberCenter(); else center.current = { x: 0, y: 0 }; measured = true; setFitWidth(el.clientWidth || 1); };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(el);
    return () => observer.disconnect();
  }, [requested]);
  useLayoutEffect(() => {
    const el = viewport.current, next = center.current;
    if (el && next) {
      el.scrollLeft = subwayMapCenterOffset(next.x, layout.width, el.clientWidth);
      el.scrollTop = subwayMapCenterOffset(next.y, layout.height, el.clientHeight);
      center.current = null;
    }
  }, [layout.width, layout.height]);
  function changeZoom(next: number) { rememberCenter(); setZoom(subwayMapLayout(fitWidth, next).zoom); }
  function fit() { center.current = { x: 0, y: 0 }; setZoom(100); viewport.current?.scrollTo(0, 0); }
  function releaseDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null; event.currentTarget.classList.remove('is-dragging');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function load() { setAttempt(value => value + 1); setStatus('loading'); }

  return <section className="subway-map" aria-label="수도권 지하철 노선도 보기">
    <div className="page-heading"><div><h1>지하철 노선도</h1><p>공식 국문 원본을 확대하고 이동하며 봅니다.</p></div></div>
    <div className="info-strip">자료명 기준일 {snapshot.declaredAsOf}의 보관본입니다. 이후 개통·운행 변경은 <a href={snapshot.currentMapUrl} target="_blank" rel="noreferrer">최신 공식 노선도 ↗</a>에서 확인하세요.</div>
    <p className="subway-map-credit">{snapshot.attribution}<br/><a href={snapshot.sourceUrl} target="_blank" rel="noreferrer">{snapshot.license} · 공식 출처 ↗</a><br/><small>출처 페이지 수정일 {snapshot.pageModifiedOn} · 원본 확인일 {snapshot.checkedAt}. 페이지 수정일은 노선도 갱신일과 다릅니다.</small></p>
    <p className="small">원본 JPG 약 10.5MB를 불러옵니다. 이 화면에서는 역 선택·경로 계산·실시간 운행 정보를 제공하지 않습니다.</p>
    {status === 'idle' ? <button className="primary" onClick={load}>국문 노선도 불러오기 · 10.5MB</button> : <>
      <div className="subway-map-tools" role="group" aria-label="노선도 확대와 이동">
        <button disabled={!ready || layout.zoom <= 100} onClick={() => changeZoom(layout.zoom / 1.5)}>축소</button>
        <button disabled={!ready || layout.zoom >= layout.maxZoom} onClick={() => changeZoom(layout.zoom * 1.5)}>확대</button>
        <button disabled={!ready} onClick={fit}>화면 맞춤</button>
        <button disabled={!ready || layout.zoom >= layout.maxZoom} onClick={() => changeZoom(layout.maxZoom)}>원본 크기</button>
      </div>
      <label htmlFor={sliderId}>노선도 확대 비율 · {Math.round(layout.zoom)}%</label>
      <input id={sliderId} type="range" min={100} max={layout.maxZoom} step={1} value={layout.zoom} disabled={!ready} onChange={event => changeZoom(Number(event.target.value))}/>
      <p id={instructionId} className="small">화면 안에서 손가락으로 밀거나 마우스로 끌어 이동하세요. 지도에 초점을 두고 방향키로도 이동할 수 있습니다. 두 손가락 브라우저 확대도 사용할 수 있습니다.</p>
      {status === 'loading' && <p role="status">노선도 원본을 불러오는 중입니다.</p>}
      {status === 'error' && <div role="alert"><p>노선도를 불러오지 못했습니다. 다시 불러오거나 아래 공식 출처에서 원본을 확인하세요.</p><button onClick={load}>노선도 다시 불러오기</button></div>}
      <div ref={viewport} className="subway-map-viewport" role="region" aria-label="확대 가능한 수도권 지하철 노선도" aria-describedby={instructionId} aria-busy={status === 'loading'} tabIndex={0}
        onKeyDown={event => { if (!ready || event.ctrlKey || event.altKey || event.metaKey) return; const shifts: Record<string, [number, number]> = { ArrowLeft: [-80, 0], ArrowRight: [80, 0], ArrowUp: [0, -80], ArrowDown: [0, 80] }; const shift = shifts[event.key]; if (shift) { event.preventDefault(); event.currentTarget.scrollBy(shift[0], shift[1]); } }}
        onPointerDown={event => { if (!ready || event.pointerType !== 'mouse' || event.button !== 0) return; drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop }; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.classList.add('is-dragging'); }}
        onPointerMove={event => { const start = drag.current; if (start?.id !== event.pointerId) return; event.currentTarget.scrollLeft = start.left + start.x - event.clientX; event.currentTarget.scrollTop = start.top + start.y - event.clientY; }}
        onPointerUp={releaseDrag} onPointerCancel={releaseDrag} onLostPointerCapture={releaseDrag}>
        <div ref={stage} className="subway-map-stage" style={{ width: layout.width, height: layout.height }}>
          <img key={attempt} src={snapshot.assetUrl} alt={`${snapshot.title}, 자료명 기준일 ${snapshot.declaredAsOf}. 역 검색과 이동 경로는 공식 사이버스테이션에서 확인하세요.`} width={snapshot.width} height={snapshot.height} decoding="async" draggable={false} onLoad={() => setStatus('ready')} onError={() => setStatus('error')}/>
        </div>
      </div>
    </>}
    <div className="subway-map-links"><a href={snapshot.assetUrl} target="_blank" rel="noreferrer">국문 원본 JPG 열기 ↗</a><a href={snapshot.originalUrl} target="_blank" rel="noreferrer">4개 언어 원본 ZIP 받기 ↗</a><a href={snapshot.currentMapUrl} target="_blank" rel="noreferrer">서울교통공사 사이버스테이션 ↗</a></div>
  </section>;
}
