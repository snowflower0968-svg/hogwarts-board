import React, { useState } from 'react';
import { changeLoginId, changePassword, updateSettings } from '../lib/api';

export default function Settings({ profile, onProfileChange }) {
  const [idErr, setIdErr] = useState(''); const [idOk, setIdOk] = useState('');
  const [pwErr, setPwErr] = useState(''); const [pwOk, setPwOk] = useState('');
  const [newId, setNewId] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');

  async function toggleSound() {
    const next = !profile.sound_enabled;
    await updateSettings({ sound_enabled: next });
    onProfileChange({ ...profile, sound_enabled: next });
  }
  async function toggleDark() {
    const next = !profile.dark_mode;
    await updateSettings({ dark_mode: next });
    onProfileChange({ ...profile, dark_mode: next });
  }
  async function submitId(e) {
    e.preventDefault();
    setIdOk('');
    if (newId.trim().length < 3) { setIdErr('아이디는 3자 이상 입력하세요.'); return; }
    try {
      await changeLoginId(newId.trim());
      onProfileChange({ ...profile, login_id: newId.trim() });
      setIdErr(''); setIdOk('아이디가 변경되었습니다.'); setNewId('');
    } catch (err) { setIdErr(err.message?.includes('duplicate') ? '이미 사용 중인 아이디입니다.' : (err.message || '변경에 실패했습니다.')); }
  }
  async function submitPw(e) {
    e.preventDefault();
    setPwOk('');
    if (newPw.length < 6) { setPwErr('새 비밀번호는 6자 이상 입력하세요.'); return; }
    if (newPw !== newPw2) { setPwErr('새 비밀번호가 일치하지 않습니다.'); return; }
    try {
      await changePassword(newPw);
      setPwErr(''); setPwOk('비밀번호가 변경되었습니다.');
      setNewPw(''); setNewPw2('');
    } catch (err) { setPwErr(err.message || '변경에 실패했습니다.'); }
  }

  return (
    <>
      <div className="board-title-bar"><h2>설정</h2></div>
      <div className="list-row">
        <div className="row-top"><span className="row-title" style={{ cursor: 'default' }}>알림음</span>
          <button className="text-btn" onClick={toggleSound}>{profile.sound_enabled ? '켜짐' : '꺼짐'}</button></div>
      </div>
      <div className="list-row">
        <div className="row-top"><span className="row-title" style={{ cursor: 'default' }}>다크모드</span>
          <button className="text-btn" onClick={toggleDark}>{profile.dark_mode ? '켜짐' : '꺼짐'}</button></div>
      </div>

      <div className="field-label">아이디 변경</div>
      {idErr && <div className="auth-error">{idErr}</div>}
      {idOk && <div className="auth-success">{idOk}</div>}
      <form onSubmit={submitId} style={{ padding: '0 4px' }}>
        <div className="field"><input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="새 아이디" /></div>
        <button className="btn-primary" type="submit">아이디 변경</button>
      </form>

      <div className="field-label">비밀번호 변경</div>
      {pwErr && <div className="auth-error">{pwErr}</div>}
      {pwOk && <div className="auth-success">{pwOk}</div>}
      <form onSubmit={submitPw} style={{ padding: '0 4px 30px' }}>
        <div className="field"><input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="새 비밀번호" /></div>
        <div className="field"><input type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} placeholder="새 비밀번호 확인" /></div>
        <button className="btn-primary" type="submit">비밀번호 변경</button>
      </form>
    </>
  );
}
