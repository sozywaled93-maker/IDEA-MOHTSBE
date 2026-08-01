import { useEffect, useMemo, useState } from 'react'
import { BlurInput } from '../../components/BlurInput.jsx'
import { Modal, EmptyState } from '../../components/ui.jsx'
import { TelegramBadge } from '../../components/TelegramBadge.jsx'
import { useLang } from '../../lib/i18n.jsx'
import { listRows, insertRow, updateRow, deleteRow } from '../../lib/db.js'
import { debSave } from '../../lib/debounce.js'
import { loadSettings } from '../../lib/supabase.js'
import { tgSend } from '../../lib/telegram.js'
import { autoInviteContacts } from '../../lib/telegramInvite.js'

const STATUSES = ['open', 'in_progress', 'done', 'cancelled']
const statusIcon = { open: '🟡', in_progress: '🔧', done: '✅', cancelled: '🚫' }

export default function WorkOrdersPage() {
  const { t } = useLang()
  const [orders, setOrders] = useState([])
  const [items, setItems] = useState([])
  const [conferences, setConferences] = useState([])
  const [quotes, setQuotes] = useState([])
  const [clients, setClients] = useState([])
  const [employees, setEmployees] = useState([])
  const [venues, setVenues] = useState([])
  const [librarySub, setLibrarySub] = useState([])
  const [settings, setSettings] = useState(null)
  const [open, setOpen] = useState(null)          // أمر الشغل المفتوح للتحرير
  const [filter, setFilter] = useState('all')     // all | open | done
  const [empFilter, setEmpFilter] = useState('all')
  const [inviteResult, setInviteResult] = useState(null)

  const [syncing, setSyncing] = useState(false)

  // مزامنة تلقائية: كل عرض سعر فيه موردين => أمر شغل لكل مورد
  const syncFromQuotes = async () => {
    setSyncing(true)
    try {
      const [qs, wos, sups, confs] = await Promise.all([
        listRows('quotes').catch(() => []), listRows('work_orders').catch(() => []),
        listRows('suppliers').catch(() => []), listRows('conferences').catch(() => []),
      ])
      let touched = 0
      for (const q of qs) {
        let d = {}
        try { d = typeof q.data === 'string' ? JSON.parse(q.data || '{}') : (q.data || {}) } catch { d = {} }
        const halls = d.halls || [], qItems = d.items || []
        // تجميع بنود كل مورد
        const bySup = {}
        for (const it of qItems) {
          if (!it.supplier_id) continue
          let qty = 0
          for (const h of halls) qty += +(it.cells?.[h.key]?.units || 0)
          if (!qty && !it.item_name) continue
          ;(bySup[it.supplier_id] ||= []).push({ name: it.item_name, note: it.item_note, qty, unit: it.unit || '' })
        }
        const conf = confs.find((c) => c.id === q.conference_id)
        for (const [sid, rows] of Object.entries(bySup)) {
          const prev = wos.find((w) => w.quote_id === q.id && w.supplier_id === sid)
          if (prev) continue   // موجود بالفعل — لا نلمسه حتى لا نضيع تعديلات المستخدم
          const sup = sups.find((x) => x.id === sid)
          const r = await insertRow('work_orders', {
            quote_id: q.id, conference_id: q.conference_id || null, client_id: q.client_id || null,
            supplier_id: sid,
            title: (sup?.supplier_name || '') + ' — ' + (q.conference_name || ''),
            location: conf ? [conf.location, conf.hall_name].filter(Boolean).join(' — ') : (q.location || ''),
            date_from: q.date_from || null, date_to: q.date_to || null,
            setup_time: q.date_from ? new Date(new Date(q.date_from).getTime() - 864e5).toISOString().slice(0, 10) : '',
            status: 'open',
          }).catch(() => null)
          if (!r?.id) continue
          touched++
          let o = 0
          for (const it of rows) {
            await insertRow('work_order_items', {
              work_order_id: r.id, item_name: it.name || '', qty: +it.qty || 0,
              unit: it.unit || '', days: 1, note: it.note || '', sort_order: o++,
            }).catch(() => {})
          }
        }
      }
      if (touched) load()
    } finally { setSyncing(false) }
  }

  const load = () => {
    listRows('work_orders').then(setOrders).catch(() => setOrders([]))
    listRows('work_order_items').then(setItems).catch(() => setItems([]))
    listRows('conferences').then(setConferences).catch(() => setConferences([]))
    listRows('quotes').then(setQuotes).catch(() => setQuotes([]))
    listRows('clients').then(setClients).catch(() => setClients([]))
    listRows('employees').then(setEmployees).catch(() => setEmployees([]))
    listRows('venues').then(setVenues).catch(() => setVenues([]))
    listRows('library_sub').then(setLibrarySub).catch(() => setLibrarySub([]))
  }
  useEffect(() => { load(); loadSettings().then(setSettings); syncFromQuotes() }, [])

  // قفل تلقائي: أي أمر شغل مؤتمره خلص يتحوّل إلى "منتهي"
  useEffect(() => {
    if (!orders.length || !conferences.length) return
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const ended = []
    for (const o of orders) {
      if (o.status === 'done' || o.status === 'cancelled') continue
      const conf = conferences.find((c) => c.id === o.conference_id)
      const endStr = conf?.date_to || conf?.date_from || o.date_to || o.date_from
      if (!endStr) continue
      const end = new Date(endStr); end.setHours(0, 0, 0, 0)
      if (end < today) ended.push(o.id)
    }
    if (!ended.length) return
    Promise.all(ended.map((id) => updateRow('work_orders', id, { status: 'done' }).catch(() => {})))
      .then(() => setOrders((p) => p.map((o) => ended.includes(o.id) ? { ...o, status: 'done' } : o)))
  }, [orders.length, conferences.length])

  const confName = (id) => conferences.find((c) => c.id === id)?.name || ''
  const empById = (id) => employees.find((e) => e.id === id)
  const orderItems = (id) => items.filter((i) => i.work_order_id === id)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))

  const visible = useMemo(() => orders.filter((o) => {
    if (filter === 'open' && (o.status === 'done' || o.status === 'cancelled')) return false
    if (filter === 'done' && o.status !== 'done') return false
    if (empFilter !== 'all' && o.employee_id !== empFilter) return false
    return true
  }).sort((a, b) => (b.wo_number || 0) - (a.wo_number || 0)), [orders, filter, empFilter])

  const addOrder = async () => {
    const r = await insertRow('work_orders', {
      title: '', status: 'open', contacts: [], notes: '',
      date_from: new Date().toISOString().slice(0, 10),
    })
    load(); setOpen(r)
  }

  const patch = (id, p) => {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...p } : o)))
    setOpen((prev) => (prev && prev.id === id ? { ...prev, ...p } : prev))
    debSave('work_orders', id, p)
  }

  // ===== إرسال أمر الشغل للموظف على تليجرام =====
  const buildMessage = (o) => {
    const its = orderItems(o.id)
    const emp = empById(o.employee_id)
    const venue = venues.find((v) => v.id === o.venue_id)
    const lines = [
      `🧾 <b>${t('workOrder')} #${o.wo_number}${o.title ? ' — ' + o.title : ''}</b>`,
      `🔑 ${t('orderKey')}: <code>${o.order_key}</code>`,
      o.conference_id ? `🎪 ${confName(o.conference_id)}` : '',
      venue ? `🏨 ${venue.hotel_name}${venue.hall_name ? ' — ' + venue.hall_name : ''}` : (o.location ? `📍 ${o.location}` : ''),
      o.date_from ? `📅 ${o.date_from}${o.date_to ? ' ← ' + o.date_to : ''}` : '',
      o.setup_time ? `🛠 ${t('setupTime')}: ${o.setup_time}` : '',
      o.start_time ? `⏰ ${t('startTime')}: ${o.start_time}` : '',
      emp ? `👷 ${emp.name}` : '',
    ].filter(Boolean)

    if (its.length) {
      lines.push('', `<b>📋 ${t('orderItems')} (${its.length}):</b>`)
      its.forEach((it, i) => {
        lines.push(`${i + 1}. ${it.item_name} — ${it.qty || 1} ${it.unit || ''}` +
          (Number(it.days) > 1 ? ` × ${it.days} ${t('daysWord')}` : '') +
          (it.note ? `\n     📝 ${it.note}` : ''))
      })
    }

    const cts = Array.isArray(o.contacts) ? o.contacts.filter((c) => c.phone || c.name) : []
    if (cts.length) {
      lines.push('', `<b>📞 ${t('orderContacts')}:</b>`)
      cts.forEach((c) => lines.push(`• ${c.name || ''}${c.role ? ' (' + c.role + ')' : ''} — ${c.phone || ''}`))
    }

    if (o.notes) lines.push('', `📝 ${o.notes}`)
    lines.push('', t('orderKeyHint'))
    return lines.join('\n')
  }

  const sendToEmployee = async (o) => {
    const emp = empById(o.employee_id)
    if (!emp) return alert(t('assignFirst'))
    if (!emp.telegram_chat_id) return alert(t('empNotLinked'))
    try {
      await tgSend(settings?.telegram_bot_token, emp.telegram_chat_id, buildMessage(o))
      await updateRow('work_orders', o.id, { sent_at: new Date().toISOString() })
      alert(`✓ ${t('sentTo')} ${emp.name}`)
      load()
    } catch (e) { alert(e.message) }
  }

  const inviteContacts = async (o) => {
    try {
      const res = await autoInviteContacts(Array.isArray(o.contacts) ? o.contacts : [])
      if (!res.length) return alert(t('noNewNumbers'))
      setInviteResult(res)
    } catch (e) { alert(e.message) }
  }

  return (
    <div>
      <h1 className="page-title">{t('workorders')}</h1>
      <p className="page-sub">{t('workordersSub')}</p>

      <div className="toolbar">
        <select className="cat-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">— {t('allOrders')} —</option>
          <option value="open">{t('openOrders')}</option>
          <option value="done">{t('doneOrders')}</option>
        </select>
        <select className="cat-filter" value={empFilter} onChange={(e) => setEmpFilter(e.target.value)}>
          <option value="all">— {t('allEmployees')} —</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <button className="add-btn" onClick={addOrder}>+ {t('addWorkOrder')}</button>
      </div>

      {visible.length === 0 ? <EmptyState /> : (
        <div className="cards-grid">
          {visible.map((o) => {
            const emp = empById(o.employee_id)
            const its = orderItems(o.id)
            return (
              <div className="entity-card" key={o.id}>
                <div className="entity-head">
                  <b>{statusIcon[o.status] || '🟡'} #{o.wo_number} {o.title || confName(o.conference_id) || t('noTitle')}</b>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <label className="check-row" style={{ padding: 0, fontSize: 12.5 }} title={t('closeWorkOrder')}>
                      <input type="checkbox" checked={o.status === 'done'}
                        onChange={(e) => patch(o.id, { status: e.target.checked ? 'done' : 'open' })} />
                      {o.status === 'done' ? t('wo_done') : t('closeWorkOrder')}
                    </label>
                    <span className="badge">{its.length} {t('itemsWord')}</span>
                  </span>
                </div>
                <div className="entity-meta">
                  <span>🔑 <code>{o.order_key}</code></span>
                  {o.conference_id && <span>🎪 {confName(o.conference_id)}</span>}
                  <span>📅 {o.date_from || '—'}{o.date_to ? ' ← ' + o.date_to : ''}</span>
                  <span>
                    👷 {emp?.name || t('unassigned')}
                    {emp && <> <TelegramBadge row={emp} small /></>}
                  </span>
                  {o.sent_at && <span className="hint-inline">📤 {t('sentAlready')}</span>}
                </div>
                <div className="entity-actions">
                  <button onClick={() => setOpen(o)}>{t('details')}</button>
                  <button className="tg" disabled={!o.employee_id} onClick={() => sendToEmployee(o)}>📤 {t('sendToEmp')}</button>
                  <button onClick={() => { navigator.clipboard?.writeText(o.order_key); alert('✓ ' + t('linkCopied')) }}>🔑</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {open && (() => {
        const o = orders.find((x) => x.id === open.id) || open
        return (
          <Modal title={`${t('workOrder')} #${o.wo_number}`} onClose={() => setOpen(null)} wide>
            <OrderEditor
              o={o} t={t} patch={patch}
              conferences={conferences} quotes={quotes} clients={clients}
              employees={employees} venues={venues} librarySub={librarySub}
              items={orderItems(o.id)} reload={load}
              onSend={() => sendToEmployee(o)}
              onInvite={() => inviteContacts(o)}
              onDelete={async () => {
                if (!confirm(t('confirmDelete'))) return
                await deleteRow('work_orders', o.id); setOpen(null); load()
              }}
            />
          </Modal>
        )
      })()}

      {inviteResult && (
        <Modal title={t('invitesReady')} onClose={() => setInviteResult(null)}>
          {inviteResult.map((r, i) => (
            <div className="manage-row" key={i}>
              <span>{r.name || '—'} <small dir="ltr" className="hint-inline">{r.phone}</small></span>
              {r.error ? <small style={{ color: '#A32D2D' }}>{r.error}</small> : (
                <button className="mini-btn ok" onClick={() => { navigator.clipboard?.writeText(r.link); alert('✓ ' + t('linkCopied')) }}>
                  🔗 {t('copyLink')}
                </button>
              )}
            </div>
          ))}
        </Modal>
      )}
    </div>
  )
}

/* ================================================================
 * محرر أمر الشغل
 * ================================================================ */
function OrderEditor({ o, t, patch, conferences, quotes, clients, employees, venues, librarySub, items, reload, onSend, onInvite, onDelete }) {
  const [picker, setPicker] = useState(false)

  const addItem = async (preset) => {
    await insertRow('work_order_items', {
      work_order_id: o.id,
      sub_id: preset?.id || null,
      item_name: preset?.name || '',
      qty: 1, unit: preset?.unit || 'قطعة', days: 1, note: '',
      sort_order: items.length,
    })
    reload()
  }
  const patchItem = (id, k, v) => debSave('work_order_items', id, { [k]: v })
  const delItem = async (id) => { await deleteRow('work_order_items', id); reload() }

  const contacts = Array.isArray(o.contacts) ? o.contacts : []
  const setContacts = (arr) => patch(o.id, { contacts: arr })

  return (
    <div>
      {/* ===== البيانات الأساسية ===== */}
      <div className="grid2">
        <div className="field"><label>{t('orderTitle')}</label>
          <BlurInput value={o.title || ''} onCommit={(v) => patch(o.id, { title: v })} placeholder={t('phWoTitle')} /></div>

        <div className="field"><label>{t('orderKey')}</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input dir="ltr" readOnly value={o.order_key || ''} style={{ flex: 1, fontWeight: 700, letterSpacing: 1 }} />
            <button type="button" className="mini-btn" onClick={() => { navigator.clipboard?.writeText(o.order_key); alert('✓') }}>📋</button>
          </div>
          <p className="hint-inline">{t('orderKeyFieldHint')}</p>
        </div>

        <div className="field"><label>{t('conferences')}</label>
          <select value={o.conference_id || ''} onChange={(e) => patch(o.id, { conference_id: e.target.value || null })}>
            <option value="">—</option>
            {conferences.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>

        <div className="field"><label>{t('quotes')}</label>
          <select value={o.quote_id || ''} onChange={(e) => patch(o.id, { quote_id: e.target.value || null })}>
            <option value="">—</option>
            {quotes.map((q) => <option key={q.id} value={q.id}>{q.conference_name}</option>)}
          </select></div>

        <div className="field"><label>{t('clients')}</label>
          <select value={o.client_id || ''} onChange={(e) => patch(o.id, { client_id: e.target.value || null })}>
            <option value="">—</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select></div>

        {/* ===== الإسناد ===== */}
        <div className="field"><label>{t('assignTo')} *</label>
          <select value={o.employee_id || ''} onChange={(e) => patch(o.id, { employee_id: e.target.value || null })}>
            <option value="">— {t('unassigned')} —</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}{e.job_title ? ` (${e.job_title})` : ''}{e.telegram_chat_id ? ' ✈️' : ''}
              </option>
            ))}
          </select>
          {o.employee_id && (() => {
            const emp = employees.find((x) => x.id === o.employee_id)
            return emp && !emp.telegram_chat_id
              ? <p className="hint-inline" style={{ color: '#A32D2D' }}>⚠️ {t('empNotLinked')}</p>
              : <TelegramBadge row={emp} small />
          })()}
        </div>

        <div className="field"><label>{t('venues')}</label>
          <select value={o.venue_id || ''} onChange={(e) => patch(o.id, { venue_id: e.target.value || null })}>
            <option value="">—</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.hotel_name}{v.hall_name ? ' — ' + v.hall_name : ''}</option>)}
          </select></div>

        <div className="field"><label>{t('location')}</label>
          <BlurInput value={o.location || ''} onCommit={(v) => patch(o.id, { location: v })} /></div>

        <div className="field"><label>{t('dateFrom')}</label>
          <input type="date" value={o.date_from || ''} onChange={(e) => patch(o.id, { date_from: e.target.value })} /></div>
        <div className="field"><label>{t('dateTo')}</label>
          <input type="date" value={o.date_to || ''} onChange={(e) => patch(o.id, { date_to: e.target.value })} /></div>

        <div className="field"><label>{t('setupTime')}</label>
          <BlurInput value={o.setup_time || ''} onCommit={(v) => patch(o.id, { setup_time: v })} placeholder={t('phSetupTime')} /></div>
        <div className="field"><label>{t('startTime')}</label>
          <BlurInput value={o.start_time || ''} onCommit={(v) => patch(o.id, { start_time: v })} placeholder={t('phStartTime')} /></div>

        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>{t('status')}</label>
          <div className="seg">
            {STATUSES.map((s) => (
              <button type="button" key={s} className={o.status === s ? 'active' : ''}
                onClick={() => patch(o.id, { status: s })}>{statusIcon[s]} {t('wo_' + s)}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ===== البنود ===== */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>📋 {t('orderItems')} ({items.length})</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="mini-btn" onClick={() => setPicker((v) => !v)}>🗂️ {t('fromLibrary')}</button>
            <button type="button" className="add-btn" onClick={() => addItem()}>+ {t('addItem')}</button>
          </div>
        </div>

        {picker && (
          <div className="manage-list" style={{ marginTop: 8, maxHeight: 220, overflow: 'auto' }}>
            {librarySub.length === 0 ? <p className="hint-inline">{t('noData')}</p> : librarySub.map((s) => (
              <div className="manage-row" key={s.id}>
                <span>{s.name} <small className="hint-inline">{s.unit}</small></span>
                <button type="button" className="mini-btn ok" onClick={() => { addItem(s); setPicker(false) }}>+</button>
              </div>
            ))}
          </div>
        )}

        {items.length === 0 ? <p className="hint-inline" style={{ marginTop: 10 }}>{t('noItemsYet')}</p> : (
          <div className="quote-scroll" style={{ marginTop: 10 }}>
            <table className="quote-table costs-table">
              <thead><tr>
                <th style={{ width: 32 }}>✓</th>
                <th>{t('itemName')}</th><th style={{ width: 80 }}>{t('qty')}</th>
                <th style={{ width: 100 }}>{t('unit')}</th><th style={{ width: 80 }}>{t('daysWord')}</th>
                <th>{t('notes')}</th><th style={{ width: 40 }}></th>
              </tr></thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td><input type="checkbox" defaultChecked={!!it.done}
                      onChange={(e) => patchItem(it.id, 'done', e.target.checked)} /></td>
                    <td><BlurInput value={it.item_name || ''} onCommit={(v) => patchItem(it.id, 'item_name', v)} placeholder={t('itemName')} /></td>
                    <td><BlurInput className="num" type="number" min="0" value={it.qty ?? 1} onCommit={(v) => patchItem(it.id, 'qty', +v)} /></td>
                    <td><BlurInput value={it.unit || ''} onCommit={(v) => patchItem(it.id, 'unit', v)} /></td>
                    <td><BlurInput className="num" type="number" min="1" value={it.days ?? 1} onCommit={(v) => patchItem(it.id, 'days', +v)} /></td>
                    <td><BlurInput value={it.note || ''} onCommit={(v) => patchItem(it.id, 'note', v)} /></td>
                    <td><button type="button" className="icon-btn" onClick={() => delItem(it.id)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ===== أرقام التواصل ===== */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>📞 {t('orderContacts')}</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="mini-btn tg" onClick={onInvite}>🔗 {t('inviteAllNumbers')}</button>
            <button type="button" className="add-btn"
              onClick={() => setContacts([...contacts, { name: '', phone: '', role: '' }])}>+ {t('addContact')}</button>
          </div>
        </div>
        <p className="hint-inline">{t('contactsHint')}</p>
        {contacts.map((c, i) => (
          <div className="sub-item-row" key={i} style={{ gridTemplateColumns: '1fr 1fr 1fr 36px' }}>
            <BlurInput value={c.name || ''} placeholder={t('empName')}
              onCommit={(v) => setContacts(contacts.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
            <BlurInput dir="ltr" value={c.phone || ''} placeholder={t('phone')}
              onCommit={(v) => setContacts(contacts.map((x, j) => (j === i ? { ...x, phone: v } : x)))} />
            <BlurInput value={c.role || ''} placeholder={t('jobTitle')}
              onCommit={(v) => setContacts(contacts.map((x, j) => (j === i ? { ...x, role: v } : x)))} />
            <button type="button" className="icon-btn"
              onClick={() => setContacts(contacts.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
      </div>

      <div className="field" style={{ marginTop: 14 }}>
        <label>{t('notes')}</label>
        <textarea rows={3} defaultValue={o.notes || ''} onBlur={(e) => patch(o.id, { notes: e.target.value })} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, gap: 8, flexWrap: 'wrap' }}>
        <button className="mini-btn" style={{ color: '#A32D2D' }} onClick={onDelete}>🗑 {t('delete')}</button>
        <button className="save-btn" disabled={!o.employee_id} onClick={onSend}>📤 {t('sendToEmp')}</button>
      </div>
    </div>
  )
}
