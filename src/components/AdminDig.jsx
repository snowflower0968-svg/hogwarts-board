import React, { useCallback, useEffect, useState } from 'react';
import {
  fetchDigRewards, saveDigReward, deleteDigReward, subscribeDigPublic, subscribeDigSecret,
  adminNewRound, adminAssignCell, adminRandomizeUndug, fetchDigLogs,
  fetchItemsOf, adminGrantItem, adminRemoveItem, fetchItemLogs,
  deleteDigLogs, deleteItemLogs, fetchProfileById, fetchNotes, adminGrantDigTickets,
} from '../lib/api';
import { fmtDateTime } from '../lib/helpers';
import { LogList } from './AdminLogs';

const cellPos = (i) => `${Math.floor(i / 9) + 1}행 ${(i % 9) + 1}열`;

function RewardRow({ r, total, onChanged }) {
  const [name, setName] = useState(r.name);
  const [desc, setDesc] = useState(r.description);
  const [weight, setWeight] = useState(String(r.weight));
  const [empty, setEmpty] = useState(r.empty);
  const [err, setErr] = useState('');
  const pct = total > 0 ? Math.round(((Number(weight) || 0) / total) * 1000) / 10 : 0;

  async function save() {
    setErr('');
    try { await saveDigReward(r.id, { name, description: desc, weight, empty }); await onChanged(); }
    catch (e) { setErr(e.message); }
  }
  async function del() {
    if (!window.confirm(`"${r.name}" 보상을 목록에서 삭제할까요?\n(이미 칸에 배치된 보상은 그대로 남습니다)`)) return;
    await deleteDigReward(r.id); await onChanged();
  }
  return (
    <div className="list-row">
      {err && <div className="auth-error">{err}</div>}
      <div className="admin-row-form">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" style={{ flex: 1, minWidth: 90 }} />
        <input type="number" min="0" step="any" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="확률" style={{ width: 64 }} />
        <span style={{ fontSize: 12, color: 'var(--text-light)' }}>% (실제 {pct}%)</span>
      </div>
      <div className="admin-row-form">
        <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="효과/설명 (소지품 클릭 시 표시)" style={{ flex: 1, minWidth: 140 }} />
      </div>
      <div className="admin-row-form">
        <label style={{ fontSize: 12, color: 'var(--text-mid)' }}><input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} /> 꽝(소지품에 안 들어감)</label>
        <button className="accent" onClick={save}>저장</button>
        <button className="danger" onClick={del}>삭제</button>
      </div>
    </div>
  );
}

