import {
  collection, collectionGroup, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, writeBatch, getCountFromServer,
  serverTimestamp, increment, runTransaction, Timestamp,
} from 'firebase/firestore';
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as fbSignOut,
  updatePassword, updateEmail, onAuthStateChanged,
} from 'firebase/auth';
import { auth, db, loginIdToEmail } from '../firebaseClient';

export const BOARDS = [
  { id: 'free', name: '자유게시판', house: null },
  { id: 'gryffindor', name: '그리핀도르', house: 'gryffindor' },
  { id: 'slytherin', name: '슬리데린', house: 'slytherin' },
  { id: 'ravenclaw', name: '래번클로', house: 'ravenclaw' },
  { id: 'hufflepuff', name: '후플푸프', house: 'hufflepuff' },
  { id: 'anon', name: '익명방', house: null },
];
export const HOUSES = [
  { id: 'gryffindor', name: '그리핀도르' },
  { id: 'slytherin', name: '슬리데린' },
  { id: 'ravenclaw', name: '래번클로' },
  { id: 'hufflepuff', name: '후플푸프' },
];
const BOARD_HOUSE = Object.fromEntries(BOARDS.map((b) => [b.id, b.house]));

const CHAT_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_POINT_SETTINGS = { postEvery: 1, postAmount: 5, commentEvery: 2, commentAmount: 1 };
const GAMBLE_OUTCOMES = [[10, 1], [5, 4], [3, 8], [2, 15], [1, 22], [-1, 22], [-2, 15], [-3, 8], [-5, 4], [-10, 1]];

export const DIG_SIZE = 81;
export const DIG_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2시간마다 1회 충전
export const DIG_MAX_CHARGES = 3; // 최대 3회까지 누적

function ts(t) { return t ? t.toMillis() : Date.now(); }
function uid() { return auth.currentUser?.uid; }

// ---- 간이 조사: 충전 계산 (순수 함수) ----
// charges/atMs 가 비어 있으면(처음) 가입 시점 기준 1회 + 시간 경과분으로 계산
export function chargeState(charges, atMs, createdMs, nowMs) {
  let c = charges;
  let at = atMs;
  if (c === null || c === undefined) { c = 1; at = createdMs; }
  if (at === null || at === undefined) at = nowMs;
  if (c >= DIG_MAX_CHARGES) return { charges: DIG_MAX_CHARGES, at: nowMs, full: true };
  const gained = Math.floor((nowMs - at) / DIG_INTERVAL_MS);
  if (gained <= 0) return { charges: c, at, full: false };
  const nc = c + gained;
  if (nc >= DIG_MAX_CHARGES) return { charges: DIG_MAX_CHARGES, at: nowMs, full: true };
  return { charges: nc, at: at + gained * DIG_INTERVAL_MS, full: false };
}

// ---- 상점: 할인 적용 가격 (반올림) ----
export function discountActive(item, nowMs) {
  const pct = Number(item.discountPercent) || 0;
  if (pct <= 0) return false;
  return !item.discountUntil || nowMs < item.discountUntil;
}
export function effectivePrice(item, nowMs) {
  if (!discountActive(item, nowMs)) return item.price;
  return Math.round((item.price * (100 - Number(item.discountPercent))) / 100);
}

// 확률(가중치) 기반 랜덤 선택
export function pickWeighted(list) {
  const items = list.filter((r) => (Number(r.weight) || 0) > 0);
  const total = items.reduce((sum, r) => sum + Number(r.weight), 0);
  if (!total) return null;
  let x = Math.random() * total;
  for (const r of items) { x -= Number(r.weight); if (x < 0) return r; }
  return items[items.length - 1];
}

// 같은 이름+효과의 소지품은 한 묶음(수량)으로 합쳐지도록 고정 ID 생성
export function itemKey(name, description) {
  const str = `${(name || '').trim()}|${(description || '').trim()}`;
  let h1 = 5381; let h2 = 52711;
  for (let i = 0; i < str.length; i += 1) {
    const c = str.charCodeAt(i);
    h1 = ((h1 * 33) ^ c) >>> 0;
    h2 = ((h2 * 31) + c) >>> 0;
  }
  return `i_${h1.toString(36)}${h2.toString(36)}`;
}

