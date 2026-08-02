import { useEffect, useMemo, useState } from 'react'
import { useLang } from '../../lib/i18n.jsx'
import { listRows, insertRow, updateRow, deleteRow, uploadDoc, openFile } from '../../lib/db.js'
import { fmt } from '../../lib/tafqeet.js'
import { Modal, EmptyState } from '../../components/ui.jsx'
import { printHtml } from '../exports/exportQuote.js'
import { loadSettings } from '../../lib/supabase.js'

const invTotal = (inv) => (inv.items || []).reduce((s, i) => s + (+i.qty || 0) * (+i.price || 0) * (+i.days || 1), 0)
const invPaid = (inv) => (inv.payments || []).reduce((s, p) => s + (+p.amount || 0), 0)
const withVat = (inv, sup) => invTotal(inv) * (inv.is_taxable ? 1 + (+(sup?.tax_rate ?? 14)) / 100 : 1)

// السحب التلقائي من فواتير المؤتمرات المنتهية
export function autoPulls(supplierId, quotes) {
  const out = []
  for (const q of quotes) {
    if (q.doc_type !== 'invoice' || !q.finished) continue
    const d = typeof q.data === 'string' ? JSON.parse(q.data || '{}') : (q.data || {})
    const items = []
    for (const it of (d.items || [])) {
      if (it.supplier_id !== supplierId) continue
      let qty = 0, cost = 0, days = 0
      for (const h of (d.halls || [])) {
        const c = it.cells?.[h.key] || {}
        qty += +c.units || 0
        days = Math.max(days, +c.days || 0)
        cost += (+c.units || 0) * (+it.cost_price || 0) * (+c.days || 0)
      }
      if (qty || cost) items.push({ name: it.item_name, qty, days, cost })
    }
    if (items.length) out.push({
      quote: q, conference: q.conference_name, date: q.date_from,
      items, total: items.reduce((s, i) => s + i.cost, 0),
    })
  }
  return out
}

