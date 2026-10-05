import React, { useState } from 'react';
import { boardName, fmtTime, computeAnonMap, authorLabel } from '../lib/helpers';

const CROWN_SVG = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M2 18h20l-2-9-5 4-3-7-3 7-5-4-2 9z" /></svg>
);

function AuthorLabel({ post, authorId, anonMap, profilesById, profile, cls, onOpenChat, onOpenIdentity }) {
  const u = profilesById[authorId];
  const label = authorLabel(post, authorId, anonMap, profilesById);
  if (u?.is_admin) {
    return <span className={cls}>{label}<span className="crown" title="관리자">{CROWN_SVG}</span></span>;
  }
  if (profile.is_admin) {
    if (authorId === profile.id) return <span className={cls}>{label}</span>;
    return <span className={`${cls} clickable`} onClick={() => onOpenIdentity(authorId)} title="정체 확인">{label}</span>;
  }
  if (authorId === profile.id) return <span className={cls}>{label}</span>;
  return <span className={`${cls} clickable`} onClick={() => onOpenChat(authorId)} title="메시지">{label}</span>;
}

export default function PostDetail({ profile, profilesById, post, comments, onBack, onLike, onDelete, onEdit, onTogglePinned, onOpenChat, onOpenIdentity, onSubmitComment, onDeleteComment, onEditComment, onBulkDeleteComments, images = [] }) {
  const [lightbox, setLightbox] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

  if (!post) return <div className="empty-state">삭제되었거나 존재하지 않는 글입니다.</div>;

  const isMine = post.author_id === profile.id;
  const liked = (post.post_likes || []).some((l) => l.user_id === profile.id);
  const anonMap = computeAnonMap(post, comments, profilesById);
  const topLevel = comments.filter((c) => !c.parent_id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  function toggleSel(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function exitSelect() { setSelectMode(false); setSelected(new Set()); }

  function getAllDescendants(rootId) {
    const direct = comments.filter((c) => c.parent_id === rootId);
    let all = [...direct];
    direct.forEach((d) => { all = all.concat(getAllDescendants(d.id)); });
    return all;
  }

  function renderComment(c, isReply) {
    const mine = c.author_id === profile.id;
    const isOwnerOfPost = c.author_id === post.author_id;
    const descendants = isReply ? [] : getAllDescendants(c.id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return (
      <div key={c.id} className={`comment-item ${isReply ? 'reply' : ''}`}>
        <div className="c-top">
          {selectMode && <input type="checkbox" className="row-check" checked={selected.has(c.id)} onChange={() => toggleSel(c.id)} />}
          <AuthorLabel post={post} authorId={c.author_id} anonMap={anonMap} profilesById={profilesById} profile={profile}
            cls={`c-author${isOwnerOfPost ? ' owner' : ''}`} onOpenChat={(id) => onOpenChat(post.id, id)} onOpenIdentity={onOpenIdentity} />
          <span className="c-time">{fmtTime(c.created_at)}</span>
        </div>
        <div className="c-body">
          {editingId === c.id ? (
            <form
              className="reply-form"
              onSubmit={(e) => { e.preventDefault(); if (!editText.trim()) return; onEditComment(c.id, editText.trim()); setEditingId(null); }}
            >
              <input value={editText} onChange={(e) => setEditText(e.target.value)} placeholder="댓글 수정" autoComplete="off" />
              <button type="submit">저장</button>
              <span onClick={() => setEditingId(null)} style={{ marginLeft: 8, cursor: 'pointer', fontSize: 11.5, color: 'var(--text-light)', alignSelf: 'center' }}>취소</span>
            </form>
          ) : (
            <>{c.content}{c.updated_at ? <span style={{ color: 'var(--text-light)', fontSize: 11 }}> (수정됨)</span> : null}</>
          )}
        </div>
        <div className="c-actions">
          {editingId !== c.id && <span onClick={() => { setReplyingTo(replyingTo === c.id ? null : c.id); setReplyText(''); }}>답글</span>}
          {mine && editingId !== c.id && <span onClick={() => { setEditingId(c.id); setEditText(c.content); }}>수정</span>}
          {mine && <span onClick={() => onDeleteComment(c.id)}>삭제</span>}
          {!mine && profile.is_admin && <span onClick={() => onDeleteComment(c.id)} title="관리자 삭제">삭제(관리자)</span>}
        </div>
        {replyingTo === c.id && (
          <form className="reply-form" onSubmit={(e) => { e.preventDefault(); if (!replyText.trim()) return; onSubmitComment(replyText.trim(), c.id); setReplyText(''); setReplyingTo(null); }}>
            <input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="답글 입력" autoComplete="off" />
            <button type="submit">등록</button>
          </form>
        )}
        {!isReply && descendants.map((r) => renderComment(r, true))}
      </div>
    );
  }

  return (
    <>
      <div className="back-row" onClick={onBack}>‹ {boardName(post.board_id)}</div>
      <div className="post-detail">
        <span className="pd-badge">{boardName(post.board_id)}</span>
        {post.pinned && <span className="notice-badge">공지</span>}
        <h1 className="pd-title">{post.title}</h1>
        <div className="pd-meta-row">
          <div>
            <AuthorLabel post={post} authorId={post.author_id} anonMap={anonMap} profilesById={profilesById} profile={profile}
              cls="pd-author" onOpenChat={(id) => onOpenChat(post.id, id)} onOpenIdentity={onOpenIdentity} />
            <span className="pd-time"> · {fmtTime(post.created_at)}{post.updated_at ? ' (수정됨)' : ''}</span>
          </div>
          <div className="pd-actions">
            {isMine && <><button onClick={onEdit}>수정</button><button onClick={onDelete}>삭제</button></>}
            {!isMine && profile.is_admin && <button onClick={onDelete} title="관리자 삭제">삭제(관리자)</button>}
            {profile.is_admin && <button onClick={onTogglePinned}>{post.pinned ? '공지 해제' : '공지 등록'}</button>}
          </div>
        </div>
        <div className="pd-content">{post.content}</div>
        {images.length > 0 && (
          <div className={`pd-images n${Math.min(images.length, 4)}`}>
            {images.map((src, i) => (
              <img key={i} src={src} alt={`첨부 사진 ${i + 1}`} onClick={() => setLightbox(src)} />
            ))}
          </div>
        )}
        <div className="pd-bottom">
          <button className={`like-btn ${liked ? 'liked' : ''}`} onClick={onLike}>좋아요 {(post.post_likes || []).length}</button>
        </div>
      </div>
      <div className="comments-wrap">
        <div className="comments-head">
          댓글 {comments.length}
          {profile.is_admin && comments.length > 0 && !selectMode && (
            <button className="select-toggle" onClick={() => setSelectMode(true)}>선택</button>
          )}
        </div>
        {selectMode && (
          <div className="select-bar">
            <span>{selected.size}개 선택 (답글도 함께 삭제)</span>
            <button onClick={() => setSelected(new Set(comments.map((c) => c.id)))}>전체 선택</button>
            <button className="danger" disabled={!selected.size} onClick={() => onBulkDeleteComments([...selected], exitSelect)}>선택 삭제</button>
            <button onClick={exitSelect}>취소</button>
          </div>
        )}
        {topLevel.length === 0 ? <div className="no-comments">댓글이 없습니다.</div> : topLevel.map((c) => renderComment(c, false))}
      </div>
      {lightbox && (
        <div className="modal-overlay lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="확대 사진" />
        </div>
      )}
    </>
  );
}
