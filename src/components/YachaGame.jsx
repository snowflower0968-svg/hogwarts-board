import React, { useEffect, useState } from 'react';
import {
  rpsLabel, acceptYacha, declineYacha, setYachaBet, confirmYachaBet,
  chooseYacha, agreeYachaNextRound, declineYachaNextRound,
  checkYachaTimeout, fetchItemsOf,
} from '../lib/api';

const RPS_CHOICES = [
  { id: 'rock', label: '바위' },
  { id: 'scissors', label: '가위' },
  { id: 'paper', label: '보' },
];

function BetEditor({ myBet, items, onChange, onConfirm, confirmed, disabled, err }) {
  const [points, setPoints] = useState(String(myBet?.points || ''));
  const [picked, setPicked] = useState(myBet?.items || []);
  const [pickId, setPickId] = useState('');
  const [pickQty, setPickQty] = useState('1');
  function addItem() {
    const it = items.find((i) => i.id === pickId);
    if (!it) return;
    const q = Math.max(1, Math.min(it.qty, parseInt(pickQty, 10) || 1));
    const next = [...picked.filter((p) => p.id !== it.id), { id: it.id, name: it.name, description: it.description, qty: q }];
    setPicked(next); onChange(points, next);
    setPickId(''); setPickQty('1');
  }
  function removeItem(id) { const next = picked.filter((p) => p.id !== id); setPicked(next); onChange(points, next); }
  return (
    <div className="yacha-bet-editor">
      <div className="yacha-field-row">
        <label>걸 포인트</label>
        <input className="txt-input" type="number" min="0" value={points} disabled={confirmed || disabled}
          onChange={(e) => { setPoints(e.target.value); onChange(e.target.value, picked); }} placeholder="0" />
      </div>
      {!confirmed && !disabled && items.length > 0 && (
        <div className="yacha-field-row">
          <select value={pickId} onChange={(e) => setPickId(e.target.value)}>
            <option value="">소지품 추가</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name} (보유 {i.qty})</option>)}
          </select>
          <input className="txt-input" type="number" min="1" value={pickQty} onChange={(e) => setPickQty(e.target.value)} style={{ width: 56 }} />
          <button type="button" className="a-btn" onClick={addItem}>추가</button>
        </div>
      )}
      {picked.length > 0 && (
        <div className="yacha-bet-items">
          {picked.map((p) => (
            <span key={p.id} className="yacha-bet-chip">{p.name} x{p.qty}{!confirmed && !disabled && <button type="button" onClick={() => removeItem(p.id)}>×</button>}</span>
          ))}
        </div>
      )}
      {err && <div className="auth-error" style={{ marginTop: 6 }}>{err}</div>}
      {!confirmed && !disabled && <button className="a-btn accent big" style={{ width: '100%', marginTop: 10 }} onClick={onConfirm}>베팅 확정</button>}
      {confirmed && <div className="yacha-note ok">확정됨 — 상대를 기다리는 중</div>}
    </div>
  );
}

