import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchItemsOf, fetchNotes, addNote, updateNote, deleteNote } from '../lib/api';

function QtyStepper({ value, onChange, min = 1, max = 999 }) {
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

function NoteRow({ n, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(n.name);
  const [note, setNote] = useState(n.note);
  const [qty, setQty] = useState(String(n.qty));
  const [err, setErr] = useState('');

  function open() { setName(n.name); setNote(n.note); setQty(String(n.qty)); setErr(''); setEditing(true); }
  async function save() {
    setErr('');
    try { await onSave(n.id, name, note, qty); setEditing(false); }
    catch (e) { setErr(e.message || '오류가 발생했습니다.'); }
  }

  if (editing) {
    return (
      <div className="pnote-edit">
        {err && <div className="auth-error">{err}</div>}
        <div className="pnote-add-row">
          <input className="txt-input" style={{ flex: 1, minWidth: 0 }} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" maxLength={40} />
          <QtyStepper value={qty} onChange={setQty} />
        </div>
        <input className="txt-input" style={{ width: '100%', marginTop: 8 }} type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="설명 (선택)" />
        <div className="admin-row-form" style={{ marginTop: 8 }}>
          <button className="accent" onClick={save}>저장</button>
          <button onClick={() => setEditing(false)}>취소</button>
        </div>
      </div>
    );
  }
  return (
    <div className="pnote-row">
      <div className="pnote-info">
        <div className="pnote-title">{n.name}{n.qty > 1 && <span className="pnote-qty">x{n.qty}</span>}</div>
        {n.note && <div className="pnote-note">{n.note}</div>}
      </div>
      <div className="row-actions">
        <button onClick={open}>수정</button>
        <button className="danger" onClick={() => { if (window.confirm('정말로 삭제하시겠습니까?')) onDelete(n.id); }}>삭제</button>
      </div>
    </div>
  );
}

export default function Personal({ profile }) {
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState([]);
  const [openItem, setOpenItem] = useState(null);
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const [showDesc, setShowDesc] = useState(false);
  const [err, setErr] = useState('');
  const nameRef = useRef(null);

  const load = useCallback(async () => {
    const [i, n] = await Promise.allSettled([fetchItemsOf(profile.id), fetchNotes(profile.id)]);
    setItems(i.status === 'fulfilled' ? i.value : []);
    setNotes(n.status === 'fulfilled' ? n.value : []);
  }, [profile.id]);
  useEffect(() => { load(); }, [load]);

  async function add(e) {
    e.preventDefault();
    setErr('');
    try {
      await addNote(name, note, qty);
      setName(''); setQty('1'); setNote(''); setShowDesc(false);
      await load();
      nameRef.current?.focus(); // 바로 다음 항목을 이어서 입력할 수 있게
    } catch (ex) { setErr(ex.message || '오류가 발생했습니다.'); }
  }

  return (
    <>
      <div className="board-title-bar"><h2>소지품</h2><span className="count">{profile.character_name}</span></div>
      <div className="board-note" style={{ padding: '10px 4px' }}>
        개인 기재에 직접 적은 항목은 채팅으로 양도할 수 없고, 관리자가 볼 수 있어요.
      </div>

      <div className="field-label">소지품</div>
      {items.length === 0 ? <div className="empty-state" style={{ padding: '18px 0' }}>보유한 소지품이 없습니다.</div> : items.map((it) => (
        <div key={it.id} className="pnote-row" style={{ cursor: 'pointer' }} onClick={() => setOpenItem(openItem === it.id ? null : it.id)}>
          <div className="pnote-info">
            <div className="pnote-title">{it.name}{it.qty > 1 && <span className="pnote-qty">x{it.qty}</span>}</div>
            {openItem === it.id && <div className="pnote-note">{it.description ? it.description : '입력된 효과가 없습니다.'}</div>}
          </div>
        </div>
      ))}

      <div className="field-label">개인 기재 ({notes.length})</div>
      <form className="pnote-add" onSubmit={add}>
        <div className="pnote-add-row">
          <input ref={nameRef} className="txt-input" style={{ flex: 1, minWidth: 0 }} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="이름 입력 후 Enter" maxLength={40} />
          <QtyStepper value={qty} onChange={setQty} />
          <button type="submit" className="pnote-add-btn">추가</button>
        </div>
        {showDesc
          ? <input className="txt-input" style={{ width: '100%', marginTop: 8 }} type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="설명 (선택)" />
          : <button type="button" className="link-btn" onClick={() => setShowDesc(true)}>+ 설명 추가 (선택)</button>}
        {err && <div className="auth-error" style={{ marginTop: 8, marginBottom: 0 }}>{err}</div>}
      </form>
      {notes.length === 0 && <div className="empty-state" style={{ padding: '14px 0' }}>아직 적은 항목이 없습니다.</div>}
      {notes.map((n) => (
        <NoteRow key={n.id} n={n}
          onSave={async (id, nm, nt, q) => { await updateNote(id, nm, nt, q); await load(); }}
          onDelete={async (id) => { await deleteNote(id); await load(); }} />
      ))}
    </>
  );
}
