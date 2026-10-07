import React, { useCallback, useEffect, useState } from 'react';
import { fetchLastGamble, voidGamble } from '../lib/api';
import { ConfirmModal } from './Modals';

// 도박 무효권: 계속 화면에 떠 있고, 눌러서 가장 최근 도박을 없던 일로 되돌림
// (화면을 껐다 켜도, 다음 도박을 하기 전까지는 사용 가능)
export default function VoidTicketCard({ profile, refreshKey = 0, onChanged, onVoided }) {
  const hold = (profile.gamble_void || 0) >= 1;
  const [last, setLast] = useState(undefined);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { setLast(await fetchLastGamble()); } catch (e) { setLast(null); }
  }, []);
  useEffect(() => { setDone(false); if (hold) load(); }, [hold, refreshKey, load]);

  async function use() {
    setAsk(false); setBusy(true); setErr('');
    try {
      await voidGamble(last.id);
      setDone(true);
      if (onVoided) onVoided(last.id);
      if (onChanged) await onChanged();
      await load();
    } catch (e) { setErr(e.message || '오류가 발생했습니다.'); }
    finally { setBusy(false); }
  }

  if (!hold && !done) return null;
  const usable = hold && last && !last.voided;

  return (
    <div className="void-card">
      <div className="void-head">
        <b>도박 무효권</b>
        {hold && <span className="a-pill">보유 중</span>}
      </div>
      {done && <div className="auth-success" style={{ margin: '8px 0 0' }}>무효 처리되었습니다.</div>}
      {err && <div className="auth-error" style={{ margin: '8px 0 0' }}>{err}</div>}
      {hold && (
        <>
          {last === undefined && <div className="void-sub">불러오는 중</div>}
          {last !== undefined && usable && (
            <div className="void-sub">마지막 도박 · x{last.multiplier} · 베팅 {last.bet}P → {last.result_delta >= 0 ? '+' : ''}{last.result_delta}P</div>
          )}
          {last !== undefined && !usable && <div className="void-sub">되돌릴 수 있는 도박 기록이 없습니다.</div>}
          <button type="button" className="void-btn" disabled={!usable || busy} onClick={() => setAsk(true)}>도박 무효권 사용</button>
        </>
      )}
      {ask && usable && (
        <ConfirmModal
          message={`도박 무효권을 사용하시겠습니까?\n마지막 도박(x${last.multiplier}, ${last.result_delta >= 0 ? '+' : ''}${last.result_delta}P)이 없던 일이 됩니다.`}
          danger={false} cancelLabel="취소" confirmLabel="사용"
          onCancel={() => setAsk(false)} onConfirm={use} />
      )}
    </div>
  );
}