// ---------------- auth ----------------
export async function signUp(loginId, password, characterName) {
  const email = loginIdToEmail(loginId);
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const newUid = cred.user.uid;
  try {
    await setDoc(doc(db, 'users', newUid), {
      loginId: loginId.trim(), characterName: characterName.trim(),
      isAdmin: false, approved: false, rejected: false, house: null,
      points: 100, commentCount: 0, soundEnabled: true, darkMode: false,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    await fbSignOut(auth);
    throw err;
  }
  await fbSignOut(auth);
}

export async function signIn(loginId, password) {
  const email = loginIdToEmail(loginId);
  let cred;
  try {
    cred = await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
  }
  const profile = await fetchOwnProfile(cred.user.uid);
  if (!profile) { await fbSignOut(auth); throw new Error('계정 정보를 찾을 수 없습니다.'); }
  if (profile.withdrawn) { await fbSignOut(auth); throw new Error('탈퇴 처리된 계정입니다.'); }
  if (profile.rejected) { await fbSignOut(auth); throw new Error('가입이 거절된 계정입니다.'); }
  if (!profile.approved) { await fbSignOut(auth); throw new Error('관리자 승인 대기 중입니다.'); }
  return profile;
}

function mapUser(id, d) {
  return {
    id, login_id: d.loginId, character_name: d.characterName, is_admin: !!d.isAdmin,
    approved: !!d.approved, rejected: !!d.rejected, house: d.house || null,
    points: d.points || 0, comment_count: d.commentCount || 0,
    sound_enabled: d.soundEnabled !== false, dark_mode: !!d.darkMode, created_at: ts(d.createdAt),
    dig_charges: d.digCharges ?? null, dig_charge_at: d.digChargeAt ? ts(d.digChargeAt) : null,
    dig_bonus: d.digBonus || 0, withdrawn: !!d.withdrawn, post_count: d.postCount ?? null,
  };
}
export function subscribeOwnStatus(id, cb) {
  return onSnapshot(doc(db, 'users', id), (snap) => { if (snap.exists()) cb(mapUser(id, snap.data())); }, () => {});
}
export async function fetchOwnProfile(id) {
  const snap = await getDoc(doc(db, 'users', id));
  return snap.exists() ? mapUser(id, snap.data()) : null;
}
export async function fetchProfileById(id) {
  try {
    const snap = await getDoc(doc(db, 'users', id));
    return snap.exists() ? mapUser(id, snap.data()) : null;
  } catch (e) { return null; }
}

export async function changePassword(newPassword) { await updatePassword(auth.currentUser, newPassword); }
export async function changeLoginId(newLoginId) {
  await updateEmail(auth.currentUser, loginIdToEmail(newLoginId));
  await updateDoc(doc(db, 'users', uid()), { loginId: newLoginId.trim() });
}
export async function updateSettings(patch) {
  const map = {};
  if ('sound_enabled' in patch) map.soundEnabled = patch.sound_enabled;
  if ('dark_mode' in patch) map.darkMode = patch.dark_mode;
  await updateDoc(doc(db, 'users', uid()), map);
}

// ---------------- posts ----------------
function mapPost(id, d) {
  return {
    id, board_id: d.boardId, author_id: d.authorId, title: d.title, content: d.content,
    pinned: !!d.pinned, created_at: ts(d.createdAt), updated_at: d.updatedAt ? ts(d.updatedAt) : null,
    post_likes: Array(d.likeCount || 0), comments: Array(d.commentCount || 0),
    image_count: d.imageCount || 0, thumb: d.thumb || null,
  };
}
export async function fetchPosts(boardId) {
  const q = query(collection(db, 'posts'), where('boardId', '==', boardId), orderBy('pinned', 'desc'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => mapPost(d.id, d.data()));
}
export function subscribePosts(boardId, onChange) {
  const q = query(collection(db, 'posts'), where('boardId', '==', boardId), orderBy('pinned', 'desc'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, () => onChange());
}
export async function fetchPost(id) {
  const snap = await getDoc(doc(db, 'posts', id));
  if (!snap.exists()) return null;
  const post = mapPost(id, snap.data());
  const likesSnap = await getDocs(collection(db, 'posts', id, 'likes'));
  post.post_likes = likesSnap.docs.map((l) => ({ user_id: l.id }));
  return post;
}
export async function fetchComments(postId) {
  const q = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id: d.id, author_id: d.data().authorId, parent_id: d.data().parentId || null,
    content: d.data().content, created_at: ts(d.data().createdAt), reward_granted: d.data().rewardGranted || 0,
    updated_at: d.data().updatedAt ? ts(d.data().updatedAt) : null,
  }));
}
export function subscribePost(postId, onChange) {
  const u1 = onSnapshot(doc(db, 'posts', postId), () => onChange());
  const u2 = onSnapshot(collection(db, 'posts', postId, 'comments'), () => onChange());
  const u3 = onSnapshot(collection(db, 'posts', postId, 'likes'), () => onChange());
  return () => { u1(); u2(); u3(); };
}
export async function fetchProfilesByIds(ids) {
  const unique = Array.from(new Set(ids));
  const map = {};
  await Promise.all(unique.map(async (id) => {
    const p = await fetchProfileById(id);
    if (p) map[id] = { id: p.id, character_name: p.character_name, is_admin: p.is_admin };
  }));
  return map;
}

export async function fetchPointSettings() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'points'));
    const d = snap.exists() ? snap.data() : {};
    const num = (v, def, min) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= min ? n : def; };
    return {
      postEvery: num(d.postEvery, DEFAULT_POINT_SETTINGS.postEvery, 1),
      postAmount: num(d.postAmount, DEFAULT_POINT_SETTINGS.postAmount, 0),
      commentEvery: num(d.commentEvery, DEFAULT_POINT_SETTINGS.commentEvery, 1),
      commentAmount: num(d.commentAmount, DEFAULT_POINT_SETTINGS.commentAmount, 0),
    };
  } catch (e) { return { ...DEFAULT_POINT_SETTINGS }; }
}
export async function savePointSettings(v) {
  const n = (x) => Math.floor(Number(x));
  const next = { postEvery: n(v.postEvery), postAmount: n(v.postAmount), commentEvery: n(v.commentEvery), commentAmount: n(v.commentAmount) };
  if (!(next.postEvery >= 1) || !(next.commentEvery >= 1)) throw new Error('"몇 개당" 값은 1 이상이어야 합니다.');
  if (!(next.postAmount >= 0) || !(next.commentAmount >= 0)) throw new Error('포인트는 0 이상이어야 합니다.');
  await setDoc(doc(db, 'settings', 'points'), next);
}