export default function YachaGame({ profile, room, game, onRefresh }) {
  const [items, setItems] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const me = profile.id;
  const other = room ? (room.user_a === me ? room.user_b : room.user_a) : null;

  useEffect(() => {
    if (game?.status === 'betting') fetchItemsOf(me).then(setItems).catch(() => setItems([]));
  }, [game?.status, game?.id, me]);

  useEffect(() => {
    if (!game || !['pending', 'betting', 'choosing', 'result'].includes(game.status)) return undefined;
    const t = setInterval(() => { checkYachaTimeout(game.id).then((acted) => { if (acted) onRefresh(); }).catch(() => {}); }, 15000);
    return () => clearInterval(t);
  }, [game, onRefresh]);

  if (!game) return null;

  async function run(fn) {
    setErr(''); setBusy(true);
    try { await fn(); await onRefresh(); } catch (e) { setErr(e.message || '오류가 발생했습니다.'); }
    finally { setBusy(false); }
  }

  if (['declined', 'ended', 'cancelled'].includes(game.status)) {
    const winsA = game.wins?.[game.user_a] || 0; const winsB = game.wins?.[game.user_b] || 0;
    const myWins = game.user_a === me ? winsA : winsB;
    const oppWins = game.user_a === me ? winsB : winsA;
    const potTotal = (game.pot?.points?.[game.user_a] || 0) + (game.pot?.points?.[game.user_b] || 0);
    const played = game.status !== 'declined' && (winsA + winsB > 0 || potTotal > 0);
    return (
      <div className="yacha-panel yacha-ended">
        <div className="yacha-title">야차 종료</div>
        {played && <div className="yacha-note">나 {myWins}승 · 상대 {oppWins}승</div>}
        {played && potTotal > 0 && (
          myWins === oppWins
            ? <div className="yacha-note">동률로 각자 건 것을 돌려받았습니다.</div>
            : <div className="yacha-note">{myWins > oppWins ? `금고(${potTotal}P)를 모두 가져왔습니다.` : '금고를 모두 상대에게 넘겼습니다.'}</div>
        )}
      </div>
    );
  }

  if (game.status === 'pending') {
    const iRequested = game.requested_by === me;
    return (
      <div className="yacha-panel">
        <div className="yacha-title">야차 신청</div>
        {err && <div className="auth-error">{err}</div>}
        {iRequested ? (
          <>
            <div className="yacha-note">상대의 수락을 기다리는 중입니다.</div>
            <button className="a-btn" disabled={busy} onClick={() => run(() => declineYacha(game.id))}>신청 취소</button>
          </>
        ) : (
          <>
            <div className="yacha-note">상대가 야차를 신청했습니다.</div>
            <div className="modal-actions">
              <button className="modal-cancel" disabled={busy} onClick={() => run(() => declineYacha(game.id))}>거절</button>
              <button className="modal-confirm" disabled={busy} onClick={() => run(() => acceptYacha(game.id))}>수락</button>
            </div>
          </>
        )}
      </div>
    );
  }

  if (game.status === 'betting') {
    const myBet = game.bets[me];
    const oppBet = game.bets[other];
    const potTotal = (game.pot?.points?.[game.user_a] || 0) + (game.pot?.points?.[game.user_b] || 0);
    return (
      <div className="yacha-panel">
        <div className="yacha-title">야차 · {game.round}라운드 베팅</div>
        {potTotal > 0 && <div className="yacha-note">현재 금고 {potTotal}P (이번 라운드 베팅은 확정 후 추가로 쌓여요)</div>}
        {err && <div className="auth-error">{err}</div>}
        <div className="yacha-bet-cols">
          <div>
            <div className="yacha-col-label">내 베팅</div>
            <BetEditor myBet={myBet} items={items} confirmed={!!myBet?.confirmed} disabled={busy}
              onChange={(p, its) => setYachaBet(game.id, p, its).catch((e) => setErr(e.message))}
              onConfirm={() => run(() => confirmYachaBet(game.id))} err={null} />
          </div>
          <div>
            <div className="yacha-col-label">상대 베팅</div>
            {oppBet ? (
              <div className="yacha-opp-bet">
                {oppBet.points > 0 && <div>{oppBet.points}P</div>}
                {(oppBet.items || []).map((it) => <div key={it.id}>{it.name} x{it.qty}</div>)}
                <div className="yacha-note ok">{oppBet.confirmed ? '확정됨' : '입력 중'}</div>
              </div>
            ) : <div className="yacha-note">아직 입력하지 않았습니다.</div>}
          </div>
        </div>
      </div>
    );
  }

  if (game.status === 'choosing') {
    const picked = !!game.choices[me];
    const oppPicked = !!game.choices[other];
    return (
      <div className="yacha-panel">
        <div className="yacha-title">야차 · {game.round}라운드</div>
        {err && <div className="auth-error">{err}</div>}
        {picked ? (
          <div className="yacha-note">냈습니다. {oppPicked ? '곧 결과가 나와요.' : '상대가 낼 때까지 기다리는 중'}</div>
        ) : (
          <>
            <div className="yacha-note">가위바위보 중 하나를 고르세요.</div>
            <div className="yacha-rps-row">
              {RPS_CHOICES.map((c) => (
                <button key={c.id} type="button" className="yacha-rps-btn" disabled={busy} onClick={() => run(() => chooseYacha(game.id, c.id))}>
                  {c.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  if (game.status === 'result') {
    const { result } = game;
    const myChoice = game.user_a === me ? result.choiceA : result.choiceB;
    const oppChoice = game.user_a === me ? result.choiceB : result.choiceA;
    const iWon = result.winner === me; const draw = !result.winner;
    const agreedMe = !!game.next_round_agree[me]; const agreedOther = !!game.next_round_agree[other];
    const maxed = game.round >= game.max_rounds;
    const winsA = game.wins?.[game.user_a] || 0; const winsB = game.wins?.[game.user_b] || 0;
    const myWins = game.user_a === me ? winsA : winsB;
    const oppWins = game.user_a === me ? winsB : winsA;
    return (
      <div className="yacha-panel">
        <div className="yacha-title">{game.round}라운드 결과</div>
        {err && <div className="auth-error">{err}</div>}
        <div className="yacha-result-big">{draw ? '비김' : iWon ? '승리!' : '패배'}</div>
        <div className="yacha-note">나: {rpsLabel(myChoice)} · 상대: {rpsLabel(oppChoice)}</div>
        <div className="yacha-note">나 {myWins}승 · 상대 {oppWins}승</div>
        {maxed ? (
          <button className="a-btn accent big" style={{ marginTop: 10, width: '100%' }} disabled={busy} onClick={() => run(() => declineYachaNextRound(game.id))}>종료 (최대 3라운드)</button>
        ) : (
          <div className="modal-actions">
            <button className="modal-cancel" disabled={busy || agreedMe} onClick={() => run(() => declineYachaNextRound(game.id))}>종료</button>
            <button className="modal-confirm" disabled={busy || agreedMe} onClick={() => run(() => agreeYachaNextRound(game.id))}>
              {agreedMe ? '상대 응답 대기 중' : '계속하기'}
            </button>
          </div>
        )}
        {agreedOther && !agreedMe && <div className="yacha-note">상대가 계속하기에 동의했습니다.</div>}
      </div>
    );
  }
  return null;
}
