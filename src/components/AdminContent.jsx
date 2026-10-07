import React, { useState } from 'react';
import { boardName, fmtTime, makeThumb } from '../lib/helpers';
import { backfillPostThumbs } from '../lib/api';
import { AdminCard, SegTabs } from './Ui';

function ThumbBackfill() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function run() {
    setBusy(true); setMsg('사진 글을 찾는 중...');
    try {
      const r = await backfillPostThumbs(makeThumb, (done, total) => setMsg(`대표 사진 만드는 중... ${done}/${total}`));
      setMsg(r.total === 0 ? '대표 사진이 필요한 글이 없어요.' : `완료! ${r.total - r.failed}개 만들었어요.${r.failed ? ` (${r.failed}개는 실패)` : ''}`);
    } catch (e) { setMsg(e.message || '오류가 발생했습니다.'); }
    finally { setBusy(false); }
  }
  return (
    <AdminCard title="대표 사진 일괄 생성" hint="예전에 사진을 올린 글은 목록에 대표 사진이 없어요. 한 번에 만들어줍니다.">
      <div className="a-form-row" style={{ marginBottom: 0 }}>
        <button className="a-btn accent big" disabled={busy} onClick={run}>{busy ? '진행 중...' : '대표 사진 만들기'}</button>
        {msg && <span className="a-inline-note">{msg}</span>}
      </div>
    </AdminCard>
  );
}

export function ContentSection({ allPosts, allComments, actions }) {
  const [sub, setSub] = useState('posts');
  return (
    <>
      <SegTabs variant="sub" value={sub} onChange={setSub}
        items={[{ id: 'posts', label: `게시글 ${allPosts.length}` }, { id: 'comments', label: `댓글 ${allComments.length}` }]} />

      {sub === 'posts' && (
        <>
          <AdminCard title="게시글">
            {allPosts.length === 0 && <div className="a-empty">등록된 글이 없습니다.</div>}
            {allPosts.map((p) => (
              <div key={p.id} className="a-item">
                <div className="a-item-main a-click" onClick={() => actions.openPost(p.id)}>
                  <div className="a-item-title">{p.pinned && <span className="notice-badge">공지</span>}{p.title}</div>
                  <div className="a-item-sub">{p.profiles?.character_name || '(탈퇴)'} · {boardName(p.board_id)} · {fmtTime(p.created_at)}</div>
                </div>
                <button className="a-btn" onClick={() => actions.togglePinned(p.id)}>{p.pinned ? '공지 해제' : '공지'}</button>
                <button className="a-btn danger" onClick={() => actions.deletePost(p)}>삭제</button>
              </div>
            ))}
          </AdminCard>
          <ThumbBackfill />
        </>
      )}

      {sub === 'comments' && (
        <AdminCard title="댓글">
          {allComments.length === 0 && <div className="a-empty">등록된 댓글이 없습니다.</div>}
          {allComments.map((c) => (
            <div key={c.id} className="a-item">
              <div className="a-item-main a-click" onClick={() => actions.openPost(c.post_id)}>
                <div className="a-item-title" style={{ fontWeight: 500 }}>{c.content.slice(0, 60)}</div>
                <div className="a-item-sub">{c.profiles?.character_name || '(탈퇴)'} · {c.posts?.title || '(삭제된 글)'} · {fmtTime(c.created_at)}</div>
              </div>
              <button className="a-btn danger" onClick={() => actions.deleteComment(c)}>삭제</button>
            </div>
          ))}
        </AdminCard>
      )}
    </>
  );
}
