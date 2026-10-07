import React, { useEffect, useState } from 'react';
import {
  fetchPointSettings, savePointSettings, subscribeShop, saveShopItem, deleteShopItem,
  setShopDiscount, clearShopDiscount, discountActive, effectivePrice,
} from '../lib/api';
import { fmtRemain } from '../lib/helpers';
import { AdminCard } from './Ui';

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
const KIND_HINT = {
  item: '구매하면 소지품으로 들어가요.',
  dig_ticket: '구매하면 조사 횟수가 늘어나요. (최대 3회 충전과 별개, 구매 제한 없음)',
  gamble_void: '도박 직후 1회 결과를 없던 일로 돌려요. (1인당 1장까지만 보유, 사용 후 재구매 가능)',
};
const KIND_LABEL = { item: '일반 상품', dig_ticket: '간이조사권', gamble_void: '도박 무효권' };
const KIND_TAG = { dig_ticket: '조사권', gamble_void: '무효권' };

function KindToggle({ value, onChange }) {
  return (
    <div className="seg-row" style={{ marginBottom: 6 }}>
      {Object.keys(KIND_LABEL).map((k) => (
        <button key={k} type="button" className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{KIND_LABEL[k]}</button>
      ))}
    </div>
  );
}

function PriceInput({ value, onChange }) {
  return (
    <div className="price-input">
      <input className="txt-input" type="number" min="0" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} placeholder="가격" />
      <span>P</span>
    </div>
  );
}

function ShopAddForm() {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('10');
  const [kind, setKind] = useState('item');
  const [desc, setDesc] = useState('');
  const [showDesc, setShowDesc] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  async function submit(e) {
    e.preventDefault();
    setErr(''); setOk('');
    try {
      await saveShopItem(null, { name, description: desc, price, kind });
      setOk(`"${name.trim()}" 상품을 추가했습니다.`);
      setName(''); setDesc(''); setShowDesc(false);
    } catch (ex) { setErr(ex.message || '오류가 발생했습니다.'); }
  }

  return (
    <form onSubmit={submit}>
      <div className="shop-form-row">
        <input className="txt-input" style={{ flex: 1, minWidth: 0 }} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="상품 이름" maxLength={40} />
        <PriceInput value={price} onChange={setPrice} />
      </div>
      <KindToggle value={kind} onChange={setKind} />
      <div className="kind-hint">{KIND_HINT[kind]}</div>
      {showDesc
        ? <input className="txt-input" style={{ width: '100%', marginBottom: 8 }} type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="설명 / 효과 (선택)" />
        : <button type="button" className="link-btn" style={{ paddingTop: 0, paddingBottom: 8 }} onClick={() => setShowDesc(true)}>+ 설명 추가 (선택)</button>}
      {err && <div className="auth-error">{err}</div>}
      {ok && <div className="auth-success">{ok}</div>}
      <button type="submit" className="shop-form-submit">상품 추가</button>
    </form>
  );
}

