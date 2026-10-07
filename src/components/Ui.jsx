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
