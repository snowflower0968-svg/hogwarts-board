import {
  collection, collectionGroup, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, writeBatch, getCountFromServer,
  serverTimestamp, increment, runTransaction, Timestamp, deleteField,
} from 'firebase/firestore';
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as fbSignOut,
  updatePassword, updateEmail, onAuthStateChanged,
} from 'firebase/auth';
import { auth, db, loginIdToEmail } from '../firebaseClient';

// 진영(기숙사+결사) 기본 목록. 회귀 전/후 각각 따로 소속을 가질 수 있어서,
// 실제 유저의 house 값은 회귀 전엔 그대로(예: 'gryffindor'), 회귀 후엔 'post_' 접두어가 붙어요(예: 'post_gryffindor').
export const FACTIONS = [
  { id: 'gryffindor', name: '그리핀도르' },
  { id: 'slytherin', name: '슬리데린' },
  { id: 'ravenclaw', name: '래번클로' },
  { id: 'hufflepuff', name: '후플푸프' },
  { id: 'phoenix', name: '불사조 기사단' },
  { id: 'deatheater', name: '죽음을 먹는 자들' },
];
// 회귀 전/후 상관없이 같은 기숙사 그룹으로 묶기 위한 소속 id (post_ 접두어 제거)
export function factionOf(house) { return house ? house.replace(/^post_/, '') : null; }
export const HOUSES = [
  ...FACTIONS.map((f) => ({ id: f.id, name: f.name, era: 'pre' })),
  ...FACTIONS.map((f) => ({ id: `post_${f.id}`, name: f.name, era: 'post' })),
];
// 회귀 전/후 판별 (post_ 로 시작하면 회귀 후)
export function houseEra(house) { return house && house.startsWith('post_') ? 'post' : 'pre'; }
export const BOARDS = [
  { id: 'free', name: '자유게시판', house: null, era: 'pre' },
  { id: 'free_post', name: '자유게시판', house: null, era: 'post' },
  ...FACTIONS.map((f) => ({ id: f.id, name: f.name, house: f.id, era: 'pre' })),
  ...FACTIONS.map((f) => ({ id: `post_${f.id}`, name: f.name, house: `post_${f.id}`, era: 'post' })),
  { id: 'anon', name: '익명방', house: null, era: null },
];
const BOARD_HOUSE = Object.fromEntries(BOARDS.map((b) => [b.id, b.house]));

const CHAT_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_POINT_SETTINGS = { postEvery: 1, postAmount: 5, commentEvery: 2, commentAmount: 1 };
// 기본 도박 확률 [배율, 비중]. 관리자가 settings/gamble 에서 바꿀 수 있음
export const DEFAULT_GAMBLE_ODDS = [[1, 5], [2, 5], [3, 5], [5, 5], [10, 1], [-1, 3], [-2, 3], [-3, 3]];
// 배율을 곱한 결과 (0.5배, 0.1배처럼 소수가 나와도 포인트는 정수로 반올림)
export function gambleDelta(bet, multiplier) { return Math.round(bet * multiplier); }

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

// 꽝 칸 수: 전체 칸 수 x 꽝 비율 (소수점은 버림). 예) 81칸 50% -> 40칸
export function blankCountFor(n, percent) {
  const p = Math.min(100, Math.max(0, Number(percent) || 0));
  return Math.min(n, Math.floor((n * p) / 100 + 1e-9));
}
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
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
    dig_bonus: d.digBonus || 0, gamble_void: d.gambleVoid || 0, galleon: d.galleon || 0, withdrawn: !!d.withdrawn, post_count: d.postCount ?? null,
    yacha_bonus: d.yachaTicket || 0,
    battle_hp: d.battleHp ?? 100, battle_points: d.battlePoints || 0,
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
  const reqBoard = BOARDS.find((b) => b.id === board);
  if (!u.isAdmin && reqBoard) {
    if (reqHouse && u.house !== reqHouse) throw new Error('해당 소속만 작성 가능합니다.');
    if (!reqHouse && reqBoard.era && houseEra(u.house) !== reqBoard.era) throw new Error('해당 소속만 작성 가능합니다.');
  }
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
    // 빚(마이너스)은 글 삭제로 지워지지도, 늘어나지도 않게: 잔액이 0 이하면 그대로 둠
    const curPts = a.points || 0;
    const patch = { points: curPts > 0 ? Math.max(0, curPts - granted) : curPts };
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
  const roomSnap0 = await getDoc(doc(db, 'chatRooms', roomId));
  if (roomSnap0.exists() && roomSnap0.data().yachaActive) throw new Error('야차 게임이 진행 중인 방은 삭제할 수 없습니다. 게임이 끝난 뒤 삭제하세요.');
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
// 첫 메시지가 오가는 순간부터 CHAT_TTL_MS 동안만 대화 가능 (expiresAt 이 아직 없으면 이때 정해짐)
async function touchRoom(roomId, text, room) {
  const patch = { lastText: text.slice(0, 60), lastAt: serverTimestamp(), messageCount: increment(1) };
  if (room && !room.expiresAt) patch.expiresAt = Timestamp.fromMillis(Date.now() + CHAT_TTL_MS);
  try { await updateDoc(doc(db, 'chatRooms', roomId), patch); } catch (e) { /* best-effort */ }
}
function roomExpired(r) { return !!r.expiresAt && r.expiresAt.toMillis() <= Date.now(); }

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
    if (r.expiresAt && ts(r.expiresAt) <= now && !r.yachaActive) continue; // 사용자에게는 안 보이지만 관리자는 기록을 볼 수 있음
    alive.push(r);
  }
  return Promise.all(alive.map(async (r) => {
    const [msgsSnap, readsSnap] = await Promise.all([
      getDocs(collection(db, 'chatRooms', r.id, 'messages')),
      getDocs(collection(db, 'chatRooms', r.id, 'reads')),
    ]);
    return {
      id: r.id, post_id: r.postId, user_a: r.userA, user_b: r.userB,
      created_at: ts(r.createdAt), expires_at: r.expiresAt ? ts(r.expiresAt) : null,
      chat_messages: msgsSnap.docs.map((m) => ({ id: m.id, sender_id: m.data().senderId, created_at: ts(m.data().createdAt) })),
      chat_reads: readsSnap.docs.map((rd) => ({ user_id: rd.id, last_read_at: ts(rd.data().lastReadAt) })),
    };
  }));
}

