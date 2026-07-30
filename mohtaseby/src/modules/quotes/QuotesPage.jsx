import { useEffect, useMemo, useState } from 'react'
import { useLang } from '../../lib/i18n.jsx'
import { listRows, insertRow, updateRow, deleteRow } from '../../lib/db.js'
import { fmt } from '../../lib/tafqeet.js'
import { Modal, ConfirmDelete, EmptyState } from '../../components/ui.jsx'
import { exportQuote } from '../exports/exportQuote.js'

// بنية العرض داخل الواجهة:
// quote { header..., is_taxable, halls: [{key, name}], items: [{key, equipment_id, item_name, unit, supplier_id, cost_price, cells: {hallKey: {units, price, days, note}}}] }

const newQuote = () => ({
  conference_id: '', conference_name: '', client_id: '', date_from: '', date_to: '', location: '',
  is_taxable: true, include_stamp: false, include_signature: false,
  doc_type: 'proposal', preamble: '', payments: [], finished: false, einvoice_done: false,
  beneficiary: '', show_org: true, show_notes: true, preparing: false,
  halls: [], items: [],
})

const DRAFT_KEY = 'mohtaseby_open_quote'

const rowTotal = (c) => (+c.units || 0) * (+c.price || 0) * (+c.days || 0)

export default function QuotesPage() {
  const { t, lang } = useLang()
  const [quotes, setQuotes] = useState([])
  const [clients, setClients] = useState([])
  const [equipment, setEquipment] = useState([])
  const [links, setLinks] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [settings, setSettings] = useState(null)
  const [q, setQ] = useState(() => {            // العرض المفتوح — يفضل مفتوح حتى لو خرجت
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) } catch { return null }
  })
  const [picker, setPicker] = useState(null)    // { rowKey, itemId, options }
  const [del, setDel] = useState(null)
  const [exp, setExp] = useState(null)          // عرض للتصدير
  const [workOrder, setWorkOrder] = useState(false)
  const [status, setStatus] = useState('idle')
  const [preambles, setPreambles] = useState([])
  const [conferences, setConferences] = useState([])
  const [mains, setMains] = useState([])
  const [libSubs, setLibSubs] = useState([])
  const [subPrices, setSubPrices] = useState([])
  const [supplierMains, setSupplierMains] = useState([])
  const [showProfit, setShowProfit] = useState(true)
  const [venues, setVenues] = useState([])

  useEffect(() => {
    if (q) localStorage.setItem(DRAFT_KEY, JSON.stringify(q))
    else localStorage.removeItem(DRAFT_KEY)
  }, [q])

  useEffect(() => {
    listRows('quotes').then(setQuotes)
    listRows('clients').then(setClients)
    listRows('equipment_library').then(setEquipment)
    listRows('equipment_suppliers', 'id').then(setLinks)
    listRows('suppliers').then(setSuppliers)
    listRows('preambles').then(setPreambles)
    listRows('conferences').then(setConferences)
    listRows('library_main').then(setMains)
    listRows('library_sub').then(setLibSubs)
    listRows('sub_supplier_prices', 'id').then(setSubPrices)
    listRows('supplier_main_items', 'id').then(setSupplierMains)
    listRows('venues').then(setVenues)
    import('../../lib/supabase.js').then((m) => m.loadSettings().then(setSettings))
  }, [])

  const supName = (id) => suppliers.find((s) => s.id === id)?.supplier_name || ''

  // ===== إدارة القاعات =====
  const addHall = () => {
    const name = prompt(t('enterHallName'))
    if (!name?.trim()) return
    const dd = defaultDays()
    setQ((p) => ({
      ...p,
      halls: [...p.halls, { key: crypto.randomUUID(), name: name.trim() }],
      items: p.items.map((it) => ({ ...it })),  // no-op placeholder to keep structure
    }))
    // تعبئة الأيام الافتراضية للقاعة الجديدة في كل الصفوف
    setQ((p) => {
      const newHallKey = p.halls[p.halls.length - 1]?.key
      if (!newHallKey) return p
      return { ...p, items: p.items.map((it) => ({ ...it, cells: { ...it.cells, [newHallKey]: { ...(it.cells[newHallKey] || {}), days: it.cells[newHallKey]?.days ?? dd } } })) }
    })
  }
  const removeHall = (key) => setQ((p) => ({
    ...p,
    halls: p.halls.filter((h) => h.key !== key),
    items: p.items.map((it) => { const c = { ...it.cells }; delete c[key]; return { ...it, cells: c } }),
  }))

  // ===== إدارة الصفوف =====
  const defaultDays = () => {
    if (q.date_from && q.date_to) {
      const d = Math.round((new Date(q.date_to) - new Date(q.date_from)) / 864e5) + 1
      return Math.max(1, d)
    }
    return 1
  }
  const addRow = () => setQ((p) => {
    const dd = defaultDays()
    const cells = {}
    for (const h of p.halls) cells[h.key] = { days: dd }
    return { ...p, items: [...p.items, { key: crypto.randomUUID(), equipment_id: '', item_name: '', unit: '', supplier_id: '', cost_price: 0, cells }] }
  })
  const removeRow = (key) => setQ((p) => ({ ...p, items: p.items.filter((i) => i.key !== key) }))

  const setItem = (key, patch) => setQ((p) => ({
    ...p, items: p.items.map((i) => (i.key === key ? { ...i, ...patch } : i)),
  }))
  const setCell = (rowKey, hallKey, field, value) => setQ((p) => ({
    ...p,
    items: p.items.map((i) => i.key === rowKey
      ? { ...i, cells: { ...i.cells, [hallKey]: { ...(i.cells[hallKey] || {}), [field]: value } } }
      : i),
  }))

  // ===== اختيار البند: منطق الموردين =====
  const supplierOf = (id) => suppliers.find((s) => s.id === id)

  // البند الأساسي → الموردون المرتبطون به → بنوده الفرعية بأسعار هذا المورد
  const pickEquipment = (rowKey, mainId) => {
    const m = mains.find((x) => x.id === mainId)
    if (!m) return setItem(rowKey, { equipment_id: '', supplier_id: '', cost_price: 0 })
    const linkedSups = suppliers.filter((sp) => supplierMains.some((x) => x.main_id === mainId && x.supplier_id === sp.id))
    setItem(rowKey, { equipment_id: mainId })
    if (linkedSups.length === 0) {
      setItem(rowKey, { equipment_id: mainId, item_name: m.name })
    } else if (linkedSups.length === 1) {
      openSubStep(rowKey, m, linkedSups[0])
    } else {
      setPicker({ rowKey, main: m, step: 'supplier', options: linkedSups })
    }
  }

  const openSubStep = (rowKey, m, sup) => {
    const subsOfMain = libSubs.filter((x) => x.main_id === m.id)
    setItem(rowKey, { supplier_id: sup.id })
    if (subsOfMain.length === 0) {
      setItem(rowKey, { item_name: m.name, supplier_id: sup.id })
      setPicker(null)
    } else {
      setPicker({ rowKey, main: m, step: 'subitem', supplier: sup, subs: subsOfMain })
    }
  }

  const supCostOf = (subId, supId) => subPrices.find((p) => p.sub_id === subId && p.supplier_id === supId)?.cost_price

  const choosePickerSupplier = (sup) => openSubStep(picker.rowKey, picker.main, sup)

  const choosePickerSubItem = (sub) => {
    const row = subPrices.find((p) => p.sub_id === sub.id && p.supplier_id === picker.supplier.id)
    const cost = +(row?.cost_price) || 0
    const sell = +(row?.sell_price) || +sub.client_price || 0
    setItem(picker.rowKey, { item_name: sub.name, unit: sub.unit || '', cost_price: cost })
    applyPrice(picker.rowKey, sell || cost)
    setPicker(null)
  }

  const applyPrice = (rowKey, price) => setQ((p) => ({
    ...p,
    items: p.items.map((i) => {
      if (i.key !== rowKey) return i
      const cells = { ...i.cells }
      for (const h of p.halls) cells[h.key] = { ...(cells[h.key] || {}), price: cells[h.key]?.price || price }
      return { ...i, cells }
    }),
  }))

  // ===== الإجماليات =====
  const totals = useMemo(() => {
    if (!q) return null
    const hallSubs = {}
    for (const h of q.halls) hallSubs[h.key] = q.items.reduce((s, i) => s + rowTotal(i.cells[h.key] || {}), 0)
    const subtotal = Object.values(hallSubs).reduce((a, b) => a + b, 0)
    const wht = q.is_taxable ? subtotal * 0.03 : 0
    const vat = q.is_taxable ? subtotal * 0.14 : 0
    return { hallSubs, subtotal, wht, vat, grand: subtotal - wht + vat }
  }, [q])

  // ===== حفظ =====
  const save = async () => {
    if (!q.conference_name.trim()) return alert(t('required') + ': ' + t('conferenceName'))
    setStatus('saving')
    const payload = {
      conference_name: q.conference_name, client_id: q.client_id || null,
      date_from: q.date_from || null, date_to: q.date_to || null, location: q.location,
      is_taxable: q.is_taxable, include_stamp: q.include_stamp, include_signature: q.include_signature,
      doc_type: q.doc_type || 'proposal', preamble: q.preamble || '',
      beneficiary: q.beneficiary || '', show_org: q.show_org !== false, show_notes: q.show_notes !== false,
      preparing: !!q.preparing,
      payments: JSON.stringify(q.payments || []),
      finished: !!q.finished, einvoice_done: !!q.einvoice_done,
      subtotal: totals.subtotal, wht_amount: totals.wht, vat_amount: totals.vat, grand_total: totals.grand,
      data: JSON.stringify({ halls: q.halls, items: q.items }),
    }
    payload.conference_id = q.conference_id || null
    let saved
    if (q.id) {
      saved = await updateRow('quotes', q.id, payload)
      if (!saved) {
        // العرض المفتوح كان يشير لسجل محذوف أو غير موجود (مثلاً بعد تغيير قاعدة البيانات) — ننشئه من جديد
        saved = await insertRow('quotes', payload)
      }
    } else {
      saved = await insertRow('quotes', payload)
    }

    // مزامنة بيانات المؤتمر الأصلي إذا تغيّرت
    if (q.conference_id) {
      const c = conferences.find((x) => x.id === q.conference_id)
      const changed = c && (c.name !== q.conference_name || (c.date_from || '') !== (q.date_from || '') || (c.date_to || '') !== (q.date_to || ''))
      if (changed && confirm(t('updateConfQ'))) {
        const updated = await updateRow('conferences', q.conference_id, {
          name: q.conference_name, date_from: q.date_from || null, date_to: q.date_to || null, location: q.location,
        })
        if (!updated) console.warn('conference not found, skipped sync:', q.conference_id)
        setConferences(await listRows('conferences'))
      }
    }
    setQ((p) => ({ ...p, id: saved.id }))
    setQuotes(await listRows('quotes'))
    setStatus('saved'); setTimeout(() => setStatus('idle'), 2000)
  }

  const openQuote = (row) => {
    const d = row.data ? JSON.parse(row.data) : { halls: [], items: [] }
    const pays = typeof row.payments === 'string' ? JSON.parse(row.payments || '[]') : (row.payments || [])
    setQ({ ...row, payments: pays, halls: d.halls || [], items: d.items || [] })
  }

  const convertToInvoice = async (row) => {
    await updateRow('quotes', row.id, { doc_type: 'invoice' })
    setQuotes(await listRows('quotes'))
  }

  const paid = (pays) => (pays || []).reduce((s, p) => s + (+p.amount || 0), 0)

  // ============ قائمة العروض ============
  if (!q) return (
    <div>
      <h1 className="page-title">{t('quotes')}</h1>
      <div className="toolbar">
        <button className="save-btn" onClick={() => setQ(newQuote())}>+ {t('newQuote')}</button>
      </div>
      {quotes.length === 0 ? <EmptyState /> : (
        <div className="cards-grid">
          {quotes.map((r) => (
            <div className="entity-card" key={r.id}>
              <div className="entity-head">
                <b>{r.conference_name}</b>
                <span className={`badge ${r.doc_type === 'invoice' ? 'inv' : ''}`}>
                  {r.doc_type === 'invoice' ? t('invoice') : t('proposal')}
                </span>
              </div>
              <div className="entity-sub">{clients.find((c) => c.id === r.client_id)?.company_name || '—'}</div>
              <div className="entity-meta">
                <span>{r.date_from || ''} {r.date_to ? '← ' + r.date_to : ''} {r.location ? '· ' + r.location : ''}</span>
                <span><b>{fmt(r.grand_total)} EGP</b> · {r.is_taxable ? t('taxable') : t('nonTaxable')}</span>
                {r.doc_type === 'invoice' && (() => {
                  const pays = typeof r.payments === 'string' ? JSON.parse(r.payments || '[]') : (r.payments || [])
                  const p = paid(pays)
                  return <span>{t('collected')}: {fmt(p)} — <b style={{ color: r.grand_total - p > 0.01 ? '#A32D2D' : '#0F6E56' }}>{t('remainingAmt')}: {fmt(r.grand_total - p)}</b></span>
                })()}
              </div>
              <div className="entity-actions">
                <button onClick={() => openQuote(r)}>{t('edit')}</button>
                {r.doc_type !== 'invoice' && <button className="convert" onClick={() => convertToInvoice(r)}>{t('convertToInvoice')}</button>}
                <button onClick={() => setExp(r)}>{t('export')}</button>
                <button className="danger" onClick={() => setDel(r.id)}>{t('delete')}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {del && <ConfirmDelete onCancel={() => setDel(null)}
        onConfirm={async () => { await deleteRow('quotes', del); setDel(null); setQuotes(await listRows('quotes')) }} />}
      {exp && <ExportModal quote={exp} clients={clients} settings={settings} suppliers={suppliers} onClose={() => setExp(null)} />}
    </div>
  )

  // ============ محرر العرض ============
  return (
    <div>
      <div className="toolbar">
        <button className="mini-btn" onClick={() => setQ(null)}>← {t('quotes')}</button>
        <div style={{ flex: 1 }} />
        <div className="seg">
          <button className={q.doc_type !== 'invoice' ? 'active' : ''} onClick={() => setQ((p) => ({ ...p, doc_type: 'proposal' }))}>{t('proposal')}</button>
          <button className={q.doc_type === 'invoice' ? 'active' : ''} onClick={() => setQ((p) => ({ ...p, doc_type: 'invoice' }))}>{t('invoice')}</button>
        </div>
        <label className="check-row" style={{ padding: 0 }}>
          <input type="checkbox" checked={showProfit} onChange={(e) => setShowProfit(e.target.checked)} />
          {t('showProfit')}
        </label>
        <label className="check-row" style={{ padding: 0 }}>
          <input type="checkbox" checked={q.is_taxable} onChange={(e) => setQ((p) => ({ ...p, is_taxable: e.target.checked }))} />
          <b>{q.is_taxable ? t('taxable') : t('nonTaxable')}</b>
        </label>
        <label className="check-row" style={{ padding: 0 }}>
          <input type="checkbox" checked={!!q.preparing} onChange={(e) => setQ((p) => ({ ...p, preparing: e.target.checked }))} />
          <b style={{ color: q.preparing ? '#0F6E56' : 'inherit' }}>{t('preparing')}</b>
        </label>
        {q.id && <button className="mini-btn tg" onClick={() => setWorkOrder(true)}>🛠 {t('workOrder')}</button>}
        <label className="check-row" style={{ padding: 0 }}>
          <input type="checkbox" checked={!!q.finished} onChange={(e) => setQ((p) => ({ ...p, finished: e.target.checked }))} />
          {t('conferenceDone')}
        </label>
        <button className="save-btn" disabled={status === 'saving'} onClick={save}>
          {status === 'saving' ? t('saving') : t('save')}
        </button>
        {q.id && <button className="mini-btn" onClick={() => setExp({ ...q, data: JSON.stringify({ halls: q.halls, items: q.items }), subtotal: totals.subtotal, wht_amount: totals.wht, vat_amount: totals.vat, grand_total: totals.grand })}>{t('export')} ⬇</button>}
        {status === 'saved' && <span className="saved-msg">{t('saved')}</span>}
      </div>

      <div className="card">
        <div className="field" style={{ marginBottom: 12 }}>
          <label>{t('linkToConference')}</label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={q.conference_id || ''} style={{ maxWidth: 320 }}
              onChange={(e) => {
                const c = conferences.find((x) => x.id === e.target.value)
                setQ((p) => ({
                  ...p, conference_id: e.target.value || '',
                  ...(c ? {
                    conference_name: c.name, date_from: c.date_from || '', date_to: c.date_to || '',
                    location: [c.governorate, c.location, c.hall_name].filter(Boolean).join(' - '),
                  } : {}),
                }))
              }}>
              <option value="">🆓 {t('freeQuote')}</option>
              {conferences.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {q.conference_id && <span className="badge">{t('linkedConf')}</span>}
          </div>
        </div>
        <div className="grid4">
          <div className="field"><label>{t('conferenceName')} *</label>
            <input value={q.conference_name} onChange={(e) => setQ((p) => ({ ...p, conference_name: e.target.value }))} /></div>
          <div className="field"><label>{t('organizingCompany')}</label>
            <select value={q.client_id} onChange={(e) => setQ((p) => ({ ...p, client_id: e.target.value }))}>
              <option value="">—</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select></div>
          <div className="field"><label>{t('dateFrom')}</label>
            <input type="date" value={q.date_from} onChange={(e) => setQ((p) => ({ ...p, date_from: e.target.value }))} /></div>
          <div className="field"><label>{t('dateTo')}</label>
            <input type="date" value={q.date_to} onChange={(e) => setQ((p) => ({ ...p, date_to: e.target.value }))} /></div>
          <div className="field"><label>{t('place')}</label>
            <input list="venues-list" value={q.location} onChange={(e) => setQ((p) => ({ ...p, location: e.target.value }))}
              placeholder={t('placeHint')} />
            <datalist id="venues-list">
              {venues.map((v) => <option key={v.id} value={v.hotel_name}>{v.governorate || ''}</option>)}
            </datalist>
            {(() => {
              const v = venues.find((x) => x.hotel_name === q.location)
              if (!v) return null
              return <div className="cell-hint">
                {(v.halls || []).map((h) => `${h.name}${h.max_width ? ` (${h.max_width}×${h.max_height} م)` : ''}`).join(' · ')}
                {(v.contacts || [])[0] && ` — ☎ ${v.contacts[0].name}: ${v.contacts[0].phone}`}
              </div>
            })()}
          </div>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label>{t('preamble')}
            {preambles.length > 0 && (
              <select className="inline-select" value="" onChange={(e) => {
                const p = preambles.find((x) => x.id === e.target.value)
                if (p) setQ((prev) => ({ ...prev, preamble: p.body }))
              }}>
                <option value="">— {t('choosePreamble')} —</option>
                {preambles.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            )}
          </label>
          <textarea rows={2} value={q.preamble || ''} onChange={(e) => setQ((p) => ({ ...p, preamble: e.target.value }))}
            placeholder={t('preambleHint')} />
          {q.preamble?.trim() && (
            <button type="button" className="mini-btn" style={{ marginTop: 6 }} onClick={async () => {
              const title = prompt(t('preambleTitle'))
              if (!title?.trim()) return
              const saved = await insertRow('preambles', { title: title.trim(), body: q.preamble })
              setPreambles((p) => [saved, ...p])
            }}>💾 {t('savePreamble')}</button>
          )}
        </div>

        {q.doc_type === 'invoice' && (
          <div className="field" style={{ marginTop: 12 }}>
            <label>{t('payments')}</label>
            {(q.payments || []).map((p, i) => (
              <div className="sub-item-row" key={i} style={{ gridTemplateColumns: '140px 160px 1fr 36px' }}>
                <input type="number" dir="ltr" placeholder={t('amount')} value={p.amount}
                  onChange={(e) => setQ((prev) => ({ ...prev, payments: prev.payments.map((x, j) => j === i ? { ...x, amount: e.target.value } : x) }))} />
                <input type="date" value={p.date || ''}
                  onChange={(e) => setQ((prev) => ({ ...prev, payments: prev.payments.map((x, j) => j === i ? { ...x, date: e.target.value } : x) }))} />
                <input placeholder={t('notes')} value={p.note || ''}
                  onChange={(e) => setQ((prev) => ({ ...prev, payments: prev.payments.map((x, j) => j === i ? { ...x, note: e.target.value } : x) }))} />
                <button type="button" className="icon-btn" onClick={() => setQ((prev) => ({ ...prev, payments: prev.payments.filter((_, j) => j !== i) }))}>✕</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <button type="button" className="add-btn" style={{ padding: '7px 14px', fontSize: 13 }}
                onClick={() => setQ((prev) => ({ ...prev, payments: [...(prev.payments || []), { amount: '', date: '', note: '' }] }))}>
                + {t('addPayment')}
              </button>
              <span style={{ fontSize: 13.5 }}>
                {t('collected')}: <b>{fmt(paid(q.payments))}</b> — {t('remainingAmt')}: <b style={{ color: (totals?.grand || 0) - paid(q.payments) > 0.01 ? '#A32D2D' : '#0F6E56' }}>{fmt((totals?.grand || 0) - paid(q.payments))}</b> EGP
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="toolbar">
        <button className="add-btn" onClick={addRow}>+ {t('addRow')}</button>
        <button className="add-btn" onClick={addHall}>+ {t('addHall')}</button>
      </div>

      {q.halls.length === 0 ? (
        <div className="placeholder">🏛 {t('addHallFirst')}</div>
      ) : (
        <div className="quote-scroll">
          <table className="quote-table">
            <thead>
              <tr>
                <th className="sticky-col item-col">ITEM / EQUIPMENT</th>
                {q.halls.map((h) => (
                  <th key={h.key} colSpan={5} className="hall-head">
                    {h.name}
                    <button className="icon-btn" style={{ fontSize: 12 }} onClick={() => removeHall(h.key)}>✕</button>
                  </th>
                ))}
                <th className="subtotal-col">{t('rowSubtotal')}</th>
                <th></th>
              </tr>
              <tr className="sub-head">
                <th className="sticky-col"></th>
                {q.halls.map((h) => (
                  ['units', 'price', 'days', 'total', 'note'].map((f) => (
                    <th key={h.key + f}>{t('col_' + f)}</th>
                  ))
                ))}
                <th></th><th></th>
              </tr>
            </thead>
            <tbody>
              {q.items.map((it) => {
                const rowSum = q.halls.reduce((s, h) => s + rowTotal(it.cells[h.key] || {}), 0)
                return (
                  <tr key={it.key}>
                    <td className="sticky-col item-col">
                      <input className="item-name-input" placeholder={t('itemNameManual')}
                        value={it.item_name || ''}
                        onChange={(e) => setItem(it.key, { item_name: e.target.value })} />
                      <select value={it.equipment_id} onChange={(e) => pickEquipment(it.key, e.target.value)}
                        title={t('pickFromLibrary')}>
                        <option value="">— {t('pickFromLibrary')} —</option>
                        {mains.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                      {it.supplier_id && <div className="cell-hint">{supName(it.supplier_id)} · {it.unit}</div>}
                      <input className="item-note-input" placeholder={t('itemNote')}
                        value={it.item_note || ''}
                        onChange={(e) => setItem(it.key, { item_note: e.target.value })} />
                    </td>
                    {q.halls.map((h) => {
                      const c = it.cells[h.key] || {}
                      return (
                        <HallCells key={h.key} c={c}
                          onChange={(f, v) => setCell(it.key, h.key, f, v)} />
                      )
                    })}
                    <td className="subtotal-col">
                      <b>{fmt(rowSum)}</b>
                      {(() => {
                        const rowCost = q.halls.reduce((s2, h) => {
                          const c = it.cells[h.key] || {}
                          return s2 + (+c.units || 0) * (+it.cost_price || 0) * (+c.days || 0)
                        }, 0)
                        const m = rowSum - rowCost
                        if (!showProfit || (!rowSum && !rowCost)) return null
                        return <div className="margin-chip" style={{ color: m >= 0 ? '#0F6E56' : '#A32D2D' }}>
                          {t('margin')}: {fmt(m)}
                        </div>
                      })()}
                    </td>
                    <td><button className="icon-btn" onClick={() => removeRow(it.key)}>✕</button></td>
                  </tr>
                )
              })}
              <tr className="halls-subtotal">
                <td className="sticky-col"><b>{t('hallSubtotals')}</b></td>
                {q.halls.map((h) => (
                  <td key={h.key} colSpan={5} style={{ textAlign: 'center' }}>
                    <b>{fmt(totals.hallSubs[h.key])}</b>
                  </td>
                ))}
                <td className="subtotal-col"><b>{fmt(totals.subtotal)}</b></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="card totals-card">
        {(() => {
          const totalCost = q.items.reduce((s2, it) => s2 + q.halls.reduce((a, h) => {
            const c = it.cells[h.key] || {}
            return a + (+c.units || 0) * (+it.cost_price || 0) * (+c.days || 0)
          }, 0), 0)
          const m = totals.subtotal - totalCost
          if (!showProfit || !totalCost) return null
          return <div className="tot-row"><span>{t('totalCostRow')}</span>
            <b>{fmt(totalCost)} — {t('margin')}: <span style={{ color: m >= 0 ? '#0F6E56' : '#A32D2D' }}>{fmt(m)}</span></b></div>
        })()}
        <div className="tot-row"><span>Subtotal</span><b>{fmt(totals.subtotal)} EGP</b></div>
        {q.is_taxable && <>
          <div className="tot-row deduct"><span>WHT (3%)</span><b>− {fmt(totals.wht)} EGP</b></div>
          <div className="tot-row"><span>VAT (14%)</span><b>{fmt(totals.vat)} EGP</b></div>
        </>}
        <div className="tot-row grand"><span>{q.is_taxable ? 'Grand Total + VAT 14%' : 'Grand Total'}</span><b>{fmt(totals.grand)} EGP</b></div>
      </div>

      {picker && picker.step === 'supplier' && (
        <Modal title={`${t('chooseSupplierFor')} ${picker.main.name}`} onClose={() => setPicker(null)}>
          <div className="supplier-links">
            {picker.options.map((sp) => (
              <button key={sp.id} className="supplier-link picker" onClick={() => choosePickerSupplier(sp)}>
                <span>○ {sp.supplier_name}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {picker && picker.step === 'subitem' && (
        <Modal title={`${picker.supplier.supplier_name} — ${t('chooseSubItem')}`} onClose={() => setPicker(null)}>
          <div className="supplier-links">
            {picker.subs.map((sub) => {
              const row = subPrices.find((p) => p.sub_id === sub.id && p.supplier_id === picker.supplier.id)
              const cost = row?.cost_price
              const sell = row?.sell_price || sub.client_price
              return (
                <button key={sub.id} className="supplier-link picker" onClick={() => choosePickerSubItem(sub)}>
                  <span>○ {sub.name} <small className="hint-inline">({sub.unit})</small></span>
                  <b>
                    {sell ? `${t('clientPrice')}: ${fmt(sell)}` : ''}
                    {showProfit && cost !== undefined ? ` · ${t('cost_')}: ${fmt(cost)}` : ''}
                  </b>
                </button>
              )
            })}
            <button className="supplier-link picker" onClick={() => { setItem(picker.rowKey, { item_name: picker.main.name }); setPicker(null) }}>
              ✏️ {t('keepGenericName')}
            </button>
          </div>
        </Modal>
      )}
      {exp && <ExportModal quote={exp} clients={clients} settings={settings} suppliers={suppliers} onClose={() => setExp(null)} />}
      {workOrder && <WorkOrderModal q={q} suppliers={suppliers} conferences={conferences} settings={settings} t={t} onClose={() => setWorkOrder(false)} />}
    </div>
  )
}

export function WorkOrderModal({ q, suppliers, conferences, settings, t, onClose, onlySupplierId }) {
  const [tested, setTested] = useState(q.tested_suppliers || {})
  const toggleTested = async (sid, val) => {
    const next = { ...tested, [sid]: val }
    setTested(next)
    const { updateRow } = await import('../../lib/db.js')
    await updateRow('quotes', q.id, { tested_suppliers: next }).catch(() => {})
  }
  // تجميع: كل مورد → بنوده المسحوبة في هذا العرض (أو مورد واحد محدد فقط لو onlySupplierId)
  const bySupplier = {}
  for (const it of q.items) {
    if (!it.supplier_id) continue
    if (onlySupplierId && it.supplier_id !== onlySupplierId) continue
    let qty = 0
    for (const h of q.halls) qty += +(it.cells[h.key]?.units || 0)
    if (!qty && !it.item_name) continue
    ;(bySupplier[it.supplier_id] ||= []).push({ name: it.item_name, note: it.item_note, qty, unit: it.unit || '' })
  }
  const supplierIds = Object.keys(bySupplier)
  const [selected, setSelected] = useState(() => new Set(supplierIds))
  const toggle = (sid) => setSelected((p) => { const s = new Set(p); s.has(sid) ? s.delete(sid) : s.add(sid); return s })

  const [printLang, setPrintLang] = useState('ar')   // ar | en | both
  const conf = conferences.find((c) => c.id === q.conference_id)
  const setupDate = q.date_from ? new Date(new Date(q.date_from).getTime() - 864e5).toISOString().slice(0, 10) : '—'

  // وصف طبيعي للكمية حسب الوحدة، بدل عرض القيمة الخام المخزَّنة (تدعم العربي والإنجليزي بصياغة لطيفة)
  const describeQty = (qty, unit, lang) => {
    const u = (unit || '').trim()
    const isMeter = u.includes('متر') || /meter|m$/i.test(u)
    const isDay = u.includes('يوم') || /day/i.test(u)
    const isPiece = u.includes('قطعة') || /piece|pcs/i.test(u)
    const isHour = u.includes('ساعة') || /hour/i.test(u)
    if (lang === 'ar') {
      if (isMeter) return `إجمالي عدد الأمتار: ${qty}`
      if (isDay) return `${qty} ${qty === 1 ? 'يوم' : 'أيام'} على القاعة`
      if (isPiece) return `${qty} قطعة`
      if (isHour) return `${qty} ${qty === 1 ? 'ساعة' : 'ساعات'}`
      return `${qty}${u ? ' — ' + u : ''}`
    }
    // en
    if (isMeter) return `Total meters: ${qty}`
    if (isDay) return `${qty} day${qty === 1 ? '' : 's'} on-site`
    if (isPiece) return `${qty} piece${qty === 1 ? '' : 's'}`
    if (isHour) return `${qty} hour${qty === 1 ? '' : 's'}`
    return `${qty}${u ? ' — ' + u : ''}`
  }

  const L = {
    ar: { title: 'أمر شغل', event: 'الإيفنت', date: 'التاريخ', place: 'المكان', hall: 'القاعة', supplier: 'المورد',
      setup: 'السيت أب', setupNote: 'قبل الإيفنت بيوم', item: 'البند', qty: 'الكمية', notes: 'ملاحظات' },
    en: { title: 'Work Order', event: 'Event', date: 'Date', place: 'Place', hall: 'Hall', supplier: 'Supplier',
      setup: 'Setup', setupNote: '1 day before event', item: 'Item', qty: 'Quantity', notes: 'Notes' },
  }

  const oneLangBlock = (lang, sup, items) => {
    const l = L[lang]
    const dir = lang === 'ar' ? 'rtl' : 'ltr'
    let body = `<div dir="${dir}" style="margin-bottom:8mm">
      <h1>${l.title} — ${q.conference_name}</h1>
      <div class="head-grid">
        <div><b>${l.event}:</b> ${q.conference_name}</div>
        <div><b>${l.date}:</b> ${q.date_from || ''} ${q.date_to ? '← ' + q.date_to : ''}</div>
        <div><b>${l.place}:</b> ${conf ? [conf.governorate, conf.location].filter(Boolean).join(' - ') : q.location || ''}</div>
        <div><b>${l.hall}:</b> ${conf?.hall_name || '—'}</div>
        <div><b>${l.supplier}:</b> ${sup?.supplier_name || ''}</div>
        <div style="grid-column:1/-1;background:#F5E3D7;padding:3px 8px;border-radius:6px"><b>${l.setup}:</b> ${setupDate} (${l.setupNote})</div>
      </div>
      <table><thead><tr><th>${l.item}</th><th>${l.qty}</th><th>${l.notes}</th></tr></thead><tbody>`
    for (const i of items) body += `<tr><td style="text-align:start">${i.name}</td><td>${describeQty(i.qty, i.unit, lang)}</td><td>${i.note || ''}</td></tr>`
    body += `</tbody></table></div>`
    return body
  }

  const headHtml = (sup, items) => {
    if (printLang === 'both') return oneLangBlock('ar', sup, items) + '<hr style="margin:8mm 0">' + oneLangBlock('en', sup, items)
    return oneLangBlock(printLang, sup, items)
  }
  const itemsTable = () => ''  // مدمج الآن داخل headHtml لكل لغة

  const printHtmlLazy = async (body, title) => {
    const { printHtml } = await import('../exports/exportQuote.js')
    printHtml({ title: 'أمر شغل — ' + title, bodyHtml: body, settings, letterhead: !!settings?.letterhead_url, stamp: false, sign: false, preview: false })
  }

  // طباعة عرض منفصل لكل مورد محدد (نافذة مستقلة لكل واحد)
  const printSelected = () => {
    for (const sid of supplierIds) {
      if (!selected.has(sid)) continue
      const sup = suppliers.find((x) => x.id === sid)
      printHtmlLazy(headHtml(sup, bySupplier[sid]), `${q.conference_name} — ${sup?.supplier_name || ''}`)
    }
  }

  const sendToSupplier = async (sid) => {
    const sup = suppliers.find((x) => x.id === sid)
    if (!sup?.telegram_chat_id) return alert(t('noTelegramForSupplier'))
    const { tgSend } = await import('../../lib/telegram.js')
    const lines = bySupplier[sid].map((i) => `• ${i.name} × ${i.qty}${i.note ? ` (${i.note})` : ''}`).join('\n')
    const msg = `🛠 أمر شغل — ${q.conference_name}\nالتاريخ: ${q.date_from || ''}${q.date_to ? ' ← ' + q.date_to : ''}\nالمكان: ${conf?.location || q.location || ''}\nالسيت أب: ${setupDate}\n\n${lines}`
    try { await tgSend(settings?.telegram_bot_token, sup.telegram_chat_id, msg); alert('✓ ' + t('sentTo') + ' ' + sup.supplier_name) }
    catch (e) { alert(e.message) }
  }

  return (
    <Modal title={`🛠 ${t('workOrder')} — ${q.conference_name}`} onClose={onClose} wide>
      <div className="head-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 13.5, marginBottom: 12 }}>
        <span>📅 {q.date_from || '—'} {q.date_to ? '← ' + q.date_to : ''}</span>
        <span>📍 {conf ? [conf.location, conf.hall_name].filter(Boolean).join(' — ') : q.location || '—'}</span>
        <span className="badge" style={{ gridColumn: '1 / -1', justifySelf: 'start' }}>⚙️ {t('setup')}: {setupDate}</span>
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label>{t('printLanguage')}</label>
        <div className="seg">
          <button className={printLang === 'ar' ? 'active' : ''} onClick={() => setPrintLang('ar')}>عربي</button>
          <button className={printLang === 'en' ? 'active' : ''} onClick={() => setPrintLang('en')}>English</button>
          <button className={printLang === 'both' ? 'active' : ''} onClick={() => setPrintLang('both')}>{t('bothLangs')}</button>
        </div>
      </div>
      {supplierIds.length === 0 ? <EmptyState /> : supplierIds.map((sid) => {
        const sup = suppliers.find((x) => x.id === sid)
        const items = bySupplier[sid]
        return (
          <div className="card" key={sid} style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <label className="check-row" style={{ padding: 0 }}>
                <input type="checkbox" checked={selected.has(sid)} onChange={() => toggle(sid)} />
                <h3 style={{ fontSize: 14, margin: 0 }}>{sup?.supplier_name || '؟'}</h3>
              </label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <label className="check-row" style={{ padding: 0, fontSize: 12.5 }}>
                  <input type="checkbox" checked={!!tested[sid]} onChange={(e) => toggleTested(sid, e.target.checked)} />
                  {tested[sid] ? t('tested') : t('notTested')}
                </label>
                <button className="mini-btn" onClick={() => printHtmlLazy(headHtml(sup, items), `${q.conference_name} — ${sup?.supplier_name || ''}`)}>🖨 {t('printOnly')}</button>
                {sup?.telegram_chat_id && <button className="mini-btn tg" onClick={() => sendToSupplier(sid)}>📤 {t('sendTg')}</button>}
              </div>
            </div>
            {items.map((i, j) => (
              <div key={j} className="manage-row"><span>{i.name} — <b>×{i.qty}</b> {i.note && <small className="hint-inline">({i.note})</small>}</span></div>
            ))}
          </div>
        )
      })}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="save-btn" onClick={printSelected} disabled={![...selected].length}>🖨 {t('printWorkOrder')} ({selected.size})</button>
      </div>
    </Modal>
  )
}

function HallCells({ c, onChange }) {
  return (
    <>
      <td><input type="number" min="0" className="num" value={c.units ?? ''} onChange={(e) => onChange('units', e.target.value)} /></td>
      <td><input type="number" min="0" className="num" value={c.price ?? ''} onChange={(e) => onChange('price', e.target.value)} /></td>
      <td><input type="number" min="0" className="num" value={c.days ?? ''} onChange={(e) => onChange('days', e.target.value)} /></td>
      <td className="cell-total">{fmt(rowTotal(c))}</td>
      <td><input className="note" value={c.note ?? ''} onChange={(e) => onChange('note', e.target.value)} /></td>
    </>
  )
}

function ExportModal({ quote, clients, settings, suppliers, onClose }) {
  const { t } = useLang()
  const [fmt_, setFmt] = useState('pdf')
  const [letterhead, setLetterhead] = useState(true)
  const [version, setVersion] = useState('client')
  const [stamp, setStamp] = useState(quote.include_stamp)
  const [sign, setSign] = useState(quote.include_signature)
  const [docLang, setDocLang] = useState('ar')

  const go = (preview) => exportQuote({
    quote, clients, settings, suppliers,
    format: fmt_, letterhead, version, stamp, sign, preview, docLang, t,
  })

  return (
    <Modal title={t('export')} onClose={onClose}>
      <div className="field"><label>{t('chooseFormat')}</label>
        <div className="seg">
          {['pdf', 'excel', 'both'].map((f) => (
            <button key={f} className={fmt_ === f ? 'active' : ''} onClick={() => setFmt(f)}>{f.toUpperCase()}</button>
          ))}
        </div>
      </div>
      <div className="field"><label>{t('docLanguage')}</label>
        <div className="seg">
          <button className={docLang === 'ar' ? 'active' : ''} onClick={() => setDocLang('ar')}>العربية</button>
          <button className={docLang === 'en' ? 'active' : ''} onClick={() => setDocLang('en')}>English</button>
          <button className={docLang === 'both' ? 'active' : ''} onClick={() => setDocLang('both')}>{t('bothLangs')}</button>
        </div>
      </div>
      <div className="field"><label>{t('chooseTemplate')}</label>
        <div className="seg">
          <button className={letterhead ? 'active' : ''} onClick={() => setLetterhead(true)}>{t('withLetterhead')}</button>
          <button className={!letterhead ? 'active' : ''} onClick={() => setLetterhead(false)}>{t('withoutLetterhead')}</button>
        </div>
      </div>
      <div className="field"><label>{t('version')}</label>
        <div className="seg">
          <button className={version === 'client' ? 'active' : ''} onClick={() => setVersion('client')}>{t('clientVersion')}</button>
          <button className={version === 'internal' ? 'active' : ''} onClick={() => setVersion('internal')}>{t('internalVersion')}</button>
        </div>
      </div>
      <div className="check-row"><input type="checkbox" id="xst" checked={stamp} onChange={(e) => setStamp(e.target.checked)} /><label htmlFor="xst">{t('includeStamp')}</label></div>
      <div className="check-row"><input type="checkbox" id="xsg" checked={sign} onChange={(e) => setSign(e.target.checked)} /><label htmlFor="xsg">{t('includeSignature')}</label></div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="add-btn" onClick={() => go(true)}>{t('preview')}</button>
        <button className="save-btn" onClick={() => go(false)}>{t('download')}</button>
      </div>
    </Modal>
  )
}
