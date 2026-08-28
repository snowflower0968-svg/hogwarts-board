import { BOARDS, HOUSES } from './api';

export function fmtTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const pad = (n) => String(n).padStart(2, '0');
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getMonth() + 1}.${pad(d.getDate())}`;
}
export function boardName(id) { return BOARDS.find((b) => b.id === id)?.name || id; }
export function houseName(id) { return HOUSES.find((h) => h.id === id)?.name || '미지정'; }

// comments: array of {id, author_id, parent_id}; post: {author_id}; profilesById: map id->profile
export function computeAnonMap(post, comments, profilesById) {
  const map = {};
  let n = 1;
  comments.forEach((c) => {
    if (c.author_id === post.author_id) return;
    const u = profilesById[c.author_id];
    if (u?.is_admin) return;
    if (!(c.author_id in map)) map[c.author_id] = n++;
  });
  return map;
}
export function authorLabel(post, authorId, anonMap, profilesById) {
  const u = profilesById[authorId];
  if (u?.is_admin) return u.character_name;
  if (authorId === post.author_id) return '글쓴이';
  return `익${anonMap[authorId] ?? '?'}`;
}
export function notifText(n) {
  if (n.type === 'admin_grant') {
    const amt = n.points || 0;
    let t = amt >= 0 ? `포인트 +${amt} 지급` : `포인트 ${amt} 차감`;
    if (n.message) t += ' · ' + n.message;
    return t;
  }
  if (n.type === 'gift') return `포인트 ${n.points || 0} 선물 도착`;
  if (n.type === 'comment_on_post') return '내 글에 댓글이 달렸습니다.';
  if (n.type === 'reply_to_comment') return '내 댓글에 답글이 달렸습니다.';
  if (n.type === 'chat_message') return '새 메시지가 도착했습니다.';
  return '알림';
}
export function playNotifSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.16, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.35);
  } catch (e) { /* ignore */ }
}