// ---------------- gambling ----------------
function cleanOdds(list) {
  const out = (Array.isArray(list) ? list : [])
    .map((o) => [Number(o.multiplier ?? o[0]), Number(o.weight ?? o[1])])
    .filter(([m, w]) => Number.isFinite(m) && Number.isFinite(w) && w > 0);
  return out.length ? out : DEFAULT_GAMBLE_ODDS;
}
export async function fetchGambleOdds() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'gamble'));
    if (snap.exists() && snap.data().odds) return cleanOdds(snap.data().odds);
  } catch (e) { /* 기본값 사용 */ }
  return DEFAULT_GAMBLE_ODDS;
}
export async function saveGambleOdds(list) {
  const odds = cleanOdds(list).map(([multiplier, weight]) => ({ multiplier, weight }));
  if (!odds.some((o) => o.multiplier > 0)) throw new Error('플러스 배율이 하나 이상 있어야 합니다.');
  await setDoc(doc(db, 'settings', 'gamble'), { odds }, { merge: true });
  return odds.map((o) => [o.multiplier, o.weight]);
}
// 도박으로 가질 수 있는 최대 포인트 (null 이면 제한 없음). 도박 결과로만 적용되고, 이미 그 이상 가진 사람에게는 영향 없음
export async function fetchGambleMaxPoints() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'gamble'));
    if (snap.exists() && snap.data().maxPoints != null) return Number(snap.data().maxPoints);
  } catch (e) { /* 제한 없음 */ }
  return null;
}
export async function saveGambleMaxPoints(raw) {
  const v = raw === '' || raw === null || raw === undefined ? null : Math.floor(Number(raw));
  if (v !== null && !(v > 0)) throw new Error('0보다 큰 숫자를 입력하거나, 비워서 제한을 해제하세요.');
  await setDoc(doc(db, 'settings', 'gamble'), { maxPoints: v }, { merge: true });
  return v;
}
export async function spinGamble(bet) {
  const userRef = doc(db, 'users', uid());
  const snap = await getDoc(userRef);
  const pts = snap.data().points || 0;
  if (pts < 0) throw new Error('포인트가 부족하여 이용할 수 없습니다.');
  if (!bet || bet <= 0 || bet > pts) throw new Error('베팅 금액을 확인하세요.');
  const [odds, maxPoints] = await Promise.all([fetchGambleOdds(), fetchGambleMaxPoints()]);
  const total = odds.reduce((t, [, w]) => t + w, 0);
  let r = Math.random() * total;
  let m = odds[odds.length - 1][0];
  for (const [mult, w] of odds) { if (r < w) { m = mult; break; } r -= w; }
  const delta = gambleDelta(bet, m);
  let newBal = pts - bet + delta;
  if (maxPoints != null && newBal > maxPoints) newBal = maxPoints; // 도박으로는 이 값을 넘게 가질 수 없음
  const logRef = doc(collection(db, 'gambleLogs'));
  await setDoc(logRef, { userId: uid(), bet, multiplier: m, resultDelta: delta, balanceAfter: newBal, voided: false, createdAt: serverTimestamp() });
  await updateDoc(userRef, { points: newBal, lastGambleLogId: logRef.id });
  return { multiplier: m, result_delta: delta, balance_after: newBal, log_id: logRef.id };
}
// 도박 무효권: 가장 최근 도박 1회를 없던 일로 되돌림 (다음 도박을 하기 전까지, 화면을 껐다 켜도 사용 가능)
export async function voidGamble(logId) {
  const me = uid();
  let info;
  await runTransaction(db, async (tx) => {
    const userRef = doc(db, 'users', me);
    const logRef = doc(db, 'gambleLogs', logId);
    const us = await tx.get(userRef);
    const ls = await tx.get(logRef);
    if (!ls.exists() || ls.data().userId !== me) throw new Error('도박 기록을 찾을 수 없습니다.');
    const u = us.data();
    const l = ls.data();
    if (l.voided) throw new Error('이미 무효 처리된 도박입니다.');
    if (u.lastGambleLogId !== logId) throw new Error('가장 최근 도박에만 사용할 수 있습니다.');
    if ((u.gambleVoid || 0) < 1) throw new Error('도박 무효권이 없습니다.');
    const refund = (l.bet || 0) - (l.resultDelta || 0); // 도박 전 잔액으로 되돌림
    const balance = (u.points || 0) + refund;
    tx.update(userRef, { gambleVoid: (u.gambleVoid || 0) - 1, points: balance });
    tx.update(logRef, { voided: true });
    info = { refund, balance, userName: u.characterName };
  });
  await logItem({ action: 'void_use', userId: me, userName: info.userName, itemName: '도박 무효권', itemDescription: '', qty: 1 });
  return info;
}
export async function fetchLastGamble() {
  const us = await getDoc(doc(db, 'users', uid()));
  const id = us.data()?.lastGambleLogId;
  if (!id) return null;
  const ls = await getDoc(doc(db, 'gambleLogs', id));
  if (!ls.exists()) return null;
  const l = ls.data();
  return { id, bet: l.bet, multiplier: l.multiplier, result_delta: l.resultDelta, voided: !!l.voided, created_at: l.createdAt ? ts(l.createdAt) : Date.now() };
}
export async function fetchGambleLogsAdmin() {
  const q = query(collection(db, 'gambleLogs'), orderBy('createdAt', 'desc'), limit(200));
  const snap = await getDocs(q);
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const profiles = await fetchProfilesFull(items.map((i) => i.userId));
  return items.map((i) => ({
    id: i.id, user_id: i.userId, voided: !!i.voided, bet: i.bet, multiplier: i.multiplier, result_delta: i.resultDelta, balance_after: i.balanceAfter,
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
  const existing = await getDocs(query(collection(db, 'chatRooms'), where('postId', '==', postId)));
  let roomId = null;
  existing.forEach((d) => {
    const r = d.data();
    if (((r.userA === uid() && r.userB === targetId) || (r.userA === targetId && r.userB === uid())) && !roomExpired(r)) {
      roomId = d.id;
    }
  });
  if (!roomId) {
    const ref = await addDoc(collection(db, 'chatRooms'), {
      postId, userA: uid(), userB: targetId, createdAt: serverTimestamp(), expiresAt: null,
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
  return {
    id: roomId, post_id: d.postId, user_a: d.userA, user_b: d.userB, created_at: ts(d.createdAt), expires_at: d.expiresAt ? ts(d.expiresAt) : null,
    yacha_active: !!d.yachaActive, active_yacha_id: d.activeYachaId || null,
  };
}
export function subscribeChatRoom(roomId, onChange) {
  return onSnapshot(doc(db, 'chatRooms', roomId), (snap) => {
    if (!snap.exists()) { onChange(null); return; }
    const d = snap.data();
    onChange({
      id: roomId, post_id: d.postId, user_a: d.userA, user_b: d.userB, created_at: ts(d.createdAt), expires_at: d.expiresAt ? ts(d.expiresAt) : null,
      yacha_active: !!d.yachaActive, active_yacha_id: d.activeYachaId || null,
    });
  }, () => {});
}
export async function fetchChatMessages(roomId) {
  const q = query(collection(db, 'chatRooms', roomId, 'messages'), orderBy('createdAt'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id: d.id, sender_id: d.data().senderId, type: d.data().type, text: d.data().text || null,
    amount: d.data().amount || null, status: d.data().status || null, created_at: ts(d.data().createdAt),
    kind: d.data().kind || 'points', item_name: d.data().itemName || null,
    item_description: d.data().itemDescription || null, qty: d.data().qty || null,
    ticket_type: d.data().ticketType || null,
  }));
}
export function subscribeChat(roomId, onChange) {
  return onSnapshot(collection(db, 'chatRooms', roomId, 'messages'), () => onChange());
}
export function subscribeChatReads(roomId, onChange) {
  return onSnapshot(collection(db, 'chatRooms', roomId, 'reads'), (snap) => {
    const map = {};
    snap.docs.forEach((d) => { const t = d.data().lastReadAt; map[d.id] = t ? t.toMillis() : 0; });
    onChange(map);
  });
}
export async function sendChatMessage(roomId, text) {
  const roomSnap = await getDoc(doc(db, 'chatRooms', roomId));
  if (!roomSnap.exists()) throw new Error('채팅방을 찾을 수 없습니다.');
  const r = roomSnap.data();
  if (roomExpired(r) && !r.yachaActive) throw new Error('대화 가능 시간이 종료되었습니다.');
  await addDoc(collection(db, 'chatRooms', roomId, 'messages'), { senderId: uid(), type: 'text', text, createdAt: serverTimestamp() });
  const recipient = r.userA === uid() ? r.userB : r.userA;
  await addDoc(collection(db, 'notifications'), { userId: recipient, type: 'chat_message', roomId, preview: text.slice(0, 80), read: false, createdAt: serverTimestamp() });
  await touchRoom(roomId, text, r);
}
export async function sendGift(roomId, amount) {
  const roomSnap = await getDoc(doc(db, 'chatRooms', roomId));
  if (!roomSnap.exists()) throw new Error('채팅방을 찾을 수 없습니다.');
  const r = roomSnap.data();
  if (roomExpired(r) && !r.yachaActive) throw new Error('대화 가능 시간이 종료되었습니다.');
  const userRef = doc(db, 'users', uid());
  const userSnap = await getDoc(userRef);
  const bal = userSnap.data().points || 0;
  if (bal < amount) throw new Error('보유 포인트가 부족합니다.');
  const recipient = r.userA === uid() ? r.userB : r.userA;
  await updateDoc(userRef, { points: bal - amount });
  await addDoc(collection(db, 'chatRooms', roomId, 'messages'), { senderId: uid(), type: 'gift', kind: 'points', amount, status: 'pending', createdAt: serverTimestamp() });
  await addDoc(collection(db, 'notifications'), { userId: recipient, type: 'gift', points: amount, roomId, read: false, createdAt: serverTimestamp() });
  await touchRoom(roomId, `[선물] 포인트 ${amount}`, r);
}
export async function sendGiftItem(roomId, itemId, qtyRaw) {
  const qty = parseInt(qtyRaw, 10);
  if (!qty || qty <= 0) throw new Error('수량을 확인하세요.');
  const roomSnap = await getDoc(doc(db, 'chatRooms', roomId));
  if (!roomSnap.exists()) throw new Error('채팅방을 찾을 수 없습니다.');
  const r = roomSnap.data();
  if (roomExpired(r) && !r.yachaActive) throw new Error('대화 가능 시간이 종료되었습니다.');
  const recipient = r.userA === uid() ? r.userB : r.userA;
  const item = await removeItemFromUser(uid(), itemId, qty); // 보낸 순간 내 소지품에서 빠짐 (취소하면 돌아옴)
  await addDoc(collection(db, 'chatRooms', roomId, 'messages'), {
    senderId: uid(), type: 'gift', kind: 'item', itemName: item.name, itemDescription: item.description || '', qty, status: 'pending', createdAt: serverTimestamp(),
  });
  await addDoc(collection(db, 'notifications'), { userId: recipient, type: 'gift', itemName: item.name, qty, roomId, read: false, createdAt: serverTimestamp() });
  await touchRoom(roomId, `[선물] ${item.name} x${qty}`, r);
}
const TICKET_FIELD = { yacha: 'yachaTicket', dig: 'digBonus' };
const TICKET_LABEL = { yacha: '야차권', dig: '간이조사권' };
export async function sendGiftTicket(roomId, ticketType, qtyRaw) {
  const qty = parseInt(qtyRaw, 10);
  if (!qty || qty <= 0) throw new Error('수량을 확인하세요.');
  const field = TICKET_FIELD[ticketType];
  if (!field) throw new Error('알 수 없는 티켓 종류입니다.');
  const roomSnap = await getDoc(doc(db, 'chatRooms', roomId));
  if (!roomSnap.exists()) throw new Error('채팅방을 찾을 수 없습니다.');
  const r = roomSnap.data();
  if (roomExpired(r) && !r.yachaActive) throw new Error('대화 가능 시간이 종료되었습니다.');
  const recipient = r.userA === uid() ? r.userB : r.userA;
  const userRef = doc(db, 'users', uid());
  const userSnap = await getDoc(userRef);
  const have = userSnap.data()[field] || 0;
  if (have < qty) throw new Error('보유 수량이 부족합니다.');
  await updateDoc(userRef, { [field]: have - qty });
  await addDoc(collection(db, 'chatRooms', roomId, 'messages'), {
    senderId: uid(), type: 'gift', kind: 'ticket', ticketType, qty, status: 'pending', createdAt: serverTimestamp(),
  });
  await addDoc(collection(db, 'notifications'), { userId: recipient, type: 'gift', itemName: TICKET_LABEL[ticketType], qty, roomId, read: false, createdAt: serverTimestamp() });
  await touchRoom(roomId, `[선물] ${TICKET_LABEL[ticketType]} x${qty}`, r);
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
  if (m.kind === 'ticket') {
    const field = TICKET_FIELD[m.ticketType];
    const userRef = doc(db, 'users', uid());
    await runTransaction(db, async (tx) => {
      const ms = await tx.get(msgRef);
      const us = await tx.get(userRef);
      if (!ms.exists() || ms.data().status !== 'pending') throw new Error('이미 처리된 선물입니다.');
      tx.update(msgRef, { status: 'accepted' });
      tx.update(userRef, { [field]: (us.data()[field] || 0) + m.qty });
    });
    const [from, to] = await Promise.all([fetchProfileById(m.senderId), fetchProfileById(uid())]);
    await logItem({ action: 'transfer', userId: m.senderId, userName: from?.character_name || '', targetUserId: uid(), targetName: to?.character_name || '', itemName: TICKET_LABEL[m.ticketType] || '티켓', itemDescription: '', qty: m.qty });
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
  if (m.kind === 'ticket') {
    const field = TICKET_FIELD[m.ticketType];
    const senderRef = doc(db, 'users', m.senderId);
    await runTransaction(db, async (tx) => {
      const ms = await tx.get(msgRef);
      const ss = await tx.get(senderRef);
      if (!ms.exists() || ms.data().status !== 'pending') return;
      tx.update(msgRef, { status: 'cancelled' });
      if (ss.exists()) tx.update(senderRef, { [field]: (ss.data()[field] || 0) + m.qty });
    });
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
  let rooms = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  // 메시지가 한 번도 오가지 않은 방(눌러서 열기만 한 방)은 기록에 표시하지 않음
  const checked = await Promise.all(rooms.map(async (r) => {
    if (typeof r.messageCount === 'number') return r.messageCount > 0;
    const m = await getDocs(query(collection(db, 'chatRooms', r.id, 'messages'), limit(1)));
    return !m.empty;
  }));
  rooms = rooms.filter((_, i) => checked[i]);
  const profiles = await fetchProfilesFull(rooms.flatMap((r) => [r.userA, r.userB]));
  const titles = await titlesForPostIds(rooms.map((r) => r.postId).filter(Boolean));
  return rooms.map((r) => ({
    id: r.id, user_a: r.userA, user_b: r.userB, created_at: ts(r.createdAt), expires_at: r.expiresAt ? ts(r.expiresAt) : null,
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
// 게시판별 새 글 표시용: 최근 글의 게시판/작성자/시각만 가볍게 가져옴
export async function fetchRecentPostStamps(n = 80) {
  const snap = await getDocs(query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(n)));
  return snap.docs.map((d) => ({ board_id: d.data().boardId, author_id: d.data().authorId, created_at: d.data().createdAt ? d.data().createdAt.toMillis() : Date.now() }));
}
// 전체 회원의 포인트를 0으로, 보유 소지품을 전부 비움 (개인 기재·갈레온은 건드리지 않음)
export async function adminResetAllPointsAndItems() {
  const snap = await getDocs(collection(db, 'users'));
  let count = 0;
  for (const d of snap.docs) {
    // eslint-disable-next-line no-await-in-loop
    const itemsSnap = await getDocs(collection(db, 'users', d.id, 'items'));
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(itemsSnap.docs.map((it) => deleteDoc(it.ref)));
    // eslint-disable-next-line no-await-in-loop
    await updateDoc(doc(db, 'users', d.id), { points: 0 });
    count += 1;
  }
  await logItem({ action: 'reset_all', userId: 'admin', userName: '관리자', itemName: '전체 포인트·소지품 초기화', itemDescription: `대상 ${count}명`, qty: count });
  return count;
}

// 선택한 항목만 전체 회원 대상으로 초기화 (개인 기재·갈레온·조사권·야차권 등 포함 가능)
// options: { points, items, notes, galleon, digTicket, gambleVoid, yachaTicket, battle }
export async function adminResetSelected(options) {
  const opt = options || {};
  const snap = await getDocs(collection(db, 'users'));
  let count = 0;
  for (const d of snap.docs) {
    const patch = {};
    if (opt.points) patch.points = 0;
    if (opt.galleon) patch.galleon = 0;
    if (opt.digTicket) patch.digBonus = 0;
    if (opt.gambleVoid) patch.gambleVoid = 0;
    if (opt.yachaTicket) patch.yachaTicket = 0;
    if (opt.battle) { patch.battleHp = 100; patch.battlePoints = 0; }
    if (Object.keys(patch).length) {
      // eslint-disable-next-line no-await-in-loop
      await updateDoc(doc(db, 'users', d.id), patch);
    }
    if (opt.items) {
      // eslint-disable-next-line no-await-in-loop
      const itemsSnap = await getDocs(collection(db, 'users', d.id, 'items'));
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(itemsSnap.docs.map((it) => deleteDoc(it.ref)));
    }
    if (opt.notes) {
      // eslint-disable-next-line no-await-in-loop
      const notesSnap = await getDocs(collection(db, 'users', d.id, 'notes'));
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(notesSnap.docs.map((n) => deleteDoc(n.ref)));
    }
    count += 1;
  }
  const labels = [];
  if (opt.points) labels.push('포인트');
  if (opt.items) labels.push('소지품');
  if (opt.notes) labels.push('개인 기재');
  if (opt.galleon) labels.push('갈레온');
  if (opt.digTicket) labels.push('조사권');
  if (opt.gambleVoid) labels.push('도박무효권');
  if (opt.yachaTicket) labels.push('야차권');
  if (opt.battle) labels.push('전투 체력·점수');
  await logItem({ action: 'reset_selected', userId: 'admin', userName: '관리자', itemName: `선택 초기화: ${labels.join(', ') || '(선택 없음)'}`, itemDescription: `대상 ${count}명`, qty: count });
  return count;
}
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
// 여러 캐릭터를 한 번에 같은 소속으로 바꿔요(예: 선택한 캐릭터들을 전부 "회귀 후"로 전환).
export async function adminBulkSetHouse(userIds, house) {
  const batch = writeBatch(db);
  userIds.forEach((id) => { batch.update(doc(db, 'users', id), { house: house || null }); });
  await batch.commit();
  return userIds.length;
}
export async function toggleAdminRole(id) {
  const ref = doc(db, 'users', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  await updateDoc(ref, { isAdmin: !snap.data().isAdmin });
}
export async function grantPoints(id, amount, message) {
  const ref = doc(db, 'users', id);
  const snap = await getDoc(ref);
  const curPts = snap.data().points || 0;
  // 잔액이 0 이상일 때만 0 밑으로 내려가지 않게 막고, 빚이 있으면 더하고 빼는 값을 그대로 반영
  const newPts = curPts >= 0 ? Math.max(0, curPts + amount) : curPts + amount;
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
// 탈퇴 처리된 회원을 목록에서 완전히 삭제 (회원 정보 문서와 소지품·개인 기재 삭제. 작성한 글/댓글은 그대로 남음)
export async function adminDeleteWithdrawnUser(userId) {
  const snap = await getDoc(doc(db, 'users', userId));
  if (!snap.exists()) return;
  if (!snap.data().withdrawn) throw new Error('탈퇴 처리된 회원만 삭제할 수 있습니다.');
  for (const sub of ['items', 'notes']) {
    // eslint-disable-next-line no-await-in-loop
    const subSnap = await getDocs(collection(db, 'users', userId, sub));
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(subSnap.docs.map((d) => deleteDoc(d.ref)));
  }
  await deleteDoc(doc(db, 'users', userId));
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
const missCell = () => ({ assigned: true, rewardId: null, name: '꽝', description: '', empty: true, by: null, byName: null, at: null });
const cellFromReward = (r) => ({ assigned: true, rewardId: r.id, name: r.name, description: r.description || '', empty: !!r.empty, by: null, byName: null, at: null });
// n칸을 새로 배치: 꽝은 정해진 개수만큼 무작위 위치에, 나머지는 보상 확률대로
const usableRewards = (catalog) => catalog.filter((r) => !r.empty && r.weight > 0);
function randomizeCells(n, catalog, blankPercent) {
  const pool = usableRewards(catalog);
  const missSet = new Set(shuffled(Array.from({ length: n }, (_, i) => i)).slice(0, blankCountFor(n, blankPercent)));
  return Array.from({ length: n }, (_, i) => {
    if (missSet.has(i)) return missCell();
    const r = pickWeighted(pool);
    return r ? cellFromReward(r) : blankSecretCell();
  });
}
const randomSecretCells = (catalog, blankPercent) => randomizeCells(DIG_SIZE, catalog, blankPercent);

const cfgRefOf = () => doc(db, 'dig', 'config');
export async function fetchDigConfig() {
  try {
    const snap = await getDoc(cfgRefOf());
    const p = snap.exists() ? Number(snap.data().blankPercent) : 0;
    return { blankPercent: Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0 };
  } catch (e) { return { blankPercent: 0 }; }
}
export async function saveDigConfig({ blankPercent }) {
  const p = Number(blankPercent);
  if (!(p >= 0 && p <= 100)) throw new Error('꽝 비율은 0~100 사이로 입력하세요.');
  await setDoc(cfgRefOf(), { blankPercent: p });
}

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
  const [catalog, cfg] = await Promise.all([fetchDigRewards(), fetchDigConfig()]);
  await runTransaction(db, async (tx) => {
    const p = await tx.get(pubRefOf());
    const round = (p.exists() ? (p.data().round || 1) : 0) + 1;
    tx.set(pubRefOf(), { round, cells: blankPublicCells() });
    tx.set(secRefOf(), { round, cells: randomSecretCells(catalog, cfg.blankPercent) });
  });
}
export async function adminAssignCell(index, reward) {
  await runTransaction(db, async (tx) => {
    const p = await tx.get(pubRefOf());
    const sc = await tx.get(secRefOf());
    if (!p.exists() || !sc.exists()) throw new Error('먼저 "새 판 시작"을 눌러주세요.');
    if (p.data().cells[index].dug) throw new Error('이미 조사된 칸은 바꿀 수 없습니다.');
    const cells = sc.data().cells.slice();
    // reward: 보상 객체 / 'miss'(꽝) / null(미지정)
    cells[index] = reward === 'miss' ? missCell() : reward ? cellFromReward(reward) : blankSecretCell();
    tx.update(secRefOf(), { cells });
  });
}
export async function adminRandomizeUndug() {
  const [catalog, cfg] = await Promise.all([fetchDigRewards(), fetchDigConfig()]);
  if (!usableRewards(catalog).length && cfg.blankPercent < 100) throw new Error('확률이 0보다 큰 보상을 먼저 등록하세요.');
  await runTransaction(db, async (tx) => {
    const p = await tx.get(pubRefOf());
    const sc = await tx.get(secRefOf());
    if (!p.exists() || !sc.exists()) throw new Error('먼저 "새 판 시작"을 눌러주세요.');
    const cells = sc.data().cells.slice();
    const undug = [];
    p.data().cells.forEach((pc, i) => { if (!pc.dug) undug.push(i); });
    const fresh = randomizeCells(undug.length, catalog, cfg.blankPercent);
    undug.forEach((idx, k) => { cells[idx] = fresh[k]; });
    tx.update(secRefOf(), { cells });
  });
}

export async function digCell(index) {
  const me = uid();
  const [catalog, cfg] = await Promise.all([fetchDigRewards(), fetchDigConfig()]);
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
      const pick = pickWeighted(usableRewards(catalog));
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
      tx.set(secRefOf(), { round: round + 1, cells: randomSecretCells(catalog, cfg.blankPercent) });
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
const SHOP_KINDS = ['item', 'dig_ticket', 'gamble_void', 'yacha_ticket'];
function mapShop(id, d) {
  return {
    id, name: d.name, description: d.description || '', price: Number(d.price) || 0,
    kind: SHOP_KINDS.includes(d.kind) ? d.kind : 'item', enabled: d.enabled !== false,
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
  const payload = { name: data.name.trim(), description: (data.description || '').trim(), price, kind: SHOP_KINDS.includes(data.kind) ? data.kind : 'item', enabled: data.enabled !== false };
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
// ---- 도박 무효권 갈레온별 가격 (관리자 설정, 일반 회원에게는 자기 가격만 보임) ----
function cleanTiers(list) {
  return (Array.isArray(list) ? list : [])
    .map((t) => ({ minGalleon: Number(t.minGalleon), price: Number(t.price) }))
    .filter((t) => Number.isFinite(t.minGalleon) && t.minGalleon >= 0 && Number.isFinite(t.price) && t.price >= 0)
    .sort((a, b) => a.minGalleon - b.minGalleon);
}
export async function fetchVoidTiers() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'voidPrice'));
    if (snap.exists()) return cleanTiers(snap.data().tiers);
  } catch (e) { /* 규칙 없음 */ }
  return [];
}
export async function saveVoidTiers(list) {
  const tiers = cleanTiers(list).map((t) => ({ minGalleon: Math.floor(t.minGalleon), price: Math.floor(t.price) }));
  const seen = new Set();
  tiers.forEach((t) => { if (seen.has(t.minGalleon)) throw new Error('같은 갈레온 기준이 두 번 들어 있어요.'); seen.add(t.minGalleon); });
  await setDoc(doc(db, 'settings', 'voidPrice'), { tiers });
  return tiers;
}
// 내 갈레온 이상인 기준 중 가장 높은 기준의 가격. 해당하는 기준이 없으면 상점에 적힌 기본 가격
export function voidPriceFor(basePrice, tiers, galleon) {
  let price = basePrice;
  (tiers || []).forEach((t) => { if (galleon >= t.minGalleon) price = t.price; });
  return price;
}
export async function buyShopItem(shopId, qtyRaw) {
  const qty = parseInt(qtyRaw, 10);
  if (!qty || qty <= 0 || qty > 99) throw new Error('수량은 1~99 사이로 입력하세요.');
  const me = uid();
  const voidTiers = await fetchVoidTiers();
  let info;
  await runTransaction(db, async (tx) => {
    const shopRef = doc(db, 'shopItems', shopId);
    const userRef = doc(db, 'users', me);
    const ss = await tx.get(shopRef);
    const us = await tx.get(userRef);
    if (!ss.exists() || ss.data().enabled === false) throw new Error('판매 중이 아닌 상품입니다.');
    const shop = mapShop(ss.id, ss.data());
    if (shop.kind === 'gamble_void') shop.price = voidPriceFor(shop.price, voidTiers, us.data().galleon || 0);
    const now = Date.now();
    const unit = effectivePrice(shop, now);
    const total = unit * qty;
    const pts = us.data().points || 0;
    if (pts < total) throw new Error('포인트가 부족합니다.');
    if (shop.kind === 'gamble_void') {
      if (qty !== 1) throw new Error('도박 무효권은 한 번에 1장만 살 수 있어요.');
      if ((us.data().gambleVoid || 0) >= 1) throw new Error('이미 도박 무효권을 가지고 있어요. 사용한 뒤에 다시 살 수 있어요.');
    }
    let itemRef = null; let itemSnap = null;
    if (shop.kind === 'item') {
      itemRef = doc(db, 'users', me, 'items', itemKey(shop.name, shop.description));
      itemSnap = await tx.get(itemRef);
    }
    const patch = { points: pts - total };
    if (shop.kind === 'dig_ticket') patch.digBonus = increment(qty);
    if (shop.kind === 'gamble_void') patch.gambleVoid = 1;
    if (shop.kind === 'yacha_ticket') patch.yachaTicket = increment(qty);
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


// ================= 대표 사진 일괄 생성 (예전 글용) =================
export async function backfillPostThumbs(makeThumbFn, onProgress) {
  const snap = await getDocs(collection(db, 'posts'));
  const targets = snap.docs.filter((d) => (d.data().imageCount || 0) > 0 && !d.data().thumb);
  let done = 0; let failed = 0;
  for (const d of targets) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const imgs = await fetchPostImages(d.id);
      // eslint-disable-next-line no-await-in-loop
      const t = imgs.length ? await makeThumbFn(imgs[0]) : null;
      // eslint-disable-next-line no-await-in-loop
      if (t) await updateDoc(d.ref, { thumb: t }); else failed += 1;
    } catch (e) { failed += 1; }
    done += 1;
    if (onProgress) onProgress(done, targets.length);
  }
  return { total: targets.length, failed };
}


// ================= 상점 상품 목록 (한 번 읽기) =================
export async function fetchShopItems() {
  const snap = await getDocs(collection(db, 'shopItems'));
  return snap.docs.map((d) => mapShop(d.id, d.data())).sort((a, b) => a.createdMs - b.createdMs);
}

// ================= 갈레온 =================
function parseRate(snap) {
  const n = Math.floor(Number(snap.exists() ? snap.data().pointsPerGalleon : 10));
  return n >= 1 ? n : 10;
}
export async function fetchGalleonRate() {
  try { return parseRate(await getDoc(doc(db, 'settings', 'galleon'))); } catch (e) { return 10; }
}
export async function saveGalleonRate(v) {
  const n = Math.floor(Number(v));
  if (!(n >= 1)) throw new Error('환율은 1 이상의 숫자여야 합니다.');
  await setDoc(doc(db, 'settings', 'galleon'), { pointsPerGalleon: n });
}
// 포인트 -> 갈레온 환전 (환율: 갈레온 1개 = N포인트, 관리자가 정함)
export async function exchangeToGalleon(amountRaw) {
  const amount = parseInt(amountRaw, 10);
  if (!amount || amount <= 0 || amount > 1000000) throw new Error('환전할 갈레온 수를 확인하세요.');
  const me = uid();
  let info;
  await runTransaction(db, async (tx) => {
    const userRef = doc(db, 'users', me);
    const us = await tx.get(userRef);
    const rs = await tx.get(doc(db, 'settings', 'galleon'));
    const rate = parseRate(rs);
    const cost = amount * rate;
    const pts = us.data().points || 0;
    if (pts < cost) throw new Error('포인트가 부족합니다.');
    const before = us.data().galleon || 0;
    tx.update(userRef, { points: pts - cost, galleon: before + amount });
    info = { cost, rate, before, after: before + amount, userName: us.data().characterName };
  });
  await logItem({ action: 'galleon_exchange', userId: me, userName: info.userName, itemName: '갈레온', itemDescription: '', qty: amount, price: info.cost, before: info.before, after: info.after });
  return info;
}
// 내 갈레온을 직접 적기 (변경 내역은 관리자 기록에 남음)
export async function setMyGalleon(raw) {
  const v = Math.floor(Number(raw));
  if (!(v >= 0) || v > 999999999) throw new Error('0 이상의 숫자를 입력하세요.');
  const me = uid();
  let before = 0; let name = '';
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'users', me);
    const snap = await tx.get(ref);
    before = snap.data().galleon || 0;
    name = snap.data().characterName;
    if (before !== v) tx.update(ref, { galleon: v });
  });
  if (before !== v) await logItem({ action: 'galleon_user_edit', userId: me, userName: name, itemName: '갈레온', itemDescription: '', qty: Math.abs(v - before), before, after: v });
  return v;
}
export async function adminAdjustGalleon(userId, deltaRaw, message) {
  const delta = parseInt(deltaRaw, 10);
  if (!delta) throw new Error('수량을 입력하세요.');
  let before = 0; let after = 0; let name = '';
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'users', userId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('회원 정보를 찾을 수 없습니다.');
    before = snap.data().galleon || 0;
    after = before + delta;
    if (after < 0) throw new Error('보유한 갈레온보다 많이 회수할 수 없습니다.');
    name = snap.data().characterName;
    tx.update(ref, { galleon: after });
  });
  await logItem({ action: delta > 0 ? 'galleon_admin_grant' : 'galleon_admin_remove', userId, userName: name, itemName: '갈레온', itemDescription: '', qty: Math.abs(delta), before, after });
  await addDoc(collection(db, 'notifications'), { userId, type: 'admin_item', message: `갈레온 ${delta > 0 ? '지급' : '회수'}: ${Math.abs(delta)}${message ? ' · ' + message : ''}`, read: false, createdAt: serverTimestamp() });
}
// 관리자가 도박 무효권 지급/회수 (1인당 1장까지)
export async function adminGrantGambleVoid(userId, delta, message) {
  if (delta !== 1 && delta !== -1) throw new Error('도박 무효권은 1장씩 지급·회수할 수 있습니다.');
  let name = '';
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'users', userId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('회원 정보를 찾을 수 없습니다.');
    const cur = snap.data().gambleVoid || 0;
    if (delta > 0 && cur >= 1) throw new Error('이미 도박 무효권을 가지고 있습니다. (1장까지 보유 가능)');
    if (delta < 0 && cur < 1) throw new Error('회수할 도박 무효권이 없습니다.');
    name = snap.data().characterName;
    tx.update(ref, { gambleVoid: delta > 0 ? 1 : 0 });
  });
  await logItem({ action: delta > 0 ? 'admin_grant' : 'admin_remove', userId, userName: name, itemName: '도박 무효권', itemDescription: '', qty: 1 });
  await addDoc(collection(db, 'notifications'), { userId, type: 'admin_item', message: `도박 무효권 ${delta > 0 ? '지급' : '회수'}${message ? ' · ' + message : ''}`, read: false, createdAt: serverTimestamp() });
}


// ================= 관리자: 기숙사 일괄 지급 / 빚 무효화 =================
// houses: 기숙사 id 배열. kind: points | galleon | ticket | void | item. 결과: 성공/건너뜀/실패 명단
export async function adminBulkGrant(houses, kind, opts) {
  if (!houses.length) throw new Error('기숙사를 선택하세요.');
  const all = await fetchAllUsers();
  const targets = all.filter((u) => u.approved && !u.withdrawn && houses.includes(u.house));
  if (!targets.length) throw new Error('선택한 기숙사에 지급할 회원이 없습니다.');
  const n = parseInt(opts.amount, 10);
  const msg = (opts.message || '').trim();
  if ((kind === 'points' || kind === 'galleon' || kind === 'ticket') && !(n > 0)) throw new Error('수량을 입력하세요.');
  if (kind === 'item' && !(opts.name || '').trim()) throw new Error('소지품 이름을 입력하세요.');
  const result = { ok: 0, skipped: [], failed: [] };
  for (const u of targets) {
    try {
      if (kind === 'points') await grantPoints(u.id, n, msg);
      else if (kind === 'galleon') await adminAdjustGalleon(u.id, n, msg);
      else if (kind === 'ticket') await adminGrantDigTickets(u.id, n, msg);
      else if (kind === 'void') await adminGrantGambleVoid(u.id, 1, msg);
      else await adminGrantItem(u.id, opts.name, opts.description, opts.qty || 1, msg);
      result.ok += 1;
    } catch (e) {
      if (kind === 'void' && /이미/.test(e.message || '')) result.skipped.push(u.character_name);
      else result.failed.push(`${u.character_name}(${e.message || '오류'})`);
    }
  }
  return result;
}
// 빚 무효화: 마이너스인 포인트·갈레온을 0으로 (플러스인 값은 건드리지 않음)
export async function adminForgiveDebt(userId) {
  let before = {}; let name = '';
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'users', userId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('회원 정보를 찾을 수 없습니다.');
    const d = snap.data();
    name = d.characterName;
    before = { points: d.points || 0, galleon: d.galleon || 0 };
    const patch = {};
    if (before.points < 0) patch.points = 0;
    if (before.galleon < 0) patch.galleon = 0;
    if (!Object.keys(patch).length) throw new Error('무효화할 빚이 없습니다.');
    tx.update(ref, patch);
  });
  const parts = [];
  if (before.points < 0) parts.push(`포인트 ${before.points}`);
  if (before.galleon < 0) parts.push(`갈레온 ${before.galleon}`);
  await logItem({ action: 'debt_forgive', userId, userName: name, itemName: '빚 무효화', itemDescription: parts.join(', '), qty: 1 });
  await addDoc(collection(db, 'notifications'), { userId, type: 'admin_item', message: `빚이 무효화되었습니다. (${parts.join(', ')} → 0)`, read: false, createdAt: serverTimestamp() });
  return parts;
}


// ================= 야차 (1:1 체력 전투) =================
export const YACHA_ACTIONS = ['attack', 'defend', 'heal', 'item'];
export const YACHA_ACTION_LABEL = { attack: '공격', defend: '방어', heal: '회복' };
export const YACHA_BASE_HP = 100;
export const DITTANY_NAME = '디터니';
// 간이 조사로 주울 수 있는 스킬(=소지품) 이름. "스킬1"~"스킬19"라는 이름 자체로 효과를 인식하고,
// 실제 설명은 SKILL_DESCRIPTIONS에 적어서 간이 조사 보상 등록 시 description으로 함께 들어감(adminSeedYachaSkills).
export const SKILL_NAMES = {
  NULLIFY: '스킬1', ATK_SURE: '스킬2', DEF_SURE: '스킬3', COIN: '스킬4', LIFESTEAL: '스킬5',
  FORCE_DEFEND: '스킬6', HEAL_D20: '스킬7', ATK_D20_FIXED: '스킬8', GUARD_HALF: '스킬9', COPY_BUFF: '스킬10',
  HEAL_D30: '스킬11', GUARANTEE_NEXT: '스킬12', ADVANTAGE: '스킬13', SACRIFICE_ATK: '스킬14', DEFER_DMG: '스킬15',
  HEAL_NULLIFY: '스킬16', STRENGTH_POTION: '스킬17', DEATH_WARD: '스킬18', SWAP_HP: '스킬19',
  COND_HEAL: '스킬20', DOUBLE_ATK: '스킬21', STEAL_SKILL: '스킬22', MIRROR: '스킬23', CHIP_ARMOR: '스킬24',
  DOT_HEAL: '스킬25', ALL_IN: '스킬26', RETRY_PICK: '스킬27', COND_DMG: '스킬28', HEAL_BUFF_3R: '스킬29',
  DEF_BUFF_3R: '스킬30', NULLIFY_THEN_GUARANTEE: '스킬31',
};
export const SKILL_DESCRIPTIONS = {
  [SKILL_NAMES.NULLIFY]: '해당 라운드 들어오는 모든 피해를 상쇄합니다.',
  [SKILL_NAMES.ATK_SURE]: '이번 라운드 공격 성공률 100% 고정.',
  [SKILL_NAMES.DEF_SURE]: '이번 라운드 방어 성공률 100% 고정.',
  [SKILL_NAMES.COIN]: '1/2 확률로 체력 1d20을 회복하거나 깎습니다.',
  [SKILL_NAMES.LIFESTEAL]: '이번 라운드 입힌 피해의 절반만큼 자신 체력을 회복합니다.',
  [SKILL_NAMES.FORCE_DEFEND]: '이번 라운드 상대 행동을 강제로 "방어"로 고정시킵니다.',
  [SKILL_NAMES.HEAL_D20]: '체력 1d20만큼 즉시 회복합니다(성공률 없음).',
  [SKILL_NAMES.ATK_D20_FIXED]: '상대에게 1d20 고정 피해(공격 성공률 무시).',
  [SKILL_NAMES.GUARD_HALF]: '이번 라운드와 다음 라운드까지 들어오는 피해를 절반으로 줄입니다.',
  [SKILL_NAMES.COPY_BUFF]: '이번 라운드 자신에게 걸린 모든 이로운 효과를 상대에게도 복사합니다.',
  [SKILL_NAMES.HEAL_D30]: '즉시 체력 1d30 회복합니다(성공률 없음).',
  [SKILL_NAMES.GUARANTEE_NEXT]: '다음 라운드 자신의 행동이 반드시 성공합니다.',
  [SKILL_NAMES.ADVANTAGE]: '주사위를 2번 굴려 더 높은 값을 사용합니다(공격/회복 한정).',
  [SKILL_NAMES.SACRIFICE_ATK]: '체력 10을 희생해 상대에게 1d20+5 피해를 입힙니다.',
  [SKILL_NAMES.DEFER_DMG]: '이번 라운드 받는 피해를 전부 다음 라운드로 미룹니다.',
  [SKILL_NAMES.HEAL_NULLIFY]: '상대의 이번 라운드 회복을 무효화합니다.',
  [SKILL_NAMES.STRENGTH_POTION]: '체력 10을 즉시 소모하고 이후 공격 피해가 +5 됩니다(전투 끝까지 영구).',
  [SKILL_NAMES.DEATH_WARD]: '사망 시 1회 한정으로 체력 1로 부활합니다.',
  [SKILL_NAMES.SWAP_HP]: '상대와 자신의 체력을 서로 맞바꿉니다.',
  [SKILL_NAMES.COND_HEAL]: '체력이 50 이하일 때만 사용 가능. 1d20+10 고정 회복(성공률 없음).',
  [SKILL_NAMES.DOUBLE_ATK]: '이번 라운드 공격을 2회 합니다(각각 1d20, 상대 방어로 각각 차감).',
  [SKILL_NAMES.STEAL_SKILL]: '사용 시 상대가 보유한 스킬 아이템 1개를 무작위로 소모시킵니다.',
  [SKILL_NAMES.MIRROR]: '이번 라운드 자신이 고른 공격/방어/회복을 상대도 그대로 하게 합니다.',
  [SKILL_NAMES.CHIP_ARMOR]: '이번 라운드 들어오는 피해 중 10을 넘는 부분만 상쇄합니다(약한 공격엔 효과 없음).',
  [SKILL_NAMES.DOT_HEAL]: '사용한 라운드부터 2라운드간 매 라운드 1d6 고정 회복합니다.',
  [SKILL_NAMES.ALL_IN]: '자신의 체력을 1만 남기고, 희생한 체력만큼 상대에게 고정 피해를 입힙니다.',
  [SKILL_NAMES.RETRY_PICK]: '이미 고른 행동을, 상대가 고르기 전까지 상대에게 들키지 않고 다시 고를 수 있게 합니다.',
  [SKILL_NAMES.COND_DMG]: '상대 체력이 자신보다 높을 때만 사용 가능. 체력 차이의 절반만큼 고정 피해를 입힙니다.',
  [SKILL_NAMES.HEAL_BUFF_3R]: '사용한 다음 라운드부터 3라운드간 회복 성공률이 +20%p 됩니다.',
  [SKILL_NAMES.DEF_BUFF_3R]: '사용한 다음 라운드부터 3라운드간 방어 성공률이 +20%p 됩니다.',
  [SKILL_NAMES.NULLIFY_THEN_GUARANTEE]: '이번 라운드 받는 피해를 없애고, 다음 라운드 자신의 행동이 반드시 성공합니다.',
};
// 사용할 때 "공격/회복 중 어느 쪽에 적용할지" 추가 선택이 필요한 스킬
export const SKILL_NEEDS_SUBACTION = [SKILL_NAMES.ADVANTAGE, SKILL_NAMES.MIRROR];
// 사용 시 전투 중인 체력 조건을 만족해야 하는 스킬: [itemName, 검사함수(myHp, oppHp) => boolean, 실패 메시지]
export const SKILL_HP_CONDITIONS = [
  [SKILL_NAMES.COND_HEAL, (my) => my <= 50, '체력이 50 이하일 때만 사용할 수 있습니다.'],
  [SKILL_NAMES.COND_DMG, (my, opp) => opp > my, '상대 체력이 자신보다 높을 때만 사용할 수 있습니다.'],
];
export const NULLIFY_SKILL_NAME = SKILL_NAMES.NULLIFY; // 하위 호환용 별칭

// 디터니 + 스킬 1~19를 간이 조사 보상 목록에 한 번에 등록(이미 있는 이름은 건너뜀). 확률(weight)은 기본 10으로 두고 관리자가 조정.
export async function adminSeedYachaSkills() {
  const existing = await fetchDigRewards();
  const existingNames = new Set(existing.map((r) => r.name));
  const toAdd = [{ name: DITTANY_NAME, description: '먹으면 체력이 주사위만큼 회복됩니다(최대 100, 주사위 크기는 관리자가 설정). 전투 탭에서도 사용할 수 있어요.' }];
  Object.values(SKILL_NAMES).forEach((name) => { toAdd.push({ name, description: SKILL_DESCRIPTIONS[name] || '' }); });
  let count = 0;
  for (const item of toAdd) {
    if (existingNames.has(item.name)) continue;
    // eslint-disable-next-line no-await-in-loop
    await saveDigReward(null, { name: item.name, description: item.description, weight: 10 });
    count += 1;
  }
  return count;
}

export async function fetchYachaTimeoutMs() {
  try { const snap = await getDoc(doc(db, 'settings', 'yacha')); if (snap.exists() && snap.data().timeoutMs) return Number(snap.data().timeoutMs); } catch (e) { /* 기본값 */ }
  return 3 * 60 * 1000;
}
export async function saveYachaTimeoutMs(minutesRaw) {
  const min = Number(minutesRaw);
  if (!(min > 0)) throw new Error('0보다 큰 숫자(분)를 입력하세요.');
  await setDoc(doc(db, 'settings', 'yacha'), { timeoutMs: Math.round(min * 60 * 1000) }, { merge: true });
  return min;
}
const DEFAULT_YACHA_BATTLE = { atkChance: 70, defChance: 70, healChance: 70, dieMax: 20, dittanyDie: 10 };
export async function fetchYachaBattleSettings() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'yacha'));
    if (!snap.exists()) return { ...DEFAULT_YACHA_BATTLE };
    const d = snap.data();
    return {
      atkChance: Number.isFinite(d.atkChance) ? d.atkChance : DEFAULT_YACHA_BATTLE.atkChance,
      defChance: Number.isFinite(d.defChance) ? d.defChance : DEFAULT_YACHA_BATTLE.defChance,
      healChance: Number.isFinite(d.healChance) ? d.healChance : DEFAULT_YACHA_BATTLE.healChance,
      dieMax: Number.isFinite(d.dieMax) && d.dieMax > 0 ? d.dieMax : DEFAULT_YACHA_BATTLE.dieMax,
      dittanyDie: Number.isFinite(d.dittanyDie) && d.dittanyDie > 0 ? d.dittanyDie : DEFAULT_YACHA_BATTLE.dittanyDie,
    };
  } catch (e) { return { ...DEFAULT_YACHA_BATTLE }; }
}
export async function saveYachaBattleSettings({ atkChance, defChance, healChance, dieMax, dittanyDie }) {
  const a = Number(atkChance); const d = Number(defChance); const h = Number(healChance); const die = Number(dieMax); const dd = Number(dittanyDie);
  if (![a, d, h].every((v) => v >= 0 && v <= 100)) throw new Error('확률은 0~100 사이로 입력하세요.');
  if (!(die >= 1)) throw new Error('주사위 최대값은 1 이상이어야 합니다.');
  if (!(dd >= 1)) throw new Error('디터니 회복 주사위는 1 이상이어야 합니다.');
  await setDoc(doc(db, 'settings', 'yacha'), { atkChance: a, defChance: d, healChance: h, dieMax: Math.round(die), dittanyDie: Math.round(dd) }, { merge: true });
}
// 기숙사(진영)별 전투 점수 합계 — 관리자 화면에서 사용
export function aggregateBattlePointsByFaction(users) {
  const sums = Object.fromEntries(FACTIONS.map((f) => [f.id, 0]));
  (users || []).forEach((u) => {
    const fid = factionOf(u.house);
    if (fid && fid in sums) sums[fid] += u.battle_points || 0;
  });
  return FACTIONS.map((f) => ({ id: f.id, name: f.name, total: sums[f.id] }));
}

