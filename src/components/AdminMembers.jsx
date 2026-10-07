import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  HOUSES, grantPoints, adminAdjustGalleon, adminGrantDigTickets, adminGrantGambleVoid,
  adminGrantItem, adminRemoveItem, fetchItemsOf, fetchNotes, fetchProfileById, fetchDigRewards, fetchShopItems,
} from '../lib/api';
import { fmtTime, houseName } from '../lib/helpers';
import { Avatar, AdminCard, QtyStepper, SegTabs } from './Ui';

// ---------------- 가입 승인 ----------------
function PendingList({ users, actions }) {
  if (!users.length) return <div className="a-empty-big">승인 대기 중인 신청이 없습니다.</div>;
  return (
    <AdminCard title={`승인 대기 ${users.length}명`}>
      {users.map((u) => (
        <div key={u.id} className="a-item">
          <Avatar name={u.character_name} />
          <div className="a-item-main">
            <div className="a-item-title">{u.character_name}</div>
            <div className="a-item-sub">{u.login_id} · 신청 {fmtTime(u.created_at)}</div>
          </div>
          <button className="a-btn accent" onClick={() => actions.approve(u.id)}>승인</button>
          <button className="a-btn danger" onClick={() => actions.reject(u.id)}>거절</button>
        </div>
      ))}
    </AdminCard>
  );
}

// ---------------- 캐릭터 목록 ----------------
function CharacterList({ users, onOpen }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return users.filter((u) => !t || (u.character_name || '').toLowerCase().includes(t) || (u.login_id || '').toLowerCase().includes(t));
  }, [users, q]);
  return (
    <>
      <input className="txt-input a-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 또는 아이디 검색" />
      <AdminCard title={`캐릭터 ${shown.length}명`}>
        {shown.length === 0 && <div className="a-empty">검색 결과가 없습니다.</div>}
        {shown.map((u) => (
          <div key={u.id} className="a-item a-click" onClick={() => onOpen(u.id)}>
            <Avatar name={u.character_name} />
            <div className="a-item-main">
              <div className="a-item-title">
                {u.character_name}
                {u.is_admin && <span className="admin-badge">ADMIN</span>}
                {u.withdrawn && <span className="withdrawn-badge">탈퇴</span>}
                {!u.approved && !u.withdrawn && <span className="withdrawn-badge" style={{ background: 'var(--surface-2)', color: 'var(--text-light)' }}>대기</span>}
              </div>
              <div className="a-item-sub">{u.login_id}{u.house ? ` · ${houseName(u.house)}` : ''}</div>
            </div>
            <div className="a-item-meta"><b style={{ color: 'var(--gold)' }}>{u.points}P</b></div>
            <span className="a-chevron">›</span>
          </div>
        ))}
      </AdminCard>
    </>
  );
}

