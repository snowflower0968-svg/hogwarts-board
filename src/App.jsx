import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as api from './lib/api';
import { playNotifSound } from './lib/helpers';

import { LoginScreen, SignupScreen, SignupDoneScreen } from './components/Auth';
import { Header, NotifPanel, Sidebar } from './components/Shell';
import Board from './components/Board';
import PostDetail from './components/PostDetail';
import MyPage from './components/MyPage';
import Gamble from './components/Gamble';
import Chat from './components/Chat';
import Settings from './components/Settings';
import Admin from './components/Admin';
import Toasts from './components/Toasts';
import { ComposeModal, ConfirmModal, GiftModal, IdentityModal } from './components/Modals';

export default function App() {
  const [profile, setProfile] = useState(null);
  const [authScreen, setAuthScreen] = useState('login');
  const [booted, setBooted] = useState(false);

  const [view, setView] = useState('board');
  const [currentBoard, setCurrentBoard] = useState('free');
  const [currentPostId, setCurrentPostId] = useState(null);
  const [currentChatId, setCurrentChatId] = useState(null);

  const [posts, setPosts] = useState([]);
  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [profilesById, setProfilesById] = useState({});

  const [myPosts, setMyPosts] = useState([]);
  const [myComments, setMyComments] = useState([]);
  const [myChats, setMyChats] = useState([]);

  const [adminData, setAdminData] = useState({ pendingUsers: [], allUsers: [], allPosts: [], allComments: [], gambleLogs: [], chatRooms: [] });

  const [chatRoom, setChatRoom] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);

  const [notifications, setNotifications] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toasts, setToasts] = useState([]);

  const [composeOpen, setComposeOpen] = useState(false);
  const [editingPost, setEditingPost] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [giftRoomId, setGiftRoomId] = useState(null);
  const [identityUserId, setIdentityUserId] = useState(null);

  // ---------------- boot / auth ----------------
  useEffect(() => {
    const unsub = api.onAuthBoot(async (user) => {
      unsub();
      if (user) {
        const p = await api.fetchOwnProfile(user.uid);
        if (p && p.approved && !p.rejected) setProfile(p);
        else await api.signOutUser();
      }
      setBooted(true);
    });
  }, []);

  useEffect(() => {
    if (profile) document.body.classList.toggle('dark', !!profile.dark_mode);
    else document.body.classList.remove('dark');
  }, [profile?.dark_mode, profile]);

  function pushToast(text) {
    const id = 't' + Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }
  function notifTextLocal(n) {
    if (n.type === 'admin_grant') {
      const amt = n.points || 0;
      let t = amt >= 0 ? `포인트 +${amt} 지급` : `포인트 ${amt} 차감`;
      if (n.message) t += ' · ' + n.message;
      return t;
    }
    if (n.type === 'gift') return `포인트 ${n.points || 0} 선물 도착`;
    if (n.type === 'comment_on_post') return '내 글에 댓글이 달렸습니다.';
    if (n.type === 'reply_to_comment') return '내 댓글에 답글이 달렸습니다.';
    return '알림';
  }

  // ---------------- notifications: realtime ----------------
  useEffect(() => {
    if (!profile) return;
    const unsub = api.subscribeNotifications(
      profile.id,
      (list) => setNotifications(list),
      (n) => { pushToast(notifTextLocal(n)); if (profile.sound_enabled) playNotifSound(); }
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  async function toggleNotifPanel() {
    const next = !notifOpen;
    setNotifOpen(next);
    if (next) {
      const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
      if (unreadIds.length) {
        await api.markNotificationsRead(unreadIds);
        setNotifications((prev) => prev.map((n) => (unreadIds.includes(n.id) ? { ...n, read: true } : n)));
      }
    }
  }
  function openNotif(n) {
    setNotifOpen(false);
    if ((n.type === 'comment_on_post' || n.type === 'reply_to_comment') && n.post_id) openPost(n.post_id);
    else if (n.type === 'gift' && n.room_id) openChatRoomById(n.room_id);
  }

  // ---------------- board list ----------------
  const loadPosts = useCallback(async (boardId) => {
    const p = await api.fetchPosts(boardId);
    setPosts(p);
  }, []);
  useEffect(() => {
    if (!profile || view !== 'board') return;
    loadPosts(currentBoard);
    const unsub = api.subscribePosts(currentBoard, () => loadPosts(currentBoard));
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, view, currentBoard]);

  // ---------------- post detail ----------------
  const loadPost = useCallback(async (id) => {
    const [p, c] = await Promise.all([api.fetchPost(id), api.fetchComments(id)]);
    setPost(p); setComments(c);
    if (p) {
      const ids = Array.from(new Set([p.author_id, ...c.map((x) => x.author_id)]));
      const map = await api.fetchProfilesByIds(ids);
      setProfilesById(map);
    }
  }, []);
  useEffect(() => {
    if (!profile || view !== 'post' || !currentPostId) return;
    loadPost(currentPostId);
    const unsub = api.subscribePost(currentPostId, () => loadPost(currentPostId));
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, view, currentPostId]);

  function openPost(id) { setCurrentPostId(id); setView('post'); }

  // ---------------- my page ----------------
  const loadMyPage = useCallback(async () => {
    if (!profile) return;
    const [p, c, ch] = await Promise.all([api.fetchMyPosts(profile.id), api.fetchMyComments(profile.id), api.fetchMyChats(profile.id)]);
    setMyPosts(p); setMyComments(c); setMyChats(ch);
  }, [profile]);
  useEffect(() => { if (profile && view === 'mypage') loadMyPage(); }, [profile, view, loadMyPage]);

  // ---------------- admin ----------------
  const [adminError, setAdminError] = useState('');
  const loadAdmin = useCallback(async () => {
    if (!profile?.is_admin) return;
    setAdminError('');
    const results = await Promise.allSettled([
      api.fetchAllUsers(), api.fetchAllPostsAdmin(), api.fetchAllCommentsAdmin(), api.fetchGambleLogsAdmin(), api.fetchAdminChatRooms(),
    ]);
    const [allR, postsR, commentsR, gamblesR, roomsR] = results;
    const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message || String(r.reason));
    if (errors.length) {
      console.error('관리자 데이터 로딩 실패:', results);
      setAdminError(errors.join(' / '));
    }
    const all = allR.status === 'fulfilled' ? allR.value : [];
    setAdminData({
      pendingUsers: all.filter((u) => !u.approved && !u.rejected),
      allUsers: all,
      allPosts: postsR.status === 'fulfilled' ? postsR.value : [],
      allComments: commentsR.status === 'fulfilled' ? commentsR.value : [],
      gambleLogs: gamblesR.status === 'fulfilled' ? gamblesR.value : [],
      chatRooms: roomsR.status === 'fulfilled' ? roomsR.value : [],
    });
  }, [profile]);
  useEffect(() => { if (profile?.is_admin && view === 'admin') loadAdmin(); }, [profile, view, loadAdmin]);

  // ---------------- chat ----------------
  const loadChat = useCallback(async (roomId) => {
    const [room, msgs] = await Promise.all([api.fetchChatRoom(roomId), api.fetchChatMessages(roomId)]);
    setChatRoom(room); setChatMessages(msgs);
    api.markChatRead(roomId);
  }, []);
  useEffect(() => {
    if (!profile || view !== 'chat' || !currentChatId) return;
    loadChat(currentChatId);
    const unsub = api.subscribeChat(currentChatId, () => loadChat(currentChatId));
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, view, currentChatId]);

  function openChatRoomById(id) { setCurrentChatId(id); setView('chat'); }
  async function openChatWith(postId, targetId) {
    const roomId = await api.openChatWith(postId, targetId);
    openChatRoomById(roomId);
  }

  // ---------------- generic refresh after mutations ----------------
  function refreshCurrentView() {
    if (view === 'board') loadPosts(currentBoard);
    if (view === 'post' && currentPostId) loadPost(currentPostId);
    if (view === 'mypage') loadMyPage();
    if (view === 'admin') loadAdmin();
  }

  // ---------------- auth actions ----------------
  async function handleLogout() {
    await api.signOutUser();
    setProfile(null); setView('board'); setNotifOpen(false);
  }

  // ---------------- board / post actions ----------------
  async function submitCompose(board, title, content) {
    if (editingPost) await api.updatePost(editingPost.id, board, title, content);
    else await api.createPost(board, title, content);
    setComposeOpen(false); setEditingPost(null);
    setCurrentBoard(board); setView('board'); setCurrentPostId(null);
    const p = await api.fetchOwnProfile(profile.id); setProfile(p);
    loadPosts(board);
  }
  async function doDeletePost(p) {
    await api.deletePost(p.id);
    const fresh = await api.fetchOwnProfile(profile.id); setProfile(fresh);
    setView('board'); setCurrentPostId(null);
    refreshCurrentView();
  }
  async function doDeleteComment(c) {
    await api.deleteComment(c.post_id, c.id);
    const fresh = await api.fetchOwnProfile(profile.id); setProfile(fresh);
    refreshCurrentView();
  }

  // ---------------- confirm modal dispatch ----------------
  function askConfirm(message, onConfirm, danger = true) { setConfirmState({ message, onConfirm, danger }); }

  // ---------------- render ----------------
  if (!booted) return <div className="auth-wrap"><div className="auth-card" style={{ textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>불러오는 중</div></div>;

  if (!profile) {
    if (authScreen === 'signup') return <SignupScreen goLogin={() => setAuthScreen('login')} onDone={() => setAuthScreen('signup-done')} />;
    if (authScreen === 'signup-done') return <SignupDoneScreen goLogin={() => setAuthScreen('login')} />;
    return <LoginScreen goSignup={() => setAuthScreen('signup')} onLoggedIn={(p) => { setProfile(p); setAuthScreen('login'); }} />;
  }

  const hasChatUnread = myChats.some((r) => (r.chat_messages || []).some((m) => m.sender_id !== profile.id &&
    new Date(m.created_at).getTime() > new Date((r.chat_reads || []).find((x) => x.user_id === profile.id)?.last_read_at || 0).getTime()));

  return (
    <>
      <Header profile={profile} view={view} setView={setView} unreadCount={unreadCount}
        notifOpen={notifOpen} setNotifOpen={toggleNotifPanel} onLogout={() => askConfirm('로그아웃', handleLogout, false)}
        onMobileMenu={() => setMobileNavOpen((v) => !v)} />
      <div className="layout">
        <Sidebar profile={profile} view={view} currentBoard={currentBoard}
          selectBoard={(id) => { setCurrentBoard(id); setView('board'); }}
          openMyPage={() => setView('mypage')} openGamble={() => setView('gamble')}
          openSettings={() => setView('settings')} openAdmin={() => setView('admin')}
          hasChatUnread={hasChatUnread} mobileOpen={mobileNavOpen} closeMobile={() => setMobileNavOpen(false)} />
        <div className={`sidebar-backdrop ${mobileNavOpen ? 'show' : ''}`} onClick={() => setMobileNavOpen(false)} />
        <div className="main"><div className="main-inner">

          {view === 'board' && <Board profile={profile} boardId={currentBoard} posts={posts} openPost={openPost} />}

          {view === 'post' && (
            <PostDetail
              profile={profile} profilesById={profilesById} post={post} comments={comments}
              onBack={() => { setView('board'); setCurrentPostId(null); }}
              onLike={async () => { await api.toggleLike(post.id); loadPost(post.id); }}
              onDelete={() => askConfirm('이 글을 삭제할까? 댓글도 함께 삭제돼.', () => doDeletePost(post))}
              onEdit={() => { setEditingPost(post); setComposeOpen(true); }}
              onTogglePinned={async () => { await api.togglePinned(post.id); loadPost(post.id); }}
              onOpenChat={(postId, authorId) => openChatWith(postId, authorId)}
              onOpenIdentity={(id) => setIdentityUserId(id)}
              onSubmitComment={async (text, parentId) => { await api.addComment(post.id, parentId, text); const fresh = await api.fetchOwnProfile(profile.id); setProfile(fresh); loadPost(post.id); }}
              onDeleteComment={(id) => askConfirm('이 댓글을 삭제할까?', () => doDeleteComment({ id, post_id: post.id }))}
            />
          )}

          {view === 'mypage' && (
            <MyPage profile={profile} posts={myPosts} comments={myComments} chats={myChats}
              openPost={openPost}
              onEditPost={(p) => { setEditingPost(p); setComposeOpen(true); }}
              onDeletePost={(p) => askConfirm('이 글을 삭제할까?', () => doDeletePost(p))}
              onDeleteComment={(c) => askConfirm('이 댓글을 삭제할까?', () => doDeleteComment(c))}
              onOpenChatRoom={openChatRoomById}
            />
          )}

          {view === 'gamble' && (
            <Gamble profile={profile} onSpin={async (bet) => {
              const r = await api.spinGamble(bet);
              const fresh = await api.fetchOwnProfile(profile.id); setProfile(fresh);
              return r;
            }} />
          )}

          {view === 'chat' && (
            <Chat profile={profile} room={chatRoom} messages={chatMessages}
              onBack={() => { setView('mypage'); setCurrentChatId(null); }}
              onSend={async (text) => { await api.sendChatMessage(chatRoom.id, text); loadChat(chatRoom.id); }}
              onOpenGift={() => setGiftRoomId(chatRoom.id)}
              onAccept={async (msgId) => { await api.acceptGift(chatRoom.id, msgId); const fresh = await api.fetchOwnProfile(profile.id); setProfile(fresh); loadChat(chatRoom.id); }}
              onCancel={async (msgId) => { await api.cancelGift(chatRoom.id, msgId); const fresh = await api.fetchOwnProfile(profile.id); setProfile(fresh); loadChat(chatRoom.id); }}
            />
          )}

          {view === 'settings' && <Settings profile={profile} onProfileChange={setProfile} />}

          {view === 'admin' && profile.is_admin && (
            <Admin
              pendingUsers={adminData.pendingUsers} allUsers={adminData.allUsers} allPosts={adminData.allPosts}
              allComments={adminData.allComments} gambleLogs={adminData.gambleLogs} chatRooms={adminData.chatRooms}
              refresh={loadAdmin} error={adminError}
              actions={{
                selfId: profile.id,
                approve: async (id) => { await api.approveUser(id); loadAdmin(); },
                reject: async (id) => askConfirm('가입을 거절할까? 신청 기록은 남지만 로그인은 막혀.', async () => { await api.rejectUser(id); loadAdmin(); }),
                setHouse: async (id, house) => { await api.setUserHouse(id, house); loadAdmin(); },
                toggleAdmin: (u) => askConfirm(`${u.character_name}에게 관리자 권한을 ${u.is_admin ? '해제' : '지급'}할까?`, async () => { await api.toggleAdminRole(u.id); loadAdmin(); }),
                grantPoints: async (id, amount, message) => { await api.grantPoints(id, amount, message); loadAdmin(); },
                openPost,
                togglePinned: async (id) => { await api.togglePinned(id); loadAdmin(); },
                deletePost: (p) => askConfirm('이 글을 삭제할까?', async () => { await api.deletePost(p.id); loadAdmin(); }),
                deleteComment: (c) => askConfirm('이 댓글을 삭제할까?', async () => { await api.deleteComment(c.post_id, c.id); loadAdmin(); }),
              }}
            />
          )}

        </div></div>
      </div>

      {(view === 'board' || view === 'post') && (
        <button className="fab" onClick={() => { setEditingPost(null); setComposeOpen(true); }} title="글쓰기">+</button>
      )}

      {view === 'post' && post && (
        <CommentInputBar onSubmit={async (text) => { await api.addComment(post.id, null, text); const fresh = await api.fetchOwnProfile(profile.id); setProfile(fresh); loadPost(post.id); }} />
      )}

      {composeOpen && (
        <ComposeModal profile={profile} editingPost={editingPost} defaultBoard={currentBoard}
          onCancel={() => { setComposeOpen(false); setEditingPost(null); }} onSubmit={submitCompose} />
      )}
      {giftRoomId && (
        <GiftModal balance={profile.points} onCancel={() => setGiftRoomId(null)}
          onSend={async (amt) => { await api.sendGift(giftRoomId, amt); const fresh = await api.fetchOwnProfile(profile.id); setProfile(fresh); setGiftRoomId(null); loadChat(giftRoomId); }} />
      )}
      {identityUserId && (
        <IdentityModal userId={identityUserId} onClose={() => setIdentityUserId(null)} onOpenPost={openPost} />
      )}
      {confirmState && (
        <ConfirmModal message={confirmState.message} danger={confirmState.danger}
          onCancel={() => setConfirmState(null)}
          onConfirm={async () => { const fn = confirmState.onConfirm; setConfirmState(null); await fn(); }} />
      )}
      {notifOpen && <NotifPanel notifications={notifications} onOpen={openNotif} onClose={() => setNotifOpen(false)} />}
      <Toasts toasts={toasts} />
    </>
  );
}

function CommentInputBar({ onSubmit }) {
  const [text, setText] = useState('');
  const taRef = useRef(null);

  function autoGrow(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }

  function submit() {
    if (!text.trim()) return;
    onSubmit(text.trim());
    setText('');
    requestAnimationFrame(() => autoGrow(taRef.current));
  }

  return (
    <div className="bottom-input-bar">
      <form className="inner" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          onChange={(e) => { setText(e.target.value); autoGrow(e.target); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="댓글 남기기 (Shift+Enter로 줄바꿈)"
        />
        <button type="submit">등록</button>
      </form>
    </div>
  );
}