function mapYacha(id, d) {
  return {
    id, room_id: d.roomId, user_a: d.userA, user_b: d.userB, status: d.status, requested_by: d.requestedBy,
    round: d.round || 1, hp: d.hp || {}, actions: d.actions || {}, buffs: d.buffs || {}, result: d.result || null,
    last_action_at: d.lastActionAt ? ts(d.lastActionAt) : Date.now(), created_at: ts(d.createdAt),
  };
}
export async function fetchYachaGame(gameId) {
  const snap = await getDoc(doc(db, 'yachaGames', gameId));
  return snap.exists() ? mapYacha(gameId, snap.data()) : null;
}
export function subscribeYachaGame(gameId, onChange) {
  return onSnapshot(doc(db, 'yachaGames', gameId), (snap) => onChange(snap.exists() ? mapYacha(gameId, snap.data()) : null));
}
// 익명 게시판이므로 야차 진행 과정은 실명이 아니라 보낸 사람 기준(나/상대방)으로만 보이는
// 평범한 채팅 메시지로 남김 — 기존 채팅 메시지와 동일한 형태(type:'text')라 추가 렌더링 코드가 필요 없음
async function postYachaChatMessage(roomId, senderId, text) {
  try {
    await addDoc(collection(db, 'chatRooms', roomId, 'messages'), { senderId, type: 'text', text, createdAt: serverTimestamp() });
    const roomSnap = await getDoc(doc(db, 'chatRooms', roomId));
    await touchRoom(roomId, text, roomSnap.exists() ? roomSnap.data() : null);
  } catch (e) { /* best-effort: 기록 실패해도 게임 진행에는 영향 없음 */ }
}
// 신청: 둘 중 한 명만 야차권을 가지고 있어도 신청·진행 가능 (소모는 수락 시 한 장).
// 체력이 전투 사이에 그대로 이어지는 개인 자원이라 한 사람이 동시에 여러 전투를 열면 꼬이므로,
// 신청 시점부터 한 사람은 하나의 야차에만 참여할 수 있게 막아요 (battleActiveGameId).
export async function requestYacha(roomId) {
  const me = uid();
  const roomRef = doc(db, 'chatRooms', roomId);
  const gameRef = doc(collection(db, 'yachaGames'));
  let other = null;
  await runTransaction(db, async (tx) => {
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists()) throw new Error('채팅방을 찾을 수 없습니다.');
    const r = roomSnap.data();
    if (r.yachaActive) throw new Error('이 채팅방에는 이미 진행 중인 야차가 있습니다.');
    other = r.userA === me ? r.userB : r.userA;
    const meRef = doc(db, 'users', me); const otherRef = doc(db, 'users', other);
    const [meSnap, otherSnap] = await Promise.all([tx.get(meRef), tx.get(otherRef)]);
    if ((meSnap.data()?.yachaTicket || 0) < 1 && (otherSnap.data()?.yachaTicket || 0) < 1) throw new Error('둘 중 한 명은 야차권이 있어야 신청할 수 있습니다.');
    if (meSnap.data()?.battleActiveGameId) throw new Error('이미 다른 야차 전투에 참여 중입니다.');
    if (otherSnap.data()?.battleActiveGameId) throw new Error('상대가 이미 다른 야차 전투에 참여 중입니다.');
    tx.set(gameRef, {
      roomId, userA: me, userB: other, status: 'pending', requestedBy: me,
      round: 1, hp: {}, actions: {}, lastActionAt: serverTimestamp(), createdAt: serverTimestamp(),
    });
    tx.update(roomRef, { yachaActive: true, activeYachaId: gameRef.id });
    tx.update(meRef, { battleActiveGameId: gameRef.id });
    tx.update(otherRef, { battleActiveGameId: gameRef.id });
  });
  await addDoc(collection(db, 'notifications'), { userId: other, type: 'chat_message', roomId, preview: '야차 신청이 왔습니다.', read: false, createdAt: serverTimestamp() });
  await postYachaChatMessage(roomId, me, '야차를 신청했습니다.');
  return gameRef.id;
}
export async function declineYacha(gameId) {
  const me = uid();
  const gameRef = doc(db, 'yachaGames', gameId);
  let g = null;
  await runTransaction(db, async (tx) => {
    const gs = await tx.get(gameRef);
    if (!gs.exists() || ['declined', 'ended', 'cancelled'].includes(gs.data().status)) return;
    g = gs.data();
    tx.update(gameRef, { status: 'declined', lastActionAt: serverTimestamp() });
    tx.update(doc(db, 'chatRooms', g.roomId), { yachaActive: false, activeYachaId: null });
    tx.update(doc(db, 'users', g.userA), { battleActiveGameId: null });
    tx.update(doc(db, 'users', g.userB), { battleActiveGameId: null });
  });
  if (g) await postYachaChatMessage(g.roomId, me, g.requestedBy === me ? '신청을 취소했습니다.' : '신청을 거절했습니다.');
}
// 한 전투 시작에 필요한 야차권 1장을 둘 중 가진 쪽에서 소모 (A 우선)
function consumeOneTicket(tx, aRef, bRef, aTicket, bTicket) {
  if (aTicket >= 1) { tx.update(aRef, { yachaTicket: increment(-1) }); return; }
  if (bTicket >= 1) { tx.update(bRef, { yachaTicket: increment(-1) }); return; }
  throw new Error('야차권이 없습니다.');
}
// 수락: 둘 중 한 명의 야차권 1장을 소모하고, 각자 직전 전투에서 이어지는 체력(없으면 100)으로 전투 시작
export async function acceptYacha(gameId) {
  const me = uid();
  const gameRef = doc(db, 'yachaGames', gameId);
  await runTransaction(db, async (tx) => {
    const gs = await tx.get(gameRef);
    if (!gs.exists() || gs.data().status !== 'pending') throw new Error('이미 처리된 신청입니다.');
    const g = gs.data();
    if (g.requestedBy === me) throw new Error('본인이 신청한 야차는 수락할 수 없습니다.');
    const aRef = doc(db, 'users', g.userA); const bRef = doc(db, 'users', g.userB);
    const [as, bs] = await Promise.all([tx.get(aRef), tx.get(bRef)]);
    const aTicket = as.data().yachaTicket || 0; const bTicket = bs.data().yachaTicket || 0;
    if (aTicket < 1 && bTicket < 1) throw new Error('둘 중 한 명은 야차권이 있어야 시작할 수 있습니다.');
    consumeOneTicket(tx, aRef, bRef, aTicket, bTicket);
    const hpA = Number.isFinite(as.data().battleHp) ? as.data().battleHp : YACHA_BASE_HP;
    const hpB = Number.isFinite(bs.data().battleHp) ? bs.data().battleHp : YACHA_BASE_HP;
    tx.update(gameRef, {
      status: 'battling', round: 1, hp: { [g.userA]: hpA, [g.userB]: hpB }, actions: {},
      buffs: { [g.userA]: {}, [g.userB]: {} }, result: null, lastActionAt: serverTimestamp(),
    });
  });
}
function rollDie(dieMax) { return 1 + Math.floor(Math.random() * dieMax); }
function rollSuccess(chancePercent) { return Math.random() * 100 < chancePercent; }
function defaultYachaBuff() {
  return {
    halfDmgRounds: 0, atkBonus: 0, deathWard: false, guaranteedNext: false, pendingDamage: 0,
    healDotRounds: 0, healBonusRounds: 0, defBonusRounds: 0,
  };
}
function actionNote(act, skill, roll) {
  if (!act) return '';
  if (act.action === 'attack') return roll.atkOk ? `공격(성공/${roll.atk})` : '공격(실패)';
  if (act.action === 'defend') return roll.defOk ? `방어(성공/${roll.def})` : '방어(실패)';
  if (act.action === 'heal') return roll.healOk ? `회복(성공/${roll.heal})` : '회복(실패)';
  if (skill === DITTANY_NAME) return `${DITTANY_NAME}(회복${roll.heal})`;
  const S = SKILL_NAMES;
  switch (skill) {
    case S.NULLIFY: case S.NULLIFY_THEN_GUARANTEE: return `${skill}(상쇄)`;
    case S.ATK_D20_FIXED: case S.ATK_SURE: case S.COND_DMG: case S.ALL_IN: return `${skill}(성공/${roll.atk})`;
    case S.DEF_SURE: return `${skill}(성공/${roll.def})`;
    case S.HEAL_D20: case S.HEAL_D30: case S.COND_HEAL: return `${skill}(회복${roll.heal})`;
    case S.DOT_HEAL: return `${skill}(회복${roll.heal})`;
    case S.LIFESTEAL: return roll.atkOk ? `${skill}(성공/${roll.atk})` : `${skill}(실패)`;
    case S.SACRIFICE_ATK: return `${skill}(피해${roll.atk}/자해10)`;
    case S.DOUBLE_ATK: return `${skill}(${roll.atkOk ? `성공/${roll.atk}` : '실패'}·${roll.atkOk2 ? `성공/${roll.atk2}` : '실패'})`;
    case S.COIN: return roll.healOk ? `${skill}(회복${roll.heal})` : `${skill}(자해${roll.selfDmg})`;
    case S.ADVANTAGE: case S.MIRROR:
      if (act.subAction === 'attack') return roll.atkOk ? `${skill}(성공/${roll.atk})` : `${skill}(실패)`;
      if (act.subAction === 'defend') return roll.defOk ? `${skill}(성공/${roll.def})` : `${skill}(실패)`;
      return roll.healOk ? `${skill}(회복${roll.heal})` : `${skill}(실패)`;
    default: return `${skill}(발동)`;
  }
}
// 한 라운드를 해석하는 순수 함수(파이어스토어 접근 없음). 트랜잭션에서 필요한 읽기가 끝난 뒤 호출.
// actA/actB: {action, itemId, itemName, subAction} / hp,buffsIn: {[uid]: ...} / settings: {dieMax, atkChance, defChance, healChance, dittanyDie}
function resolveYachaRound({ userA, userB, actions, hp, buffsIn, settings }) {
  const { dieMax, atkChance, defChance, healChance, dittanyDie } = settings;
  const S = SKILL_NAMES;
  const actA = actions[userA]; const actB = actions[userB];
  const skillA = actA?.action === 'item' ? actA.itemName : null;
  const skillB = actB?.action === 'item' ? actB.itemName : null;
  const bA = { ...defaultYachaBuff(), ...(buffsIn[userA] || {}) };
  const bB = { ...defaultYachaBuff(), ...(buffsIn[userB] || {}) };
  const hpStartA = hp[userA] ?? YACHA_BASE_HP; const hpStartB = hp[userB] ?? YACHA_BASE_HP;

  // "이번 라운드 상대 행동을 강제로 방어로 고정" / "상대도 그대로 하게" — 상대가 일반 행동일 때만 적용, 스킬 사용은 그대로 둠
  let effA = actA?.action; let effB = actB?.action;
  if (skillB === S.FORCE_DEFEND && effA !== 'item') effA = 'defend';
  if (skillA === S.FORCE_DEFEND && effB !== 'item') effB = 'defend';
  if (skillA === S.MIRROR && actA.subAction && effB !== 'item') effB = actA.subAction;
  if (skillB === S.MIRROR && actB.subAction && effA !== 'item') effA = actB.subAction;

  function rollFor(act, eff, skill, buff, selfHp) {
    const r = { atkOk: false, atk: 0, atkOk2: false, atk2: 0, defOk: false, def: 0, healOk: false, heal: 0, selfDmg: 0 };
    const guaranteed = buff.guaranteedNext;
    const healChanceEff = healChance + (buff.healBonusRounds > 0 ? 20 : 0);
    const defChanceEff = defChance + (buff.defBonusRounds > 0 ? 20 : 0);
    if (skill === S.ATK_SURE) { r.atkOk = true; r.atk = rollDie(dieMax) + buff.atkBonus; }
    else if (skill === S.ATK_D20_FIXED) { r.atkOk = true; r.atk = rollDie(20); }
    else if (skill === S.SACRIFICE_ATK) { r.atkOk = true; r.atk = rollDie(20) + 5; r.selfDmg += 10; }
    else if (skill === S.COND_DMG) { r.atkOk = true; r.atk = Math.floor(Math.abs((hp[eff === 'opp' ? 0 : 0])) * 0); } // placeholder, replaced below
    else if (skill === S.ALL_IN) { const cost = Math.max(0, selfHp - 1); r.atkOk = true; r.atk = cost; r.selfDmg += cost; }
    else if (skill === S.LIFESTEAL) { r.atkOk = guaranteed || rollSuccess(atkChance); if (r.atkOk) r.atk = rollDie(dieMax) + buff.atkBonus; }
    else if (skill === S.DOUBLE_ATK) {
      r.atkOk = guaranteed || rollSuccess(atkChance); if (r.atkOk) r.atk = rollDie(dieMax) + buff.atkBonus;
      r.atkOk2 = guaranteed || rollSuccess(atkChance); if (r.atkOk2) r.atk2 = rollDie(dieMax) + buff.atkBonus;
    } else if (skill === S.ADVANTAGE && act.subAction === 'attack') { r.atkOk = guaranteed || rollSuccess(atkChance); if (r.atkOk) r.atk = Math.max(rollDie(dieMax), rollDie(dieMax)) + buff.atkBonus; }
    else if (skill === S.MIRROR && act.subAction === 'attack') { r.atkOk = guaranteed || rollSuccess(atkChance); if (r.atkOk) r.atk = rollDie(dieMax) + buff.atkBonus; }
    else if (eff === 'attack') { r.atkOk = guaranteed || rollSuccess(atkChance); if (r.atkOk) r.atk = rollDie(dieMax) + buff.atkBonus; }

    if (skill === S.DEF_SURE) { r.defOk = true; r.def = rollDie(dieMax); }
    else if (skill === S.ADVANTAGE && act.subAction === 'defend') { r.defOk = guaranteed || rollSuccess(defChanceEff); if (r.defOk) r.def = Math.max(rollDie(dieMax), rollDie(dieMax)); }
    else if (skill === S.MIRROR && act.subAction === 'defend') { r.defOk = guaranteed || rollSuccess(defChanceEff); if (r.defOk) r.def = rollDie(dieMax); }
    else if (eff === 'defend') { r.defOk = guaranteed || rollSuccess(defChanceEff); if (r.defOk) r.def = rollDie(dieMax); }

    if (skill === S.HEAL_D20) { r.healOk = true; r.heal = rollDie(20); }
    else if (skill === S.HEAL_D30) { r.healOk = true; r.heal = rollDie(30); }
    else if (skill === S.COND_HEAL) { r.healOk = true; r.heal = rollDie(20) + 10; }
    else if (skill === S.ADVANTAGE && act.subAction === 'heal') { r.healOk = guaranteed || rollSuccess(healChanceEff); if (r.healOk) r.heal = Math.max(rollDie(dieMax), rollDie(dieMax)); }
    else if (skill === S.MIRROR && act.subAction === 'heal') { r.healOk = guaranteed || rollSuccess(healChanceEff); if (r.healOk) r.heal = rollDie(dieMax); }
    else if (eff === 'heal') { r.healOk = guaranteed || rollSuccess(healChanceEff); if (r.healOk) r.heal = rollDie(dieMax); }

    if (skill === S.COIN) { if (Math.random() < 0.5) { r.healOk = true; r.heal = rollDie(20); } else { r.selfDmg += rollDie(20); } }
    if (skill === DITTANY_NAME) { r.healOk = true; r.heal = rollDie(dittanyDie); }
    const dotActive = buff.healDotRounds > 0 || skill === S.DOT_HEAL;
    if (dotActive) { r.healOk = true; r.heal += rollDie(6); }
    return r;
  }
  const rollA = rollFor(actA, effA, skillA, bA, hpStartA);
  const rollB = rollFor(actB, effB, skillB, bB, hpStartB);
  // 체력차 기반 고정 피해(스킬28)는 상대 쪽 수치가 필요해서 역할 계산 뒤 다시 채움
  if (skillA === S.COND_DMG) { rollA.atkOk = true; rollA.atk = Math.floor(Math.max(0, hpStartB - hpStartA) / 2); }
  if (skillB === S.COND_DMG) { rollB.atkOk = true; rollB.atk = Math.floor(Math.max(0, hpStartA - hpStartB) / 2); }
  if (skillA === S.HEAL_NULLIFY) rollB.healOk = false;
  if (skillB === S.HEAL_NULLIFY) rollA.healOk = false;

  let dmgToA = Math.max(0, rollB.atk - rollA.def) + Math.max(0, (rollB.atk2 || 0) - rollA.def);
  let dmgToB = Math.max(0, rollA.atk - rollB.def) + Math.max(0, (rollA.atk2 || 0) - rollB.def);
  if (skillA === S.NULLIFY || skillA === S.NULLIFY_THEN_GUARANTEE) dmgToA = 0;
  if (skillB === S.NULLIFY || skillB === S.NULLIFY_THEN_GUARANTEE) dmgToB = 0;
  const halfActiveA = bA.halfDmgRounds > 0 || skillA === S.GUARD_HALF;
  const halfActiveB = bB.halfDmgRounds > 0 || skillB === S.GUARD_HALF;
  if (halfActiveA) dmgToA = Math.floor(dmgToA / 2);
  if (halfActiveB) dmgToB = Math.floor(dmgToB / 2);
  if (skillA === S.CHIP_ARMOR && dmgToA > 10) dmgToA = 10;
  if (skillB === S.CHIP_ARMOR && dmgToB > 10) dmgToB = 10;
  let deferOutA = 0; let deferOutB = 0;
  if (skillA === S.DEFER_DMG) { deferOutA = dmgToA; dmgToA = 0; }
  if (skillB === S.DEFER_DMG) { deferOutB = dmgToB; dmgToB = 0; }
  dmgToA += bA.pendingDamage || 0;
  dmgToB += bB.pendingDamage || 0;

  let hpA2 = hpStartA - dmgToA - (rollA.selfDmg || 0);
  let hpB2 = hpStartB - dmgToB - (rollB.selfDmg || 0);
  if (hpA2 > 0 && rollA.healOk) hpA2 = Math.min(YACHA_BASE_HP, hpA2 + rollA.heal);
  if (hpB2 > 0 && rollB.healOk) hpB2 = Math.min(YACHA_BASE_HP, hpB2 + rollB.heal);
  if (hpA2 > 0 && skillA === S.LIFESTEAL && rollA.atkOk) hpA2 = Math.min(YACHA_BASE_HP, hpA2 + Math.floor(dmgToB / 2));
  if (hpB2 > 0 && skillB === S.LIFESTEAL && rollB.atkOk) hpB2 = Math.min(YACHA_BASE_HP, hpB2 + Math.floor(dmgToA / 2));
  if (skillA === S.ALL_IN) hpA2 = Math.min(hpA2, 1);
  if (skillB === S.ALL_IN) hpB2 = Math.min(hpB2, 1);
  if (skillA === S.SWAP_HP || skillB === S.SWAP_HP) { const t = hpA2; hpA2 = hpB2; hpB2 = t; }
  hpA2 = Math.max(0, hpA2); hpB2 = Math.max(0, hpB2);

  let newAtkBonusA = bA.atkBonus + (skillA === S.STRENGTH_POTION ? 5 : 0);
  let newAtkBonusB = bB.atkBonus + (skillB === S.STRENGTH_POTION ? 5 : 0);
  let newHalfA = skillA === S.GUARD_HALF ? 1 : Math.max(0, bA.halfDmgRounds - (bA.halfDmgRounds > 0 ? 1 : 0));
  let newHalfB = skillB === S.GUARD_HALF ? 1 : Math.max(0, bB.halfDmgRounds - (bB.halfDmgRounds > 0 ? 1 : 0));
  let newGuaranteedA = skillA === S.GUARANTEE_NEXT || skillA === S.NULLIFY_THEN_GUARANTEE;
  let newGuaranteedB = skillB === S.GUARANTEE_NEXT || skillB === S.NULLIFY_THEN_GUARANTEE;
  let newDeathWardA = skillA === S.DEATH_WARD ? true : bA.deathWard;
  let newDeathWardB = skillB === S.DEATH_WARD ? true : bB.deathWard;
  let newDotA = skillA === S.DOT_HEAL ? 1 : Math.max(0, bA.healDotRounds - (bA.healDotRounds > 0 ? 1 : 0));
  let newDotB = skillB === S.DOT_HEAL ? 1 : Math.max(0, bB.healDotRounds - (bB.healDotRounds > 0 ? 1 : 0));
  let newHealBuffA = skillA === S.HEAL_BUFF_3R ? 3 : Math.max(0, bA.healBonusRounds - (bA.healBonusRounds > 0 ? 1 : 0));
  let newHealBuffB = skillB === S.HEAL_BUFF_3R ? 3 : Math.max(0, bB.healBonusRounds - (bB.healBonusRounds > 0 ? 1 : 0));
  let newDefBuffA = skillA === S.DEF_BUFF_3R ? 3 : Math.max(0, bA.defBonusRounds - (bA.defBonusRounds > 0 ? 1 : 0));
  let newDefBuffB = skillB === S.DEF_BUFF_3R ? 3 : Math.max(0, bB.defBonusRounds - (bB.defBonusRounds > 0 ? 1 : 0));
  let deadA = hpA2 <= 0; let deadB = hpB2 <= 0;
  if (deadA && newDeathWardA) { hpA2 = 1; deadA = false; newDeathWardA = false; }
  if (deadB && newDeathWardB) { hpB2 = 1; deadB = false; newDeathWardB = false; }
  if (skillA === S.COPY_BUFF) {
    newHalfB = Math.max(newHalfB, newHalfA); newAtkBonusB = Math.max(newAtkBonusB, newAtkBonusA);
    newGuaranteedB = newGuaranteedB || newGuaranteedA; newDeathWardB = newDeathWardB || newDeathWardA;
  }
  if (skillB === S.COPY_BUFF) {
    newHalfA = Math.max(newHalfA, newHalfB); newAtkBonusA = Math.max(newAtkBonusA, newAtkBonusB);
    newGuaranteedA = newGuaranteedA || newGuaranteedB; newDeathWardA = newDeathWardA || newDeathWardB;
  }
  return {
    hpA: hpA2, hpB: hpB2, deadA, deadB, dmgToA, dmgToB,
    noteA: actionNote(actA, skillA, rollA), noteB: actionNote(actB, skillB, rollB),
    buffs: {
      [userA]: {
        halfDmgRounds: newHalfA, atkBonus: newAtkBonusA, deathWard: newDeathWardA, guaranteedNext: newGuaranteedA,
        pendingDamage: deferOutA, healDotRounds: newDotA, healBonusRounds: newHealBuffA, defBonusRounds: newDefBuffA,
      },
      [userB]: {
        halfDmgRounds: newHalfB, atkBonus: newAtkBonusB, deathWard: newDeathWardB, guaranteedNext: newGuaranteedB,
        pendingDamage: deferOutB, healDotRounds: newDotB, healBonusRounds: newHealBuffB, defBonusRounds: newDefBuffB,
      },
    },
  };
}
// 공격/방어/회복/아이템 중 하나를 선택. 고른 순간엔 "행동을 선택했습니다."만 보이고,
// 둘 다 고르면 그제서야 한 라운드가 한꺼번에 풀려서 결과가 공개됨
export async function chooseYachaAction(gameId, action, itemId, subAction) {
  if (!YACHA_ACTIONS.includes(action)) throw new Error('잘못된 행동입니다.');
  if (action === 'item' && !itemId) throw new Error('사용할 아이템을 선택하세요.');
  const me = uid();
  const gameRef = doc(db, 'yachaGames', gameId);
  const settings = await fetchYachaBattleSettings();
  let roomId = null; let reveal = null; let ended = null;
  await runTransaction(db, async (tx) => {
    const gs = await tx.get(gameRef);
    if (!gs.exists() || gs.data().status !== 'battling') throw new Error('지금은 행동할 수 없습니다.');
    const g = gs.data();
    if (g.actions?.[me]) throw new Error('이미 행동을 선택했습니다.');
    roomId = g.roomId;
    const other = g.userA === me ? g.userB : g.userA;
    const myItemRef = action === 'item' ? doc(db, 'users', me, 'items', itemId) : null;
    const myItemSnap = myItemRef ? await tx.get(myItemRef) : null;
    if (action === 'item') {
      if (!myItemSnap.exists() || (myItemSnap.data().qty || 0) < 1) throw new Error('보유하지 않은 아이템입니다.');
    }
    const itemName = myItemSnap ? myItemSnap.data().name : null;
    if (SKILL_NEEDS_SUBACTION.includes(itemName) && !subAction) throw new Error('함께 선택할 행동을 골라주세요.');
    const hpNow = g.hp || {};
    const cond = SKILL_HP_CONDITIONS.find(([n]) => n === itemName);
    if (cond) {
      const [, check, failMsg] = cond;
      const myHp = hpNow[me] ?? YACHA_BASE_HP; const oppHp = hpNow[other] ?? YACHA_BASE_HP;
      if (!check(myHp, oppHp)) throw new Error(failMsg);
    }
    const myAct = { action, itemId: itemId || null, itemName, subAction: subAction || null };
    const actions = { ...(g.actions || {}), [me]: myAct };

    // 둘 다 고르기 전이면: STEAL_SKILL처럼 즉시 상대 아이템을 읽어야 하는 경우도 모든 tx.get을 먼저 끝내야 함
    let stealPick = null;
    if (itemName === SKILL_NAMES.STEAL_SKILL) {
      const otherItemsSnap = await getDocs(collection(db, 'users', other, 'items'));
      const skillDocs = otherItemsSnap.docs.filter((d) => Object.values(SKILL_NAMES).includes(d.data().name) && d.data().name !== SKILL_NAMES.STEAL_SKILL && (d.data().qty || 0) > 0);
      if (skillDocs.length > 0) stealPick = skillDocs[Math.floor(Math.random() * skillDocs.length)];
    }
    if (!g.actions?.[other]) {
      if (stealPick) {
        const left = (stealPick.data().qty || 0) - 1;
        if (left <= 0) tx.delete(stealPick.ref); else tx.update(stealPick.ref, { qty: left });
      }
      tx.update(gameRef, { actions, lastActionAt: serverTimestamp() });
      return;
    }

    // 둘 다 골랐으면 한 라운드를 한꺼번에 해석
    const actA = actions[g.userA]; const actB = actions[g.userB];
    // 상대가 이번 라운드에 아이템을 썼다면 그 아이템도 여기서 함께 확인/소모해야 함
    const otherAct = g.userA === me ? actB : actA;
    let otherItemSnap = null; let otherItemRef2 = null;
    let otherStealPick = null;
    if (otherAct?.action === 'item' && otherAct.itemId) {
      otherItemRef2 = doc(db, 'users', other, 'items', otherAct.itemId);
      otherItemSnap = await tx.get(otherItemRef2);
      if (!otherItemSnap.exists() || (otherItemSnap.data().qty || 0) < 1) throw new Error('상대 아이템 정보를 확인할 수 없습니다.');
      if (otherAct.itemName === SKILL_NAMES.STEAL_SKILL) {
        const myItemsSnap = await getDocs(collection(db, 'users', me, 'items'));
        const skillDocs = myItemsSnap.docs.filter((d) => Object.values(SKILL_NAMES).includes(d.data().name) && d.data().name !== SKILL_NAMES.STEAL_SKILL && (d.data().qty || 0) > 0);
        if (skillDocs.length > 0) otherStealPick = skillDocs[Math.floor(Math.random() * skillDocs.length)];
      }
    }
    if (stealPick) {
      const left = (stealPick.data().qty || 0) - 1;
      if (left <= 0) tx.delete(stealPick.ref); else tx.update(stealPick.ref, { qty: left });
    }
    if (otherStealPick) {
      const left = (otherStealPick.data().qty || 0) - 1;
      if (left <= 0) tx.delete(otherStealPick.ref); else tx.update(otherStealPick.ref, { qty: left });
    }

    const hp = g.hp || {};
    const buffsIn = g.buffs || {};
    const r = resolveYachaRound({ userA: g.userA, userB: g.userB, actions, hp, buffsIn, settings });

    // 이번 라운드에 쓴 아이템은 여기서 함께 소모 (내 것/상대 것)
    function consumeItem(itemRef, itemSnap) {
      if (!itemRef || !itemSnap) return;
      const left = (itemSnap.data().qty || 0) - 1;
      if (left <= 0) tx.delete(itemRef); else tx.update(itemRef, { qty: left });
    }
    if (actA?.action === 'item') consumeItem(g.userA === me ? myItemRef : otherItemRef2, g.userA === me ? myItemSnap : otherItemSnap);
    if (actB?.action === 'item') consumeItem(g.userB === me ? myItemRef : otherItemRef2, g.userB === me ? myItemSnap : otherItemSnap);

    const stolenVictim = stealPick ? other : (otherStealPick ? me : null);
    const stolenName = stealPick ? stealPick.data().name : (otherStealPick ? otherStealPick.data().name : null);
    reveal = {
      userA: g.userA, userB: g.userB, actA, actB, dmgA: r.dmgToA, dmgB: r.dmgToB, noteA: r.noteA, noteB: r.noteB,
      stolenVictim, stolenName,
    };

    if (r.deadA || r.deadB) {
      const aRef = doc(db, 'users', g.userA); const bRef = doc(db, 'users', g.userB);
      if (r.deadA && r.deadB) {
        tx.update(aRef, { battleHp: YACHA_BASE_HP, battleActiveGameId: null });
        tx.update(bRef, { battleHp: YACHA_BASE_HP, battleActiveGameId: null });
        ended = { type: 'draw' };
      } else if (r.deadA) {
        tx.update(aRef, { battleHp: YACHA_BASE_HP, battlePoints: increment(-1), battleActiveGameId: null });
        tx.update(bRef, { battleHp: r.hpB, battlePoints: increment(1), battleActiveGameId: null });
        ended = { type: 'death', loser: g.userA, winner: g.userB };
      } else {
        tx.update(bRef, { battleHp: YACHA_BASE_HP, battlePoints: increment(-1), battleActiveGameId: null });
        tx.update(aRef, { battleHp: r.hpA, battlePoints: increment(1), battleActiveGameId: null });
        ended = { type: 'death', loser: g.userB, winner: g.userA };
      }
      tx.update(doc(db, 'chatRooms', g.roomId), { yachaActive: false, activeYachaId: null });
      tx.update(gameRef, { status: 'ended', hp: { [g.userA]: r.hpA, [g.userB]: r.hpB }, result: ended, lastActionAt: serverTimestamp() });
    } else {
      tx.update(gameRef, {
        hp: { [g.userA]: r.hpA, [g.userB]: r.hpB }, buffs: r.buffs, actions: {}, round: (g.round || 1) + 1, lastActionAt: serverTimestamp(),
      });
    }
  });
  if (roomId) await postYachaChatMessage(roomId, me, '행동을 선택했습니다.');
  if (reveal) {
    await postYachaChatMessage(roomId, reveal.userA, reveal.noteA);
    await postYachaChatMessage(roomId, reveal.userB, reveal.noteB);
    if (reveal.stolenVictim && reveal.stolenName) {
      await postYachaChatMessage(roomId, null, `상대가 ${reveal.stolenName}을(를) 잃었습니다.`);
    }
  }
  if (ended) {
    const text = ended.type === 'draw' ? '두 사람 모두 체력이 0이 되어 무승부로 전투가 종료되었습니다.' : '체력이 0이 되어 전투가 종료되었습니다.';
    await postYachaChatMessage(roomId, null, text);
  }
}
// 전투 중이 아닐 때도 디터니를 먹어 체력을 회복할 수 있게 함(전투 탭용). 전투 중엔 사용 불가(해당 라운드 행동으로 써야 함).
export async function useDittanyStandalone() {
  const me = uid();
  const userRef = doc(db, 'users', me);
  let healed = 0;
  await runTransaction(db, async (tx) => {
    const us = await tx.get(userRef);
    if (!us.exists()) throw new Error('유저 정보를 찾을 수 없습니다.');
    const u = us.data();
    if (u.battleActiveGameId) throw new Error('전투 중에는 전투 화면에서 사용하세요.');
    const itemsSnap = await getDocs(collection(db, 'users', me, 'items'));
    const d = itemsSnap.docs.find((x) => x.data().name === DITTANY_NAME && (x.data().qty || 0) > 0);
    if (!d) throw new Error('보유한 디터니가 없습니다.');
    const hp = Number.isFinite(u.battleHp) ? u.battleHp : YACHA_BASE_HP;
    if (hp >= YACHA_BASE_HP) throw new Error('이미 체력이 가득 찼습니다.');
    const settings = await fetchYachaBattleSettings();
    healed = rollDie(settings.dittanyDie);
    const newHp = Math.min(YACHA_BASE_HP, hp + healed);
    const left = (d.data().qty || 0) - 1;
    if (left <= 0) tx.delete(d.ref); else tx.update(d.ref, { qty: left });
    tx.update(userRef, { battleHp: newHp });
  });
  return healed;
}
// 스킬27(다시 고르기): 이미 고른 행동을 상대가 고르기 전까지 취소하고 다시 고를 수 있게 함. 사용할 때마다 아이템 1개 소모.
export async function retractYachaAction(gameId, itemId) {
  const me = uid();
  const gameRef = doc(db, 'yachaGames', gameId);
  await runTransaction(db, async (tx) => {
    const gs = await tx.get(gameRef);
    if (!gs.exists() || gs.data().status !== 'battling') throw new Error('지금은 사용할 수 없습니다.');
    const g = gs.data();
    if (!g.actions?.[me]) throw new Error('아직 행동을 선택하지 않았습니다.');
    const other = g.userA === me ? g.userB : g.userA;
    if (g.actions?.[other]) throw new Error('상대가 이미 행동을 선택해 다시 고를 수 없습니다.');
    const itemRef = doc(db, 'users', me, 'items', itemId);
    const itemSnap = await tx.get(itemRef);
    if (!itemSnap.exists() || itemSnap.data().name !== SKILL_NAMES.RETRY_PICK || (itemSnap.data().qty || 0) < 1) throw new Error('보유하지 않은 아이템입니다.');
    const left = (itemSnap.data().qty || 0) - 1;
    if (left <= 0) tx.delete(itemRef); else tx.update(itemRef, { qty: left });
    tx.update(gameRef, { actions: { ...g.actions, [me]: deleteField() }, lastActionAt: serverTimestamp() });
  });
}
// 항복: 즉시 종료되며 체력은 그대로 다음 전투로 이어짐(사망이 아니므로 초기화하지 않음)
export async function surrenderYacha(gameId) {
  const me = uid();
  const gameRef = doc(db, 'yachaGames', gameId);
  let roomId = null;
  await runTransaction(db, async (tx) => {
    const gs = await tx.get(gameRef);
    if (!gs.exists() || gs.data().status !== 'battling') throw new Error('지금은 항복할 수 없습니다.');
    const g = gs.data();
    roomId = g.roomId;
    const other = g.userA === me ? g.userB : g.userA;
    const hp = g.hp || {};
    tx.update(doc(db, 'users', me), { battleHp: hp[me] ?? YACHA_BASE_HP, battleActiveGameId: null });
    tx.update(doc(db, 'users', other), { battleHp: hp[other] ?? YACHA_BASE_HP, battlePoints: increment(1), battleActiveGameId: null });
    tx.update(doc(db, 'chatRooms', g.roomId), { yachaActive: false, activeYachaId: null });
    tx.update(gameRef, { status: 'ended', result: { type: 'surrender', loser: me, winner: other }, lastActionAt: serverTimestamp() });
  });
  if (roomId) await postYachaChatMessage(roomId, me, '항복했습니다.');
}
// 비활성 처리: 상대가 응답할 차례인데 설정된 시간 동안 아무 반응이 없으면 자동 처리
export async function checkYachaTimeout(gameId) {
  const gameRef = doc(db, 'yachaGames', gameId);
  const timeoutMs = await fetchYachaTimeoutMs();
  let acted = false;
  let endedRoomId = null; let endedText = null;
  await runTransaction(db, async (tx) => {
    const gs = await tx.get(gameRef);
    if (!gs.exists()) return;
    const g = gs.data();
    const elapsed = Date.now() - (g.lastActionAt ? g.lastActionAt.toMillis() : Date.now());
    if (elapsed < timeoutMs) return;
    const roomRef = doc(db, 'chatRooms', g.roomId);
    const aRef = doc(db, 'users', g.userA); const bRef = doc(db, 'users', g.userB);
    if (g.status === 'pending') {
      tx.update(gameRef, { status: 'declined', lastActionAt: serverTimestamp() });
      tx.update(roomRef, { yachaActive: false, activeYachaId: null });
      tx.update(aRef, { battleActiveGameId: null }); tx.update(bRef, { battleActiveGameId: null });
      acted = true; endedRoomId = g.roomId; endedText = '야차 신청이 종료되었습니다.';
      return;
    }
    if (g.status === 'battling') {
      const acts = g.actions || {};
      const aActed = !!acts[g.userA]; const bActed = !!acts[g.userB];
      if (aActed && bActed) return; // 둘 다 골랐다면 보통 바로 처리되므로 그대로 둠
      if (!aActed && !bActed) return; // 아직 아무도 행동하지 않았다면 기다림
      const hp = g.hp || {};
      const loserUid = aActed ? g.userB : g.userA;
      const winnerUid = aActed ? g.userA : g.userB;
      tx.update(doc(db, 'users', loserUid), { battleHp: hp[loserUid] ?? YACHA_BASE_HP, battleActiveGameId: null });
      tx.update(doc(db, 'users', winnerUid), { battleHp: hp[winnerUid] ?? YACHA_BASE_HP, battlePoints: increment(1), battleActiveGameId: null });
      tx.update(roomRef, { yachaActive: false, activeYachaId: null });
      tx.update(gameRef, { status: 'ended', result: { type: 'timeout', loser: loserUid, winner: winnerUid }, lastActionAt: serverTimestamp() });
      acted = true; endedRoomId = g.roomId; endedText = '시간 초과로 전투가 종료되었습니다.';
    }
  });
  if (endedRoomId) await postYachaChatMessage(endedRoomId, null, endedText);
  return acted;
}
