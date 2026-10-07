import React, { useCallback, useEffect, useState } from 'react';
import {
  fetchDigRewards, saveDigReward, deleteDigReward, subscribeDigPublic, subscribeDigSecret,
  adminNewRound, adminAssignCell, adminRandomizeUndug, fetchDigLogs, fetchDigConfig, saveDigConfig,
  fetchItemsOf, adminGrantItem, adminRemoveItem, fetchItemLogs,
  deleteDigLogs, deleteItemLogs, fetchProfileById, fetchNotes, adminGrantDigTickets,
  blankCountFor, DIG_SIZE,
} from '../lib/api';
import { fmtDateTime } from '../lib/helpers';
import { LogList } from './AdminLogs';
import { QtyStepper, AdminCard } from './Ui';
import { useCloseGuard } from './Modals';

const cellPos = (i) => `${Math.floor(i / 9) + 1}행 ${(i % 9) + 1}열`;

// ---------------- 보상 한 줄 ----------------
function RewardRow({ r, sharePct, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  const set = (k) => (v) => setF((prev) => ({ ...prev, [k]: v }));

  async function del() {
    if (!window.confirm(`"${r.name}" 보상을 목록에서 삭제할까요?\n(이미 칸에 배치된 보상은 그대로 남습니다)`)) return;
    await deleteDigReward(r.id); await onChanged();
  }
  async function save() {
    setErr('');
    try { await saveDigReward(r.id, f); setEditing(false); await onChanged(); }
    catch (e) { setErr(e.message || '오류가 발생했습니다.'); }
  }

  if (r.empty) {
    return (
      <div className="a-item">
        <div className="a-item-main">
          <div className="a-item-title">{r.name}</div>
          <div className="a-item-sub" style={{ color: 'var(--danger)' }}>예전 방식의 꽝 항목이에요. 지금은 위의 "꽝 비율"로 정하니 삭제해 주세요.</div>
        </div>
        <button className="a-btn danger" onClick={del}>삭제</button>
      </div>
    );
  }
  return (
    <div className="a-item col">
      <div className="a-item-line">
        <div className="a-item-main">
          <div className="a-item-title">{r.name}</div>
          {r.description && <div className="a-item-sub">{r.description}</div>}
        </div>
        <div className="a-item-meta">
          <b>{sharePct}%</b>
          <span>약 {Math.round((DIG_SIZE * sharePct) / 100)}칸</span>
        </div>
        <button className="a-btn" onClick={() => { if (editing) setEditing(false); else { setF({ name: r.name, description: r.description, weight: String(r.weight) }); setErr(''); setEditing(true); } }}>{editing ? '닫기' : '수정'}</button>
      </div>
      {editing && f && (
        <div className="a-edit">
          {err && <div className="auth-error">{err}</div>}
          <div className="a-form-row">
            <input className="txt-input" style={{ flex: 1, minWidth: 0 }} type="text" value={f.name} onChange={(e) => set('name')(e.target.value)} placeholder="이름" />
            <div className="price-input"><input className="txt-input" type="number" min="0" step="any" value={f.weight} onChange={(e) => set('weight')(e.target.value)} placeholder="확률" /><span>%</span></div>
          </div>
          <input className="txt-input" style={{ width: '100%' }} type="text" value={f.description} onChange={(e) => set('description')(e.target.value)} placeholder="효과 / 설명 (선택)" />
          <div className="a-actions">
            <button className="a-btn accent" onClick={save}>저장</button>
            <button className="a-btn danger" onClick={del}>삭제</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 간이 조사 관리 ----------------
export function DigAdmin() {
  const [rewards, setRewards] = useState([]);
  const [blank, setBlank] = useState('0');
  const [blankSaved, setBlankSaved] = useState('0');
  const [pub, setPub] = useState(undefined);
  const [sec, setSec] = useState(undefined);
  const [editIdx, setEditIdx] = useState(null);
  const [pick, setPick] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [nName, setNName] = useState('');
  const [nDesc, setNDesc] = useState('');
  const [nWeight, setNWeight] = useState('10');
  const [showDesc, setShowDesc] = useState(false);

  const loadRewards = useCallback(async () => { setRewards(await fetchDigRewards()); }, []);
  useEffect(() => { loadRewards(); }, [loadRewards]);
  useEffect(() => { fetchDigConfig().then((c) => { setBlank(String(c.blankPercent)); setBlankSaved(String(c.blankPercent)); }); }, []);
  useEffect(() => subscribeDigPublic(setPub), []);
  useEffect(() => subscribeDigSecret(setSec), []);

  const usable = rewards.filter((r) => !r.empty && r.weight > 0);
  const totalW = usable.reduce((sum, r) => sum + r.weight, 0);
  const blankNum = Math.min(100, Math.max(0, Number(blank) || 0));
  const missCells = blankCountFor(DIG_SIZE, blankNum);
  // 보상별 전체 판 대비 비율 = (보상 확률 / 보상 확률 합) x (100 - 꽝 비율)
  const share = (r) => (totalW > 0 ? Math.round(((r.weight / totalW) * (100 - blankNum)) * 10) / 10 : 0);

  async function run(fn, msg) {
    setErr(''); setOk('');
    try { await fn(); if (msg) setOk(msg); } catch (e) { setErr(e.message || '오류가 발생했습니다.'); }
  }
  async function addReward(e) {
    e.preventDefault();
    await run(async () => {
      await saveDigReward(null, { name: nName, description: nDesc, weight: nWeight });
      setNName(''); setNDesc(''); setShowDesc(false);
      await loadRewards();
    }, '보상을 추가했습니다.');
  }
  async function saveCell() {
    const reward = pick === 'miss' ? 'miss' : (rewards.find((r) => r.id === pick) || null);
    await run(async () => { await adminAssignCell(editIdx, reward); setEditIdx(null); }, '칸을 수정했습니다.');
  }

  const started = pub && sec;
  const dugCount = started ? pub.cells.filter((c) => c.dug).length : 0;
  const cellOriginal = editIdx !== null && started ? (sec.cells[editIdx].assigned ? (sec.cells[editIdx].empty ? 'miss' : (sec.cells[editIdx].rewardId || '')) : '') : '';
  const guard = useCloseGuard(editIdx !== null && pick !== cellOriginal, () => setEditIdx(null));

  return (
    <>
      {err && <div className="auth-error" style={{ margin: '0 4px 10px' }}>{err}</div>}
      {ok && <div className="auth-success" style={{ margin: '0 4px 10px' }}>{ok}</div>}

      <AdminCard title="꽝 비율" hint="판의 몇 %를 꽝으로 할지 정해요. 새 판을 시작하거나 랜덤 배치할 때 적용돼요.">
        <div className="a-form-row">
          <div className="price-input"><input className="txt-input" type="number" min="0" max="100" step="any" value={blank} onChange={(e) => setBlank(e.target.value)} style={{ width: 84 }} /><span>%</span></div>
          <div className="a-inline-note">{DIG_SIZE}칸 중 <b>{missCells}칸</b>이 꽝 <span>(소수점은 버림)</span></div>
          <button className="a-btn accent" disabled={blank === blankSaved} onClick={() => run(async () => { await saveDigConfig({ blankPercent: blank }); setBlankSaved(blank); }, '꽝 비율을 저장했습니다.')}>저장</button>
        </div>
      </AdminCard>

      <AdminCard title={`보상 목록 (${usable.length})`} hint="꽝을 뺀 나머지 칸에 아래 확률대로 배치돼요. 확률은 서로의 비율이라 합이 100이 아니어도 괜찮아요.">
        {rewards.length === 0 && <div className="a-empty">등록된 보상이 없습니다.</div>}
        {rewards.map((r) => <RewardRow key={r.id} r={r} sharePct={share(r)} onChanged={loadRewards} />)}
        <form className="a-add" onSubmit={addReward}>
          <div className="a-form-row">
            <input className="txt-input" style={{ flex: 1, minWidth: 0 }} type="text" value={nName} onChange={(e) => setNName(e.target.value)} placeholder="새 보상 이름" maxLength={40} />
            <div className="price-input"><input className="txt-input" type="number" min="0" step="any" value={nWeight} onChange={(e) => setNWeight(e.target.value)} placeholder="확률" /><span>%</span></div>
            <button type="submit" className="a-btn accent big">추가</button>
          </div>
          {showDesc
            ? <input className="txt-input" style={{ width: '100%' }} type="text" value={nDesc} onChange={(e) => setNDesc(e.target.value)} placeholder="효과 / 설명 (선택)" />
            : <button type="button" className="link-btn" style={{ paddingTop: 0 }} onClick={() => setShowDesc(true)}>+ 설명 추가 (선택)</button>}
        </form>
      </AdminCard>

      <AdminCard
        title="9 x 9 판"
        right={started ? <span className="a-pill">{pub.round || 1}번째 판 · 남은 칸 {pub.cells.length - dugCount}/{pub.cells.length}</span> : null}
      >
        {!started ? (
          <button className="shop-form-submit" onClick={() => run(adminNewRound, '간이 조사를 시작했습니다.')}>간이 조사 시작 (전체 랜덤 배치)</button>
        ) : (
          <>
            <div className="a-actions" style={{ marginTop: 0, marginBottom: 12 }}>
              <button className="a-btn accent big" onClick={() => run(adminRandomizeUndug, '안 깐 칸을 랜덤으로 다시 배치했습니다.')}>랜덤 배치 (안 깐 칸)</button>
              <button className="a-btn danger big" onClick={() => { if (window.confirm('모든 칸을 새로 랜덤 배치하고 조사 기록을 초기화할까요?')) run(adminNewRound, '새 판을 시작했습니다.'); }}>새 판 시작</button>
            </div>
            <div className="dig-grid admin" style={{ padding: 0 }}>
              {sec.cells.map((c, i) => {
                const dug = pub.cells[i]?.dug;
                return (
                  <button
                    key={i}
                    type="button"
                    className={`dig-cell ${dug ? 'dug' : ''} ${!c.assigned ? 'unassigned' : ''} ${c.empty ? 'empty' : ''}`}
                    onClick={() => { setEditIdx(i); setPick(c.assigned ? (c.empty ? 'miss' : (c.rewardId || '')) : ''); setErr(''); setOk(''); }}
                    title={dug ? `${c.byName} 님이 조사` : cellPos(i)}
                  >
                    {c.assigned ? c.name : '?'}
                  </button>
                );
              })}
            </div>
            <div className="a-legend">
              <span><i className="lg gold" />보상</span>
              <span><i className="lg miss" />꽝</span>
              <span><i className="lg none" />미지정</span>
              <span><i className="lg dug" />조사됨</span>
            </div>
            <div className="a-hint" style={{ marginTop: 6, marginBottom: 0 }}>칸을 누르면 그 칸의 보상을 바꾸거나, 조사된 칸은 누가 깠는지 볼 수 있어요.</div>
          </>
        )}
      </AdminCard>

      {editIdx !== null && started && (
        <>
          <div className="modal-overlay" onClick={guard.overlayClick}>
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
                    <option value="miss">꽝</option>
                    {rewards.filter((r) => !r.empty).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <div className="modal-actions">
                    <button className="modal-cancel" onClick={() => setEditIdx(null)}>취소</button>
                    <button className="modal-confirm" onClick={saveCell}>저장</button>
                  </div>
                </>
              )}
            </div>
          </div>
          {guard.guard}
        </>
      )}
    </>
  );
}

// ---------------- 조사 기록 ----------------
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
          <div className="log-line1"><span className="log-name">{l.userName}</span><span className={`log-tag ${l.empty ? '' : 'ok'}`}>{l.empty ? '꽝' : '획득'}</span></div>
          <div className="log-line2">{l.rewardName} · {l.round}번째 판 {cellPos(l.cell)} · {fmtDateTime(l.created_at)}</div>
        </>
      )}
    />
  );
}

