import React from 'react';

// 개수 선택 (− 숫자 +)
export function QtyStepper({ value, onChange, min = 1, max = 999 }) {
  const n = parseInt(value, 10) || min;
  const set = (v) => onChange(String(Math.min(max, Math.max(min, v))));
  return (
    <div className="qty-step">
      <button type="button" onClick={() => set(n - 1)} disabled={n <= min} aria-label="줄이기">−</button>
      <input type="number" inputMode="numeric" min={min} max={max} value={value} onChange={(e) => onChange(e.target.value)} onBlur={() => set(n)} aria-label="개수" />
      <button type="button" onClick={() => set(n + 1)} disabled={n >= max} aria-label="늘리기">+</button>
    </div>
  );
}

// 관리자 화면 공통 카드
export function AdminCard({ title, right, hint, children }) {
  return (
    <section className="a-card">
      {(title || right) && (
        <div className="a-card-head">
          <h3>{title}</h3>
          {right}
        </div>
      )}
      {hint && <p className="a-hint">{hint}</p>}
      {children}
    </section>
  );
}

// 위쪽 구역 이동용 탭 (main: 크게 꽉 차게 / sub: 작은 알약)
export function SegTabs({ items, value, onChange, variant = 'main' }) {
  return (
    <div className={variant === 'main' ? 'a-nav' : 'a-sub'}>
      {items.map((it) => (
        <button key={it.id} type="button" className={value === it.id ? 'on' : ''} onClick={() => onChange(it.id)}>
          {it.label}
          {it.badge ? <span className="a-badge">{it.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ name, size = 40 }) {
  const ch = (name || '?').trim().charAt(0) || '?';
  return <div className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>{ch}</div>;
}