// ---------------- 강제 탈퇴 확인창 ----------------
function WithdrawModal({ user, onCancel, onConfirm }) {
  const [deleteContent, setDeleteContent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function go() {
    setBusy(true); setError('');
    try { await onConfirm(user, deleteContent); }
    catch (e) { setError(e.message || '오류가 발생했습니다.'); setBusy(false); }
  }
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="modal-card small">
        <div className="confirm-msg"><b>{user.character_name}</b> ({user.login_id})<br />강제 탈퇴 처리할까요?<br /><span style={{ fontSize: 12, color: 'var(--text-light)' }}>이 계정은 더 이상 로그인할 수 없어요. (기록은 남아요)</span></div>
        {error && <div className="auth-error">{error}</div>}
        <label className="check-line"><input type="checkbox" checked={deleteContent} onChange={(e) => setDeleteContent(e.target.checked)} /> 작성한 게시글과 댓글도 함께 삭제</label>
        <div className="modal-actions">
          <button className="modal-cancel" disabled={busy} onClick={onCancel}>취소</button>
          <button className="modal-confirm danger" disabled={busy} onClick={go}>{busy ? '처리 중...' : '강제 탈퇴'}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 캐릭터 상세 (지급·회수·소지품·계정을 한 화면에) ----------------
const CURRENCIES = [
  { id: 'points', label: '포인트' },
  { id: 'galleon', label: '갈레온' },
  { id: 'ticket', label: '조사권' },
  { id: 'void', label: '무효권' },
];
const CHIPS = [10, 50, 100, 500];
const CUR_NAME = { points: '포인트', galleon: '갈레온', ticket: '간이조사권', void: '도박 무효권' };
const CUR_UNIT = { points: 'P', galleon: '', ticket: '장', void: '장' };

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

function CharacterDetail({ userId, allUsers, actions, onBack, onWithdraw }) {
  const base = allUsers.find((u) => u.id === userId);
  const [prof, setProf] = useState(base || null);
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState([]);
  const [presets, setPresets] = useState([]);
  const [kind, setKind] = useState('points');
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState('');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [qty, setQty] = useState('1');
  const [showDesc, setShowDesc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const topRef = useRef(null);

  const load = useCallback(async () => {
    const [pf, it, nt] = await Promise.all([fetchProfileById(userId), fetchItemsOf(userId), fetchNotes(userId).catch(() => [])]);
    if (pf) setProf(pf);
    setItems(it); setNotes(nt);
  }, [userId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    Promise.all([fetchDigRewards().catch(() => []), fetchShopItems().catch(() => [])]).then(([rw, sh]) => {
      const list = [
        ...sh.filter((x) => x.kind === 'item').map((x) => ({ key: `s${x.id}`, label: `상점 · ${x.name}`, name: x.name, description: x.description })),
        ...rw.filter((x) => !x.empty).map((x) => ({ key: `r${x.id}`, label: `조사 보상 · ${x.name}`, name: x.name, description: x.description })),
      ];
      setPresets(list);
    });
  }, []);

  if (!prof) return <div className="empty-state">불러오는 중</div>;
  const u = allUsers.find((x) => x.id === userId) || prof; // 기숙사·권한 등은 목록 데이터 기준(바뀌면 바로 반영)
  const isSelf = userId === actions.selfId;

  function pickKind(k) { setKind(k); setAmount(''); setErr(''); setOk(''); }
  async function run(fn, okMsg) {
    setErr(''); setOk(''); setBusy(true);
    try { await fn(); await load(); setOk(okMsg); }
    catch (e) { setErr(e.message || '오류가 발생했습니다.'); }
    finally { setBusy(false); }
  }
  function apply(sign) {
    const n = Math.abs(parseInt(amount, 10) || 0);
    const m = msg.trim();
    if (kind !== 'void' && !n) { setErr('수량을 입력하세요.'); setOk(''); return; }
    const verb = sign > 0 ? '지급' : '회수';
    const shown = kind === 'void' ? '1장' : `${n}${CUR_UNIT[kind]}`;
    const call = {
      points: () => grantPoints(userId, sign * n, m),
      galleon: () => adminAdjustGalleon(userId, sign * n, m),
      ticket: () => adminGrantDigTickets(userId, sign * n, m),
      void: () => adminGrantGambleVoid(userId, sign, m),
    }[kind];
    run(call, `${CUR_NAME[kind]} ${shown}을(를) ${verb}했습니다.`);
  }

  return (
    <>
      <div className="back-row" onClick={onBack} ref={topRef}>‹ 캐릭터 목록</div>

      <section className="a-card a-profile">
        <Avatar name={u.character_name} size={52} />
        <div className="a-profile-main">
          <div className="a-profile-name">{u.character_name}{u.is_admin && <span className="admin-badge">ADMIN</span>}{u.withdrawn && <span className="withdrawn-badge">탈퇴</span>}</div>
          <div className="a-item-sub">{u.login_id}{u.house ? ` · ${houseName(u.house)}` : ''} · 가입 {fmtTime(u.created_at)}</div>
        </div>
      </section>

      <div className="a-tiles">
        <div><b style={{ color: 'var(--gold)' }}>{prof.points}</b><span>포인트</span></div>
        <div><b>{prof.galleon || 0}</b><span>갈레온</span></div>
        <div><b>{prof.dig_bonus || 0}</b><span>조사권</span></div>
        <div><b>{prof.gamble_void || 0}</b><span>무효권</span></div>
      </div>

      {err && <div className="auth-error a-flash">{err}</div>}
      {ok && <div className="auth-success a-flash">{ok}</div>}

      <AdminCard title="지급 · 회수">
        <SegTabs variant="sub" items={CURRENCIES} value={kind} onChange={pickKind} />
        {kind === 'void' ? (
          <div className="a-hint" style={{ margin: '0 0 10px' }}>도박 무효권은 1장씩만 지급·회수할 수 있어요. (최대 1장 보유)</div>
        ) : kind === 'ticket' ? (
          <div className="a-form-row"><QtyStepper value={amount || '1'} onChange={setAmount} max={999} /></div>
        ) : (
          <>
            <input className="txt-input" style={{ width: '100%', marginBottom: 8 }} type="number" min="1" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`${CUR_NAME[kind]} 수량`} />
            <div className="a-chips">
              {CHIPS.map((c) => <button key={c} type="button" onClick={() => setAmount(String((parseInt(amount, 10) || 0) + c))}>+{c}</button>)}
              <button type="button" className="clear" onClick={() => setAmount('')}>지우기</button>
            </div>
          </>
        )}
        <input className="txt-input" style={{ width: '100%', marginBottom: 10 }} type="text" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="알림에 함께 보낼 메시지 (선택)" />
        <div className="a-split">
          <button className="a-btn accent big" disabled={busy} onClick={() => apply(1)}>지급</button>
          <button className="a-btn danger big" disabled={busy} onClick={() => apply(-1)}>회수</button>
        </div>
      </AdminCard>

      <AdminCard title="소지품 지급">
        {presets.length > 0 && (
          <select className="house-select" style={{ width: '100%', padding: '10px', marginBottom: 8 }} value="" onChange={(e) => {
            const p = presets.find((x) => x.key === e.target.value);
            if (p) { setName(p.name); setDesc(p.description || ''); if (p.description) setShowDesc(true); }
          }}>
            <option value="">상품 · 보상 목록에서 불러오기 (선택)</option>
            {presets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        )}
        <div className="a-form-row">
          <input className="txt-input" style={{ flex: 1, minWidth: 0 }} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="소지품 이름" maxLength={40} />
          <QtyStepper value={qty} onChange={setQty} />
          <button className="a-btn accent big" disabled={busy} onClick={() => run(() => adminGrantItem(userId, name, desc, qty, msg.trim()), `${name.trim() || '소지품'} x${parseInt(qty, 10) || 1}을(를) 지급했습니다.`)}>지급</button>
        </div>
        {showDesc
          ? <input className="txt-input" style={{ width: '100%' }} type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="효과 / 설명 (선택)" />
          : <button type="button" className="link-btn" style={{ paddingTop: 0 }} onClick={() => setShowDesc(true)}>+ 설명 추가 (선택)</button>}
      </AdminCard>

      <AdminCard title={`보유 소지품 ${items.length}`}>
        {items.length === 0 ? <div className="a-empty">보유한 소지품이 없습니다.</div> : items.map((it) => (
          <HeldRow key={it.id} item={it} onRemove={(item, q) => run(() => adminRemoveItem(userId, item.id, q, msg.trim()), `${item.name} x${q}을(를) 회수했습니다.`)} />
        ))}
      </AdminCard>

      <AdminCard title={`개인 기재 ${notes.length}`} hint="캐릭터가 직접 적은 항목이에요. (보기 전용)">
        {notes.length === 0 ? <div className="a-empty">적은 항목이 없습니다.</div> : notes.map((n) => (
          <div key={n.id} className="a-item">
            <div className="a-item-main">
              <div className="a-item-title">{n.name}{n.qty > 1 && <span className="pnote-qty">x{n.qty}</span>}</div>
              {n.note && <div className="a-item-sub">{n.note}</div>}
            </div>
          </div>
        ))}
      </AdminCard>

      <AdminCard title="계정">
        {!u.is_admin && !u.withdrawn && (
          <div className="a-item">
            <div className="a-item-main"><div className="a-item-title">기숙사</div></div>
            <select className="house-select" value={u.house || ''} onChange={(e) => actions.setHouse(u.id, e.target.value)}>
              <option value="">미지정</option>
              {HOUSES.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
        )}
        {!isSelf && !u.withdrawn && (
          <div className="a-item">
            <div className="a-item-main"><div className="a-item-title">관리자 권한</div><div className="a-item-sub">{u.is_admin ? '현재 관리자예요' : '일반 회원이에요'}</div></div>
            <button className="a-btn accent" onClick={() => actions.toggleAdmin(u)}>{u.is_admin ? '권한 해제' : '관리자 지정'}</button>
          </div>
        )}
        {!isSelf && !u.is_admin && !u.withdrawn && (
          <div className="a-item">
            <div className="a-item-main"><div className="a-item-title">강제 탈퇴</div><div className="a-item-sub">로그인이 막혀요. 글·댓글도 같이 지울 수 있어요.</div></div>
            <button className="a-btn danger" onClick={() => onWithdraw(u)}>강제 탈퇴</button>
          </div>
        )}
        {u.withdrawn && (
          <div className="a-item">
            <div className="a-item-main"><div className="a-item-title">탈퇴 처리된 계정</div></div>
            <button className="a-btn accent" onClick={() => actions.restore(u)}>탈퇴 취소(복구)</button>
          </div>
        )}
      </AdminCard>
    </>
  );
}

// ---------------- 회원 구역 ----------------
export function MembersSection({ pendingUsers, allUsers, actions, refresh }) {
  const [sub, setSub] = useState('chars');
  const touched = useRef(false);
  const [openId, setOpenId] = useState(null);
  const [withdrawTarget, setWithdrawTarget] = useState(null);

  // 승인 대기가 있으면 처음에 그 화면부터 보여줌
  useEffect(() => { if (!touched.current && pendingUsers.length) setSub('pending'); }, [pendingUsers.length]);

  if (openId) {
    return (
      <>
        <CharacterDetail userId={openId} allUsers={allUsers} actions={actions} onBack={() => { setOpenId(null); refresh(); }} onWithdraw={setWithdrawTarget} />
        {withdrawTarget && (
          <WithdrawModal user={withdrawTarget} onCancel={() => setWithdrawTarget(null)}
            onConfirm={async (u, del) => { await actions.withdraw(u, del); setWithdrawTarget(null); }} />
        )}
      </>
    );
  }
  const visible = allUsers.filter((u) => u.approved || u.withdrawn || u.rejected);
  return (
    <>
      <SegTabs variant="sub" value={sub} onChange={(v) => { touched.current = true; setSub(v); }}
        items={[{ id: 'pending', label: '가입 승인', badge: pendingUsers.length || null }, { id: 'chars', label: '캐릭터' }]} />
      {sub === 'pending' ? <PendingList users={pendingUsers} actions={actions} /> : <CharacterList users={visible} onOpen={setOpenId} />}
    </>
  );
}
