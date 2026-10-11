import { useEffect, useState } from 'react';
import type { BasicConnection } from '../src/connectors/lifestyle/types';

interface Props {
  connections: BasicConnection[];
  busy: boolean;
  prepare: (id: string, routeId: string) => void;
  remove: (id: string) => void;
}
export function Connections({ connections, busy, prepare, remove }: Props) {
  return <>
    <div className="page-heading"><div><h1>기본 서비스 연결</h1><p>진입 경로를 준비하고, 서비스별 기능을 단계별로 추가합니다.</p></div></div>
    <div className="info-strip">현재 단계는 연결 준비와 서비스 진입 안내입니다. 계정 로그인·권한 검증과 조회·주문·송금 등의 자동 실행은 후속 기능에서 제공됩니다.</div>
    <div className="account-grid">{connections.map(connection => <ConnectionCard key={connection.serviceId} connection={connection} busy={busy} prepare={prepare} remove={remove}/>)}</div>
  </>;
}
function ConnectionCard({ connection, busy, prepare, remove }: Omit<Props, 'connections'> & { connection: BasicConnection }) {
  const savedRoute = connection.profile?.routeId;
  const defaultRoute = connection.routes[0].id;
  const [routeId, setRouteId] = useState(savedRoute ?? defaultRoute);
  useEffect(() => { setRouteId(savedRoute ?? defaultRoute); }, [savedRoute, defaultRoute]);
  const route = connection.routes.find(r => r.id === routeId)!;
  return <article className="panel connection-card" aria-label={`${connection.name} 기본 연결`}>
    <div className="panel-heading"><h2>{connection.name}</h2><span className={`badge ${connection.state === 'prepared' ? 'documented' : ''}`}>{connection.state === 'prepared' ? '준비됨 · 계정 미검증' : '준비 전'}</span></div>
    <label htmlFor={`route-${connection.serviceId}`}>진입 경로</label>
    <select id={`route-${connection.serviceId}`} value={routeId} onChange={e => setRouteId(e.target.value)}>{connection.routes.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select>
    <p className="small">{route.description}</p>
    <div className="button-row">
      <button className="primary" disabled={busy} onClick={() => prepare(connection.serviceId, routeId)}>연결 준비 저장</button>
      <a href={route.url} target="_blank" rel="noreferrer">{route.kind === 'partnership' ? '연동 문서 열기' : '서비스 열기'} ↗</a>
      {connection.profile && <button className="danger-text" disabled={busy} onClick={() => remove(connection.serviceId)}>준비 해제</button>}
    </div>
    <p className="small connection-boundary">{connection.boundary}</p>
    <ol className="connection-stages">{connection.stages.map(stage => <li key={stage.id}><span>{stage.title}</span><small>{stage.state === 'available' ? '현재 제공' : '단계별 정의 예정'}</small></li>)}</ol>
    <details><summary>공식 근거 · 확인 날짜</summary>{connection.sources.map(source => <p className="small" key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a> · {source.checkedAt}</p>)}</details>
  </article>;
}
