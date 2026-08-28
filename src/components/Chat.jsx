import React, { useState } from 'react';
import { fmtTime } from '../lib/helpers';

export default function Chat({ profile, room, messages, onBack, onSend, onOpenGift, onAccept, onCancel }) {
  const [text, setText] = useState('');
  if (!room) return <div className="empty-state">채팅방을 찾을 수 없습니다.</div>;
  const active = new Date(room.expires_at).getTime() > Date.now();

  function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
  }

  return (
    <>
      <div className="back-row" onClick={onBack}>‹ 채팅</div>
      {!active && <div className="chat-notice">대화 가능 시간이 종료되었습니다.</div>}
      <div className="chat-thread">
        {messages.length === 0 && <div className="no-comments">메시지가 없습니다.</div>}
        {messages.map((m) => {
          const mine = m.sender_id === profile.id;
          let body;
          if (m.type === 'gift') {
            if (m.status === 'pending') {
              body = mine
                ? <>포인트 {m.amount} 선물 대기중<div><button className="text-btn" onClick={() => onCancel(m.id)}>취소</button></div></>
                : <>포인트 {m.amount} 선물 도착<div><button className="text-btn" onClick={() => onAccept(m.id)}>받기</button></div></>;
            } else if (m.status === 'accepted') {
              body = `포인트 ${m.amount} 선물 ${mine ? '전달됨' : '받음'}`;
            } else {
              body = `포인트 ${m.amount} 선물 취소됨`;
            }
          } else {
            body = m.text;
          }
          return (
            <div key={m.id} className={`chat-msg ${mine ? 'mine' : 'theirs'}${m.type === 'gift' ? ' gift' : ''}`}>
              <div className="chat-sender">{mine ? '나' : '상대방'} · {fmtTime(m.created_at)}</div>
              <div className="chat-bubble">{body}</div>
            </div>
          );
        })}
      </div>
      {active ? (
        <div className="bottom-input-bar">
          <form className="inner" onSubmit={submit} style={{ flex: 1 }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="메시지 보내기" autoComplete="off" />
            <button type="button" onClick={onOpenGift} style={{ background: 'var(--gold)' }}>포인트</button>
            <button type="submit">전송</button>
          </form>
        </div>
      ) : (
        <div className="bottom-input-bar"><div className="expired-note">대화 가능 시간이 종료되었습니다.</div></div>
      )}
    </>
  );
}
