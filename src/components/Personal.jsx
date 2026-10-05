import React, { useCallback, useEffect, useState } from 'react';
import { fetchItemsOf, fetchNotes, addNote, updateNote, deleteNote } from '../lib/api';

function NoteRow({ n, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(n.name);
  const [note, setNote] = useState(n.note);
  const [open, setOpen] = useState(false);
  if (editing) {
    return (
      <div className="list-row">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" style={{ width: '100%', marginBottom: 6 }} />
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="설명 / 메모" rows={3} style={{ width: '100%' }} />
        <div className="admin-row-form" style={{ marginTop: 6 }}>
          <button className="accent" onClick={async () => { await onSave(n.id, name, note); setEditing(false); }}>저장</button>
          <button onClick={() => { setName(n.name); setNote(n.note); setEditing(false); }}>취소</button>
        </div>
      </div>
    );
  }
  return (
    <div className="list-row">
      <div className="row-top">
        <span className="row-title" onClick={() => setOpen(!open)}>{n.name}</span>
        <div className="row-actions">
          <button onClick={() => setEditing(true)}>수정</button>
          <button className="danger" onClick={() => { if (window.confirm('정말로 삭제하시겠습니까?')) onDelete(n.id); }}>삭제</button>
        </div>
      </div>
      {open && <div className="item-desc">{n.note ? n.note : '입력된 설명이 없습니다.'}</div>}
    </div>
  );
}

export default function Personal({ profile }) {
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState([]);
  const [openItem, setOpenItem] = useState(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const [i, n] = await Promise.allSettled([fetchItemsOf(profile.id), fetchNotes(profile.id)]);
    setItems(i.status === 'fulfilled' ? i.value : []);
    setNotes(n.status === 'fulfilled' ? n.value : []);
  }, [profile.id]);
  useEffect(() => { load(); }, [load]);

  async function add(e) {
    e.preventDefault();
    setErr('');
    try { await addNote(name, note); setName(''); setNote(''); await load(); }
    catch (ex) { setErr(ex.message || '오류가 발생했습니다.'); }
  }

  return (
    <>
      <div className="board-title-bar"><h2>개인</h2><span className="count">{profile.character_name}</span></div>
      <div className="board-note" style={{ padding: '10px 4px' }}>
        내 캐릭터의 소지품 메모장이에요. 직접 적은 항목은 채팅으로 양도할 수 없고, 관리자가 확인할 수 있어요.
      </div>

      <div className="field-label">소지품 (자동)</div>
      {items.length === 0 ? <div className="empty-state" style={{ padding: '18px 0' }}>보유한 소지품이 없습니다.</div> : items.map((it) => (
        <div key={it.id} className="list-row">
          <div className="row-top">
            <span className="row-title" onClick={() => setOpenItem(openItem === it.id ? null : it.id)}>{it.name}{it.qty > 1 ? ` x${it.qty}` : ''}</span>
          </div>
          {openItem === it.id && <div className="item-desc">{it.description ? it.description : '입력된 효과가 없습니다.'}</div>}
        </div>
      ))}

      <div className="field-label">내가 적은 항목</div>
      {notes.length === 0 && <div className="empty-state" style={{ padding: '18px 0' }}>아직 적은 항목이 없습니다.</div>}
      {notes.map((n) => (
        <NoteRow key={n.id + n.name + n.note} n={n}
          onSave={async (id, nm, nt) => { try { await updateNote(id, nm, nt); await load(); } catch (ex) { window.alert(ex.message); } }}
          onDelete={async (id) => { await deleteNote(id); await load(); }} />
      ))}

      <form className="list-row" onSubmit={add}>
        {err && <div className="auth-error">{err}</div>}
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="새 항목 이름" style={{ width: '100%', marginBottom: 6 }} />
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="설명 / 메모 (선택)" rows={3} style={{ width: '100%' }} />
        <div className="admin-row-form" style={{ marginTop: 6 }}><button className="accent" type="submit">추가</button></div>
      </form>
    </>
  );
}