export default function SupplierLedger({ supplier, onClose }) {
  const { t } = useLang()
  const [quotes, setQuotes] = useState([])
  const [invoices, setInvoices] = useState([])
  const [adjustments, setAdjustments] = useState([])
  const [payments, setPayments] = useState([])
  const [payForm, setPayForm] = useState(null)

  // إرسال إيصال الدفعة على واتساب المورد
  const sendReceiptWhatsapp = (p) => {
    const num = String(supplier.whatsapp_number || supplier.phone || '').replace(/[^\d]/g, '')
    if (!num) return alert(t('noWhatsappNumber'))
    const intl = num.startsWith('0') ? '20' + num.slice(1) : num.startsWith('20') ? num : '20' + num
    const methodTxt = t(p.method) !== p.method ? t(p.method) : p.method
    const lines = [
      `${t('paymentReceipt')} — ${supplier.supplier_name || ''}`,
      `${t('amount')}: ${fmt(p.amount)}`,
      `${t('date')}: ${p.pay_date || '—'}`,
      `${t('paymentMethod')}: ${methodTxt}`,
    ]
    if (p.cheque_no) lines.push(`${t('chequeNumber')}: ${p.cheque_no}`)
    if (p.handed_by) lines.push(`${t('handedBy')}: ${p.handed_by}`)
    if (p.note) lines.push(`${t('notes')}: ${p.note}`)
    if (p.receipt_url) lines.push('', `${t('receiptImage')}: ${p.receipt_url}`)
    window.open(`https://wa.me/${intl}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank')
  }
  const [conferences, setConferences] = useState([])
  const [mains, setMains] = useState([])
  const [subs, setSubs] = useState([])
  const [prices, setPrices] = useState([])
  const [supplierMains, setSupplierMains] = useState([])
  const [settings, setSettings] = useState(null)
  const [inv, setInv] = useState(null)        // فاتورة مفتوحة للتحرير
  const [selected, setSelected] = useState(null)  // ما يدخل الكشف: Set من المفاتيح (null = الكل)

  const load = async () => {
    setInvoices((await listRows('supplier_invoices')).filter((x) => x.supplier_id === supplier.id))
    setAdjustments((await listRows('supplier_adjustments')).filter((x) => x.supplier_id === supplier.id))
    setPayments((await listRows('supplier_payments')).filter((x) => x.supplier_id === supplier.id))
  }
  useEffect(() => {
    if (supplier.__openPay) setPayForm({ amount: '', conference_id: '', method: 'cash', pay_date: new Date().toISOString().slice(0, 10), note: '' })
    if (supplier.__openFreeInv) setInv({ conference_id: '', invoice_date: new Date().toISOString().slice(0, 10), is_taxable: !!supplier.adds_tax, items: [], payments: [], notes: '' })
    load()
    listRows('quotes').then(setQuotes)
    listRows('conferences').then(setConferences)
    listRows('library_main').then(setMains)
    listRows('library_sub').then(setSubs)
    listRows('sub_supplier_prices', 'id').then(setPrices)
    listRows('supplier_main_items', 'id').then(setSupplierMains)
    loadSettings().then(setSettings)
  }, [])

  const pulls = useMemo(() => autoPulls(supplier.id, quotes), [quotes])
  const myMains = mains.filter((m) => supplierMains.some((x) => x.supplier_id === supplier.id && x.main_id === m.id))
  const mySubs = (mainId) => subs.filter((s) => s.main_id === mainId)
  const myCost = (subId) => prices.find((p) => p.sub_id === subId && p.supplier_id === supplier.id)?.cost_price

  // الرصيد الكلي
  const totals = useMemo(() => {
    const auto = pulls.reduce((s, p) => s + p.total, 0)
    const manual = invoices.reduce((s, i) => s + withVat(i, supplier), 0)
    const adj = adjustments.reduce((s, a) => s + (+a.amount || 0), 0)
    const paid = invoices.reduce((s, i) => s + invPaid(i), 0)
      + payments.reduce((s, p) => s + (+p.amount || 0), 0)
    return { auto, manual, adj, due: auto + manual + adj, paid, balance: auto + manual + adj - paid }
  }, [pulls, invoices, adjustments, payments])

  const saveInv = async () => {
    const payload = {
      supplier_id: supplier.id, conference_id: inv.conference_id || null, free_conference: inv.conference_id ? '' : (inv.free_conference || ''),
      invoice_date: inv.invoice_date || null, is_taxable: !!inv.is_taxable,
      items: (inv.items || []).filter((i) => i.name?.trim()),
      payments: (inv.payments || []).filter((p) => +p.amount),
      notes: inv.notes || '',
    }
    if (inv.id) await updateRow('supplier_invoices', inv.id, payload)
    else await insertRow('supplier_invoices', payload)
    setInv(null); load()
  }

  const keyOf = (kind, id) => `${kind}:${id}`
  const isSel = (k) => selected === null || selected.has(k)
  const toggleSel = (k) => setSelected((p) => {
    const base = p === null
      ? new Set([...pulls.map((x) => keyOf('pull', x.quote.id)), ...invoices.map((x) => keyOf('inv', x.id))])
      : new Set(p)
    base.has(k) ? base.delete(k) : base.add(k)
    return base
  })

  const addAdj = async (sign, defaultReason = '') => {
    const amount = +prompt(sign > 0 ? t('adjAddAmount') : t('adjSubAmount')) || 0
    if (!amount) return
    const reason = prompt(t('adjReason'), defaultReason) || defaultReason
    await insertRow('supplier_adjustments', { supplier_id: supplier.id, amount: sign * Math.abs(amount), reason, adj_date: new Date().toISOString().slice(0, 10) })
    load()
  }

  const exportPdf = () => {
    const selPulls = pulls.filter((p) => isSel(keyOf('pull', p.quote.id)))
    const selInvs = invoices.filter((i) => isSel(keyOf('inv', i.id)))
    let body = `<h1>كشف حساب مورد — ${supplier.supplier_name}</h1>
      <div class="head-grid"><div><b>التاريخ:</b> ${new Date().toISOString().slice(0, 10)}</div>
      <div><b>الشركة:</b> ${supplier.company_name || ''}</div></div>`
    if (selPulls.length) {
      body += `<h3 style="font-size:13px">المسحوبات من المؤتمرات</h3><table><thead><tr><th>المؤتمر</th><th>التاريخ</th><th>البند</th><th>الكمية</th><th>التكلفة</th></tr></thead><tbody>`
      for (const p of selPulls) for (const i of p.items)
        body += `<tr><td>${p.conference}</td><td>${p.date || ''}</td><td>${i.name}</td><td>${i.qty}</td><td>${fmt(i.cost)}</td></tr>`
      body += `</tbody></table>`
    }
    if (selInvs.length) {
      body += `<h3 style="font-size:13px;margin-top:5mm">فواتير يدوية</h3><table><thead><tr><th>التاريخ</th><th>المؤتمر</th><th>البند</th><th>الكمية</th><th>الأيام</th><th>السعر</th><th>القيمة</th></tr></thead><tbody>`
      for (const i of selInvs) {
        const its = (i.items || [])
        its.forEach((x, j) => {
          body += `<tr>
            <td>${j === 0 ? (i.invoice_date || '') : ''}</td>
            <td>${j === 0 ? (conferences.find((c) => c.id === i.conference_id)?.name || i.free_conference || '—') : ''}</td>
            <td style="text-align:start">${x.name || ''}</td><td>${x.qty || ''}</td><td>${x.days || 1}</td>
            <td>${fmt(x.price)}</td><td>${fmt((+x.qty || 0) * (+x.price || 0) * (+x.days || 1))}</td></tr>`
        })
        body += `<tr style="background:#FBF4EE"><td colspan="5"><b>الإجمالي${i.is_taxable ? ' شامل الضريبة' : ''}</b></td><td><b>مدفوع ${fmt(invPaid(i))}</b></td><td><b>${fmt(withVat(i, supplier))}</b></td></tr>`
      }
      body += `</tbody></table>`
    }
    if (adjustments.length) {
      body += `<h3 style="font-size:13px;margin-top:5mm">تسويات</h3><table><thead><tr><th>التاريخ</th><th>السبب</th><th>المبلغ</th></tr></thead><tbody>`
      for (const a of adjustments)
        body += `<tr><td>${a.adj_date || ''}</td><td>${a.reason || ''}</td><td>${fmt(a.amount)}</td></tr>`
      body += `</tbody></table>`
    }
    const selDue = selPulls.reduce((s2, p) => s2 + p.total, 0)
      + selInvs.reduce((s2, i) => s2 + withVat(i, supplier), 0)
      + adjustments.reduce((s2, a) => s2 + (+a.amount || 0), 0)
    let selPaid = selInvs.reduce((s2, i) => s2 + invPaid(i), 0)
    if (payments.length) {
      body += `<h3 style="font-size:13px;margin-top:5mm">الدفعات</h3><table><thead><tr><th>التاريخ</th><th>المبلغ</th><th>الوسيلة</th><th>المؤتمر</th><th>البيان</th></tr></thead><tbody>`
      for (const p of payments) {
        selPaid += (+p.amount || 0)
        const mth = p.method === 'cash' ? 'نقداً' : p.method === 'cheque' ? 'شيك' : p.method === 'bank' ? 'حساب بنكي' : p.method === 'vodafone' ? 'فودافون كاش' : 'انستا باي'
        body += `<tr><td>${p.pay_date || ''}</td><td>${fmt(p.amount)}</td><td>${mth}</td><td>${conferences.find((c) => c.id === p.conference_id)?.name || '—'}</td><td>${p.note || ''}</td></tr>`
      }
      body += `</tbody></table>`
    }
      + payments.reduce((s2, p) => s2 + (+p.amount || 0), 0)
    if (payments.length) {
      body += `<h3 style="font-size:13px;margin-top:5mm">الدفعات</h3><table><thead><tr><th>التاريخ</th><th>المبلغ</th><th>الوسيلة</th><th>المؤتمر</th><th>ملاحظات</th></tr></thead><tbody>`
      for (const p of payments) {
        const mth = p.method === 'cash' ? 'نقداً' : p.method === 'cheque' ? 'شيك' : p.method === 'bank' ? 'حساب بنكي' : p.method === 'vodafone' ? 'فودافون كاش' : p.method === 'instapay' ? 'انستا باي' : p.method
        body += `<tr><td>${p.pay_date || ''}</td><td>${fmt(p.amount)}</td><td>${mth}</td><td>${conferences.find((c) => c.id === p.conference_id)?.name || '—'}</td><td>${p.note || ''}</td></tr>`
      }
      body += `</tbody></table>`
    }
    body += `<div class="totals">
      <div><span>إجمالي المستحق</span><b>${fmt(selDue)}</b></div>
      <div><span>المدفوع</span><b>− ${fmt(selPaid)}</b></div>
      <div class="grand"><span>الرصيد</span><b>${fmt(selDue - selPaid)} EGP</b></div></div>`
    printHtml({ title: `كشف ${supplier.supplier_name}`, bodyHtml: body, settings, letterhead: !!settings?.letterhead_url, stamp: false, sign: false, preview: false })
  }

  return (
    <Modal title={`${t('ledger')} — ${supplier.supplier_name}`} onClose={onClose} wide>
      <div className="kpi-row">
        <div className="kpi"><span>{t('totalDue')}</span><b>{fmt(totals.due)}</b></div>
        <div className="kpi"><span>{t('paidToSupplier')}</span><b>{fmt(totals.paid)}</b></div>
        <div className="kpi"><span>{t('balance')}</span>
          <b style={{ color: totals.balance > 0.01 ? '#A32D2D' : '#0F6E56' }}>{fmt(totals.balance)}</b></div>
      </div>

      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <button className="save-btn" style={{ padding: '9px 16px', fontSize: 13.5 }}
          onClick={() => setInv({ conference_id: '', invoice_date: new Date().toISOString().slice(0, 10), is_taxable: !!supplier.adds_tax, items: [], payments: [], notes: '' })}>
          + {t('newSupplierInvoice')}
        </button>
        <button className="mini-btn ok" onClick={() => setPayForm({ amount: '', conference_id: '', method: 'cash', pay_date: new Date().toISOString().slice(0, 10), note: '' })}>💵 {t('addPayment')}</button>
        <button className="mini-btn" onClick={() => addAdj(1)}>➕ {t('adjAdd')}</button>
        <button className="mini-btn" onClick={() => addAdj(-1)}>➖ {t('adjSub')}</button>
        <div style={{ flex: 1 }} />
        <button className="mini-btn" onClick={exportPdf}>🖨 {t('exportSelected')}</button>
      </div>

      {/* المسحوبات التلقائية */}
      {pulls.length > 0 && (
        <div className="card" style={{ padding: 14 }}>
          <h3 style={{ fontSize: 14 }}>{t('autoPulls')}</h3>
          <p className="hint-inline">{t('autoPullsEditHint')}</p>
          <div className="quote-scroll">
            <table className="quote-table">
              <thead><tr><th>{t('conferences')}</th><th>{t('receiptDate')}</th><th>{t('itemName')}</th><th>{t('quantity')}</th><th>{t('cost_')}</th><th></th></tr></thead>
              <tbody>
                {pulls.map((p) => p.items.map((i, j) => (
                  <tr key={p.quote.id + j} style={isSel(keyOf('pull', p.quote.id)) ? {} : { opacity: .4 }}>
                    <td className="wrap">
                      {j === 0 && <input type="checkbox" style={{ marginInlineEnd: 6 }}
                        checked={isSel(keyOf('pull', p.quote.id))} onChange={() => toggleSel(keyOf('pull', p.quote.id))} />}
                      {j === 0 ? p.conference : ''}</td>
                    <td>{j === 0 ? (p.date || '—') : ''}</td>
                    <td className="wrap">{i.name}</td><td>{i.qty}</td>
                    <td className="cell-total">{fmt(i.cost)}</td>
                    <td>
                      {j === 0 && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="icon-btn" title={t('addPayment')}
                            onClick={() => setPayForm({ amount: '', conference_id: p.quote.conference_id || '', method: 'cash', pay_date: new Date().toISOString().slice(0, 10), note: p.conference })}>💵</button>
                          <button className="icon-btn" title={t('adjAdd')}
                            onClick={() => addAdj(1, p.conference)}>➕</button>
                          <button className="icon-btn" title={t('adjSub')}
                            onClick={() => addAdj(-1, p.conference)}>➖</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* الفواتير اليدوية */}
      {invoices.map((i) => (
        <div className="entity-card" key={i.id} style={{ marginBottom: 10 }}>
          <div className="entity-head">
            <b>
              <input type="checkbox" style={{ marginInlineEnd: 6 }}
                checked={isSel(keyOf('inv', i.id))} onChange={() => toggleSel(keyOf('inv', i.id))} />
              🧾 {i.invoice_date} — {conferences.find((c) => c.id === i.conference_id)?.name || i.free_conference || t('freeQuote')}</b>
            <span className={`badge ${i.is_taxable ? 'inv' : ''}`}>{i.is_taxable ? t('taxable') : t('nonTaxable')}</span>
          </div>
          <div className="entity-meta">
            <span>{(i.items || []).map((x) => `${x.name} ×${x.qty}`).join(' · ')}</span>
            <span>{t('grandTotal')}: <b>{fmt(withVat(i, supplier))}</b> — {t('collected')}: {fmt(invPaid(i))} — <b style={{ color: withVat(i, supplier) - invPaid(i) > 0.01 ? '#A32D2D' : '#0F6E56' }}>{t('remainingAmt')}: {fmt(withVat(i, supplier) - invPaid(i))}</b></span>
          </div>
          <div className="entity-actions">
            <label className="check-row" style={{ padding: 0, fontSize: 12.5 }}>
              <input type="checkbox"
                checked={withVat(i, supplier) - invPaid(i) <= 0.01}
                onChange={async (e) => {
                  const rest = withVat(i, supplier) - invPaid(i)
                  if (e.target.checked) {
                    if (rest <= 0.01) return
                    const pays = [...(i.payments || []), {
                      amount: rest, method: 'cash', settled: true,
                      pay_date: new Date().toISOString().slice(0, 10), note: t('markedPaid'),
                    }]
                    await updateRow('supplier_invoices', i.id, { payments: pays })
                  } else {
                    if (!confirm(t('undoPaidConfirm'))) return
                    await updateRow('supplier_invoices', i.id, { payments: (i.payments || []).filter((x) => !x.settled) })
                  }
                  load()
                }} />
              {withVat(i, supplier) - invPaid(i) <= 0.01 ? t('fullyPaid') : t('markPaid')}
            </label>
            <button onClick={() => setInv({ ...i, items: i.items || [], payments: i.payments || [] })}>{t('edit')}</button>
            <button className="danger" onClick={async () => { if (confirm(t('confirmDelete'))) { await deleteRow('supplier_invoices', i.id); load() } }}>{t('delete')}</button>
          </div>
        </div>
      ))}

      {payments.length > 0 && (
        <div className="card" style={{ padding: 14 }}>
          <h3 style={{ fontSize: 14 }}>{t('payments')}</h3>
          {payments.map((p) => (
            <div className="manage-row" key={p.id}>
              <span>{p.pay_date} — <b style={{ color: '#0F6E56' }}>{fmt(p.amount)}</b> — {t(p.method) !== p.method ? t(p.method) : p.method === 'cash' ? 'نقداً' : p.method === 'cheque' ? 'شيك' : p.method}
                {p.conference_id ? ` — ${conferences.find((c) => c.id === p.conference_id)?.name || ''}` : ''}
                {p.cheque_no ? ` — ${t('chequeNumber')}: ${p.cheque_no}` : ''}
                {p.handed_by ? ` — ${t('handedBy')}: ${p.handed_by}` : ''}
                {p.note ? ` — ${p.note}` : ''}
                {p.receipt_url ? ' 📎' : ''}</span>
              <span style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                {p.receipt_url && (
                  <>
                    <button className="mini-btn" onClick={() => openFile(p.receipt_url)}>👁 {t('view')}</button>
                    <a className="mini-btn" href={p.receipt_url} download target="_blank" rel="noreferrer"
                      style={{ textDecoration: 'none' }}>💾 {t('save')}</a>
                  </>
                )}
                {supplier.whatsapp_number && (
                  <button className="mini-btn ok" onClick={() => sendReceiptWhatsapp(p)}>
                    📲 {t('sendWhatsapp')}</button>
                )}
                <button className="icon-btn" title={t('edit')} onClick={() => setPayForm({ ...p })}>✏️</button>
                <button className="icon-btn" onClick={async () => { if (confirm(t('confirmDelete'))) { await deleteRow('supplier_payments', p.id); load() } }}>✕</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {payForm && (
        <Modal title={payForm.id ? t('editPayment') : t('addPayment')} onClose={() => setPayForm(null)}>
          <div className="grid2">
            <div className="field"><label>{t('amount')} *</label>
              <input type="number" dir="ltr" min="0" autoFocus value={payForm.amount}
                onChange={(e) => setPayForm((p) => ({ ...p, amount: e.target.value }))} /></div>
            <div className="field"><label>{t('receiptDate')}</label>
              <input type="date" value={payForm.pay_date}
                onChange={(e) => setPayForm((p) => ({ ...p, pay_date: e.target.value }))} /></div>
            <div className="field"><label>{t('paymentMethod')}</label>
              <select value={payForm.method} onChange={(e) => setPayForm((p) => ({ ...p, method: e.target.value }))}>
                <option value="cash">{t('cashWord')}</option>
                <option value="bank">{t('bank')}</option>
                <option value="vodafone">{t('vodafone')}</option>
                <option value="instapay">{t('instapay')}</option>
                <option value="cheque">{t('chequeWord')}</option>
              </select></div>
            <div className="field"><label>{t('conferences')}</label>
              <select value={payForm.conference_id} onChange={(e) => setPayForm((p) => ({ ...p, conference_id: e.target.value }))}>
                <option value="">—</option>
                {conferences.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            {payForm.method === 'cheque' && (
              <div className="field"><label>{t('chequeNumber')}</label>
                <input dir="ltr" value={payForm.cheque_no || ''}
                  onChange={(e) => setPayForm((p) => ({ ...p, cheque_no: e.target.value }))} /></div>
            )}
            {payForm.method === 'cash' && (
              <div className="field"><label>{t('handedBy')}</label>
                <input value={payForm.handed_by || ''}
                  onChange={(e) => setPayForm((p) => ({ ...p, handed_by: e.target.value }))} /></div>
            )}
            <div className="field" style={{ gridColumn: '1 / -1' }}><label>{t('receiptImage')}</label>
              <input type="file" accept="image/*,application/pdf"
                onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f) return
                  try {
                    setPayForm((p) => ({ ...p, __uploading: true }))
                    const url = await uploadDoc('receipt-docs', f)
                    setPayForm((p) => ({ ...p, receipt_url: url, __uploading: false }))
                  } catch (err) {
                    setPayForm((p) => ({ ...p, __uploading: false }))
                    alert(t('uploadFailed') + ' ' + (err?.message || ''))
                  }
                }} />
              {payForm.__uploading && <span className="hint-inline">⏳ {t('uploading')}</span>}
              {payForm.receipt_url && !payForm.__uploading && (
                <span className="hint-inline">✅ {t('receiptAttached')}
                  <button type="button" className="mini-btn" style={{ marginInlineStart: 6 }}
                    onClick={() => openFile(payForm.receipt_url)}>👁 {t('view')}</button>
                  <button type="button" className="mini-btn" style={{ marginInlineStart: 4 }}
                    onClick={() => setPayForm((p) => ({ ...p, receipt_url: '' }))}>✕</button>
                </span>
              )}
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}><label>{t('notes')}</label>
              <input value={payForm.note} onChange={(e) => setPayForm((p) => ({ ...p, note: e.target.value }))} /></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="save-btn" onClick={async () => {
              if (!+payForm.amount) return
              const body = { supplier_id: supplier.id, amount: +payForm.amount,
                conference_id: payForm.conference_id || null, method: payForm.method,
                pay_date: payForm.pay_date, note: payForm.note || '',
                cheque_no: payForm.cheque_no || '', handed_by: payForm.handed_by || '',
                receipt_url: payForm.receipt_url || '' }
              if (payForm.id) await updateRow('supplier_payments', payForm.id, body)
              else await insertRow('supplier_payments', body)
              setPayForm(null); load()
            }}>{t('save')}</button>
          </div>
        </Modal>
      )}


      {adjustments.length > 0 && (
        <div className="card" style={{ padding: 14 }}>
          <h3 style={{ fontSize: 14 }}>{t('adjustments')}</h3>
          {adjustments.map((a) => (
            <div className="manage-row" key={a.id}>
              <span>{a.adj_date} — {a.reason || '—'} — <b style={{ color: a.amount >= 0 ? '#A32D2D' : '#0F6E56' }}>{a.amount >= 0 ? '+' : ''}{fmt(a.amount)}</b></span>
              <button className="icon-btn" onClick={async () => { await deleteRow('supplier_adjustments', a.id); load() }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* محرر الفاتورة اليدوية */}
      {inv && (
        <Modal title={t('newSupplierInvoice')} onClose={() => setInv(null)} wide>
          <div className="grid2">
            <div className="field"><label>{t('conferences')}</label>
              <select value={inv.conference_id || ''} onChange={(e) => setInv((p) => ({ ...p, conference_id: e.target.value }))}>
                <option value="">— {t('freeQuote')} —</option>
                {conferences.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {!inv.conference_id && (
                <input style={{ marginTop: 6 }} placeholder={t('freeConfHint')}
                  value={inv.free_conference || ''}
                  onChange={(e) => setInv((p) => ({ ...p, free_conference: e.target.value }))} />
              )}
            </div>
            <div className="field"><label>{t('receiptDate')}</label>
              <input type="date" value={inv.invoice_date || ''} onChange={(e) => setInv((p) => ({ ...p, invoice_date: e.target.value }))} /></div>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={!!inv.is_taxable} onChange={(e) => setInv((p) => ({ ...p, is_taxable: e.target.checked }))} />
            {t('taxable')} ({supplier.tax_rate ?? 14}%)
          </label>

          <div className="field" style={{ marginTop: 10 }}>
            <label>{t('invItems')}</label>
            {(inv.items || []).map((x, i) => (
              <div className="sub-item-row" key={i} style={{ gridTemplateColumns: '1fr 70px 70px 100px 90px 36px' }}>
                <input list={`subs-${i}`} placeholder={t('subItemName')} value={x.name || ''}
                  onChange={(e) => {
                    const name = e.target.value
                    const sub = subs.find((s) => s.name === name)
                    const cost = sub ? myCost(sub.id) : undefined
                    setInv((p) => ({ ...p, items: p.items.map((y, j) => j === i ? { ...y, name, ...(cost !== undefined && !+y.price ? { price: cost } : {}), ...(sub && !y.unit ? { unit: sub.unit } : {}) } : y) }))
                  }} />
                <datalist id={`subs-${i}`}>
                  {myMains.flatMap((m) => mySubs(m.id)).map((s) => <option key={s.id} value={s.name} />)}
                </datalist>
                <input type="number" dir="ltr" placeholder={t('quantity')} value={x.qty ?? ''}
                  onChange={(e) => setInv((p) => ({ ...p, items: p.items.map((y, j) => j === i ? { ...y, qty: e.target.value } : y) }))} />
                <input type="number" dir="ltr" placeholder={t('col_days')} value={x.days ?? ''}
                  onChange={(e) => setInv((p) => ({ ...p, items: p.items.map((y, j) => j === i ? { ...y, days: e.target.value } : y) }))} />
                <input type="number" dir="ltr" placeholder={t('col_price')} value={x.price ?? ''}
                  onChange={(e) => setInv((p) => ({ ...p, items: p.items.map((y, j) => j === i ? { ...y, price: e.target.value } : y) }))} />
                <span className="cell-total" style={{ padding: '8px 4px', fontSize: 12.5 }}>{fmt((+x.qty || 0) * (+x.price || 0) * (+x.days || 1))}</span>
                <button type="button" className="icon-btn" onClick={() => setInv((p) => ({ ...p, items: p.items.filter((_, j) => j !== i) }))}>✕</button>
              </div>
            ))}
            <button type="button" className="add-btn" style={{ padding: '7px 14px', fontSize: 13 }}
              onClick={() => setInv((p) => ({ ...p, items: [...(p.items || []), { name: '', qty: '', days: 1, price: '' }] }))}>+ {t('addItem')}</button>
          </div>

          <div className="field" style={{ marginTop: 10 }}>
            <label>{t('payments')}</label>
            {(inv.payments || []).map((x, i) => (
              <div className="sub-item-row" key={i} style={{ gridTemplateColumns: '110px 140px 130px 1fr 36px' }}>
                <input type="number" dir="ltr" placeholder={t('amount')} value={x.amount ?? ''}
                  onChange={(e) => setInv((p) => ({ ...p, payments: p.payments.map((y, j) => j === i ? { ...y, amount: e.target.value } : y) }))} />
                <input type="date" value={x.date || ''}
                  onChange={(e) => setInv((p) => ({ ...p, payments: p.payments.map((y, j) => j === i ? { ...y, date: e.target.value } : y) }))} />
                <select value={x.method || 'cash'}
                  onChange={(e) => setInv((p) => ({ ...p, payments: p.payments.map((y, j) => j === i ? { ...y, method: e.target.value } : y) }))}>
                  <option value="cash">نقداً</option>
                  <option value="bank">{t('bank')}</option>
                  <option value="vodafone">{t('vodafone')}</option>
                  <option value="instapay">{t('instapay')}</option>
                  <option value="cheque">شيك</option>
                </select>
                <input placeholder={t('notes')} value={x.note || ''}
                  onChange={(e) => setInv((p) => ({ ...p, payments: p.payments.map((y, j) => j === i ? { ...y, note: e.target.value } : y) }))} />
                <button type="button" className="icon-btn" onClick={() => setInv((p) => ({ ...p, payments: p.payments.filter((_, j) => j !== i) }))}>✕</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <button type="button" className="add-btn" style={{ padding: '7px 14px', fontSize: 13 }}
                onClick={() => setInv((p) => ({ ...p, payments: [...(p.payments || []), { amount: '', date: new Date().toISOString().slice(0, 10), method: 'cash', note: '' }] }))}>+ {t('addPayment')}</button>
              <span style={{ fontSize: 13.5 }}>
                {t('grandTotal')}: <b>{fmt(withVat(inv, supplier))}</b> — {t('remainingAmt')}: <b style={{ color: withVat(inv, supplier) - invPaid(inv) > 0.01 ? '#A32D2D' : '#0F6E56' }}>{fmt(withVat(inv, supplier) - invPaid(inv))}</b>
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="save-btn" onClick={saveInv}>{t('save')}</button>
          </div>
        </Modal>
      )}

    </Modal>
  )
}