export async function createPost(board, title, content, images = [], thumb = null) {
  const userRef = doc(db, 'users', uid());
  const userSnap = await getDoc(userRef);
  const u = userSnap.data();
  const reqHouse = BOARD_HOUSE[board];
  if (reqHouse && !u.isAdmin && u.house !== reqHouse) throw new Error('해당 기숙사 소속만 작성 가능합니다.');
  const settings = await fetchPointSettings();
  let prevCount = u.postCount;
  if (prevCount === undefined || prevCount === null) {
    const c = await getCountFromServer(query(collection(db, 'posts'), where('authorId', '==', uid())));
    prevCount = c.data().count;
  }
  const newCount = prevCount + 1;
  const reward = newCount % settings.postEvery === 0 ? settings.postAmount : 0;
  const imgs = (images || []).slice(0, 4);
  const postRef = doc(collection(db, 'posts'));
  // 사진은 글 문서와 분리해서 저장 (목록 조회가 무거워지지 않도록)
  await Promise.all(imgs.map((data, i) => setDoc(doc(db, 'posts', postRef.id, 'images', String(i)), { idx: i, data, createdAt: serverTimestamp() })));
  await setDoc(postRef, {
    boardId: board, authorId: uid(), title, content, pinned: false,
    likeCount: 0, commentCount: 0, imageCount: imgs.length, thumb: imgs.length ? (thumb || null) : null,
    rewardGranted: reward, createdAt: serverTimestamp(), updatedAt: null,
  });
  await updateDoc(userRef, { postCount: newCount, points: increment(reward) });
}
export async function fetchPostImages(postId) {
  const snap = await getDocs(collection(db, 'posts', postId, 'images'));
  return snap.docs.map((d) => ({ idx: d.data().idx ?? 0, data: d.data().data })).sort((a, b) => a.idx - b.idx).map((x) => x.data);
}
async function deleteSubcollection(colRef) {
  const snap = await getDocs(colRef);
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}
// images 가 배열이면 사진 전체를 그 목록으로 교체, null 이면 사진은 그대로 둠
export async function updatePost(id, board, title, content, images = null, thumb = null) {
  const patch = { boardId: board, title, content, updatedAt: serverTimestamp() };
  if (Array.isArray(images)) {
    const imgs = images.slice(0, 4);
    await deleteSubcollection(collection(db, 'posts', id, 'images'));
    await Promise.all(imgs.map((data, i) => setDoc(doc(db, 'posts', id, 'images', String(i)), { idx: i, data, createdAt: serverTimestamp() })));
    patch.imageCount = imgs.length;
    patch.thumb = imgs.length ? (thumb || null) : null;
  }
  await updateDoc(doc(db, 'posts', id), patch);
}
export async function deletePost(id) {
  const ref = doc(db, 'posts', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const post = snap.data();
  const authorRef = doc(db, 'users', post.authorId);
  const authorSnap = await getDoc(authorRef);
  if (authorSnap.exists()) {
    let granted = post.rewardGranted;
    if (granted === undefined || granted === null) {
      const st = await fetchPointSettings();
      granted = st.postEvery === 1 ? st.postAmount : 0;
    }
    const a = authorSnap.data();
    const patch = { points: Math.max(0, (a.points || 0) - granted) };
    if (a.postCount !== undefined && a.postCount !== null) patch.postCount = Math.max(0, a.postCount - 1);
    await updateDoc(authorRef, patch);
  }
  await deleteSubcollection(collection(db, 'posts', id, 'likes'));
  await deleteSubcollection(collection(db, 'posts', id, 'comments'));
  await deleteSubcollection(collection(db, 'posts', id, 'images'));
  await deleteDoc(ref);
}
export async function deletePosts(ids) {
  for (const id of ids) {
    // 순차 처리 (작성자 포인트 회수가 겹치지 않도록)
    // eslint-disable-next-line no-await-in-loop
    await deletePost(id);
  }
}
export async function togglePinned(id) {
  const ref = doc(db, 'posts', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  await updateDoc(ref, { pinned: !snap.data().pinned });
}
export async function toggleLike(id) {
  const postRef = doc(db, 'posts', id);
  const likeRef = doc(db, 'posts', id, 'likes', uid());
  const likedRef = doc(db, 'users', uid(), 'likedPosts', id);
  await runTransaction(db, async (tx) => {
    const likeSnap = await tx.get(likeRef);
    if (likeSnap.exists()) {
      tx.delete(likeRef);
      tx.delete(likedRef);
      tx.update(postRef, { likeCount: increment(-1) });
    } else {
      tx.set(likeRef, { createdAt: serverTimestamp() });
      tx.set(likedRef, { createdAt: serverTimestamp() });
      tx.update(postRef, { likeCount: increment(1) });
    }
  });
}
// 내가 좋아요한 글 모아보기 (예전에 누른 좋아요는 처음 한 번만 찾아서 채움)
export async function fetchMyLikedPosts() {
  const me = uid();
  const userRef = doc(db, 'users', me);
  const us = await getDoc(userRef);
  const existing = await getDocs(collection(db, 'users', me, 'likedPosts'));
  if (!us.data()?.likedBackfill) {
    const have = new Set(existing.docs.map((d) => d.id));
    const all = await getDocs(collection(db, 'posts'));
    const found = await Promise.all(all.docs.map(async (p) => {
      if (have.has(p.id)) return null;
      const l = await getDoc(doc(db, 'posts', p.id, 'likes', me));
      return l.exists() ? p.id : null;
    }));
    await Promise.all(found.filter(Boolean).map((pid) => setDoc(doc(db, 'users', me, 'likedPosts', pid), { createdAt: serverTimestamp() })));
    await updateDoc(userRef, { likedBackfill: true });
  }
  const liked = await getDocs(collection(db, 'users', me, 'likedPosts'));
  const entries = liked.docs.map((d) => ({ id: d.id, at: d.data().createdAt ? ts(d.data().createdAt) : 0 }));
  const posts = await Promise.all(entries.map(async (e) => {
    const snap = await getDoc(doc(db, 'posts', e.id));
    if (!snap.exists()) { deleteDoc(doc(db, 'users', me, 'likedPosts', e.id)).catch(() => {}); return null; }
    return { ...mapPost(snap.id, snap.data()), liked_at: e.at };
  }));
  return posts.filter(Boolean).sort((x, y) => y.liked_at - x.liked_at);
}

// ---------------- comments ----------------
export async function addComment(postId, parentId, content) {
  const userRef = doc(db, 'users', uid());
  const postRef = doc(db, 'posts', postId);
  const commentRef = doc(collection(db, 'posts', postId, 'comments'));
  const userSnap = await getDoc(userRef);
  const settings = await fetchPointSettings();
  const newCount = (userSnap.data().commentCount || 0) + 1;
  const rewardGranted = (newCount % settings.commentEvery === 0) ? settings.commentAmount : 0;
  await updateDoc(userRef, { commentCount: newCount, points: increment(rewardGranted) });
  await setDoc(commentRef, { authorId: uid(), parentId: parentId || null, content, rewardGranted, createdAt: serverTimestamp() });
  await updateDoc(postRef, { commentCount: increment(1) });

  let notifTarget = null; let notifType = null;
  if (parentId) {
    const parentSnap = await getDoc(doc(db, 'posts', postId, 'comments', parentId));
    if (parentSnap.exists() && parentSnap.data().authorId !== uid()) { notifTarget = parentSnap.data().authorId; notifType = 'reply_to_comment'; }
  } else {
    const postSnap = await getDoc(postRef);
    if (postSnap.exists() && postSnap.data().authorId !== uid()) { notifTarget = postSnap.data().authorId; notifType = 'comment_on_post'; }
  }
  if (notifTarget) {
    await addDoc(collection(db, 'notifications'), { userId: notifTarget, type: notifType, postId, commentId: commentRef.id, preview: content.slice(0, 80), read: false, createdAt: serverTimestamp() });
  }
}
export async function deleteComments(postId, ids) {
  const postRef = doc(db, 'posts', postId);
  const allSnap = await getDocs(collection(db, 'posts', postId, 'comments'));
  const byId = new Map(allSnap.docs.map((d) => [d.id, d]));
  const childrenOf = {};
  allSnap.docs.forEach((d) => {
    const p = d.data().parentId;
    if (p) (childrenOf[p] = childrenOf[p] || []).push(d.id);
  });
  const toRemove = new Set();
  const walk = (cid) => {
    if (toRemove.has(cid) || !byId.has(cid)) return;
    toRemove.add(cid);
    (childrenOf[cid] || []).forEach(walk);
  };
  ids.forEach(walk);
  if (!toRemove.size) return;
  const byAuthor = {};
  toRemove.forEach((cid) => { const a = byId.get(cid).data().authorId; byAuthor[a] = (byAuthor[a] || 0) + 1; });
  await Promise.all(Object.keys(byAuthor).map(async (a) => {
    const uref = doc(db, 'users', a);
    const usnap = await getDoc(uref);
    if (!usnap.exists()) return;
    await updateDoc(uref, { commentCount: Math.max(0, (usnap.data().commentCount || 0) - byAuthor[a]) });
  }));
  await Promise.all([...toRemove].map((cid) => deleteDoc(byId.get(cid).ref)));
  await updateDoc(postRef, { commentCount: increment(-toRemove.size) });
}
export async function deleteComment(postId, id) { await deleteComments(postId, [id]); }

export async function updateComment(postId, id, content) {
  await updateDoc(doc(db, 'posts', postId, 'comments', id), { content, updatedAt: serverTimestamp() });
}

// ---------------- my page ----------------
export async function fetchMyPosts(id) {
  const q = query(collection(db, 'posts'), where('authorId', '==', id), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => mapPost(d.id, d.data()));
}
async function titlesForPostIds(ids) {
  const unique = Array.from(new Set(ids));
  const map = {};
  await Promise.all(unique.map(async (id) => {
    const s = await getDoc(doc(db, 'posts', id));
    map[id] = s.exists() ? s.data().title : null;
  }));
  return map;
}
export async function fetchMyComments(id) {
  const q = query(collectionGroup(db, 'comments'), where('authorId', '==', id), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  const items = snap.docs.map((d) => ({ id: d.id, post_id: d.ref.parent.parent.id, content: d.data().content, created_at: ts(d.data().createdAt) }));
  const titles = await titlesForPostIds(items.map((i) => i.post_id));
  return items.map((i) => ({ ...i, posts: { title: titles[i.post_id] } }));
}
// 관리자가 직접 삭제할 때만 사용 (만료된 채팅방도 기록은 남겨둠)
export async function deleteChatRoomFully(roomId) {
  const [msgsSnap, readsSnap] = await Promise.all([
    getDocs(collection(db, 'chatRooms', roomId, 'messages')),
    getDocs(collection(db, 'chatRooms', roomId, 'reads')),
  ]);
  await Promise.all([...msgsSnap.docs, ...readsSnap.docs].map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, 'chatRooms', roomId));
}
export async function deleteChatRooms(ids) {
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    await deleteChatRoomFully(id);
  }
}
async function touchRoom(roomId, text) {
  try { await updateDoc(doc(db, 'chatRooms', roomId), { lastText: text.slice(0, 60), lastAt: serverTimestamp(), messageCount: increment(1) }); } catch (e) { /* best-effort */ }
}

export async function fetchMyChats(id) {
  const [snapA, snapB] = await Promise.all([
    getDocs(query(collection(db, 'chatRooms'), where('userA', '==', id), orderBy('createdAt', 'desc'))),
    getDocs(query(collection(db, 'chatRooms'), where('userB', '==', id), orderBy('createdAt', 'desc'))),
  ]);
  const rooms = [...snapA.docs, ...snapB.docs].map((d) => ({ id: d.id, ...d.data() }));
  rooms.sort((a, b) => ts(b.createdAt) - ts(a.createdAt));
  const now = Date.now();
  const alive = [];
  for (const r of rooms) {
    if (ts(r.expiresAt) <= now) continue; // 사용자에게는 안 보이지만 관리자는 기록을 볼 수 있음
    alive.push(r);
  }
  return Promise.all(alive.map(async (r) => {
    const [msgsSnap, readsSnap] = await Promise.all([
      getDocs(collection(db, 'chatRooms', r.id, 'messages')),
      getDocs(collection(db, 'chatRooms', r.id, 'reads')),
    ]);
    return {
      id: r.id, post_id: r.postId, user_a: r.userA, user_b: r.userB,
      created_at: ts(r.createdAt), expires_at: ts(r.expiresAt),
      chat_messages: msgsSnap.docs.map((m) => ({ id: m.id, sender_id: m.data().senderId, created_at: ts(m.data().createdAt) })),
      chat_reads: readsSnap.docs.map((rd) => ({ user_id: rd.id, last_read_at: ts(rd.data().lastReadAt) })),
    };
  }));
}

// ---------------- gambling ----------------
export async function spinGamble(bet) {
  const userRef = doc(db, 'users', uid());
  const snap = await getDoc(userRef);
  const pts = snap.data().points || 0;
  if (pts < 0) throw new Error('포인트가 부족하여 이용할 수 없습니다.');
  if (!bet || bet <= 0 || bet > pts) throw new Error('베팅 금액을 확인하세요.');
  const total = GAMBLE_OUTCOMES.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  let m = GAMBLE_OUTCOMES[GAMBLE_OUTCOMES.length - 1][0];
  for (const [mult, w] of GAMBLE_OUTCOMES) { if (r < w) { m = mult; break; } r -= w; }
  const delta = bet * m;
  const newBal = pts - bet + delta;
  await updateDoc(userRef, { points: newBal });
  await addDoc(collection(db, 'gambleLogs'), { userId: uid(), bet, multiplier: m, resultDelta: delta, balanceAfter: newBal, createdAt: serverTimestamp() });
  return { multiplier: m, result_delta: delta, balance_after: newBal };
}
export async function fetchGambleLogsAdmin() {
  const q = query(collection(db, 'gambleLogs'), orderBy('createdAt', 'desc'), limit(200));
  const snap = await getDocs(q);
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const profiles = await fetchProfilesFull(items.map((i) => i.userId));
  return items.map((i) => ({
    id: i.id, user_id: i.userId, bet: i.bet, multiplier: i.multiplier, result_delta: i.resultDelta, balance_after: i.balanceAfter,
    created_at: ts(i.createdAt), profiles: profiles[i.userId] || null,
  }));
}
export async function fetchGambleCountByUser(id) {
  const q = query(collection(db, 'gambleLogs'), where('userId', '==', id));
  const c = await getCountFromServer(q);
  return c.data().count;
}

// ---------------- chat ----------------
export async function openChatWith(postId, targetId) {
  const now = Date.now();
  const existing = await getDocs(query(collection(db, 'chatRooms'), where('postId', '==', postId)));
  let roomId = null;
  existing.forEach((d) => {
    const r = d.data();
    if (((r.userA === uid() && r.userB === targetId) || (r.userA === targetId && r.userB === uid())) && r.expiresAt.toMillis() > now) {
      roomId = d.id;
    }
  });
  if (!roomId) {
    const ref = await addDoc(collection(db, 'chatRooms'), {
      postId, userA: uid(), userB: targetId, createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(now + CHAT_TTL_MS),
    });
    roomId = ref.id;
  }
  await setDoc(doc(db, 'chatRooms', roomId, 'reads', uid()), { lastReadAt: serverTimestamp() });
  return roomId;
}
export async function markChatRead(roomId) {
  await setDoc(doc(db, 'chatRooms', roomId, 'reads', uid()), { lastReadAt: serverTimestamp() });
}
export async function fetchChatRoom(roomId) {
  const snap = await getDoc(doc(db, 'chatRooms', roomId));
  if (!snap.exists()) return null;
  const d = snap.data();
  return { id: roomId, post_id: d.postId, user_a: d.userA, user_b: d.userB, created_at: ts(d.createdAt), expires_at: ts(d.expiresAt) };
}
export async function fetchChatMessages(roomId) {
  const q = query(collection(db, 'chatRooms', roomId, 'messages'), orderBy('createdAt'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id: d.id, sender_id: d.data().senderId, type: d.data().type, text: d.data().text || null,
    amount: d.data().amount || null, status: d.data().status || null, created_at: ts(d.data().createdAt),
    kind: d.data().kind || 'points', item_name: d.data().itemName || null,
    item_description: d.data().itemDescription || null, qty: d.data().qty || null,
  }));
}
export function subscribeChat(roomId, onChange) {
  return onSnapshot(collection(db, 'chatRooms', roomId, 'messages'), () => onChange());
}
export async function sendChatMessage(roomId, text) {
  const roomSnap = await getDoc(doc(db, 'chatRooms', roomId));
  if (!roomSnap.exists()) throw new Error('채팅방을 찾을 수 없습니다.');
  const r = roomSnap.data();
  if (r.expiresAt.toMillis() < Date.now()) throw new Error('대화 가능 시간이 종료되었습니다.');
  await addDoc(collection(db, 'chatRooms', roomId, 'messages'), { senderId: uid(), type: 'text', text, createdAt: serverTimestamp() });
  const recipient = r.userA === uid() ? r.userB : r.userA;
  await addDoc(collection(db, 'notifications'), { userId: recipient, type: 'chat_message', roomId, preview: text.slice(0, 80), read: false, createdAt: serverTimestamp() });
  await touchRoom(roomId, text);
}
export async function sendGift(roomId, amount) {
  const roomSnap = await getDoc(doc(db, 'chatRooms', roomId));
  if (!roomSnap.exists()) throw new Error('채팅방을 찾을 수 없습니다.');
  const r = roomSnap.data();
  if (r.expiresAt.toMillis() < Date.now()) throw new Error('대화 가능 시간이 종료되었습니다.');
  const userRef = doc(db, 'users', uid());
  const userSnap = await getDoc(userRef);
  const bal = userSnap.data().points || 0;
  if (bal < amount) throw new Error('보유 포인트가 부족합니다.');
  const recipient = r.userA === uid() ? r.userB : r.userA;
  await updateDoc(userRef, { points: bal - amount });
  await addDoc(collection(db, 'chatRooms', roomId, 'messages'), { senderId: uid(), type: 'gift', kind: 'points', amount, status: 'pending', createdAt: serverTimestamp() });
  await addDoc(collection(db, 'notifications'), { userId: recipient, type: 'gift', points: amount, roomId, read: false, createdAt: serverTimestamp() });
  await touchRoom(roomId, `[선물] 포인트 ${amount}`);
}
export async function sendGiftItem(roomId, itemId, qtyRaw) {
  const qty = parseInt(qtyRaw, 10);
  if (!qty || qty <= 0) throw new Error('수량을 확인하세요.');
  const roomSnap = await getDoc(doc(db, 'chatRooms', roomId));
  if (!roomSnap.exists()) throw new Error('채팅방을 찾을 수 없습니다.');
  const r = roomSnap.data();
  if (r.expiresAt.toMillis() < Date.now()) throw new Error('대화 가능 시간이 종료되었습니다.');
  const recipient = r.userA === uid() ? r.userB : r.userA;
  const item = await removeItemFromUser(uid(), itemId, qty); // 보낸 순간 내 소지품에서 빠짐 (취소하면 돌아옴)
  await addDoc(collection(db, 'chatRooms', roomId, 'messages'), {
    senderId: uid(), type: 'gift', kind: 'item', itemName: item.name, itemDescription: item.description || '', qty, status: 'pending', createdAt: serverTimestamp(),
  });
  await addDoc(collection(db, 'notifications'), { userId: recipient, type: 'gift', itemName: item.name, qty, roomId, read: false, createdAt: serverTimestamp() });
  await touchRoom(roomId, `[선물] ${item.name} x${qty}`);
}
export async function acceptGift(roomId, msgId) {
  const msgRef = doc(db, 'chatRooms', roomId, 'messages', msgId);
  const msgSnap = await getDoc(msgRef);
  if (!msgSnap.exists() || msgSnap.data().status !== 'pending') return;
  const m = msgSnap.data();
  if (m.senderId === uid()) return;
  if (m.kind === 'item') {
    const itemRef = doc(db, 'users', uid(), 'items', itemKey(m.itemName, m.itemDescription));
    await runTransaction(db, async (tx) => {
      const ms = await tx.get(msgRef);
      const is = await tx.get(itemRef);
      if (!ms.exists() || ms.data().status !== 'pending') throw new Error('이미 처리된 선물입니다.');
      tx.update(msgRef, { status: 'accepted' });
      if (is.exists()) tx.update(itemRef, { qty: increment(m.qty) });
      else tx.set(itemRef, { name: m.itemName, description: m.itemDescription || '', qty: m.qty, createdAt: serverTimestamp() });
    });
    const [from, to] = await Promise.all([fetchProfileById(m.senderId), fetchProfileById(uid())]);
    await logItem({ action: 'transfer', userId: m.senderId, userName: from?.character_name || '', targetUserId: uid(), targetName: to?.character_name || '', itemName: m.itemName, itemDescription: m.itemDescription || '', qty: m.qty });
    return;
  }
  const userRef = doc(db, 'users', uid());
  const userSnap = await getDoc(userRef);
  await updateDoc(msgRef, { status: 'accepted' });
  await updateDoc(userRef, { points: (userSnap.data().points || 0) + msgSnap.data().amount });
}
export async function cancelGift(roomId, msgId) {
  const msgRef = doc(db, 'chatRooms', roomId, 'messages', msgId);
  const msgSnap = await getDoc(msgRef);
  if (!msgSnap.exists() || msgSnap.data().status !== 'pending') return;
  const m = msgSnap.data();
  if (m.senderId !== uid()) return;
  if (m.kind === 'item') {
    await updateDoc(msgRef, { status: 'cancelled' });
    await addItemToUser(m.senderId, m.itemName, m.itemDescription, m.qty);
    return;
  }
  const senderRef = doc(db, 'users', m.senderId);
  const senderSnap = await getDoc(senderRef);
  await updateDoc(msgRef, { status: 'cancelled' });
  if (senderSnap.exists()) await updateDoc(senderRef, { points: (senderSnap.data().points || 0) + m.amount });
}

