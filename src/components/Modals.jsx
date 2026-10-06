import React, { useEffect, useRef, useState } from 'react';
import { BOARDS } from '../lib/api';
import { boardName, houseName, fmtTime, compressImage } from '../lib/helpers';
import { canPostToBoard } from './Board';
import { fetchPostsByAuthor, fetchCommentsByAuthor, fetchGambleCountByUser, fetchProfileById, fetchPostImages, fetchNotes, fetchItemsOf } from '../lib/api';

export function ComposeModal({ profile, editingPost, defaultBoard, onCancel, onSubmit }) {
  const [board, setBoard] = useState(editingPost ? editingPost.board_id : defaultBoard);
  const [title, setTitle] = useState(editingPost ? editingPost.title : '');
  const [content, setContent] = useState(editingPost ? editingPost.content : '');
  const [images, setImages] = useState([]);
  const [imagesChanged, setImagesChanged] = useState(false);
  const [loadingImages, setLoadingImages] = useState(!!(editingPost && editingPost.image_count > 0));
  const [askCancel, setAskCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    if (!editingPost || !(editingPost.image_count > 0)) return undefined;
    let live = true;
    fetchPostImages(editingPost.id)
      .then((imgs) => { if (live) setImages(imgs); })
      .catch(() => { if (live) setError('기존 사진을 불러오지 못했습니다.'); })
      .finally(() => { if (live) setLoadingImages(false); });
    return () => { live = false; };
  }, [editingPost]);
  const list = editingPost ? BOARDS : BOARDS.filter((b) => canPostToBoard(profile, b.id));

  async function addFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const room = 4 - images.length;
    if (room <= 0) { setError('사진은 최대 4장까지 첨부할 수 있습니다.'); return; }
    setBusy(true); setError('');
    try {
      const out = [];
      for (const f of files.slice(0, room)) {
        // eslint-disable-next-line no-await-in-loop
        out.push(await compressImage(f));
      }
      setImages((prev) => [...prev, ...out].slice(0, 4));
      setImagesChanged(true);
      if (files.length > room) setError('사진은 최대 4장까지만 첨부됩니다.');
    } catch (err) { setError(err.message || '사진을 처리할 수 없습니다.'); }
    finally { setBusy(false); }
  }

  async function submit(e) {
    e.preventDefault();
    if (busy || loadingImages) return;
    if (!title.trim() || !content.trim()) { setError('제목과 내용을 입력하세요.'); return; }
    setBusy(true);
    try { await onSubmit(board, title.trim(), content.trim(), images, imagesChanged); }
    catch (err) { setError(err.message || '오류가 발생했습니다.'); setBusy(false); }
  }

  return (
    <>
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setAskCancel(true)}>
      <div className="modal-card">
        <div className="modal-title">{editingPost ? '글 수정' : '글쓰기'}</div>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={submit}>
          <select value={board} onChange={(e) => setBoard(e.target.value)}>
            {list.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" />
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="내용" />
          {(
            <div className="img-attach">
              <button type="button" className="img-add" disabled={busy || loadingImages || images.length >= 4} onClick={() => fileRef.current?.click()}>
                {loadingImages ? '사진 불러오는 중...' : busy ? '처리 중...' : `사진 첨부 (${images.length}/4)`}
              </button>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={addFiles} />
              {images.length > 0 && (
                <div className="img-previews">
                  {images.map((src, i) => (
                    <div key={i} className="img-thumb">
                      <img src={src} alt={`첨부 ${i + 1}`} />
                      <button type="button" onClick={() => { setImages(images.filter((_, j) => j !== i)); setImagesChanged(true); }} aria-label="사진 삭제">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="modal-cancel" onClick={onCancel}>취소</button>
            <button type="submit" className="modal-confirm" disabled={busy || loadingImages}>{editingPost ? '수정 완료' : '등록하기'}</button>
          </div>
        </form>
      </div>
    </div>
    {askCancel && (
      <ConfirmModal
        message={editingPost ? '글 수정을 취소하시겠습니까?\n수정한 내용이 사라집니다.' : '글쓰기를 취소하시겠습니까?\n작성 중인 내용이 모두 사라집니다.'}
        cancelLabel="계속 작성" confirmLabel="취소하기"
        onCancel={() => setAskCancel(false)} onConfirm={onCancel} />
    )}
    </>
  );
}

export function ConfirmModal({ message, danger = true, onCancel, onConfirm, cancelLabel = '취소', confirmLabel = '확인' }) {
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal-card small">
        <div className="confirm-msg" style={{ whiteSpace: 'pre-line' }}>{message}</div>
        <div className="modal-actions">
          <button className="modal-cancel" onClick={onCancel}>{cancelLabel}</button>
          <button className={`modal-confirm ${danger ? 'danger' : ''}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function GiftModal({ balance, items = [], onCancel, onSendPoints, onSendItem }) {
  const [mode, setMode] = useState('points');
  const [amount, setAmount] = useState('');
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('1');
  const [error, setError] = useState('');
  const selected = items.find((i) => i.id === itemId);

  async function submit(e) {
    e.preventDefault();
    try {
      if (mode === 'points') {
        const amt = parseInt(amount, 10);
        if (!amt || amt <= 0) { setError('보낼 포인트를 입력하세요.'); return; }
        await onSendPoints(amt);
      } else {
        const q = parseInt(qty, 10);
        if (!selected) { setError('보낼 소지품을 선택하세요.'); return; }
        if (!q || q <= 0 || q > selected.qty) { setError('수량을 확인하세요.'); return; }
        await onSendItem(selected.id, q);
      }
    } catch (err) { setError(err.message || '오류가 발생했습니다.'); }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal-card">
        <div className="modal-title">선물 보내기</div>
        <div className="seg-row">
          <button type="button" className={mode === 'points' ? 'on' : ''} onClick={() => { setMode('points'); setError(''); }}>포인트</button>
          <button type="button" className={mode === 'item' ? 'on' : ''} onClick={() => { setMode('item'); setError(''); }}>소지품</button>
        </div>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={submit}>
          {mode === 'points' ? (
            <input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`보유 ${balance}P`} />
          ) : items.length === 0 ? (
            <div className="empty-state" style={{ padding: '20px 0' }}>보유한 소지품이 없습니다.</div>
          ) : (
            <>
              <select value={itemId} onChange={(e) => { setItemId(e.target.value); setQty('1'); }}>
                <option value="">소지품 선택</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name} (보유 {i.qty})</option>)}
              </select>
              <input type="number" min="1" max={selected ? selected.qty : undefined} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="수량" />
            </>
          )}
          <div className="modal-actions">
            <button type="button" className="modal-cancel" onClick={onCancel}>취소</button>
            <button type="submit" className="modal-confirm">보내기</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ItemDeleteModal({ item, onCancel, onConfirm }) {
  const [qty, setQty] = useState('1');
  const [error, setError] = useState('');
  async function go() {
    const q = parseInt(qty, 10);
    if (!q || q <= 0 || q > item.qty) { setError('수량을 확인하세요.'); return; }
    try { await onConfirm(item.id, q); }
    catch (err) { setError(err.message || '오류가 발생했습니다.'); }
  }
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal-card small">
        <div className="confirm-msg">
          <b>{item.name}</b> 을(를) 삭제합니다.<br />정말로 삭제하시겠습니까?
        </div>
        {error && <div className="auth-error">{error}</div>}
        {item.qty > 1 && (
          <input type="number" min="1" max={item.qty} value={qty} onChange={(e) => setQty(e.target.value)} placeholder={`삭제할 수량 (보유 ${item.qty})`} />
        )}
        <div className="modal-actions">
          <button className="modal-cancel" onClick={onCancel}>취소</button>
          <button className="modal-confirm danger" onClick={go}>삭제</button>
        </div>
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
  const [notes, setNotes] = useState([]);
  const [invItems, setInvItems] = useState([]);

  useEffect(() => {
    let live = true;
    (async () => {
      const [p, u, c] = await Promise.all([fetchPostsByAuthor(userId), fetchProfileById(userId), fetchCommentsByAuthor(userId)]);
      if (!live) return;
      setPosts(p); setUser(u); setComments(c);
      const gc = await fetchGambleCountByUser(userId);
      if (live) setGambleCount(gc);
      const [n, it] = await Promise.allSettled([fetchNotes(userId), fetchItemsOf(userId)]);
      if (live) { setNotes(n.status === 'fulfilled' ? n.value : []); setInvItems(it.status === 'fulfilled' ? it.value : []); }
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
            <div className="field-label">소지품 ({invItems.length})</div>
            {invItems.length === 0 ? <div className="row-sub">없음</div> : invItems.map((it) => (
              <div key={it.id} className="row-sub" style={{ color: 'var(--text)' }}>{it.name}{it.qty > 1 ? ` x${it.qty}` : ''}{it.description ? ` · ${it.description}` : ''}</div>
            ))}
            <div className="field-label">개인 기재 ({notes.length})</div>
            {notes.length === 0 ? <div className="row-sub">없음</div> : notes.map((n) => (
              <div key={n.id} className="row-sub" style={{ color: 'var(--text)' }}>{n.name}{n.qty > 1 ? ` x${n.qty}` : ''}{n.note ? ` · ${n.note}` : ''}</div>
            ))}
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
