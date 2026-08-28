import React, { useState } from 'react';
import { boardName, fmtTime, houseName } from '../lib/helpers';

function roomUnread(room, uid) {
  const mine = (room.chat_reads || []).find((r) => r.user_id === uid);
  const lastRead = mine ? new Date(mine.last_read_at).getTime() : 0;
  return (room.chat_messages || []).some((m) => m.sender_id !== uid && new Date(m.created_at).getTime() > lastRead);
}

export default function MyPage({ profile, posts, comments, chats, openPost, onEditPost, onDeletePost, onDeleteComment, onOpenChatRoom, initialTab = 'posts' }) {
  const [tab, setTab] = useState(initialTab);
  const hasUnread = chats.some((r) => roomUnread(r, profile.id));

  return (
    <>
      <div className="board-title-bar"><h2>마이페이지</h2><span className="count">{profile.character_name}{profile.house ? ' · ' + houseName(profile.house) : ''}</span></div>
      <div className="stat-row">
        <div className="stat-box"><div className="num gold">{profile.points}</div><div className="lbl">포인트</div></div>
        <div className="stat-box"><div className="num">{posts.length}</div><div className="lbl">쓴 글</div></div>
        <div className="stat-box"><div className="num">{comments.length}</div><div className="lbl">쓴 댓글</div></div>
      </div>
      <div className="tab-row">
        <div className={`tab-item ${tab === 'posts' ? 'active' : ''}`} onClick={() => setTab('posts')}>내가 쓴 글</div>
        <div className={`tab-item ${tab === 'comments' ? 'active' : ''}`} onClick={() => setTab('comments')}>내가 쓴 댓글</div>
        <div className={`tab-item ${tab === 'chats' ? 'active' : ''}`} onClick={() => setTab('chats')}>채팅{hasUnread && <span className="dot-badge" />}</div>
      </div>

      {tab === 'posts' && (
        posts.length === 0 ? <div className="empty-state">작성한 글이 없습니다.</div> : posts.map((p) => (
          <div key={p.id} className="list-row">
            <div className="row-top">
              <span className="row-title" onClick={() => openPost(p.id)}>{p.title}</span>
              <div className="row-actions">
                <button onClick={() => onEditPost(p)}>수정</button>
                <button className="danger" onClick={() => onDeletePost(p)}>삭제</button>
              </div>
            </div>
            <div className="row-sub">{boardName(p.board_id)} · {fmtTime(p.created_at)} · 댓글 {p.comments?.length || 0} · 좋아요 {p.post_likes?.length || 0}</div>
          </div>
        ))
      )}

      {tab === 'comments' && (
        comments.length === 0 ? <div className="empty-state">작성한 댓글이 없습니다.</div> : comments.map((c) => (
          <div key={c.id} className="list-row">
            <div className="row-top">
              <span className="row-title" onClick={() => openPost(c.post_id)}>{c.posts?.title || '(삭제된 글)'}</span>
              <div className="row-actions"><button className="danger" onClick={() => onDeleteComment(c)}>삭제</button></div>
            </div>
            <div className="row-sub">{fmtTime(c.created_at)} · "{c.content.slice(0, 40)}"</div>
          </div>
        ))
      )}

      {tab === 'chats' && (
        chats.length === 0 ? <div className="empty-state">채팅 내역이 없습니다.</div> : chats.map((r) => {
          const active = new Date(r.expires_at).getTime() > Date.now();
          const un = roomUnread(r, profile.id);
          return (
            <div key={r.id} className="list-row">
              <div className="row-top">
                <span className="row-title" onClick={() => onOpenChatRoom(r.id)}>{un && <span className="dot-badge" />} 채팅방</span>
                <div className="row-actions"><button onClick={() => onOpenChatRoom(r.id)}>{active ? '대화하기' : '내역보기'}</button></div>
              </div>
              <div className="row-sub">{active ? '대화 가능' : '대화 종료'} · 메시지 {r.chat_messages?.length || 0}개 · {fmtTime(r.created_at)}</div>
            </div>
          );
        })
      )}
    </>
  );
}