async function fetchProfilesFull(ids) {
  const unique = Array.from(new Set(ids));
  const map = {};
  await Promise.all(unique.map(async (id) => {
    const p = await fetchProfileById(id);
    if (p) map[id] = { character_name: p.character_name, login_id: p.login_id };
  }));
  return map;
}
export async function fetchAdminChatRooms() {
  const snap = await getDocs(query(collection(db, 'chatRooms'), orderBy('createdAt', 'desc'), limit(200)));
  const rooms = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const profiles = await fetchProfilesFull(rooms.flatMap((r) => [r.userA, r.userB]));
  const titles = await titlesForPostIds(rooms.map((r) => r.postId).filter(Boolean));
  return rooms.map((r) => ({
    id: r.id, user_a: r.userA, user_b: r.userB, created_at: ts(r.createdAt), expires_at: ts(r.expiresAt),
    a: profiles[r.userA] || null, b: profiles[r.userB] || null,
    posts: r.postId ? { title: titles[r.postId] } : null,
    last_text: r.lastText || null, last_at: r.lastAt ? ts(r.lastAt) : null, message_count: r.messageCount ?? null,
  }));
}

// ---------------- notifications ----------------
function mapNotif(d) {
  const x = d.data();
  return {
    id: d.id, user_id: x.userId, type: x.type, points: x.points ?? null, message: x.message || null,
    post_id: x.postId || null, comment_id: x.commentId || null, room_id: x.roomId || null,
    item_name: x.itemName || null, qty: x.qty ?? null, preview: x.preview || null,
    read: !!x.read, created_at: ts(x.createdAt),
  };
}
export async function fetchNotifications(id) {
  const q = query(collection(db, 'notifications'), where('userId', '==', id), orderBy('createdAt', 'desc'), limit(50));
  const snap = await getDocs(q);
  return snap.docs.map(mapNotif);
}
export function subscribeNotifications(id, onList, onNewInsert) {
  let first = true;
  const q = query(collection(db, 'notifications'), where('userId', '==', id), orderBy('createdAt', 'desc'), limit(50));
  return onSnapshot(q, (snap) => {
    onList(snap.docs.map(mapNotif));
    if (!first) snap.docChanges().forEach((c) => { if (c.type === 'added') onNewInsert(mapNotif(c.doc)); });
    first = false;
  });
}
export async function markNotificationsRead(ids) {
  if (!ids.length) return;
  const batch = writeBatch(db);
  ids.forEach((id) => batch.update(doc(db, 'notifications', id), { read: true }));
  await batch.commit();
}

