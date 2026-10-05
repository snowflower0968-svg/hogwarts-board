import React, { useCallback, useEffect, useState } from 'react';
import {
  fetchGambleLogsAdmin, deleteGambleLogs, fetchAdminChatRooms, fetchChatMessages, deleteChatRooms,
} from '../lib/api';
import { fmtDateTime } from '../lib/helpers';

// 관리자 기록 목록 공통 틀: 기록마다 삭제 버튼 + 여러 개 선택해서 삭제
export function LogList({ items, renderRow, onDelete, emptyText, header }) {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  async function del(ids) {
    if (!ids.length) return;
    if (!window.confirm(`기록 ${ids.length}개를 삭제할까요?\n(되돌릴 수 없습니다)`)) return;
    setBusy(true);
    try { await onDelete(ids); setSelected(new Set()); setSelectMode(false); }
    catch (e) { window.alert(e.message || '삭제 중 오류가 발생했습니다.'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="log-toolbar">
        <span>{items.length}개</span>
        {header}
        {!selectMode && items.length > 0 && <button className="select-toggle" onClick={() => setSelectMode(true)}>선택 삭제</button>}
      </div>
      {selectMode && (
        <div className="select-bar">
          <span>{selected.size}개 선택</span>
          <button onClick={() => setSelected(new Set(items.map((i) => i.id)))}>전체 선택</button>
          <button className="danger" disabled={!selected.size || busy} onClick={() => del([...selected])}>{busy ? '삭제 중...' : '선택 삭제'}</button>
          <button onClick={() => { setSelectMode(false); setSelected(new Set()); }}>취소</button>
        </div>
      )}
      {items.length === 0 && <div className="empty-state">{emptyText}</div>}
      {items.map((item) => (
        <div key={item.id} className={`log-row ${selectMode && selected.has(item.id) ? 'selected' : ''}`}
          onClick={selectMode ? () => toggle(item.id) : undefined}>
          {selectMode && <input type="checkbox" className="row-check" checked={selected.has(item.id)} readOnly />}
          <div className="log-main">{renderRow(item)}</div>
          {!selectMode && <button className="log-del" disabled={busy} onClick={() => del([item.id])}>삭제</button>}
        </div>
      ))}
    </>
  );
}

// ---------------- 도박 기록 ----------------
export function GambleAdmin() {
  const [logs, setLogs] = useState(null);
  const [who, setWho] = useState('');

  useEffect(() => { fetchGambleLogsAdmin().then(setLogs).catch(() => setLogs([])); }, []);
  if (logs === null) return <div className="empty-state">불러오는 중</div>;

  const users = [];
  const seen = new Set();
  logs.forEach((g) => { if (!seen.has(g.user_id)) { seen.add(g.user_id); users.push({ id: g.user_id, name: g.profiles?.character_name || '(탈퇴)' }); } });
  const shown = who ? logs.filter((g) => g.user_id === who) : logs;
  const net = shown.reduce((sum, g) => sum + (g.result_delta || 0), 0);
  const wins = shown.filter((g) => g.result_delta > 0).length;
  const losses = shown.filter((g) => g.result_delta < 0).length;

  return (
    <>
      <div className="gstat-row">
        <div className="gstat"><div className="num">{shown.length}</div><div className="lbl">참여 횟수</div></div>
        <div className="gstat"><div className={`num ${net >= 0 ? 'pos' : 'neg'}`}>{net >= 0 ? '+' : ''}{net}</div><div className="lbl">손익 합계(P)</div></div>
        <div className="gstat"><div className="num">{wins} / {losses}</div><div className="lbl">이김 / 짐</div></div>
      </div>
      <LogList
        items={shown}
        emptyText="도박 기록이 없습니다."
        header={(
          <select className="house-select" value={who} onChange={(e) => setWho(e.target.value)} style={{ marginLeft: 'auto' }}>
            <option value="">전체 캐릭터</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        onDelete={async (ids) => { await deleteGambleLogs(ids); setLogs((prev) => prev.filter((g) => !ids.includes(g.id))); }}
        renderRow={(g) => (
          <>
            <div className="log-line1">
              <span className="log-name">{g.profiles?.character_name || '(탈퇴)'} <span className="log-id">{g.profiles?.login_id}</span></span>
              <span className={`log-delta ${g.result_delta >= 0 ? 'pos' : 'neg'}`}>{g.result_delta >= 0 ? '+' : ''}{g.result_delta}P</span>
            </div>
            <div className="log-line2">베팅 {g.bet}P · {g.multiplier}배 · 잔액 {g.balance_after}P · {fmtDateTime(g.created_at)}</div>
          </>
        )}
      />
    </>
  );
}

// ---------------- 채팅 기록 ----------------
function sameDay(a, b) { return new Date(a).toDateString() === new Date(b).toDateString(); }

function giftLabel(m) {
  const what = m.kind === 'item' ? `소지품 ${m.item_name} x${m.qty}` : `포인트 ${m.amount}`;
  const st = m.status === 'accepted' ? '받음' : m.status === 'cancelled' ? '취소됨' : '대기중';
  return `선물 · ${what} (${st})`;
}

function ChatDetail({ room, onBack, onDeleted }) {
  const [msgs, setMsgs] = useState(null);
  useEffect(() => { fetchChatMessages(room.id).then(setMsgs).catch(() => setMsgs([])); }, [room.id]);
  const active = new Date(room.expires_at).getTime() > Date.now();
  const nameA = room.a?.character_name || '(탈퇴)';
  const nameB = room.b?.character_name || '(탈퇴)';

  async function remove() {
    if (!window.confirm('이 채팅방의 모든 기록을 삭제할까요?\n(되돌릴 수 없습니다)')) return;
    await deleteChatRooms([room.id]);
    onDeleted(room.id);
  }

  let lastTime = null;
  return (
    <>
      <div className="back-row" onClick={onBack}>‹ 채팅 목록</div>
      <div className="achat-head">
        <div className="achat-names"><b>{nameA}</b> ↔ <b>{nameB}</b></div>
        <div className="row-sub">
          <span className={`status-pill ${active ? 'on' : ''}`}>{active ? '대화 가능' : '대화 종료'}</span>
          {' '}글: {room.posts?.title || '(삭제된 글)'}
        </div>
        <div className="row-sub">시작 {fmtDateTime(room.created_at)} · 만료 {fmtDateTime(room.expires_at)}</div>
        <div className="admin-row-form" style={{ marginTop: 8 }}>
          <button className="danger" onClick={remove}>이 채팅방 삭제</button>
        </div>
      </div>
      {msgs === null && <div className="empty-state">불러오는 중</div>}
      {msgs && msgs.length === 0 && <div className="empty-state">메시지가 없습니다.</div>}
      {msgs && msgs.length > 0 && (
        <div className="achat-thread">
          {msgs.map((m) => {
            const side = m.sender_id === room.user_a ? 'a' : 'b';
            const name = side === 'a' ? nameA : nameB;
            const showDate = lastTime === null || !sameDay(lastTime, m.created_at);
            lastTime = m.created_at;
            return (
              <React.Fragment key={m.id}>
                {showDate && <div className="achat-date">{new Date(m.created_at).getFullYear()}.{new Date(m.created_at).getMonth() + 1}.{new Date(m.created_at).getDate()}</div>}
                {m.type === 'gift' ? (
                  <div className="achat-gift">{name} · {giftLabel(m)}<span> {fmtDateTime(m.created_at)}</span></div>
                ) : (
                  <div className={`achat-msg ${side}`}>
                    <div className="achat-name">{name}</div>
                    <div className="achat-bubble">{m.text}</div>
                    <div className="achat-time">{fmtDateTime(m.created_at)}</div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}
    </>
  );
}

export function ChatAdmin() {
  const [rooms, setRooms] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(() => { fetchAdminChatRooms().then(setRooms).catch(() => setRooms([])); }, []);
  useEffect(() => { load(); }, [load]);

  if (rooms === null) return <div className="empty-state">불러오는 중</div>;
  if (detail) {
    return <ChatDetail room={detail} onBack={() => setDetail(null)} onDeleted={(id) => { setRooms((prev) => prev.filter((r) => r.id !== id)); setDetail(null); }} />;
  }
  return (
    <LogList
      items={rooms}
      emptyText="생성된 채팅방이 없습니다."
      onDelete={async (ids) => { await deleteChatRooms(ids); setRooms((prev) => prev.filter((r) => !ids.includes(r.id))); }}
      renderRow={(r) => {
        const active = new Date(r.expires_at).getTime() > Date.now();
        return (
          <div className="log-click" onClick={() => setDetail(r)}>
            <div className="log-line1">
              <span className="log-name">{r.a?.character_name || '(탈퇴)'} ↔ {r.b?.character_name || '(탈퇴)'}</span>
              <span className={`status-pill ${active ? 'on' : ''}`}>{active ? '대화 가능' : '종료'}</span>
            </div>
            {r.last_text && <div className="log-preview">{r.last_text}</div>}
            <div className="log-line2">
              {r.posts?.title ? `글: ${r.posts.title} · ` : ''}{fmtDateTime(r.created_at)}{r.message_count ? ` · 메시지 ${r.message_count}` : ''}
            </div>
          </div>
        );
      }}
    />
  );
}
