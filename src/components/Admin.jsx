import React, { useState } from 'react';
import { HOUSES } from '../lib/api';
import { boardName, fmtTime } from '../lib/helpers';
import { DigAdmin, DigLogsAdmin, ItemsAdmin, ItemLogsAdmin } from './AdminDig';
import { GambleAdmin, ChatAdmin } from './AdminLogs';
import { PointSettingsCard, ShopAdmin } from './AdminShop';

function PointsRow({ u, onGrant }) {
  const [amt, setAmt] = useState('');
  const [msg, setMsg] = useState('');
  async function go(sign) {
    const n = parseInt(amt, 10);
    if (!n || n <= 0) return;
    await onGrant(u.id, sign * n, msg.trim());
    setAmt(''); setMsg('');
  }
  return (
    <div className="list-row">
      <div className="row-top">
        <span className="row-title">{u.character_name} <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>({u.login_id})</span></span>
        <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 13 }}>{u.points}P</span>
      </div>
      <div className="admin-row-form">
        <input type="number" min="1" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="포인트" />
        <input type="text" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="메시지(선택)" style={{ flex: 1, minWidth: 110 }} />
        <button className="accent" onClick={() => go(1)}>지급</button>
        <button className="danger" onClick={() => go(-1)}>차감</button>
      </div>
    </div>
  );
}

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