// ---------------- identity reveal helpers ----------------
export async function fetchPostsByAuthor(id) {
  const q = query(collection(db, 'posts'), where('authorId', '==', id), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => mapPost(d.id, d.data()));
}
export async function fetchCommentsByAuthor(id) {
  const q = query(collectionGroup(db, 'comments'), where('authorId', '==', id), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  const items = snap.docs.map((d) => ({ id: d.id, post_id: d.ref.parent.parent.id, content: d.data().content, created_at: ts(d.data().createdAt) }));
  const titles = await titlesForPostIds(items.map((i) => i.post_id));
  return items.map((i) => ({ ...i, posts: { title: titles[i.post_id] } }));
}

// ---------------- admin ----------------
export async function fetchAllUsers() {
  const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt')));
  return snap.docs.map((d) => mapUser(d.id, d.data()));
}
export async function fetchAllPostsAdmin() {
  const snap = await getDocs(query(collection(db, 'posts'), orderBy('createdAt', 'desc')));
  const posts = snap.docs.map((d) => mapPost(d.id, d.data()));
  const profiles = await fetchProfilesFull(posts.map((p) => p.author_id));
  return posts.map((p) => ({ ...p, profiles: profiles[p.author_id] || null }));
}
export async function fetchAllCommentsAdmin() {
  const q = query(collectionGroup(db, 'comments'), orderBy('createdAt', 'desc'), limit(500));
  const snap = await getDocs(q);
  const items = snap.docs.map((d) => ({
    id: d.id, post_id: d.ref.parent.parent.id, author_id: d.data().authorId,
    content: d.data().content, created_at: ts(d.data().createdAt),
  }));
  const titles = await titlesForPostIds(items.map((i) => i.post_id));
  const profiles = await fetchProfilesFull(items.map((i) => i.author_id));
  return items.map((i) => ({ ...i, posts: { title: titles[i.post_id] }, profiles: profiles[i.author_id] || null }));
}
export async function approveUser(id) { await updateDoc(doc(db, 'users', id), { approved: true, rejected: false }); }
export async function rejectUser(id) { await updateDoc(doc(db, 'users', id), { rejected: true, approved: false }); }
export async function setUserHouse(id, house) { await updateDoc(doc(db, 'users', id), { house: house || null }); }
export async function toggleAdminRole(id) {
  const ref = doc(db, 'users', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  await updateDoc(ref, { isAdmin: !snap.data().isAdmin });
}
export async function grantPoints(id, amount, message) {
  const ref = doc(db, 'users', id);
  const snap = await getDoc(ref);
  const newPts = Math.max(0, (snap.data().points || 0) + amount);
  await updateDoc(ref, { points: newPts });
  await addDoc(collection(db, 'notifications'), { userId: id, type: 'admin_grant', points: amount, message: message || null, read: false, createdAt: serverTimestamp() });
}

async function deleteManyDocs(collName, ids) {
  for (let i = 0; i < ids.length; i += 400) {
    const batch = writeBatch(db);
    ids.slice(i, i + 400).forEach((id) => batch.delete(doc(db, collName, id)));
    // eslint-disable-next-line no-await-in-loop
    await batch.commit();
  }
}
export async function deleteGambleLogs(ids) { await deleteManyDocs('gambleLogs', ids); }
export async function deleteItemLogs(ids) { await deleteManyDocs('itemLogs', ids); }
export async function deleteDigLogs(ids) { await deleteManyDocs('digLogs', ids); }

// 강제 탈퇴: 로그인 차단(계정 기록은 남김). deleteContent 가 true 면 작성한 글/댓글도 삭제
export async function adminWithdrawUser(userId, deleteContent) {
  if (userId === uid()) throw new Error('본인은 탈퇴시킬 수 없습니다.');
  const target = await fetchProfileById(userId);
  if (!target) throw new Error('회원 정보를 찾을 수 없습니다.');
  if (target.is_admin) throw new Error('관리자 계정은 먼저 관리자 권한을 해제해 주세요.');
  await updateDoc(doc(db, 'users', userId), { withdrawn: true, approved: false, rejected: true });
  const removed = { posts: 0, comments: 0 };
  if (deleteContent) {
    const posts = await fetchPostsByAuthor(userId);
    await deletePosts(posts.map((p) => p.id));
    removed.posts = posts.length;
    const comments = await fetchCommentsByAuthor(userId);
    const byPost = {};
    comments.forEach((c) => { (byPost[c.post_id] = byPost[c.post_id] || []).push(c.id); });
    for (const [pid, ids] of Object.entries(byPost)) {
      // eslint-disable-next-line no-await-in-loop
      await deleteComments(pid, ids);
    }
    removed.comments = comments.length;
  }
  return removed;
}
export async function adminRestoreUser(userId) {
  await updateDoc(doc(db, 'users', userId), { withdrawn: false, rejected: false, approved: true });
}

export async function signOutUser() { await fbSignOut(auth); }
export function onAuthBoot(cb) { return onAuthStateChanged(auth, cb); }


// ================= 소지품 =================
async function logItem(entry) {
  try { await addDoc(collection(db, 'itemLogs'), { ...entry, createdAt: serverTimestamp() }); } catch (e) { /* best-effort */ }
}
async function addItemToUser(userId, name, description, qty) {
  const itemRef = doc(db, 'users', userId, 'items', itemKey(name, description));
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(itemRef);
    if (snap.exists()) tx.update(itemRef, { qty: increment(qty) });
    else tx.set(itemRef, { name: (name || '').trim(), description: (description || '').trim(), qty, createdAt: serverTimestamp() });
  });
}
async function removeItemFromUser(userId, itemId, qty) {
  const itemRef = doc(db, 'users', userId, 'items', itemId);
  let item;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(itemRef);
    if (!snap.exists() || (snap.data().qty || 0) < qty) throw new Error('보유한 소지품 수량이 부족합니다.');
    item = snap.data();
    const left = item.qty - qty;
    if (left <= 0) tx.delete(itemRef); else tx.update(itemRef, { qty: left });
  });
  return item;
}
export async function fetchItemsOf(userId) {
  const snap = await getDocs(collection(db, 'users', userId, 'items'));
  return snap.docs
    .map((d) => ({ id: d.id, name: d.data().name, description: d.data().description || '', qty: d.data().qty || 0 }))
    .filter((i) => i.qty > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
export async function deleteMyItem(itemId, qtyRaw) {
  const qty = parseInt(qtyRaw, 10);
  if (!qty || qty <= 0) throw new Error('수량을 확인하세요.');
  const me = await fetchOwnProfile(uid());
  const item = await removeItemFromUser(uid(), itemId, qty);
  await logItem({ action: 'user_delete', userId: uid(), userName: me?.character_name || '', itemName: item.name, itemDescription: item.description || '', qty });
}
export async function adminGrantItem(userId, name, description, qtyRaw, message) {
  const qty = parseInt(qtyRaw, 10);
  if (!name || !name.trim()) throw new Error('소지품 이름을 입력하세요.');
  if (!qty || qty <= 0) throw new Error('수량을 확인하세요.');
  await addItemToUser(userId, name, description, qty);
  const target = await fetchProfileById(userId);
  await logItem({ action: 'admin_grant', userId, userName: target?.character_name || '', itemName: name.trim(), itemDescription: (description || '').trim(), qty });
  await addDoc(collection(db, 'notifications'), { userId, type: 'admin_item', message: `소지품 지급: ${name.trim()} x${qty}${message ? ' · ' + message : ''}`, read: false, createdAt: serverTimestamp() });
}
export async function adminRemoveItem(userId, itemId, qtyRaw, message) {
  const qty = parseInt(qtyRaw, 10);
  if (!qty || qty <= 0) throw new Error('수량을 확인하세요.');
  const item = await removeItemFromUser(userId, itemId, qty);
  const target = await fetchProfileById(userId);
  await logItem({ action: 'admin_remove', userId, userName: target?.character_name || '', itemName: item.name, itemDescription: item.description || '', qty });
  await addDoc(collection(db, 'notifications'), { userId, type: 'admin_item', message: `소지품 회수: ${item.name} x${qty}${message ? ' · ' + message : ''}`, read: false, createdAt: serverTimestamp() });
}
export async function fetchItemLogs() {
  const snap = await getDocs(query(collection(db, 'itemLogs'), orderBy('createdAt', 'desc'), limit(300)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data(), created_at: ts(d.data().createdAt) }));
}

// ================= 간이 조사 =================
const pubRefOf = () => doc(db, 'dig', 'public');
const secRefOf = () => doc(db, 'dig', 'secret');
const blankPublicCells = () => Array.from({ length: DIG_SIZE }, () => ({ dug: false, name: '', description: '', empty: false }));
const blankSecretCell = () => ({ assigned: false, rewardId: null, name: '', description: '', empty: false, by: null, byName: null, at: null });
const cellFromReward = (r) => ({ assigned: true, rewardId: r.id, name: r.name, description: r.description || '', empty: !!r.empty, by: null, byName: null, at: null });
const randomSecretCells = (catalog) => Array.from({ length: DIG_SIZE }, () => { const r = pickWeighted(catalog); return r ? cellFromReward(r) : blankSecretCell(); });

export async function fetchDigRewards() {
  const snap = await getDocs(collection(db, 'digRewards'));
  return snap.docs
    .map((d) => ({ id: d.id, name: d.data().name, description: d.data().description || '', weight: Number(d.data().weight) || 0, empty: !!d.data().empty, createdMs: d.data().createdAt ? ts(d.data().createdAt) : 0 }))
    .sort((a, b) => a.createdMs - b.createdMs);
}
export async function saveDigReward(id, data) {
  if (!data.name || !data.name.trim()) throw new Error('보상 이름을 입력하세요.');
  const payload = { name: data.name.trim(), description: (data.description || '').trim(), weight: Number(data.weight) || 0, empty: !!data.empty };
  if (id) await updateDoc(doc(db, 'digRewards', id), payload);
  else await addDoc(collection(db, 'digRewards'), { ...payload, createdAt: serverTimestamp() });
}
export async function deleteDigReward(id) { await deleteDoc(doc(db, 'digRewards', id)); }

export function subscribeDigPublic(cb) { return onSnapshot(pubRefOf(), (s) => cb(s.exists() ? s.data() : null), () => cb(null)); }
export function subscribeDigSecret(cb) { return onSnapshot(secRefOf(), (s) => cb(s.exists() ? s.data() : null), () => cb(null)); }

// 새 판 시작 (처음 시작 / 전체 랜덤 + 초기화)
export async function adminNewRound() {
  const catalog = await fetchDigRewards();
  await runTransaction(db, async (tx) => {
    const p = await tx.get(pubRefOf());
    const round = (p.exists() ? (p.data().round || 1) : 0) + 1;
    tx.set(pubRefOf(), { round, cells: blankPublicCells() });
    tx.set(secRefOf(), { round, cells: randomSecretCells(catalog) });
  });
}
export async function adminAssignCell(index, reward) {
  await runTransaction(db, async (tx) => {
    const p = await tx.get(pubRefOf());
    const sc = await tx.get(secRefOf());
    if (!p.exists() || !sc.exists()) throw new Error('먼저 "새 판 시작"을 눌러주세요.');
    if (p.data().cells[index].dug) throw new Error('이미 조사된 칸은 바꿀 수 없습니다.');
    const cells = sc.data().cells.slice();
    cells[index] = reward ? cellFromReward(reward) : blankSecretCell();
    tx.update(secRefOf(), { cells });
  });
}
export async function adminRandomizeUndug() {
  const catalog = await fetchDigRewards();
  if (!catalog.some((r) => r.weight > 0)) throw new Error('확률이 0보다 큰 보상을 먼저 등록하세요.');
  await runTransaction(db, async (tx) => {
    const p = await tx.get(pubRefOf());
    const sc = await tx.get(secRefOf());
    if (!p.exists() || !sc.exists()) throw new Error('먼저 "새 판 시작"을 눌러주세요.');
    const cells = sc.data().cells.slice();
    p.data().cells.forEach((pc, i) => { if (!pc.dug) cells[i] = cellFromReward(pickWeighted(catalog)); });
    tx.update(secRefOf(), { cells });
  });
}

export async function digCell(index) {
  const me = uid();
  const catalog = await fetchDigRewards();
  let result;
  await runTransaction(db, async (tx) => {
    const userRef = doc(db, 'users', me);
    const p = await tx.get(pubRefOf());
    const sc = await tx.get(secRefOf());
    const us = await tx.get(userRef);
    if (!p.exists() || !sc.exists()) throw new Error('간이 조사가 아직 열리지 않았습니다.');
    const pub = p.data();
    const sec = sc.data();
    const u = us.data();
    const now = Date.now();
    const st = chargeState(u.digCharges ?? null, u.digChargeAt ? u.digChargeAt.toMillis() : null, u.createdAt ? u.createdAt.toMillis() : now, now);
    const bonus = u.digBonus || 0;
    if (st.charges < 1 && bonus < 1) throw new Error('조사 가능 횟수가 없습니다.');
    if (pub.cells[index].dug) throw new Error('이미 조사된 칸입니다.');
    const cells = sec.cells.slice();
    let cell = { ...cells[index] };
    if (!cell.assigned) {
      const pick = pickWeighted(catalog);
      if (!pick) throw new Error('이 칸은 아직 보상이 준비되지 않았습니다.');
      cell = { ...cellFromReward(pick) };
    }
    const itemRef = doc(db, 'users', me, 'items', itemKey(cell.name, cell.description));
    const itemSnap = cell.empty ? null : await tx.get(itemRef);
    // ---- writes ----
    const newPub = pub.cells.slice();
    newPub[index] = { dug: true, name: cell.name, description: cell.description, empty: cell.empty };
    cells[index] = { ...cell, by: me, byName: u.characterName, at: now };
    if (st.charges >= 1) {
      // 자연 충전분을 먼저 사용 (충전 타이머가 멈추지 않도록)
      const wasFull = st.charges >= DIG_MAX_CHARGES;
      tx.update(userRef, { digCharges: st.charges - 1, digChargeAt: Timestamp.fromMillis(wasFull ? now : st.at) });
    } else {
      tx.update(userRef, { digBonus: bonus - 1 });
    }
    if (!cell.empty) {
      if (itemSnap.exists()) tx.update(itemRef, { qty: increment(1) });
      else tx.set(itemRef, { name: cell.name, description: cell.description, qty: 1, createdAt: serverTimestamp() });
    }
    const allDug = newPub.every((c) => c.dug);
    const round = pub.round || 1;
    if (allDug) {
      tx.set(pubRefOf(), { round: round + 1, cells: blankPublicCells() });
      tx.set(secRefOf(), { round: round + 1, cells: randomSecretCells(catalog) });
    } else {
      tx.update(pubRefOf(), { cells: newPub });
      tx.update(secRefOf(), { cells });
    }
    result = { index, name: cell.name, description: cell.description, empty: cell.empty, reset: allDug, round, userName: u.characterName };
  });
  try {
    await addDoc(collection(db, 'digLogs'), { userId: me, userName: result.userName, cell: result.index, rewardName: result.name, empty: result.empty, round: result.round, createdAt: serverTimestamp() });
    if (!result.empty) await logItem({ action: 'dig_get', userId: me, userName: result.userName, itemName: result.name, itemDescription: result.description || '', qty: 1 });
  } catch (e) { /* best-effort */ }
  return result;
}
export async function fetchDigLogs() {
  const snap = await getDocs(query(collection(db, 'digLogs'), orderBy('createdAt', 'desc'), limit(300)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data(), created_at: ts(d.data().createdAt) }));
}


