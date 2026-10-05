import React, { useEffect, useState } from 'react';
import {
  fetchPointSettings, savePointSettings, subscribeShop, saveShopItem, deleteShopItem,
  setShopDiscount, clearShopDiscount, discountActive, effectivePrice,
} from '../lib/api';
import { fmtRemain } from '../lib/helpers';

// ---------------- 포인트 자동 지급 기준 ----------------
export function PointSettingsCard() {
  const [v, setV] = useState(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => { fetchPointSettings().then((s) => setV({ postEvery: String(s.postEvery), postAmount: String(s.postAmount), commentEvery: String(s.commentEvery), commentAmount: String(s.commentAmount) })); }, []);
  if (!v) return null;
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });

  async function save() {
    setErr(''); setOk('');
    try { await savePointSettings(v); setOk('저장했습니다. 지금부터 모든 회원에게 적용됩니다.'); }
    catch (e) { setErr(e.message); }
  }
  return (
    <div className="setting-card">
      <div className="field-label" style={{ marginTop: 0 }}>자동 지급 기준 (전체 적용)</div>
      <div className="setting-line">
        게시글 <input type="number" min="1" value={v.postEvery} onChange={set('postEvery')} /> 개 작성할 때마다
        <input type="number" min="0" value={v.postAmount} onChange={set('postAmount')} /> 포인트
      </div>
      <div className="setting-line">
        댓글(답글 포함) <input type="number" min="1" value={v.commentEvery} onChange={set('commentEvery')} /> 개 작성할 때마다
        <input type="number" min="0" value={v.commentAmount} onChange={set('commentAmount')} /> 포인트
      </div>
      <div className="row-sub">각 회원이 지금까지 쓴 글/댓글 개수를 기준으로 계산해요. 예) 글 1개당 5포인트, 댓글 2개당 1포인트</div>
      {err && <div className="auth-error" style={{ marginTop: 8 }}>{err}</div>}
      {ok && <div className="auth-success" style={{ marginTop: 8 }}>{ok}</div>}
      <div className="admin-row-form" style={{ marginTop: 8 }}><button className="accent" onClick={save}>저장</button></div>
    </div>
  );
}

// ---------------- 상점 상품 관리 ----------------
function ShopRow({ s, checked, onCheck, now }) {
  const [name, setName] = useState(s.name);
  const [desc, setDesc] = useState(s.description);
  const [price, setPrice] = useState(String(s.price));
  const [kind, setKind] = useState(s.kind);
  const [enabled, setEnabled] = useState(s.enabled);
  const [err, setErr] = useState('');
  const active = discountActive(s, now);

  async function save() {
    setErr('');
    try { await saveShopItem(s.id, { name, description: desc, price, kind, enabled }); }
    catch (e) { setErr(e.message); }
  }
  async function del() {
    if (!window.confirm(`"${s.name}" 상품을 삭제할까요?`)) return;
    await deleteShopItem(s.id);
  }

  return (
    <div className={`list-row ${checked ? 'selected' : ''}`}>
      {err && <div className="auth-error">{err}</div>}
      <div className="admin-row-form">
        <input type="checkbox" className="row-check" checked={checked} onChange={onCheck} title="할인 대상으로 선택" />
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="상품 이름" style={{ flex: 1, minWidth: 90 }} />
        <input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 72 }} />
        <span style={{ fontSize: 12, color: 'var(--text-light)' }}>P</span>
      </div>
      <div className="admin-row-form">
        <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="효과/설명" style={{ flex: 1, minWidth: 140 }} />
      </div>
      <div className="admin-row-form">
        <select className="house-select" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="item">일반 상품 (소지품)</option>
          <option value="dig_ticket">간이조사권</option>
        </select>
        <label style={{ fontSize: 12, color: 'var(--text-mid)' }}><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> 판매 중</label>
        <button className="accent" onClick={save}>저장</button>
        <button className="danger" onClick={del}>삭제</button>
      </div>
      {active && (
        <div className="row-sub" style={{ color: 'var(--danger)', fontWeight: 600 }}>
          {s.discountPercent}% 할인 중 → {effectivePrice(s, now)}P{s.discountUntil ? ` · 남은 시간 ${fmtRemain(s.discountUntil - now)}` : ' · 해제 전까지'}
        </div>
      )}
    </div>
  );
}