function ShopRow({ s, checked, onCheck, now }) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  const active = discountActive(s, now);
  const unit = effectivePrice(s, now);
  const set = (k) => (v) => setF((prev) => ({ ...prev, [k]: v }));

  function open() {
    setF({ name: s.name, description: s.description, price: String(s.price), kind: s.kind, enabled: s.enabled });
    setErr(''); setEditing(true);
  }
  async function save() {
    setErr('');
    const textChanged = s.kind === 'item' && (f.name.trim() !== s.name || f.description.trim() !== s.description);
    if (textChanged && !window.confirm('이름이나 설명을 바꾸면, 이미 구매된 소지품과 별개 항목으로 표시돼요.\n(이미 산 사람의 소지품은 예전 이름 그대로 남아요)\n그래도 저장할까요?')) return;
    try { await saveShopItem(s.id, f); setEditing(false); }
    catch (e) { setErr(e.message || '오류가 발생했습니다.'); }
  }
  async function del() {
    if (!window.confirm(`"${s.name}" 상품을 삭제할까요?`)) return;
    await deleteShopItem(s.id);
  }

  return (
    <div className={`shop-admin-row ${checked ? 'selected' : ''} ${!s.enabled ? 'off' : ''}`}>
      <div className="shop-admin-main">
        <input type="checkbox" className="row-check" checked={checked} onChange={onCheck} title="할인 대상으로 선택" />
        <div className="shop-admin-info">
          <div className="shop-admin-name">
            {s.name}
            {KIND_TAG[s.kind] && <span className="shop-tag">{KIND_TAG[s.kind]}</span>}
            {!s.enabled && <span className="withdrawn-badge">판매 중지</span>}
          </div>
          {s.description && <div className="shop-admin-desc">{s.description}</div>}
          {active && (
            <div className="shop-admin-sale">
              {s.discountPercent}% 할인 중{s.discountUntil ? ` · 남은 시간 ${fmtRemain(s.discountUntil - now)}` : ' · 해제 전까지'}
            </div>
          )}
        </div>
        <div className="shop-admin-price">{active && <s>{s.price}P</s>}<b>{unit}P</b></div>
        <button className="log-del" onClick={editing ? () => setEditing(false) : open}>{editing ? '닫기' : '수정'}</button>
      </div>

      {editing && f && (
        <div className="shop-admin-edit">
          {err && <div className="auth-error">{err}</div>}
          <div className="shop-form-row">
            <input className="txt-input" style={{ flex: 1, minWidth: 0 }} type="text" value={f.name} onChange={(e) => set('name')(e.target.value)} placeholder="상품 이름" maxLength={40} />
            <PriceInput value={f.price} onChange={set('price')} />
          </div>
          <KindToggle value={f.kind} onChange={set('kind')} />
          <input className="txt-input" style={{ width: '100%', margin: '4px 0 6px' }} type="text" value={f.description} onChange={(e) => set('description')(e.target.value)} placeholder="설명 / 효과 (선택)" />
          {s.kind === 'item' && <div className="a-hint" style={{ marginBottom: 8 }}>이름이나 설명을 바꾸면 이미 산 소지품과는 별개 항목으로 표시돼요.</div>}
          <label className="check-line" style={{ marginTop: 0 }}><input type="checkbox" checked={f.enabled} onChange={(e) => set('enabled')(e.target.checked)} /> 판매 중 (끄면 상점에서 숨겨져요)</label>
          <div className="admin-row-form" style={{ marginTop: 10 }}>
            <button className="accent" onClick={save}>저장</button>
            <button className="danger" onClick={del}>상품 삭제</button>
          </div>
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
      <AdminCard title="상품 추가"><ShopAddForm /></AdminCard>

      <AdminCard
        title={`상품 목록 (${items.length})`}
        right={items.length > 0 ? <button className="select-toggle" onClick={() => setSel(sel.size === items.length ? new Set() : new Set(items.map((i) => i.id)))}>{sel.size === items.length ? '선택 해제' : '전체 선택'}</button> : null}
        hint={items.length > 0 && sel.size === 0 ? '상품 앞의 체크박스를 선택하면 할인을 적용할 수 있어요.' : undefined}
      >
        {err && <div className="auth-error">{err}</div>}
        {ok && <div className="auth-success">{ok}</div>}

        {sel.size > 0 && (
          <div className="discount-bar" style={{ margin: '0 0 10px' }}>
            <div className="discount-title">선택한 상품 {sel.size}개 할인</div>
            <div className="setting-line">
              <input type="number" min="1" max="100" value={pct} onChange={(e) => setPct(e.target.value)} /> % 할인 ·
              <input type="number" min="0" step="any" value={hours} onChange={(e) => setHours(e.target.value)} /> 시간 동안
            </div>
            <div className="row-sub">시간을 비우면 "할인 해제"를 누르기 전까지 계속 할인돼요. (가격은 반올림)</div>
            <div className="a-actions">
              <button className="a-btn accent big" onClick={() => run(() => setShopDiscount([...sel], pct, hours), '할인을 적용했습니다.')}>할인 적용</button>
              <button className="a-btn danger big" onClick={() => run(() => clearShopDiscount([...sel]), '할인을 해제했습니다.')}>할인 해제</button>
            </div>
          </div>
        )}

        {items.length === 0 && <div className="a-empty">등록된 상품이 없습니다.</div>}
        {items.map((s) => (
          <ShopRow key={s.id} s={s} now={now} checked={sel.has(s.id)} onCheck={() => toggle(s.id)} />
        ))}
      </AdminCard>
    </>
  );
}
