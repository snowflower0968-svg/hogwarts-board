import React, { useState } from 'react';

export default function Gamble({ profile, onSpin, onVoid }) {
  const [bet, setBet] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [askVoid, setAskVoid] = useState(false);
  const blocked = profile.points < 0;
  const hasVoid = (profile.gamble_void || 0) >= 1;

  async function submit(e) {
    e.preventDefault();
    const amt = parseInt(bet, 10);
    if (!amt || amt <= 0) { setError('베팅할 포인트를 입력하세요.'); return; }
    if (amt > profile.points) { setError('보유 포인트보다 많이 베팅할 수 없습니다.'); return; }
    setBusy(true); setError('');
    try {
      const r = await onSpin(amt);
      setResult({ m: r.multiplier, bet: amt, delta: r.result_delta, logId: r.log_id, voided: false });
      setBet('');
      setAskVoid(true); // 도박 직후: 무효권이 있으면 바로 물어봄 (없으면 아래에서 아무것도 안 뜸)
    } catch (err) { setError(err.message || '오류가 발생했습니다.'); }
    finally { setBusy(false); }
  }

  async function useVoid() {
    setAskVoid(false);
    setBusy(true); setError('');
    try {
      const r = await onVoid(result.logId);
      setResult((prev) => ({ ...prev, voided: true, refund: r.refund, balance: r.balance }));
    } catch (err) { setError(err.message || '오류가 발생했습니다.'); }
    finally { setBusy(false); }
  }

  const canVoid = result && !result.voided && hasVoid;

  return (
    <>
      <div className="board-title-bar"><h2>도박장</h2></div>
      <div className="gamble-balance">
        <div className={`g-num ${profile.points < 0 ? 'neg' : ''}`}>{profile.points}P</div>
        <div className="g-lbl">보유 포인트{hasVoid ? ' · 도박 무효권 1장' : ''}</div>
      </div>
      {error && <div className="auth-error" style={{ margin: '0 4px 10px' }}>{error}</div>}
      {blocked && <div className="auth-error" style={{ margin: '0 4px 10px' }}>포인트가 부족하여 이용할 수 없습니다.</div>}
      <form className="gamble-form" onSubmit={submit}>
        <input type="number" min="1" value={bet} onChange={(e) => setBet(e.target.value)} placeholder="베팅 포인트" disabled={blocked || busy} />
        <button type="submit" disabled={blocked || busy}>베팅</button>
      </form>
      {result && (
        <div className={`gamble-result ${result.voided ? '' : result.delta >= 0 ? 'win' : 'lose'}`}>
          {result.voided ? (
            <>
              <div className="g-mult" style={{ textDecoration: 'line-through' }}>x{result.m}</div>
              <div>무효 처리되었어요. 포인트가 도박 전으로 돌아왔어요. ({result.balance}P)</div>
            </>
          ) : (
            <>
              <div className="g-mult">x{result.m}</div>
              <div>베팅 {result.bet}P → {result.delta >= 0 ? '+' : ''}{result.delta}P</div>
              {canVoid && <button type="button" className="void-btn" onClick={() => setAskVoid(true)}>도박 무효권 사용</button>}
            </>
          )}
        </div>
      )}

      {askVoid && canVoid && (
        <div className="modal-overlay">
          <div className="modal-card small">
            <div className="confirm-msg">도박 무효권을 사용하시겠습니까?<br /><span style={{ fontSize: 12, color: 'var(--text-light)' }}>방금 한 도박(x{result.m}, {result.delta >= 0 ? '+' : ''}{result.delta}P)이 없던 일이 돼요.<br />도박 직후에만 사용할 수 있어요.</span></div>
            <div className="modal-actions">
              <button className="modal-cancel" onClick={() => setAskVoid(false)}>사용 안 함</button>
              <button className="modal-confirm" onClick={useVoid}>사용</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
