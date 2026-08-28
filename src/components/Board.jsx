import React from 'react';
import { BOARDS } from '../lib/api';
import { boardName, fmtTime } from '../lib/helpers';

function canPostToBoard(profile, boardId) {
  if (profile.is_admin) return true;
  const b = BOARDS.find((x) => x.id === boardId);
  if (!b || !b.house) return true;
  return profile.house === b.house;
}

export default function Board({ profile, boardId, posts, openPost }) {
  const canWrite = canPostToBoard(profile, boardId);
  return (
    <>
      <div className="board-title-bar">
        <h2>{boardName(boardId)}</h2>
        <span className="count">{posts.length}개의 글</span>
      </div>
      {!canWrite && <div className="board-note">해당 기숙사 소속만 작성 가능합니다.</div>}
      {posts.length === 0 && <div className="empty-state">아직 올라온 글이 없습니다.</div>}
      {posts.map((p) => (
        <div key={p.id} className="post-row" onClick={() => openPost(p.id)}>
          <div className="title-line">
            {p.pinned && <span className="notice-badge">공지</span>}
            <span className="p-title">{p.title}</span>
            {p.comments?.length > 0 && <span className="c-count">[{p.comments.length}]</span>}
          </div>
          <div className="p-preview">{p.content}</div>
          <div className="p-meta">
            <span>{fmtTime(p.created_at)}</span>
            <span>좋아요 {p.post_likes?.length || 0}</span>
            <span>댓글 {p.comments?.length || 0}</span>
          </div>
        </div>
      ))}
    </>
  );
}
export { canPostToBoard };