export function DigAdmin() {
  const [rewards, setRewards] = useState([]);
  const [pub, setPub] = useState(undefined);
  const [sec, setSec] = useState(undefined);
  const [editIdx, setEditIdx] = useState(null);
  const [pick, setPick] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [nName, setNName] = useState('');
  const [nDesc, setNDesc] = useState('');
  const [nWeight, setNWeight] = useState('10');
  const [nEmpty, setNEmpty] = useState(false);

  const loadRewards = useCallback(async () => { setRewards(await fetchDigRewards()); }, []);
  useEffect(() => { loadRewards(); }, [loadRewards]);
  useEffect(() => subscribeDigPublic(setPub), []);
  useEffect(() => subscribeDigSecret(setSec), []);

  const total = rewards.reduce((sum, r) => sum + (r.weight || 0), 0);

  async function run(fn, msg) {
    setErr(''); setOk('');
    try { await fn(); if (msg) setOk(msg); } catch (e) { setErr(e.message || '오류가 발생했습니다.'); }
  }
  async function addReward(e) {
    e.preventDefault();
    await run(async () => {
      await saveDigReward(null, { name: nName, description: nDesc, weight: nWeight, empty: nEmpty });
      setNName(''); setNDesc(''); setNEmpty(false);
      await loadRewards();
    }, '보상을 추가했습니다.');
  }
  async function saveCell() {
    const reward = rewards.find((r) => r.id === pick) || null;
    await run(async () => { await adminAssignCell(editIdx, reward); setEditIdx(null); }, '칸을 수정했습니다.');
  }

  const started = pub && sec;

  return (
    <>
      <div className="field-label">보상 목록 (확률 합계 {Math.round(total * 10) / 10}%)</div>
      <div className="board-note" style={{ padding: '0 4px 8px' }}>확률 합계가 100이 아니어도 비율대로 계산됩니다. "꽝"은 소지품에 들어가지 않습니다.</div>
      {rewards.map((r) => <RewardRow key={r.id + r.name + r.weight} r={r} total={total} onChanged={loadRewards} />)}
      <form className="list-row" onSubmit={addReward}>
        <div className="admin-row-form">
          <input type="text" value={nName} onChange={(e) => setNName(e.target.value)} placeholder="새 보상 이름" style={{ flex: 1, minWidth: 90 }} />
          <input type="number" min="0" step="any" value={nWeight} onChange={(e) => setNWeight(e.target.value)} placeholder="확률" style={{ width: 64 }} />
          <span style={{ fontSize: 12, color: 'var(--text-light)' }}>%</span>
        </div>
        <div className="admin-row-form">
          <input type="text" value={nDesc} onChange={(e) => setNDesc(e.target.value)} placeholder="효과/설명" style={{ flex: 1, minWidth: 140 }} />
        </div>
        <div className="admin-row-form">
          <label style={{ fontSize: 12, color: 'var(--text-mid)' }}><input type="checkbox" checked={nEmpty} onChange={(e) => setNEmpty(e.target.checked)} /> 꽝</label>
          <button className="accent" type="submit">보상 추가</button>
        </div>
      </form>

      <div className="field-label">9 x 9 판 관리</div>
      {err && <div className="auth-error" style={{ margin: '0 4px 10px' }}>{err}</div>}
      {ok && <div className="auth-success" style={{ margin: '0 4px 10px' }}>{ok}</div>}
      <div className="admin-row-form" style={{ padding: '0 4px 10px' }}>
        {!started && <button className="accent" onClick={() => run(adminNewRound, '간이 조사를 시작했습니다.')}>간이 조사 시작 (전체 랜덤 배치)</button>}
        {started && (
          <>
            <button className="accent" onClick={() => run(adminRandomizeUndug, '안 깐 칸을 랜덤으로 다시 배치했습니다.')}>랜덤 배치 (안 깐 칸)</button>
            <button className="danger" onClick={() => { if (window.confirm('모든 칸을 새로 랜덤 배치하고 조사 기록을 초기화할까요?')) run(adminNewRound, '새 판을 시작했습니다.'); }}>새 판 시작 (전체 랜덤 + 초기화)</button>
          </>
        )}
      </div>

      {started && (
        <>
          <div className="board-note" style={{ padding: '0 4px 8px' }}>
            {pub.round || 1}번째 판 · 칸을 누르면 보상을 직접 바꿀 수 있습니다. (이미 깐 칸은 누가 깠는지 확인만 가능)
          </div>
          <div className="dig-grid admin">
            {sec.cells.map((c, i) => {
              const dug = pub.cells[i]?.dug;
              return (
                <button
                  key={i}
                  type="button"
                  className={`dig-cell ${dug ? 'dug' : ''} ${!c.assigned ? 'unassigned' : ''} ${c.empty ? 'empty' : ''}`}
                  onClick={() => { setEditIdx(i); setPick(c.rewardId || ''); setErr(''); setOk(''); }}
                  title={dug ? `${c.byName} 님이 조사` : ''}
                >
                  {c.assigned ? c.name : '?'}
                </button>
              );
            })}
          </div>
        </>
      )}

      {editIdx !== null && started && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setEditIdx(null)}>
          <div className="modal-card small">
            <div className="modal-title">{cellPos(editIdx)}</div>
            {pub.cells[editIdx].dug ? (
              <>
                <div className="dig-result-name">{sec.cells[editIdx].name}</div>
                <div className="confirm-msg">
                  {sec.cells[editIdx].byName} 님이 조사<br />
                  {sec.cells[editIdx].at ? fmtDateTime(sec.cells[editIdx].at) : ''}
                </div>
                <div className="modal-actions"><button className="modal-cancel" onClick={() => setEditIdx(null)}>닫기</button></div>
              </>
            ) : (
              <>
                <div className="confirm-msg">현재: {sec.cells[editIdx].assigned ? sec.cells[editIdx].name : '미지정'}</div>
                <select value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">미지정 (조사 시 랜덤)</option>
                  {rewards.map((r) => <option key={r.id} value={r.id}>{r.name}{r.empty ? ' (꽝)' : ''}</option>)}
                </select>
                <div className="modal-actions">
                  <button className="modal-cancel" onClick={() => setEditIdx(null)}>취소</button>
                  <button className="modal-confirm" onClick={saveCell}>저장</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function DigLogsAdmin() {
  const [logs, setLogs] = useState(null);
  useEffect(() => { fetchDigLogs().then(setLogs).catch(() => setLogs([])); }, []);
  if (logs === null) return <div className="empty-state">불러오는 중</div>;
  return (
    <LogList
      items={logs}
      emptyText="조사 기록이 없습니다."
      onDelete={async (ids) => { await deleteDigLogs(ids); setLogs((prev) => prev.filter((l) => !ids.includes(l.id))); }}
      renderRow={(l) => (
        <>
          <div className="log-line1"><span className="log-name">{l.userName}</span><span className="log-tag">{l.empty ? '꽝' : '획득'}</span></div>
          <div className="log-line2">{l.round}번째 판 · {cellPos(l.cell)} · {l.rewardName} · {fmtDateTime(l.created_at)}</div>
        </>
      )}
    />
  );
}

function RemoveRow({ item, onRemove }) {
  const [qty, setQty] = useState('1');
  return (
    <div className="list-row">
      <div className="row-top">
        <span className="row-title" style={{ cursor: 'default' }}>{item.name} x{item.qty}</span>
        <div className="admin-row-form" style={{ margin: 0 }}>
          <input type="number" min="1" max={item.qty} value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 54 }} />
          <button className="danger" onClick={() => onRemove(item, qty)}>회수</button>
        </div>
      </div>
      {item.description && <div className="row-sub">{item.description}</div>}
    </div>
  );
}

export function ItemsAdmin({ users }) {
  const [userId, setUserId] = useState('');
  const [items, setItems] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [qty, setQty] = useState('1');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [notes, setNotes] = useState([]);
  const [tickets, setTickets] = useState(0);
  const [tQty, setTQty] = useState('1');

  useEffect(() => { fetchDigRewards().then(setRewards).catch(() => {}); }, []);
  const load = useCallback(async () => {
    setItems(userId ? await fetchItemsOf(userId) : []);
    setNotes(userId ? await fetchNotes(userId).catch(() => []) : []);
    const prof = userId ? await fetchProfileById(userId) : null;
    setTickets(prof?.dig_bonus || 0);
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function run(fn, okMsg) {
    setErr(''); setOk('');
    try { await fn(); await load(); setOk(okMsg); } catch (e) { setErr(e.message || '오류가 발생했습니다.'); }
  }

  return (
    <>
      <div className="field-label">캐릭터 선택</div>
      <div style={{ padding: '0 4px' }}>
        <select className="house-select" style={{ width: '100%', padding: '10px' }} value={userId} onChange={(e) => { setUserId(e.target.value); setOk(''); setErr(''); }}>
          <option value="">캐릭터를 선택하세요</option>
          {users.filter((u) => u.approved).map((u) => <option key={u.id} value={u.id}>{u.character_name} ({u.login_id})</option>)}
        </select>
      </div>
      {err && <div className="auth-error" style={{ margin: '10px 4px 0' }}>{err}</div>}
      {ok && <div className="auth-success" style={{ margin: '10px 4px 0' }}>{ok}</div>}

      {userId && (
        <>
          <div className="field-label">소지품 지급</div>
          <div style={{ padding: '0 4px' }}>
            <select className="house-select" style={{ width: '100%', padding: '10px', marginBottom: 8 }} value="" onChange={(e) => {
              const r = rewards.find((x) => x.id === e.target.value);
              if (r) { setName(r.name); setDesc(r.description || ''); }
            }}>
              <option value="">보상 목록에서 불러오기 (선택)</option>
              {rewards.filter((r) => !r.empty).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <div className="admin-row-form">
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" style={{ flex: 1, minWidth: 90 }} />
              <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 56 }} />
            </div>
            <div className="admin-row-form">
              <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="효과/설명" style={{ flex: 1, minWidth: 140 }} />
            </div>
            <div className="admin-row-form">
              <input type="text" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="메시지 (선택)" style={{ flex: 1, minWidth: 110 }} />
              <button className="accent" onClick={() => run(() => adminGrantItem(userId, name, desc, qty, msg.trim()), '지급했습니다.')}>지급</button>
            </div>
          </div>

          <div className="field-label">간이조사권 (보유 {tickets}장)</div>
          <div style={{ padding: '0 4px' }}>
            <div className="admin-row-form">
              <input type="number" value={tQty} onChange={(e) => setTQty(e.target.value)} style={{ width: 64 }} />
              <input type="text" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="메시지 (선택)" style={{ flex: 1, minWidth: 110 }} />
              <button className="accent" onClick={() => run(() => adminGrantDigTickets(userId, Math.abs(parseInt(tQty, 10) || 0), msg.trim()), '조사권을 지급했습니다.')}>지급</button>
              <button className="danger" onClick={() => run(() => adminGrantDigTickets(userId, -Math.abs(parseInt(tQty, 10) || 0), msg.trim()), '조사권을 회수했습니다.')}>회수</button>
            </div>
          </div>

          <div className="field-label">보유 소지품</div>
          {items.length === 0 ? <div className="empty-state" style={{ padding: '20px 0' }}>보유한 소지품이 없습니다.</div> : items.map((it) => (
            <RemoveRow key={it.id} item={it} onRemove={(item, q) => run(() => adminRemoveItem(userId, item.id, q, msg.trim()), '회수했습니다.')} />
          ))}

          <div className="field-label">개인 탭에 직접 적은 항목 ({notes.length})</div>
          {notes.length === 0 ? <div className="empty-state" style={{ padding: '18px 0' }}>적은 항목이 없습니다.</div> : notes.map((n) => (
            <div key={n.id} className="list-row">
              <div className="row-top"><span className="row-title" style={{ cursor: 'default' }}>{n.name}</span></div>
              {n.note && <div className="item-desc">{n.note}</div>}
            </div>
          ))}
        </>
      )}
    </>
  );
}

const ACTION_LABEL = {
  user_delete: '본인 삭제', admin_grant: '관리자 지급', admin_remove: '관리자 회수', transfer: '양도', dig_get: '조사로 획득', shop_buy: '상점 구매',
};
export function ItemLogsAdmin() {
  const [logs, setLogs] = useState(null);
  useEffect(() => { fetchItemLogs().then(setLogs).catch(() => setLogs([])); }, []);
  if (logs === null) return <div className="empty-state">불러오는 중</div>;
  return (
    <LogList
      items={logs}
      emptyText="소지품 기록이 없습니다."
      onDelete={async (ids) => { await deleteItemLogs(ids); setLogs((prev) => prev.filter((l) => !ids.includes(l.id))); }}
      renderRow={(l) => (
        <>
          <div className="log-line1">
            <span className="log-name">{l.userName}{l.action === 'transfer' ? ` → ${l.targetName}` : ''}</span>
            <span className={`log-tag ${l.action === 'user_delete' ? 'danger' : ''}`}>{ACTION_LABEL[l.action] || l.action}</span>
          </div>
          <div className="log-line2">{l.itemName} x{l.qty}{l.price != null ? ` · ${l.price}P` : ''} · {fmtDateTime(l.created_at)}</div>
        </>
      )}
    />
  );
}