export function ShopAdmin() {
  const [items, setItems] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [sel, setSel] = useState(() => new Set());
  const [pct, setPct] = useState('10');
  const [hours, setHours] = useState('3');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [nName, setNName] = useState('');
  const [nDesc, setNDesc] = useState('');
  const [nPrice, setNPrice] = useState('10');
  const [nKind, setNKind] = useState('item');

  useEffect(() => subscribeShop(setItems), []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 20000); return () => clearInterval(t); }, []);

  async function run(fn, msg) {
    setErr(''); setOk('');
    try { await fn(); if (msg) setOk(msg); } catch (e) { setErr(e.message || '오류가 발생했습니다.'); }
  }
  function toggle(id) {
    setSel((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  if (items === null) return <div className="empty-state">불러오는 중</div>;

  return (
    <>
      <div className="field-label">상품 추가</div>
      <form className="list-row" onSubmit={(e) => { e.preventDefault(); run(async () => { await saveShopItem(null, { name: nName, description: nDesc, price: nPrice, kind: nKind }); setNName(''); setNDesc(''); }, '상품을 추가했습니다.'); }}>
        <div className="admin-row-form">
          <input type="text" value={nName} onChange={(e) => setNName(e.target.value)} placeholder="상품 이름" style={{ flex: 1, minWidth: 90 }} />
          <input type="number" min="0" value={nPrice} onChange={(e) => setNPrice(e.target.value)} style={{ width: 72 }} />
          <span style={{ fontSize: 12, color: 'var(--text-light)' }}>P</span>
        </div>
        <div className="admin-row-form">
          <input type="text" value={nDesc} onChange={(e) => setNDesc(e.target.value)} placeholder="효과/설명 (구매 후 소지품에서 보임)" style={{ flex: 1, minWidth: 140 }} />
        </div>
        <div className="admin-row-form">
          <select className="house-select" value={nKind} onChange={(e) => setNKind(e.target.value)}>
            <option value="item">일반 상품 (소지품으로 지급)</option>
            <option value="dig_ticket">간이조사권 (조사 횟수 +1, 최대 3회 누적과 별개)</option>
          </select>
          <button className="accent" type="submit">추가</button>
        </div>
      </form>

      <div className="field-label">할인</div>
      <div className="setting-card">
        <div className="row-sub" style={{ marginBottom: 8 }}>아래 목록에서 상품을 체크한 뒤 할인율과 시간을 정하세요. 가격은 반올림으로 계산돼요.</div>
        <div className="setting-line">
          선택 {sel.size}개 ·
          <input type="number" min="1" max="100" value={pct} onChange={(e) => setPct(e.target.value)} /> % 할인 ·
          <input type="number" min="0" step="any" value={hours} onChange={(e) => setHours(e.target.value)} /> 시간 동안
        </div>
        <div className="row-sub">시간을 비우면 "할인 해제"를 누르기 전까지 계속 할인돼요. (지금부터 3시간 → 3 입력)</div>
        {err && <div className="auth-error" style={{ marginTop: 8 }}>{err}</div>}
        {ok && <div className="auth-success" style={{ marginTop: 8 }}>{ok}</div>}
        <div className="admin-row-form" style={{ marginTop: 8 }}>
          <button onClick={() => setSel(new Set(items.map((i) => i.id)))}>전체 선택</button>
          <button onClick={() => setSel(new Set())}>선택 해제</button>
          <button className="accent" onClick={() => run(() => setShopDiscount([...sel], pct, hours), '할인을 적용했습니다.')}>할인 적용</button>
          <button className="danger" onClick={() => run(() => clearShopDiscount([...sel]), '할인을 해제했습니다.')}>할인 해제</button>
        </div>
      </div>

      <div className="field-label">상품 목록 ({items.length})</div>
      {items.length === 0 && <div className="empty-state">등록된 상품이 없습니다.</div>}
      {items.map((s) => (
        <ShopRow key={`${s.id}|${s.name}|${s.price}|${s.description}|${s.kind}|${s.enabled}`} s={s} now={now} checked={sel.has(s.id)} onCheck={() => toggle(s.id)} />
      ))}
    </>
  );
}