export default function Admin({ pendingUsers, allUsers, allPosts, allComments, refresh, actions, error }) {
  const [tab, setTab] = useState('approve');
  const [withdrawTarget, setWithdrawTarget] = useState(null);

  return (
    <>
      <div className="board-title-bar"><h2>관리자 페이지</h2></div>
      {error && <div className="auth-error" style={{ margin: '12px 4px' }}>데이터 로딩 중 오류: {error}</div>}
      <div className="tab-row">
        <div className={`tab-item ${tab === 'approve' ? 'active' : ''}`} onClick={() => setTab('approve')}>가입 승인 {pendingUsers.length ? `(${pendingUsers.length})` : ''}</div>
        <div className={`tab-item ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>회원 목록</div>
        <div className={`tab-item ${tab === 'points' ? 'active' : ''}`} onClick={() => setTab('points')}>포인트 관리</div>
        <div className={`tab-item ${tab === 'posts' ? 'active' : ''}`} onClick={() => setTab('posts')}>게시글 관리</div>
        <div className={`tab-item ${tab === 'comments' ? 'active' : ''}`} onClick={() => setTab('comments')}>댓글 관리</div>
        <div className={`tab-item ${tab === 'gamble' ? 'active' : ''}`} onClick={() => setTab('gamble')}>도박 기록</div>
        <div className={`tab-item ${tab === 'chats' ? 'active' : ''}`} onClick={() => setTab('chats')}>채팅 관리</div>
        <div className={`tab-item ${tab === 'shop' ? 'active' : ''}`} onClick={() => setTab('shop')}>상점 관리</div>
        <div className={`tab-item ${tab === 'dig' ? 'active' : ''}`} onClick={() => setTab('dig')}>간이 조사</div>
        <div className={`tab-item ${tab === 'diglogs' ? 'active' : ''}`} onClick={() => setTab('diglogs')}>조사 기록</div>
        <div className={`tab-item ${tab === 'items' ? 'active' : ''}`} onClick={() => setTab('items')}>소지품 관리</div>
        <div className={`tab-item ${tab === 'itemlogs' ? 'active' : ''}`} onClick={() => setTab('itemlogs')}>소지품 기록</div>
      </div>

      {tab === 'approve' && (
        pendingUsers.length === 0 ? <div className="empty-state">승인 대기 중인 신청이 없습니다.</div> : pendingUsers.map((u) => (
          <div key={u.id} className="list-row">
            <div className="row-top">
              <span className="row-title">{u.character_name} <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>({u.login_id})</span></span>
              <div className="row-actions">
                <button className="accent" onClick={() => actions.approve(u.id)}>승인</button>
                <button className="danger" onClick={() => actions.reject(u.id)}>거절</button>
              </div>
            </div>
            <div className="row-sub">신청일 {fmtTime(u.created_at)}</div>
          </div>
        ))
      )}

      {tab === 'users' && allUsers.map((u) => (
        <div key={u.id} className="list-row">
          <div className="row-top">
            <span className="row-title">{u.character_name} <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>({u.login_id})</span>{u.is_admin && <span className="admin-badge">ADMIN</span>}{u.withdrawn && <span className="withdrawn-badge">탈퇴</span>}</span>
          </div>
          <div className="row-sub">{u.withdrawn ? '강제 탈퇴됨' : u.approved ? '승인됨' : '대기중'} · 가입일 {fmtTime(u.created_at)}</div>
          {!u.is_admin && !u.withdrawn && (
            <div className="admin-row-form">
              <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>기숙사</span>
              <select className="house-select" value={u.house || ''} onChange={(e) => actions.setHouse(u.id, e.target.value)}>
                <option value="">미지정</option>
                {HOUSES.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
          )}
          {u.id !== actions.selfId && (
            <div className="admin-row-form">
              {!u.withdrawn && <button className="accent" onClick={() => actions.toggleAdmin(u)}>{u.is_admin ? '권한 해제' : '관리자 지정'}</button>}
              {!u.is_admin && !u.withdrawn && <button className="danger" onClick={() => setWithdrawTarget(u)}>강제 탈퇴</button>}
              {u.withdrawn && <button className="accent" onClick={() => actions.restore(u)}>탈퇴 취소(복구)</button>}
            </div>
          )}
        </div>
      ))}

      {tab === 'points' && (
        <>
          <PointSettingsCard />
          <div className="field-label">개별 지급 / 차감</div>
          {allUsers.filter((u) => !u.is_admin && !u.withdrawn).map((u) => (
            <PointsRow key={u.id} u={u} onGrant={actions.grantPoints} />
          ))}
        </>
      )}

      {tab === 'posts' && (
        allPosts.length === 0 ? <div className="empty-state">등록된 글이 없습니다.</div> : allPosts.map((p) => (
          <div key={p.id} className="list-row">
            <div className="row-top">
              <span className="row-title" onClick={() => actions.openPost(p.id)}>{p.pinned ? '[공지] ' : ''}{p.title}</span>
              <div className="row-actions">
                <button onClick={() => actions.togglePinned(p.id)}>{p.pinned ? '공지 해제' : '공지 등록'}</button>
                <button className="danger" onClick={() => actions.deletePost(p)}>삭제</button>
              </div>
            </div>
            <div className="row-sub">작성자: {p.profiles?.character_name || '(탈퇴)'} ({p.profiles?.login_id}) · {boardName(p.board_id)} · {fmtTime(p.created_at)}</div>
          </div>
        ))
      )}

      {tab === 'comments' && (
        allComments.length === 0 ? <div className="empty-state">등록된 댓글이 없습니다.</div> : allComments.map((c) => (
          <div key={c.id} className="list-row">
            <div className="row-top">
              <span className="row-title" onClick={() => actions.openPost(c.post_id)}>{c.posts?.title || '(삭제된 글)'}</span>
              <div className="row-actions"><button className="danger" onClick={() => actions.deleteComment(c)}>삭제</button></div>
            </div>
            <div className="row-sub">작성자: {c.profiles?.character_name || '(탈퇴)'} ({c.profiles?.login_id}) · "{c.content.slice(0, 40)}" · {fmtTime(c.created_at)}</div>
          </div>
        ))
      )}

      {tab === 'dig' && <DigAdmin />}
      {tab === 'diglogs' && <DigLogsAdmin />}
      {tab === 'items' && <ItemsAdmin users={allUsers} />}
      {tab === 'itemlogs' && <ItemLogsAdmin />}

      {tab === 'gamble' && <GambleAdmin />}
      {tab === 'chats' && <ChatAdmin />}
      {tab === 'shop' && <ShopAdmin />}

      {withdrawTarget && (
        <WithdrawModal user={withdrawTarget} onCancel={() => setWithdrawTarget(null)}
          onConfirm={async (u, del) => { await actions.withdraw(u, del); setWithdrawTarget(null); }} />
      )}
    </>
  );
}
