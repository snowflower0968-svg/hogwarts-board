import React, { useEffect, useState } from 'react';
import {
  acceptYacha, declineYacha, chooseYachaAction, surrenderYacha, checkYachaTimeout, retractYachaAction,
  fetchItemsOf, DITTANY_NAME, SKILL_NAMES, SKILL_NEEDS_SUBACTION, SKILL_DESCRIPTIONS, YACHA_BASE_HP,
} from '../lib/api';

const SUB_LABEL = { attack: '공격', defend: '방어', heal: '회복' };
const SUB_OPTIONS_BY_SKILL = {
  [SKILL_NAMES.ADVANTAGE]: ['attack', 'heal'],
  [SKILL_NAMES.MIRROR]: ['attack', 'defend', 'heal'],
};

function HpBar({ label, hp }) {
  const pct = Math.max(0, Math.min(100, (hp / YACHA_BASE_HP) * 100));
  return (
    <div className="yacha-hp-row">
      <div className="yacha-hp-label">{label} <b>{hp}</b></div>
      <div className="yacha-hp-bar"><div className="yacha-hp-fill" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export default function YachaGame({ profile, room, game, onRefresh }) {
  const [items, setItems] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showItems, setShowItems] = useState(false);
  const [subPick, setSubPick] = useState(null); // { item, options }
  const me = profile.id;
  const other = room ? (room.user_a === me ? room.user_b : room.user_a) : null;

  const USABLE_NAMES = [DITTANY_NAME, ...Object.values(SKILL_NAMES)];
  useEffect(() => {
    if (game?.status === 'battling') {
      fetchItemsOf(me).then((list) => setItems(list.filter((it) => USABLE_NAMES.includes(it.name)))).catch(() => setItems([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.status, game?.id, me, game?.round]);

  useEffect(() => {
    if (!game || !['pending', 'battling'].includes(game.status)) return undefined;
    const t = setInterval(() => { checkYachaTimeout(game.id).then((acted) => { if (acted) onRefresh(); }).catch(() => {}); }, 15000);
    return () => clearInterval(t);
  }, [game, onRefresh]);

  if (!game) return null;

  async function run(fn) {
    setErr(''); setBusy(true);
    try { await fn(); setShowItems(false); setSubPick(null); await onRefresh(); } catch (e) { setErr(e.message || '오류가 발생했습니다.'); }
    finally { setBusy(false); }
  }
  function useItem(it) {
    if (SKILL_NEEDS_SUBACTION.includes(it.name)) {
      setSubPick({ item: it, options: SUB_OPTIONS_BY_SKILL[it.name] || [] });
      return;
    }
    run(() => chooseYachaAction(game.id, 'item', it.id));
  }
  const retryItem = items.find((it) => it.name === SKILL_NAMES.RETRY_PICK);

  if (['declined', 'ended', 'cancelled'].includes(game.status)) {
    const r = game.result;
    let resultText = '';
    if (r?.type === 'draw') resultText = '무승부로 종료되었습니다.';
    else if (r) {
      const iWon = r.winner === me;
      const kindText = { death: '체력 소진', surrender: '항복', timeout: '시간 초과' }[r.type] || '';
      resultText = `${iWon ? '승리' : '패배'} (${kindText})`;
    }
    return (
      <div className="yacha-panel yacha-ended">
        <div className="yacha-title">야차 전투 종료</div>
        {resultText && <div className="yacha-note">{resultText}</div>}
      </div>
    );
  }

  if (game.status === 'pending') {
    const iRequested = game.requested_by === me;
    return (
      <div className="yacha-panel fixed-top">
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

  if (game.status === 'battling') {
    const myHp = game.hp[me] ?? YACHA_BASE_HP;
    const oppHp = game.hp[other] ?? YACHA_BASE_HP;
    const picked = !!game.actions[me];
    const oppPicked = !!game.actions[other];
    return (
      <div className="yacha-panel fixed-top">
        <div className="yacha-title">야차 전투 · {game.round}라운드</div>
        {err && <div className="auth-error">{err}</div>}
        <HpBar label="나" hp={myHp} />
        <HpBar label="상대" hp={oppHp} />
        {subPick ? (
          <div className="yacha-item-row">
            <div className="yacha-note">{subPick.item.name}과 함께 할 행동을 고르세요.</div>
            {subPick.options.map((o) => (
              <button key={o} type="button" className="a-btn" disabled={busy} onClick={() => run(() => chooseYachaAction(game.id, 'item', subPick.item.id, o))}>{SUB_LABEL[o]}</button>
            ))}
            <button type="button" className="text-btn" onClick={() => setSubPick(null)}>취소</button>
          </div>
        ) : picked ? (
          <div className="yacha-note">
            행동을 선택했습니다. {oppPicked ? '곧 결과가 나와요.' : '상대의 선택을 기다리는 중'}
            {!oppPicked && retryItem && (
              <button type="button" className="text-btn" style={{ marginLeft: 8 }} disabled={busy}
                onClick={() => run(() => retractYachaAction(game.id, retryItem.id))}>
                다시 고르기 (보유 {retryItem.qty})
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="yacha-action-row">
              <button type="button" className="a-btn" disabled={busy} onClick={() => run(() => chooseYachaAction(game.id, 'attack'))}>공격</button>
              <button type="button" className="a-btn" disabled={busy} onClick={() => run(() => chooseYachaAction(game.id, 'defend'))}>방어</button>
              <button type="button" className="a-btn" disabled={busy} onClick={() => run(() => chooseYachaAction(game.id, 'heal'))}>회복</button>
              <button type="button" className="a-btn" disabled={busy} onClick={() => setShowItems((v) => !v)}>아이템</button>
            </div>
            {showItems && (
              <div className="yacha-item-row">
                {items.filter((it) => it.name !== SKILL_NAMES.RETRY_PICK).length === 0 && <div className="yacha-note">사용할 수 있는 아이템이 없습니다.</div>}
                {items.filter((it) => it.name !== SKILL_NAMES.RETRY_PICK).map((it) => (
                  <button key={it.id} type="button" className="a-btn yacha-item-btn" disabled={busy} onClick={() => useItem(it)} title={it.description || SKILL_DESCRIPTIONS[it.name] || ''}>
                    <div>{it.name === DITTANY_NAME ? `${DITTANY_NAME} 섭취` : it.name} (보유 {it.qty})</div>
                    <div className="yacha-item-desc">{it.description || SKILL_DESCRIPTIONS[it.name] || ''}</div>
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="text-btn" disabled={busy} style={{ marginTop: 6 }} onClick={() => run(() => surrenderYacha(game.id))}>항복</button>
          </>
        )}
      </div>
    );
  }
  return null;
}
