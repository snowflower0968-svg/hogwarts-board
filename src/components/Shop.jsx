import React, { useEffect, useState } from 'react';
import { subscribeShop, buyShopItem, discountActive, effectivePrice } from '../lib/api';
import { fmtRemain } from '../lib/helpers';

function ProductCard({ s, now, points, onBuy, holdingVoid }) {
  const [qty, setQty] = useState('1');
  const active = discountActive(s, now);
  const unit = effectivePrice(s, now);
  const isVoid = s.kind === 'gamble_void';
  const q = isVoid ? 1 : Math.max(1, parseInt(qty, 10) || 1);
  const total = unit * q;

  return (
    <div className="shop-card">
      <div className="shop-top">
        <div className="shop-name">
          {s.name}
          {s.kind === 'dig_ticket' && <span className="shop-tag">간이조사권</span>}
          {isVoid && <span className="shop-tag">도박 무효권</span>}
          {active && <span className="shop-sale">{s.discountPercent}% 할인</span>}
        </div>
        <div className="shop-price">
          {active && <s>{s.price}P</s>}
          <b>{unit}P</b>
        </div>
      </div>
      {s.description && <div className="shop-desc">{s.description}</div>}
      {s.kind === 'dig_ticket' && <div className="shop-desc">구매 횟수 제한 없음 · 최대 3회 충전과 별개로 보관돼요.</div>}
      {isVoid && <div className="shop-desc">도박 직후에 1회 결과를 없던 일로 되돌려요. 1장까지만 가질 수 있고, 쓰고 나면 다시 살 수 있어요.</div>}
      {active && s.discountUntil && <div className="shop-timer">할인 종료까지 {fmtRemain(s.discountUntil - now)}</div>}
      <div className="shop-buy">
        {!isVoid && <input type="number" min="1" max="99" value={qty} onChange={(e) => setQty(e.target.value)} />}
        <button disabled={(isVoid && holdingVoid) || points < total} onClick={() => onBuy(s, q, total)}>
          {isVoid && holdingVoid ? '보유 중' : points < total ? '포인트 부족' : `${total}P 구매`}
        </button>
      </div>
    </div>
  );
}

export default function Shop({ profile, onBought }) {
  const [items, setItems] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [confirm, setConfirm] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeShop(setItems), []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  async function doBuy() {
    const { s, q } = confirm;
    setConfirm(null); setBusy(true); setMsg(''); setErr('');
    try {
      const r = await buyShopItem(s.id, q);
      setMsg(r.kind === 'dig_ticket' ? `${r.name} ${r.qty}장을 구매했습니다. (${r.total}P)`
        : r.kind === 'gamble_void' ? `${r.name}을 구매했습니다. 도박 직후에 사용할 수 있어요. (${r.total}P)`
          : `${r.name} x${r.qty} 구매 완료! 소지품에 추가되었습니다. (${r.total}P)`);
      await onBought();
    } catch (e) { setErr(e.message || '구매 중 오류가 발생했습니다.'); }
    finally { setBusy(false); }
  }

  const list = (items || []).filter((s) => s.enabled);

  return (
    <>
      <div className="board-title-bar"><h2>상점</h2></div>
      <div className="dig-status">
        <div className="dig-charges">
          <span className="dig-charge-num" style={{ color: 'var(--gold)' }}>{profile.points}</span>
          <span className="dig-charge-max"> P</span>
          <div className="dig-charge-lbl">내 포인트</div>
        </div>
        <div className="dig-timer">
          보유 조사권 <b>{profile.dig_bonus || 0}</b>장
          <div style={{ marginTop: 4 }}>도박 무효권 <b>{profile.gamble_void || 0}</b>장</div>
        </div>
      </div>
      {msg && <div className="auth-success" style={{ margin: '0 4px 10px' }}>{msg}</div>}
      {err && <div className="auth-error" style={{ margin: '0 4px 10px' }}>{err}</div>}
      {items === null && <div className="empty-state">불러오는 중</div>}
      {items && list.length === 0 && <div className="empty-state">판매 중인 상품이 없습니다.</div>}
      {list.map((s) => <ProductCard key={s.id} s={s} now={now} points={profile.points} holdingVoid={(profile.gamble_void || 0) >= 1} onBuy={(item, q, total) => !busy && setConfirm({ s: item, q, total })} />)}

      {confirm && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setConfirm(null)}>
          <div className="modal-card small">
            <div className="confirm-msg"><b>{confirm.s.name}</b> {confirm.q}개를<br />{confirm.total}P에 구매할까요?</div>
            <div className="modal-actions">
              <button className="modal-cancel" onClick={() => setConfirm(null)}>취소</button>
              <button className="modal-confirm" onClick={doBuy}>구매</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
