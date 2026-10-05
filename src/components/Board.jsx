import React, { useEffect, useState } from 'react';
import { BOARDS } from '../lib/api';
import { boardName, fmtTime } from '../lib/helpers';

function canPostToBoard(profile, boardId) {
  if (profile.is_admin) return true;
  const b = BOARDS.find((x) => x.id === boardId);
  if (!b || !b.house) return true;
  return profile.house === b.house;
}

// 기숙사 게시판은 해당 기숙사(와 관리자)만 볼 수 있음
function canViewBoard(profile, boardId) { return canPostToBoard(profile, boardId); }

export default function Board({ profile, boardId, posts, openPost, onBulkDelete }) {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  // 게시판을 옮기면 선택 상태 초기화
  useEffect(() => { setSelectMode(false); setSelected(new Set()); }, [boardId]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function exitSelect() { setSelectMode(false); setSelected(new Set()); }

  if (!canViewBoard(profile, boardId)) {
    return (
      <>
        <div className="board-title-bar"><h2>{boardName(boardId)}</h2></div>
        <div className="empty-state">해당 기숙사만 볼 수 있는 게시판입니다.</div>
      </>
    );
  }

  return (
    <>
      <div className="board-title-bar">
        <h2>{boardName(boardId)}</h2>
        <span className="count">
          {posts.length}개의 글
          {profile.is_admin && posts.length > 0 && !selectMode && (
            <button className="select-toggle" onClick={() => setSelectMode(true)}>선택</button>
          )}
        </span>
      </div>
      {selectMode && (
        <div className="select-bar">
          <span>{selected.size}개 선택</span>
          <button onClick={() => setSelected(new Set(posts.map((p) => p.id)))}>전체 선택</button>
          <button className="danger" disabled={!selected.size} onClick={() => onBulkDelete([...selected], exitSelect)}>선택 삭제</button>
          <button onClick={exitSelect}>취소</button>
        </div>
      )}
      {posts.length === 0 && <div className="empty-state">아직 올라온 글이 없습니다.</div>}
      {posts.map((p) => (
        <div key={p.id} className={`post-row ${selectMode && selected.has(p.id) ? 'selected' : ''}`} onClick={() => (selectMode ? toggle(p.id) : openPost(p.id))}>
          <div className="post-row-main">
            <div className="post-row-text">
              <div className="title-line">
                {selectMode && <input type="checkbox" className="row-check" checked={selected.has(p.id)} readOnly />}
                {p.pinned && <span className="notice-badge">공지</span>}
                <span className="p-title">{p.title}</span>
                {p.comments?.length > 0 && <span className="c-count">[{p.comments.length}]</span>}
              </div>
              <div className="p-preview">{p.content}</div>
              <div className="p-meta">
                <span>{fmtTime(p.created_at)}</span>
                <span>좋아요 {p.post_likes?.length || 0}</span>
                <span>댓글 {p.comments?.length || 0}</span>
                {p.image_count > 0 && <span>사진 {p.image_count}</span>}
              </div>
            </div>
            {p.thumb && <img className="post-thumb" src={p.thumb} alt="" />}
          </div>
        </div>
      ))}
    </>
  );
}
export { canPostToBoard, canViewBoard };