// ---------------- 소지품 관리 ----------------
function HeldRow({ item, onRemove }) {
  const [qty, setQty] = useState('1');
  return (
    <div className="a-item">
      <div className="a-item-main">
        <div className="a-item-title">{item.name} <span className="pnote-qty">x{item.qty}</span></div>
        {item.description && <div className="a-item-sub">{item.description}</div>}
      </div>
      <QtyStepper value={qty} onChange={setQty} max={item.qty} />
      <button className="a-btn danger" onClick={() => onRemove(item, qty)}>회수</button>
    </div>
  );
}

export function ItemsAdmin({ users }) {
  const [userId, setUserId] = useState('');
  const [items, setItems] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [prof, setProf] = useState(null);
  const [notes, setNotes] = useState([]);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [qty, setQty] = useState('1');
  const [tQty, setTQty] = useState('1');
  const [msg, setMsg] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => { fetchDigRewards().then(setRewards).catch(() => {}); }, []);
  const load = useCallback(async () => {
    if (!userId) { setItems([]); setNotes([]); setProf(null); return; }
    const [it, nt, pf] = await Promise.all([fetchItemsOf(userId), fetchNotes(userId).catch(() => []), fetchProfileById(userId)]);
    setItems(it); setNotes(nt); setProf(pf);
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function run(fn, okMsg) {
    setErr(''); setOk('');
    try { await fn(); await load(); setOk(okMsg); } catch (e) { setErr(e.message || '오류가 발생했습니다.'); }
  }

  return (
    <>
      <AdminCard title="캐릭터 선택">
        <select className="house-select" style={{ width: '100%', padding: '10px' }} value={userId} onChange={(e) => { setUserId(e.target.value); setOk(''); setErr(''); }}>
          <option value="">캐릭터를 선택하세요</option>
          {users.filter((u) => u.approved && !u.withdrawn).map((u) => <option key={u.id} value={u.id}>{u.character_name} ({u.login_id})</option>)}
        </select>
        {prof && (
          <div className="a-stats">
            <div><b>{prof.points}</b><span>포인트</span></div>
            <div><b>{prof.dig_bonus || 0}</b><span>간이조사권</span></div>
            <div><b>{prof.gamble_void || 0}</b><span>도박 무효권</span></div>
          </div>
        )}
        {userId && (
          <input className="txt-input" style={{ width: '100%', marginTop: 10 }} type="text" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="지급/회수 알림에 함께 보낼 메시지 (선택)" />
        )}
        {err && <div className="auth-error" style={{ marginTop: 10, marginBottom: 0 }}>{err}</div>}
        {ok && <div className="auth-success" style={{ marginTop: 10, marginBottom: 0 }}>{ok}</div>}
      </AdminCard>

      {userId && (
        <>
          <AdminCard title="소지품 지급">
            <select className="house-select" style={{ width: '100%', padding: '10px', marginBottom: 8 }} value="" onChange={(e) => {
              const r = rewards.find((x) => x.id === e.target.value);
              if (r) { setName(r.name); setDesc(r.description || ''); }
            }}>
              <option value="">보상 목록에서 불러오기 (선택)</option>
              {rewards.filter((r) => !r.empty).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <div className="a-form-row">
              <input className="txt-input" style={{ flex: 1, minWidth: 0 }} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="소지품 이름" maxLength={40} />
              <QtyStepper value={qty} onChange={setQty} />
              <button className="a-btn accent big" onClick={() => run(() => adminGrantItem(userId, name, desc, qty, msg.trim()), '지급했습니다.')}>지급</button>
            </div>
            {showMore
              ? <input className="txt-input" style={{ width: '100%' }} type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="효과 / 설명 (선택)" />
              : <button type="button" className="link-btn" style={{ paddingTop: 0 }} onClick={() => setShowMore(true)}>+ 설명 추가 (선택)</button>}
          </AdminCard>

          <AdminCard title="간이조사권">
            <div className="a-form-row" style={{ marginBottom: 0 }}>
              <QtyStepper value={tQty} onChange={setTQty} />
              <button className="a-btn accent big" onClick={() => run(() => adminGrantDigTickets(userId, Math.abs(parseInt(tQty, 10) || 0), msg.trim()), '조사권을 지급했습니다.')}>지급</button>
              <button className="a-btn danger big" onClick={() => run(() => adminGrantDigTickets(userId, -Math.abs(parseInt(tQty, 10) || 0), msg.trim()), '조사권을 회수했습니다.')}>회수</button>
            </div>
          </AdminCard>

          <AdminCard title={`보유 소지품 (${items.length})`}>
            {items.length === 0 ? <div className="a-empty">보유한 소지품이 없습니다.</div> : items.map((it) => (
              <HeldRow key={it.id} item={it} onRemove={(item, q) => run(() => adminRemoveItem(userId, item.id, q, msg.trim()), '회수했습니다.')} />
            ))}
          </AdminCard>

          <AdminCard title={`개인 기재 (${notes.length})`} hint="캐릭터가 직접 적은 항목이에요. (보기 전용)">
            {notes.length === 0 ? <div className="a-empty">적은 항목이 없습니다.</div> : notes.map((n) => (
              <div key={n.id} className="a-item">
                <div className="a-item-main">
                  <div className="a-item-title">{n.name}{n.qty > 1 && <span className="pnote-qty">x{n.qty}</span>}</div>
                  {n.note && <div className="a-item-sub">{n.note}</div>}
                </div>
              </div>
            ))}
          </AdminCard>
        </>
      )}
    </>
  );
}

// ---------------- 소지품 기록 ----------------
const ACTION_LABEL = {
  user_delete: '본인 삭제', admin_grant: '관리자 지급', admin_remove: '관리자 회수', transfer: '양도',
  dig_get: '조사로 획득', shop_buy: '상점 구매', void_use: '무효권 사용',
};
const ACTION_TONE = {
  user_delete: 'danger', admin_remove: 'danger', admin_grant: 'ok', dig_get: 'ok', shop_buy: 'gold', void_use: 'gold', transfer: '',
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
            <span className={`log-tag ${ACTION_TONE[l.action] || ''}`}>{ACTION_LABEL[l.action] || l.action}</span>
          </div>
          <div className="log-line2">{l.itemName}{l.qty > 1 ? ` x${l.qty}` : ''}{l.price != null ? ` · ${l.price}P` : ''} · {fmtDateTime(l.created_at)}</div>
        </>
      )}
    />
  );
}
