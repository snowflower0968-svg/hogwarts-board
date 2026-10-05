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
  if (n.type === 'gift') return n.item_name ? `소지품 ${n.item_name} x${n.qty || 1} 선물 도착` : `포인트 ${n.points || 0} 선물 도착`;
  if (n.type === 'admin_item') return n.message || '소지품 변동';
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

export function fmtDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(sec)}`;
}

export function fmtDateTime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 사진을 작게 줄여서(JPEG) 문자열로 변환. 한 장당 약 400KB 이하가 되도록 자동 조정.
export function compressImage(file, maxDim = 1000, startQuality = 0.72, maxChars = 380000) {
  return new Promise((resolve, reject) => {
    if (!file.type || !file.type.startsWith('image/')) { reject(new Error('이미지 파일만 첨부할 수 있습니다.')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('이미지를 불러올 수 없습니다. (다른 형식으로 시도해 주세요)'));
      img.onload = () => {
        let dim = maxDim;
        let q = startQuality;
        let out = '';
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const scale = Math.min(1, dim / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          out = canvas.toDataURL('image/jpeg', q);
          if (out.length <= maxChars) break;
          if (q > 0.5) q -= 0.1; else dim = Math.round(dim * 0.8);
        }
        if (out.length > 900000) reject(new Error('이미지 용량이 너무 큽니다.'));
        else resolve(out);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// 목록용 작은 대표 사진 (정사각형으로 잘라서 아주 작게)
export function makeThumb(dataUrl, size = 120) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(null);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.6));
    };
    img.src = dataUrl;
  });
}

export function fmtRemain(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${sec}초`;
  return `${sec}초`;
}
