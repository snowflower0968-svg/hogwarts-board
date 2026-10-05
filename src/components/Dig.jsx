import React, { useEffect, useState } from 'react';
import { subscribeDigPublic, digCell, chargeState, DIG_INTERVAL_MS, DIG_MAX_CHARGES } from '../lib/api';
import { fmtDuration } from '../lib/helpers';

export default function Dig({ profile, onDug }) {
  const [pub, setPub] = useState(undefined); // undefined: 불러오는 중, null: 아직 시작 안 됨
  const [now, setNow] = useState(Date.now());
  const [confirmIdx, setConfirmIdx] = useState(null);
  const [info, setInfo] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeDigPublic(setPub), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const st = chargeState(profile.dig_charges, profile.dig_charge_at, profile.created_at, now);
  const remaining = st.full ? 0 : st.at + DIG_INTERVAL_MS - now;
  const bonus = profile.dig_bonus || 0;
  const available = st.charges + bonus;

  async function doDig() {
    const idx = confirmIdx;
    setConfirmIdx(null);
    setBusy(true); setError('');
    try {
      const r = await digCell(idx);
      setResult(r);
      await onDug();
    } catch (e) {
      setError(e.message || '오류가 발생했습니다.');
    } finally { setBusy(false); }
  }

  function clickCell(c, i) {
    if (busy) return;
    setError('');
    if (c.dug) {
      setInfo({ title: c.empty ? `${c.name} (꽝)` : c.name, description: c.description });
      return;
    }
    if (available < 1) { setError('조사 가능 횟수가 없습니다. 다음 충전을 기다리거나 상점에서 조사권을 구매하세요.'); return; }
    setConfirmIdx(i);
  }

  return (
    <>
      <div className="board-title-bar"><h2>간이 조사</h2></div>

      <div className="dig-status">
        <div className="dig-charges">
          <span className="dig-charge-num">{st.charges}</span>
          <span className="dig-charge-max"> / {DIG_MAX_CHARGES}</span>
          <div className="dig-charge-lbl">충전 횟수</div>
        </div>
        <div className="dig-timer">
          {st.full ? '충전 완료 (최대)' : <>다음 충전까지 <b>{fmtDuration(remaining)}</b></>}
          <div style={{ marginTop: 4 }}>구매·선물 조사권 <b>{bonus}</b>장</div>
        </div>
      </div>
      <div className="dig-note">2시간마다 1회 충전되고, 최대 3회까지 모입니다. 조사권(상점 구매·선물)은 충전분을 다 쓴 뒤 사용되고 개수 제한이 없어요. 칸은 모든 캐릭터가 함께 쓰는 공용 판입니다.</div>

      {error && <div className="auth-error" style={{ margin: '0 4px 10px' }}>{error}</div>}

      {pub === undefined && <div className="empty-state">불러오는 중</div>}
      {pub === null && <div className="empty-state">아직 간이 조사가 열리지 않았습니다.</div>}
      {pub && (
        <>
          <div className="dig-meta">{pub.round || 1}번째 판 · 남은 칸 {pub.cells.filter((c) => !c.dug).length}/{pub.cells.length}</div>
          <div className="dig-grid">
            {pub.cells.map((c, i) => (
              <button
                key={i}
                type="button"
                className={`dig-cell ${c.dug ? (c.empty ? 'dug empty' : 'dug') : ''}`}
                onClick={() => clickCell(c, i)}
                disabled={busy}
              >
                {c.dug ? c.name : ''}
              </button>
            ))}
          </div>
        </>
      )}

      {confirmIdx !== null && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setConfirmIdx(null)}>
          <div className="modal-card small">
            <div className="confirm-msg">이 칸을 조사할까요?<br />조사 횟수가 1회 사용됩니다.</div>
            <div className="modal-actions">
              <button className="modal-cancel" onClick={() => setConfirmIdx(null)}>취소</button>
              <button className="modal-confirm" onClick={doDig}>조사</button>
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setResult(null)}>
          <div className="modal-card small">
            <div className="dig-result-title">{result.empty ? '아무것도 없었습니다' : '발견!'}</div>
            <div className="dig-result-name">{result.name}</div>
            {result.description && <div className="item-desc" style={{ textAlign: 'left' }}>{result.description}</div>}
            {!result.empty && <div className="dig-result-sub">소지품에 추가되었습니다.</div>}
            {result.reset && <div className="dig-result-sub">모든 칸이 조사되어 새 판으로 바뀌었습니다.</div>}
            <div className="modal-actions"><button className="modal-confirm" onClick={() => setResult(null)}>확인</button></div>
          </div>
        </div>
      )}

      {info && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setInfo(null)}>
          <div className="modal-card small">
            <div className="dig-result-name">{info.title}</div>
            <div className="item-desc" style={{ textAlign: 'left' }}>{info.description ? info.description : '입력된 효과가 없습니다.'}</div>
            <div className="modal-actions"><button className="modal-cancel" onClick={() => setInfo(null)}>닫기</button></div>
          </div>
        </div>
      )}
    </>
  );
}
