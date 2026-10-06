import React from 'react';
import { BOARDS } from '../lib/api';
import { fmtDateTime, notifText } from '../lib/helpers';
import { canViewBoard } from './Board';

const BELL_SVG = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const MENU_SVG = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

export function Header({ profile, view, setView, unreadCount, notifOpen, setNotifOpen, onLogout, onMobileMenu }) {
  return (
    <div className="header">
      <button className="mobile-menu-btn" onClick={onMobileMenu} aria-label="메뉴">{MENU_SVG}</button>
      <div className="logo" onClick={() => setView('board')}>호그와트 익명 게시판</div>
      <div className="header-spacer" />
      <div className="header-right">
        {profile.is_admin && <button className="text-btn" onClick={() => setView('admin')}>관리자</button>}
        <button className="bell-btn" onClick={() => setNotifOpen(!notifOpen)} title="알림">
          {BELL_SVG}
          {unreadCount > 0 && <span className="bell-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
        </button>
        <div className="char-chip" onClick={() => setView('mypage')}>
          {profile.character_name}
          {profile.is_admin ? <span className="admin-badge">ADMIN</span> : <span className="gcount">{profile.points}P</span>}
        </div>
        <button className="text-btn" onClick={onLogout}>로그아웃</button>
      </div>
    </div>
  );
}

export function NotifPanel({ notifications, onOpen, onClose, onReadAll }) {
  const unread = notifications.filter((n) => !n.read).length;
  return (
    <>
      <div className="notif-backdrop" onClick={onClose} />
      <div className="notif-panel">
        <div className="notif-panel-head">
          <span>알림</span>
          <button className="notif-readall" disabled={!unread} onClick={onReadAll}>전체 읽음</button>
        </div>
        <div>
          {notifications.length === 0 && <div className="empty-state" style={{ padding: '30px 10px' }}>알림이 없습니다.</div>}
          {notifications.map((n) => (
            <div key={n.id} className={`notif-row ${n.read ? 'read' : 'unread'}`} onClick={() => onOpen(n)}>
              <div className="notif-text">
                {notifText(n)}
                {n.preview && <span className="notif-preview"> · {n.preview}</span>}
              </div>
              <div className="notif-time">{fmtDateTime(n.created_at)}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function Sidebar({ profile, view, currentBoard, selectBoard, openMyPage, openPersonal, openGamble, openDig, openShop, openSettings, openAdmin, hasChatUnread, mobileOpen, closeMobile }) {
  const mainBoards = BOARDS.filter((b) => b.id !== 'anon' && canViewBoard(profile, b.id));
  const anonBoard = BOARDS.find((b) => b.id === 'anon');
  const renderBoard = (b) => {
    return (
      <div key={b.id} className={`sidebar-item ${view === 'board' && currentBoard === b.id ? 'active' : ''}`} onClick={() => { selectBoard(b.id); closeMobile(); }}>
        {b.name}
      </div>
    );
  };
  return (
    <div className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="sidebar-section">게시판</div>
      {mainBoards.map(renderBoard)}
      <div className="sidebar-divider" />
      {anonBoard && renderBoard(anonBoard)}
      <div className="sidebar-divider" />
      <div className={`sidebar-item ${view === 'mypage' ? 'active' : ''}`} onClick={() => { openMyPage(); closeMobile(); }}>
        마이페이지{hasChatUnread && <span className="dot-badge" />}
      </div>
      <div className={`sidebar-item ${view === 'personal' ? 'active' : ''}`} onClick={() => { openPersonal(); closeMobile(); }}>소지품</div>
      <div className={`sidebar-item ${view === 'gamble' ? 'active' : ''}`} onClick={() => { openGamble(); closeMobile(); }}>도박장</div>
      <div className={`sidebar-item ${view === 'dig' ? 'active' : ''}`} onClick={() => { openDig(); closeMobile(); }}>간이 조사</div>
      <div className={`sidebar-item ${view === 'shop' ? 'active' : ''}`} onClick={() => { openShop(); closeMobile(); }}>상점</div>
      <div className={`sidebar-item ${view === 'settings' ? 'active' : ''}`} onClick={() => { openSettings(); closeMobile(); }}>설정</div>
      {profile.is_admin && (
        <div className={`sidebar-item ${view === 'admin' ? 'active' : ''}`} onClick={() => { openAdmin(); closeMobile(); }}>관리자 페이지</div>
      )}
    </div>
  );
}
