import React, { useEffect, useState } from 'react';
import {
  tarotCard, acceptYacha, declineYacha, setYachaBet, confirmYachaBet,
  hitYacha, standYacha, resolveYachaDeath, agreeYachaNextRound, declineYachaNextRound,
  checkYachaTimeout, fetchItemsOf,
} from '../lib/api';

function Card({ id, destroyed, back, faceDown }) {
  if (back || faceDown) return <div className={`tarot-card back ${destroyed ? 'destroyed' : ''}`}>🂠</div>;
  const c = tarotCard(id);
  return (
    <div className={`tarot-card ${destroyed ? 'destroyed' : ''}`}>
      <div className="tarot-roman">{c.roman}</div>
      <div className="tarot-name">{c.name}</div>
    </div>
  );
}

function BetEditor({ myBet, items, onChange, onConfirm, confirmed, disabled }) {
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
      <div className="a-form-row">
        <input className="txt-input" type="number" min="0" value={points} disabled={confirmed || disabled}
          onChange={(e) => { setPoints(e.target.value); onChange(e.target.value, picked); }} placeholder="걸 포인트" />
        <span>P</span>
      </div>
      {!confirmed && !disabled && items.length > 0 && (
        <div className="a-form-row">
          <select value={pickId} onChange={(e) => setPickId(e.target.value)}>
            <option value="">소지품 추가</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name} (보유 {i.qty})</option>)}
          </select>
          <input className="txt-input" type="number" min="1" value={pickQty} onChange={(e) => setPickQty(e.target.value)} style={{ width: 60 }} />
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
      {!confirmed && !disabled && <button className="a-btn accent big" style={{ width: '100%', marginTop: 8 }} onClick={onConfirm}>베팅 확정</button>}
      {confirmed && <div className="yacha-confirmed-note">확정됨 — 상대를 기다리는 중</div>}
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
    if (!game || !['pending', 'betting', 'playing', 'result'].includes(game.status)) return undefined;
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
    return <div className="yacha-panel yacha-ended">야차가 종료되었습니다.</div>;
  }

  if (game.status === 'pending') {
    const iRequested = game.requested_by === me;
    return (
      <div className="yacha-panel">
        <div className="yacha-title">야차 신청</div>
        {err && <div className="auth-error">{err}</div>}
        {iRequested ? (
          <>
            <div className="yacha-sub">상대의 수락을 기다리는 중입니다.</div>
            <button className="a-btn" disabled={busy} onClick={() => run(() => declineYacha(game.id))}>신청 취소</button>
          </>
        ) : (
          <>
            <div className="yacha-sub">상대가 야차를 신청했습니다. 야차권이 있어야 수락할 수 있어요.</div>
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
    return (
      <div className="yacha-panel">
        <div className="yacha-title">야차 · {game.round}라운드 베팅</div>
        {err && <div className="auth-error">{err}</div>}
        <div className="yacha-bet-cols">
          <div>
            <div className="yacha-col-label">내 베팅</div>
            <BetEditor myBet={myBet} items={items} confirmed={!!myBet?.confirmed} disabled={busy}
              onChange={(p, its) => setYachaBet(game.id, p, its).catch((e) => setErr(e.message))}
              onConfirm={() => run(() => confirmYachaBet(game.id))} />
          </div>
          <div>
            <div className="yacha-col-label">상대 베팅</div>
            {oppBet ? (
              <div className="yacha-opp-bet">
                {oppBet.points > 0 && <div>{oppBet.points}P</div>}
                {(oppBet.items || []).map((it) => <div key={it.id}>{it.name} x{it.qty}</div>)}
                <div className="yacha-confirmed-note">{oppBet.confirmed ? '확정됨' : '입력 중'}</div>
              </div>
            ) : <div className="yacha-sub">아직 입력하지 않았습니다.</div>}
          </div>
        </div>
      </div>
    );
  }

  if (game.status === 'playing') {
    const myHand = game.hands[me]; const oppHand = game.hands[other];
    const myTurn = game.turn === me;
    const pending = game.pending_effect;
    const iCanSeeOppDown = (myHand.peeked || []).includes(other);
    return (
      <div className="yacha-panel yacha-table">
        <div className="yacha-title">야차 · {game.round}라운드</div>
        {err && <div className="auth-error">{err}</div>}
        <div className="yacha-side opp">
          <div className="yacha-col-label">상대</div>
          <div className="yacha-cards">
            {oppHand.up.map((c, i) => <Card key={i} id={c.id} destroyed={c.destroyed} />)}
            <Card id={oppHand.down} faceDown={!iCanSeeOppDown} />
          </div>
          {oppHand.standing && <div className="yacha-sub">{oppHand.busted ? '버스트' : '스탠드'}</div>}
        </div>
        <div className={`yacha-turn-note ${myTurn ? 'mine' : ''}`}>{myTurn ? '내 차례' : '상대 차례'}</div>
        <div className="yacha-side mine">
          <div className="yacha-col-label">나</div>
          <div className="yacha-cards">
            {myHand.up.map((c, i) => <Card key={i} id={c.id} destroyed={c.destroyed} />)}
            <Card id={myHand.down} />
          </div>
          {myHand.standing && <div className="yacha-sub">{myHand.busted ? '버스트' : '스탠드'}</div>}
        </div>
        {pending && pending.type === 'death' && pending.by === me && (
          <div className="yacha-pending">
            <div className="yacha-sub">죽음 효과: 상대의 공개 카드를 하나 파괴하세요.</div>
            <div className="yacha-cards">
              {oppHand.up.map((c, i) => !c.destroyed && (
                <button key={i} type="button" className="tarot-card-btn" disabled={busy} onClick={() => run(() => resolveYachaDeath(game.id, i))}>
                  <Card id={c.id} />
                </button>
              ))}
            </div>
          </div>
        )}
        {pending && pending.by !== me && <div className="yacha-sub">상대가 효과를 처리하는 중입니다.</div>}
        {!pending && myTurn && !myHand.standing && (
          <div className="modal-actions">
            <button className="modal-cancel" disabled={busy} onClick={() => run(() => standYacha(game.id))}>스탠드</button>
            <button className="modal-confirm" disabled={busy} onClick={() => run(() => hitYacha(game.id))}>히트</button>
          </div>
        )}
      </div>
    );
  }

  if (game.status === 'result') {
    const { result } = game;
    const myTotal = game.user_a === me ? result.totalA : result.totalB;
    const oppTotal = game.user_a === me ? result.totalB : result.totalA;
    const iWon = result.winner === me; const draw = !result.winner;
    const agreedMe = !!game.next_round_agree[me]; const agreedOther = !!game.next_round_agree[other];
    const maxed = game.round >= game.max_rounds;
    return (
      <div className="yacha-panel">
        <div className="yacha-title">{game.round}라운드 결과</div>
        {err && <div className="auth-error">{err}</div>}
        <div className="yacha-result-big">{draw ? '무승부' : iWon ? '승리!' : '패배'}</div>
        <div className="yacha-sub">내 합계 {myTotal} · 상대 합계 {oppTotal}</div>
        <div className="yacha-sub">{draw ? '걸었던 것이 모두 소멸했습니다.' : iWon ? '상대가 건 것까지 모두 가져왔습니다.' : '건 것을 모두 잃었습니다.'}</div>
        {maxed ? (
          <button className="a-btn accent big" style={{ marginTop: 8 }} disabled={busy} onClick={() => run(() => declineYachaNextRound(game.id))}>종료 (최대 3라운드)</button>
        ) : (
          <div className="modal-actions">
            <button className="modal-cancel" disabled={busy || agreedMe} onClick={() => run(() => declineYachaNextRound(game.id))}>종료</button>
            <button className="modal-confirm" disabled={busy || agreedMe} onClick={() => run(() => agreeYachaNextRound(game.id))}>
              {agreedMe ? '상대 응답 대기 중' : '다음 라운드 동의'}
            </button>
          </div>
        )}
        {agreedOther && !agreedMe && <div className="yacha-sub">상대가 다음 라운드에 동의했습니다.</div>}
      </div>
    );
  }
  return null;
}
