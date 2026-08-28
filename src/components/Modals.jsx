import React, { useEffect, useState } from 'react';
import { BOARDS } from '../lib/api';
import { boardName, houseName, fmtTime } from '../lib/helpers';
import { canPostToBoard } from './Board';
import { fetchPostsByAuthor, fetchCommentsByAuthor, fetchGambleCountByUser, fetchProfileById } from '../lib/api';

export function ComposeModal({ profile, editingPost, defaultBoard, onCancel, onSubmit }) {
  const [board, setBoard] = useState(editingPost ? editingPost.board_id : defaultBoard);
  const [title, setTitle] = useState(editingPost ? editingPost.title : '');
  const [content, setContent] = useState(editingPost ? editingPost.content : '');
  const [error, setError] = useState('');
  const list = editingPost ? BOARDS : BOARDS.filter((b) => canPostToBoard(profile, b.id));

  async function submit(e) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) { setError('제목과 내용을 입력하세요.'); return; }
    try { await onSubmit(board, title.trim(), content.trim()); }
    catch (err) { setError(err.message || '오류가 발생했습니다.'); }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal-card">
        <div className="modal-title">{editingPost ? '글 수정' : '글쓰기'}</div>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={submit}>
          <select value={board} onChange={(e) => setBoard(e.target.value)}>
            {list.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" />
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="내용" />
          <div className="modal-actions">
            <button type="button" className="modal-cancel" onClick={onCancel}>취소</button>
            <button type="submit" className="modal-confirm">{editingPost ? '수정 완료' : '등록하기'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ConfirmModal({ message, danger = true, onCancel, onConfirm }) {
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal-card small">
        <div className="confirm-msg">{message}</div>
        <div className="modal-actions">
          <button className="modal-cancel" onClick={onCancel}>취소</button>
          <button className={`modal-confirm ${danger ? 'danger' : ''}`} onClick={onConfirm}>확인</button>
        </div>
      </div>
    </div>
  );
}

export function GiftModal({ balance, onCancel, onSend }) {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    const amt = parseInt(amount, 10);
    if (!amt || amt <= 0) { setError('보낼 포인트를 입력하세요.'); return; }
    try { await onSend(amt); }
    catch (err) { setError(err.message || '오류가 발생했습니다.'); }
  }
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal-card">
        <div className="modal-title">포인트 보내기</div>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={submit}>
          <input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`보유 ${balance}P`} />
          <div className="modal-actions">
            <button type="button" className="modal-cancel" onClick={onCancel}>취소</button>
            <button type="submit" className="modal-confirm">보내기</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function IdentityModal({ userId, onClose, onOpenPost }) {
  const [user, setUser] = useState(null);
  const [posts, setPosts] = useState([]);
  const [comments, setComments] = useState([]);
  const [detail, setDetail] = useState(false);
  const [gambleCount, setGambleCount] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      const [p, u, c] = await Promise.all([fetchPostsByAuthor(userId), fetchProfileById(userId), fetchCommentsByAuthor(userId)]);
      if (!live) return;
      setPosts(p); setUser(u); setComments(c);
      const gc = await fetchGambleCountByUser(userId);
      if (live) setGambleCount(gc);
    })();
    return () => { live = false; };
  }, [userId]);

  if (!user) return null;
  const lastActivity = Math.max(0, ...posts.map((p) => new Date(p.created_at).getTime()), ...comments.map((c) => new Date(c.created_at).getTime()));

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card">
        <div className="modal-title">캐릭터 정보</div>
        <div className="row-sub" style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>이름: {user.character_name}</div>
        <div className="row-sub" style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>아이디: {user.login_id}</div>
        <div className="row-sub" style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>기숙사: {user.house ? houseName(user.house) : '미지정'}</div>
        <div className="row-sub" style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>포인트: {user.points}</div>
        <div className="row-sub" style={{ fontSize: 13, color: 'var(--text)' }}>작성 글 수: {posts.length} · 작성 댓글 수: {comments.length}</div>
        {detail && (
          <>
            <div className="field-label">기타 정보</div>
            <div className="row-sub">가입일: {fmtTime(user.created_at)}</div>
            <div className="row-sub">최근 활동: {lastActivity ? fmtTime(lastActivity) : '없음'}</div>
            <div className="row-sub">도박 참여: {gambleCount}회</div>
            <div className="field-label">작성 글 ({posts.length})</div>
            {posts.length === 0 ? <div className="row-sub">없음</div> : posts.map((p) => (
              <div key={p.id} className="list-row" style={{ padding: '8px 0' }}>
                <span className="row-title" onClick={() => { onClose(); onOpenPost(p.id); }}>{p.title}</span>
                <div className="row-sub">{boardName(p.board_id)} · {fmtTime(p.created_at)}</div>
              </div>
            ))}
            <div className="field-label">작성 댓글 ({comments.length})</div>
            {comments.length === 0 ? <div className="row-sub">없음</div> : comments.map((c) => (
              <div key={c.id} className="list-row" style={{ padding: '8px 0' }}>
                <span className="row-title" onClick={() => { onClose(); onOpenPost(c.post_id); }}>{c.posts?.title || '(삭제된 글)'}</span>
                <div className="row-sub">"{c.content.slice(0, 40)}" · {fmtTime(c.created_at)}</div>
              </div>
            ))}
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-cancel" onClick={onClose}>닫기</button>
          {!detail && <button type="button" className="modal-confirm" onClick={() => setDetail(true)}>프로필 자세히 보기</button>}
        </div>
      </div>
    </div>
  );
}
