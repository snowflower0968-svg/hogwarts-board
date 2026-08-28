import React, { useState } from 'react';
import { signIn, signUp } from '../lib/api';

export function LoginScreen({ onLoggedIn, goSignup }) {
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!id || !pw) { setError('아이디와 비밀번호를 입력하세요.'); return; }
    setBusy(true); setError('');
    try {
      const profile = await signIn(id, pw);
      onLoggedIn(profile);
    } catch (err) {
      setError(err.message || '로그인에 실패했습니다.');
    } finally { setBusy(false); }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo"><div className="title">호그와트 익명 게시판</div></div>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={submit}>
          <div className="field"><label>아이디</label><input value={id} onChange={(e) => setId(e.target.value)} placeholder="아이디 입력" /></div>
          <div className="field"><label>비밀번호</label><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="비밀번호 입력" /></div>
          <button className="btn-primary" type="submit" disabled={busy}>로그인</button>
        </form>
        <button className="btn-ghost" onClick={goSignup}>회원가입</button>
        <div className="auth-switch">가입 후 관리자 승인 필요</div>
      </div>
    </div>
  );
}

export function SignupScreen({ goLogin, onDone }) {
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!id || !pw || !pw2 || !name) { setError('모든 항목을 입력하세요.'); return; }
    if (id.length < 3) { setError('아이디는 3자 이상 입력하세요.'); return; }
    if (pw.length < 6) { setError('비밀번호는 6자 이상 입력하세요.'); return; }
    if (pw !== pw2) { setError('비밀번호가 일치하지 않습니다.'); return; }
    setBusy(true); setError('');
    try {
      await signUp(id, pw, name);
      onDone();
    } catch (err) {
      setError(err.message || '가입에 실패했습니다.');
    } finally { setBusy(false); }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo"><div className="title">회원가입</div></div>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={submit}>
          <div className="field"><label>아이디</label><input value={id} onChange={(e) => setId(e.target.value)} placeholder="사용할 아이디" /></div>
          <div className="field"><label>비밀번호</label><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="6자 이상" /></div>
          <div className="field"><label>비밀번호 확인</label><input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="비밀번호 재입력" /></div>
          <div className="field"><label>캐릭터 이름</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 해리 포터" /></div>
          <button className="btn-primary" type="submit" disabled={busy}>가입 신청하기</button>
        </form>
        <button className="btn-ghost" onClick={goLogin}>로그인으로 돌아가기</button>
      </div>
    </div>
  );
}

export function SignupDoneScreen({ goLogin }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card done-wrap">
        <div style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 8 }}>가입 신청 완료</div>
        <p>관리자 승인 후 로그인 가능합니다.</p>
        <button className="btn-primary" onClick={goLogin}>로그인 화면으로</button>
      </div>
    </div>
  );
}
