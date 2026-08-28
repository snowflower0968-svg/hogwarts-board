import React, { useState } from 'react';

export default function Gamble({ profile, onSpin }) {
  const [bet, setBet] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const blocked = profile.points < 0;

  async function submit(e) {
    e.preventDefault();
    const amt = parseInt(bet, 10);
    if (!amt || amt <= 0) { setError('베팅할 포인트를 입력하세요.'); return; }
    if (amt > profile.points) { setError('보유 포인트보다 많이 베팅할 수 없습니다.'); return; }
    setBusy(true); setError('');
    try {
      const r = await onSpin(amt);
      setResult({ m: r.multiplier, bet: amt, delta: r.result_delta });
      setBet('');
    } catch (err) { setError(err.message || '오류가 발생했습니다.'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="board-title-bar"><h2>도박장</h2></div>
      <div className="gamble-balance">
        <div className={`g-num ${profile.points < 0 ? 'neg' : ''}`}>{profile.points}P</div>
        <div className="g-lbl">보유 포인트</div>
      </div>
      {error && <div className="auth-error" style={{ margin: '0 4px 10px' }}>{error}</div>}
      {blocked && <div className="auth-error" style={{ margin: '0 4px 10px' }}>포인트가 부족하여 이용할 수 없습니다.</div>}
      <form className="gamble-form" onSubmit={submit}>
        <input type="number" min="1" value={bet} onChange={(e) => setBet(e.target.value)} placeholder="베팅 포인트" disabled={blocked || busy} />
        <button type="submit" disabled={blocked || busy}>베팅</button>
      </form>
      {result && (
        <div className={`gamble-result ${result.delta >= 0 ? 'win' : 'lose'}`}>
          <div className="g-mult">x{result.m}</div>
          <div>베팅 {result.bet}P → {result.delta >= 0 ? '+' : ''}{result.delta}P</div>
        </div>
      )}
    </>
  );
}
