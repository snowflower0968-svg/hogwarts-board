import React, { useEffect, useState } from 'react';
import { HOUSES } from '../lib/api';
import { boardName, fmtTime, houseName } from '../lib/helpers';
import { fetchChatMessages } from '../lib/api';

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

function AdminChatDetail({ room, onBack }) {
  const [msgs, setMsgs] = useState([]);
  useEffect(() => { fetchChatMessages(room.id).then(setMsgs); }, [room.id]);
  return (
    <>
      <div className="back-row" onClick={onBack} style={{ cursor: 'pointer' }}>‹ 채팅 목록</div>
      <div className="board-note" style={{ padding: '10px 4px' }}>
        대화: {room.a?.character_name} ({room.a?.login_id}) ↔ {room.b?.character_name} ({room.b?.login_id})<br />
        글: {room.posts?.title || '(삭제된 글)'} · 상태: {new Date(room.expires_at).getTime() > Date.now() ? '대화 가능' : '대화 종료'}
      </div>
      {msgs.length === 0 ? <div className="empty-state">메시지가 없습니다.</div> : msgs.map((m) => (
        <div key={m.id} className="list-row">
          <div className="row-sub" style={{ fontWeight: 600, color: 'var(--text)' }}>{m.sender_id === room.user_a ? room.a?.character_name : room.b?.character_name} · {fmtTime(m.created_at)}</div>
          <div style={{ fontSize: 13.5, marginTop: 4 }}>{m.type === 'gift' ? `[포인트] ${m.amount} (${m.status})` : m.text}</div>
        </div>
      ))}
    </>
  );
}

export default function Admin({ pendingUsers, allUsers, allPosts, allComments, gambleLogs, chatRooms, refresh, actions, error }) {
  const [tab, setTab] = useState('approve');
  const [chatDetail, setChatDetail] = useState(null);

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
        <div className={`tab-item ${tab === 'chats' ? 'active' : ''}`} onClick={() => { setTab('chats'); setChatDetail(null); }}>채팅 관리</div>
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
          <div className="row-top"><span className="row-title">{u.character_name} <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>({u.login_id})</span>{u.is_admin && <span className="admin-badge">ADMIN</span>}</span></div>
          <div className="row-sub">{u.approved ? '승인됨' : '대기중'} · 가입일 {fmtTime(u.created_at)}</div>
          {!u.is_admin && (
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
              <button className="accent" onClick={() => actions.toggleAdmin(u)}>{u.is_admin ? '권한 해제' : '관리자 지정'}</button>
            </div>
          )}
        </div>
      ))}

      {tab === 'points' && allUsers.filter((u) => !u.is_admin).map((u) => (
        <PointsRow key={u.id} u={u} onGrant={actions.grantPoints} />
      ))}

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

      {tab === 'gamble' && (
        gambleLogs.length === 0 ? <div className="empty-state">도박 기록이 없습니다.</div> : gambleLogs.map((g) => (
          <div key={g.id} className="list-row">
            <div className="row-top"><span className="row-title">{g.profiles?.character_name || '(탈퇴)'} <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>({g.profiles?.login_id})</span></span></div>
            <div className="row-sub">베팅 {g.bet}P · 배율 x{g.multiplier} · 결과 {g.result_delta >= 0 ? '+' : ''}{g.result_delta}P · 베팅 후 잔액 {g.balance_after}P · {fmtTime(g.created_at)}</div>
          </div>
        ))
      )}

      {tab === 'chats' && (
        chatDetail ? <AdminChatDetail room={chatDetail} onBack={() => setChatDetail(null)} /> : (
          chatRooms.length === 0 ? <div className="empty-state">생성된 채팅방이 없습니다.</div> : chatRooms.map((r) => (
            <div key={r.id} className="list-row">
              <div className="row-top">
                <span className="row-title" onClick={() => setChatDetail(r)}>{r.a?.character_name || '(탈퇴)'} ↔ {r.b?.character_name || '(탈퇴)'}</span>
                <div className="row-actions"><button onClick={() => setChatDetail(r)}>내역보기</button></div>
              </div>
              <div className="row-sub">{new Date(r.expires_at).getTime() > Date.now() ? '대화 가능' : '대화 종료'} · {fmtTime(r.created_at)}</div>
            </div>
          ))
        )
      )}
    </>
  );
}
