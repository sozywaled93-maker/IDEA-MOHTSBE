import { useEffect, useState } from 'react'
import { BlurInput } from '../../components/BlurInput.jsx'
import DebInput from '../../components/DebInput.jsx'
import { debSave } from '../../lib/debounce.js'
import { useLang } from '../../lib/i18n.jsx'
import { listRows, insertRow, updateRow, deleteRow } from '../../lib/db.js'
import { Modal, EmptyState } from '../../components/ui.jsx'
import { tgSend, eventMessage, taskMessage } from '../../lib/telegram.js'
import { loadSettings } from '../../lib/supabase.js'

export default function TasksPage() {
  const { t } = useLang()
  const [quotes, setQuotes] = useState([])
  const [tasks, setTasks] = useState([])
  const [employees, setEmployees] = useState([])
  const [eventId, setEventId] = useState('')
  const [empModal, setEmpModal] = useState(false)
  const [settings, setSettings] = useState(null)
  const [broadcast, setBroadcast] = useState(null)   // { text, selected: Set }

  const load = () => {
    listRows('quotes').then(setQuotes)
    listRows('tasks').then(setTasks)
    listRows('employees').then(setEmployees)
  }
  useEffect(() => { load(); loadSettings().then(setSettings) }, [])

  const token = settings?.telegram_bot_token
  const empById = (id) => employees.find((e) => e.id === id)
  const doneButton = (task) => [[{ text: '✅ تم التنفيذ', callback_data: `taskDone:${task.id}` }]]

  const sendTask = async (task) => {
    const emp = empById(task.employee_id)
    if (!emp) return alert(t('assignFirst'))
    try {
      await tgSend(token, emp.telegram_chat_id, taskMessage(task, event), doneButton(task))
      alert(`✓ ${t('sentTo')} ${emp.name}`)
    } catch (e) { alert(e.message) }
  }

  const sendAllTasks = async () => {
    let ok = 0, fail = 0
    for (const x of eventTasks.filter((x) => x.employee_id && !x.done)) {
      const emp = empById(x.employee_id)
      try { await tgSend(token, emp?.telegram_chat_id, taskMessage(x, event), doneButton(x)); ok++ }
      catch { fail++ }
    }
    alert(`${t('sentCount')}: ${ok}${fail ? ` — ${t('failedCount')}: ${fail}` : ''}`)
  }

  const sendEventInfo = async () => {
    const assigned = [...new Set(eventTasks.map((x) => x.employee_id).filter(Boolean))]
    const targets = assigned.length ? assigned.map(empById) : employees
    let ok = 0, fail = 0
    for (const emp of targets) {
      try { await tgSend(token, emp?.telegram_chat_id, eventMessage(event)); ok++ }
      catch { fail++ }
    }
    alert(`${t('sentCount')}: ${ok}${fail ? ` — ${t('failedCount')}: ${fail}` : ''}`)
  }

  const doBroadcast = async () => {
    let ok = 0, fail = 0
    for (const emp of employees.filter((e) => broadcast.selected.has(e.id))) {
      try { await tgSend(token, emp.telegram_chat_id, '📢 ' + broadcast.text); ok++ }
      catch { fail++ }
    }
    alert(`${t('sentCount')}: ${ok}${fail ? ` — ${t('failedCount')}: ${fail}` : ''}`)
    setBroadcast(null)
  }

  const event = quotes.find((q) => q.id === eventId)
  const eventTasks = tasks.filter((x) => (x.quote_id || '') === (eventId || ''))
  const doneCount = eventTasks.filter((x) => x.done).length

  const addTask = async () => {
    await insertRow('tasks', { quote_id: eventId || null, title: '', note: '', done: false, employee_id: null })
    load()
  }
  const patch = (id, k, v) => {
    setTasks((p) => p.map((x) => x.id === id ? { ...x, [k]: v } : x))
    debSave('tasks', id, { [k]: v })
  }

  const addEmployee = async (name, phone) => {
    if (!name.trim()) return
    await insertRow('employees', { name: name.trim(), phone: phone.trim() })
    load()
  }

  return (
    <div>
      <h1 className="page-title">{t('tasks')}</h1>

      <div className="toolbar">
        <select className="cat-filter" value={eventId} onChange={(e) => setEventId(e.target.value)}>
          <option value="">📌 {t('generalTasks')}</option>
          {quotes.map((q) => <option key={q.id} value={q.id}>{q.conference_name}</option>)}
        </select>
        <button className="add-btn" onClick={addTask}>+ {t('addTask')}</button>
        <span className="hint-inline">👥 {t('employees')}: {employees.length} — {t('manageInSettings')}</span>
      </div>

      {event && (
        <div className="card">
          <h3>{event.conference_name}</h3>
          <div className="entity-meta" style={{ flexDirection: 'row', gap: 18, flexWrap: 'wrap' }}>
            <span>📅 {event.date_from || '—'} {event.date_to ? '← ' + event.date_to : ''}</span>
            <span>📍 {event.location || '—'}</span>
            <span>✅ {doneCount} / {eventTasks.length} {t('tasksDone')}</span>
          </div>
          {eventTasks.length > 0 && (
            <div className="progress"><div style={{ width: `${eventTasks.length ? (doneCount / eventTasks.length) * 100 : 0}%` }} /></div>
          )}
        </div>
      )}

      {eventTasks.length === 0 ? <EmptyState /> : (
        <div className="task-list">
          {eventTasks.map((x) => (
            <div className={`task-row ${x.done ? 'done' : ''}`} key={x.id}>
              <input type="checkbox" checked={!!x.done} onChange={(e) => patch(x.id, 'done', e.target.checked)} />
              <BlurInput className="task-title" placeholder={t('taskPlaceholder')} value={x.title || ''}
                onCommit={(v) => patch(x.id, 'title', v)} />
              <BlurInput className="task-note" placeholder={t('notes')} value={x.note || ''}
                onCommit={(v) => patch(x.id, 'note', v)} />
              <select value={x.employee_id || ''} onChange={(e) => patch(x.id, 'employee_id', e.target.value || null)}>
                <option value="">— {t('assignTo')} —</option>
                {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </select>
              <button className="mini-btn tg" title={t('sendTask')} disabled={!x.employee_id}
                onClick={() => sendTask(x)}>📤</button>
              <button className="icon-btn" onClick={async () => { await deleteRow('tasks', x.id); load() }}>✕</button>
            </div>
          ))}
        </div>
      )}

      <p className="hint-inline" style={{ marginTop: 14 }}>🤖 {t('telegramNote')}</p>

      {broadcast && (
        <Modal title={t('broadcast')} onClose={() => setBroadcast(null)}>
          <div className="field"><label>{t('broadcastMsg')}</label>
            <textarea rows={3} value={broadcast.text} onChange={(e) => setBroadcast((p) => ({ ...p, text: e.target.value }))} />
          </div>
          <div className="field"><label>{t('sendToWhom')}</label>
            {employees.map((emp) => (
              <label className="check-row" key={emp.id} style={{ padding: '4px 0' }}>
                <input type="checkbox" checked={broadcast.selected.has(emp.id)}
                  onChange={(e) => setBroadcast((p) => {
                    const sel = new Set(p.selected)
                    e.target.checked ? sel.add(emp.id) : sel.delete(emp.id)
                    return { ...p, selected: sel }
                  })} />
                {emp.name} {!emp.telegram_chat_id && <small className="hint-inline">({t('noTelegram')})</small>}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="save-btn" disabled={!broadcast.text.trim() || !broadcast.selected.size} onClick={doBroadcast}>
              📢 {t('sendNow')}
            </button>
          </div>
        </Modal>
      )}
      {empModal && (
        <Modal title={t('employees')} onClose={() => setEmpModal(false)}>
          {employees.map((emp) => (
            <div className="manage-row" key={emp.id}>
              <span>{emp.name} {emp.phone && <small dir="ltr" style={{ color: '#888' }}>({emp.phone})</small>}</span>
              <button className="icon-btn" onClick={async () => { await deleteRow('employees', emp.id); load() }}>✕</button>
            </div>
          ))}
          <EmpForm onAdd={addEmployee} t={t} />
        </Modal>
      )}
    </div>
  )
}

function EmpForm({ onAdd, t }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  return (
    <div className="sub-item-row" style={{ marginTop: 12 }}>
      <input placeholder={t('supplierName').replace(t('suppliers'), '') || 'الاسم'} value={name} onChange={(e) => setName(e.target.value)} />
      <input dir="ltr" placeholder={t('phone')} value={phone} onChange={(e) => setPhone(e.target.value)} />
      <button className="mini-btn ok" onClick={() => { onAdd(name, phone); setName(''); setPhone('') }}>✓</button>
    </div>
  )
}