// ================= 간이조사권 (구매/선물) =================
export async function adminGrantDigTickets(userId, deltaRaw, message) {
  const delta = parseInt(deltaRaw, 10);
  if (!delta) throw new Error('수량을 입력하세요. (회수는 음수)');
  const ref = doc(db, 'users', userId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('회원 정보를 찾을 수 없습니다.');
    const cur = snap.data().digBonus || 0;
    if (cur + delta < 0) throw new Error('보유한 조사권보다 많이 회수할 수 없습니다.');
    tx.update(ref, { digBonus: cur + delta });
  });
  const target = await fetchProfileById(userId);
  await logItem({ action: delta > 0 ? 'admin_grant' : 'admin_remove', userId, userName: target?.character_name || '', itemName: '간이조사권', itemDescription: '', qty: Math.abs(delta) });
  await addDoc(collection(db, 'notifications'), { userId, type: 'admin_item', message: `간이조사권 ${delta > 0 ? '지급' : '회수'}: ${Math.abs(delta)}장${message ? ' · ' + message : ''}`, read: false, createdAt: serverTimestamp() });
}

// ================= 상점 =================
function mapShop(id, d) {
  return {
    id, name: d.name, description: d.description || '', price: Number(d.price) || 0,
    kind: d.kind === 'dig_ticket' ? 'dig_ticket' : 'item', enabled: d.enabled !== false,
    discountPercent: Number(d.discountPercent) || 0, discountUntil: d.discountUntil ?? null,
    createdMs: d.createdAt ? ts(d.createdAt) : 0,
  };
}
export function subscribeShop(cb) {
  return onSnapshot(collection(db, 'shopItems'), (snap) => {
    cb(snap.docs.map((d) => mapShop(d.id, d.data())).sort((a, b) => a.createdMs - b.createdMs));
  }, () => cb([]));
}
export async function saveShopItem(id, data) {
  if (!data.name || !data.name.trim()) throw new Error('상품 이름을 입력하세요.');
  const price = Math.floor(Number(data.price));
  if (!(price >= 0)) throw new Error('가격은 0 이상의 숫자여야 합니다.');
  const payload = { name: data.name.trim(), description: (data.description || '').trim(), price, kind: data.kind === 'dig_ticket' ? 'dig_ticket' : 'item', enabled: data.enabled !== false };
  if (id) await updateDoc(doc(db, 'shopItems', id), payload);
  else await addDoc(collection(db, 'shopItems'), { ...payload, discountPercent: 0, discountUntil: null, createdAt: serverTimestamp() });
}
export async function deleteShopItem(id) { await deleteDoc(doc(db, 'shopItems', id)); }
// 여러 상품에 한꺼번에 할인 적용. hours 가 비어 있으면 해제할 때까지 계속 할인
export async function setShopDiscount(ids, percentRaw, hoursRaw) {
  const percent = Number(percentRaw);
  if (!ids.length) throw new Error('할인할 상품을 선택하세요.');
  if (!(percent > 0 && percent <= 100)) throw new Error('할인율은 1~100 사이로 입력하세요.');
  const hours = hoursRaw === '' || hoursRaw === null || hoursRaw === undefined ? null : Number(hoursRaw);
  if (hours !== null && !(hours > 0)) throw new Error('할인 시간은 0보다 커야 합니다. (비우면 해제 전까지 계속)');
  const until = hours === null ? null : Date.now() + Math.round(hours * 3600 * 1000);
  const batch = writeBatch(db);
  ids.forEach((id) => batch.update(doc(db, 'shopItems', id), { discountPercent: percent, discountUntil: until }));
  await batch.commit();
}
export async function clearShopDiscount(ids) {
  if (!ids.length) throw new Error('상품을 선택하세요.');
  const batch = writeBatch(db);
  ids.forEach((id) => batch.update(doc(db, 'shopItems', id), { discountPercent: 0, discountUntil: null }));
  await batch.commit();
}
export async function buyShopItem(shopId, qtyRaw) {
  const qty = parseInt(qtyRaw, 10);
  if (!qty || qty <= 0 || qty > 99) throw new Error('수량은 1~99 사이로 입력하세요.');
  const me = uid();
  let info;
  await runTransaction(db, async (tx) => {
    const shopRef = doc(db, 'shopItems', shopId);
    const userRef = doc(db, 'users', me);
    const ss = await tx.get(shopRef);
    const us = await tx.get(userRef);
    if (!ss.exists() || ss.data().enabled === false) throw new Error('판매 중이 아닌 상품입니다.');
    const shop = mapShop(ss.id, ss.data());
    const now = Date.now();
    const unit = effectivePrice(shop, now);
    const total = unit * qty;
    const pts = us.data().points || 0;
    if (pts < total) throw new Error('포인트가 부족합니다.');
    let itemRef = null; let itemSnap = null;
    if (shop.kind !== 'dig_ticket') {
      itemRef = doc(db, 'users', me, 'items', itemKey(shop.name, shop.description));
      itemSnap = await tx.get(itemRef);
    }
    const patch = { points: pts - total };
    if (shop.kind === 'dig_ticket') patch.digBonus = increment(qty);
    tx.update(userRef, patch);
    if (itemRef) {
      if (itemSnap.exists()) tx.update(itemRef, { qty: increment(qty) });
      else tx.set(itemRef, { name: shop.name, description: shop.description, qty, createdAt: serverTimestamp() });
    }
    info = { name: shop.name, kind: shop.kind, unit, total, qty, userName: us.data().characterName };
  });
  await logItem({ action: 'shop_buy', userId: me, userName: info.userName, itemName: info.name, itemDescription: '', qty, price: info.total });
  return info;
}

