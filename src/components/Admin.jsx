import React, { useState } from 'react';
import { SegTabs } from './Ui';
import { MembersSection } from './AdminMembers';
import { ContentSection } from './AdminContent';
import { DigAdmin, DigLogsAdmin, ItemLogsAdmin } from './AdminDig';
import { GambleAdmin, ChatAdmin } from './AdminLogs';
import { PointSettingsCard, GalleonRateCard, ShopAdmin } from './AdminShop';

// 관리자 화면: 위쪽 5개 구역 + 구역 안의 작은 탭
export default function Admin({ pendingUsers, allUsers, allPosts, allComments, refresh, actions, error }) {
  const [section, setSection] = useState('members');
  const [store, setStore] = useState('shop');
  const [logs, setLogs] = useState('gamble');

  return (
    <>
      <div className="board-title-bar"><h2>관리자</h2></div>
      {error && <div className="auth-error" style={{ margin: '12px 4px' }}>데이터 로딩 중 오류: {error}</div>}

      <SegTabs value={section} onChange={setSection} items={[
        { id: 'members', label: '회원', badge: pendingUsers.length || null },
        { id: 'content', label: '콘텐츠' },
        { id: 'store', label: '상점·조사' },
        { id: 'logs', label: '기록' },
        { id: 'settings', label: '설정' },
      ]} />

      {section === 'members' && <MembersSection pendingUsers={pendingUsers} allUsers={allUsers} actions={actions} refresh={refresh} />}
      {section === 'content' && <ContentSection allPosts={allPosts} allComments={allComments} actions={actions} />}

      {section === 'store' && (
        <>
          <SegTabs variant="sub" value={store} onChange={setStore} items={[{ id: 'shop', label: '상점' }, { id: 'dig', label: '간이 조사' }]} />
          {store === 'shop' ? <ShopAdmin /> : <DigAdmin />}
        </>
      )}

      {section === 'logs' && (
        <>
          <SegTabs variant="sub" value={logs} onChange={setLogs} items={[
            { id: 'gamble', label: '도박' }, { id: 'chat', label: '채팅' }, { id: 'dig', label: '조사' }, { id: 'items', label: '소지품·갈레온' },
          ]} />
          {logs === 'gamble' && <GambleAdmin />}
          {logs === 'chat' && <ChatAdmin />}
          {logs === 'dig' && <DigLogsAdmin />}
          {logs === 'items' && <ItemLogsAdmin />}
        </>
      )}

      {section === 'settings' && (
        <>
          <PointSettingsCard />
          <GalleonRateCard />
        </>
      )}
    </>
  );
}
