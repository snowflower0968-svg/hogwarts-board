import React, { useEffect, useState } from 'react';
import {
  fetchItemsOf, useHealingItemStandalone, DITTANY_NAME, MYRTLAP_NAME, SKILL_NAMES, SKILL_DESCRIPTIONS, YACHA_BASE_HP,
} from '../lib/api';

function HealItemCard({ name, item, myHp, onHealed }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function eat() {
    setErr(''); setMsg(''); setBusy(true);
    try {
      const healed = await useHealingItemStandalone(name);
      setMsg(`체력을 ${healed} 회복했습니다.`);
      await onHealed();
    } catch (e) { setErr(e.message || '오류가 발생했습니다.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="shop-card" style={{ marginBottom: 14 }}>
      <div className="shop-top">
        <div className="shop-name">{name}</div>
        <div className="shop-price"><b>보유 {item?.qty || 0}개</b></div>
      </div>
      {msg && <div className="auth-success" style={{ margin: '8px 0 0' }}>{msg}</div>}
      {err && <div className="auth-error" style={{ margin: '8px 0 0' }}>{err}</div>}
      <div className="shop-buy">
        <button disabled={busy || !item || myHp >= YACHA_BASE_HP} onClick={eat}>
          {myHp >= YACHA_BASE_HP ? '체력 가득 참' : !item ? '보유하지 않음' : '섭취'}
        </button>
      </div>
    </div>
  );
}

export default function Battle({ profile, onBought }) {
  const [items, setItems] = useState([]);
  const myHp = profile.battle_hp ?? YACHA_BASE_HP;
  const myPoints = profile.battle_points || 0;

  const load = () => fetchItemsOf(profile.id).then(setItems).catch(() => setItems([]));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [profile.id]);

  const dittany = items.find((it) => it.name === DITTANY_NAME);
  const myrtlap = items.find((it) => it.name === MYRTLAP_NAME);
  const skills = items.filter((it) => Object.values(SKILL_NAMES).includes(it.name));
  const pct = Math.max(0, Math.min(100, (myHp / YACHA_BASE_HP) * 100));

  async function refresh() { await load(); if (onBought) await onBought(); }

  return (
    <>
      <div className="board-title-bar"><h2>전투</h2></div>
      <div className="dig-status">
        <div className="dig-charges">
          <span className="dig-charge-num" style={{ color: 'var(--gold)' }}>{myHp}</span>
          <span className="dig-charge-max"> / {YACHA_BASE_HP}</span>
          <div className="dig-charge-lbl">내 체력</div>
        </div>
        <div className="dig-timer">
          전투 점수 <b>{myPoints}</b>점
        </div>
      </div>
      <div className="yacha-hp-bar" style={{ margin: '0 4px 14px' }}><div className="yacha-hp-fill" style={{ width: `${pct}%` }} /></div>
      <HealItemCard name={DITTANY_NAME} item={dittany} myHp={myHp} onHealed={refresh} />
      <HealItemCard name={MYRTLAP_NAME} item={myrtlap} myHp={myHp} onHealed={refresh} />
      <div className="board-title-bar"><h2 style={{ fontSize: 16 }}>내 스킬</h2></div>
      {skills.length === 0 && <div className="empty-state">보유한 스킬이 없습니다.</div>}
      {skills.map((it) => (
        <div key={it.id} className="shop-card" style={{ marginBottom: 8 }}>
          <div className="shop-top">
            <div className="shop-name">{it.name}</div>
            <div className="shop-price"><b>x{it.qty}</b></div>
          </div>
          <div className="shop-desc">{it.description || SKILL_DESCRIPTIONS[it.name] || ''}</div>
        </div>
      ))}
    </>
  );
}