// ================= 개인 기재 (직접 적는 항목: 양도 불가, 수량 선택 가능) =================
function cleanQty(v) {
  const n = parseInt(v, 10);
  if (!n || n < 1) return 1;
  return Math.min(n, 999);
}
export async function fetchNotes(userId) {
  const snap = await getDocs(collection(db, 'users', userId, 'notes'));
  return snap.docs
    .map((d) => ({ id: d.id, name: d.data().name, note: d.data().note || '', qty: d.data().qty || 1, created_at: d.data().createdAt ? ts(d.data().createdAt) : 0 }))
    .sort((a, b) => a.created_at - b.created_at);
}
export async function addNote(name, note, qty) {
  if (!name || !name.trim()) throw new Error('이름을 입력하세요.');
  await addDoc(collection(db, 'users', uid(), 'notes'), { name: name.trim(), note: (note || '').trim(), qty: cleanQty(qty), createdAt: serverTimestamp() });
}
export async function updateNote(id, name, note, qty) {
  if (!name || !name.trim()) throw new Error('이름을 입력하세요.');
  await updateDoc(doc(db, 'users', uid(), 'notes', id), { name: name.trim(), note: (note || '').trim(), qty: cleanQty(qty) });
}
export async function deleteNote(id) { await deleteDoc(doc(db, 'users', uid(), 'notes', id)); }
