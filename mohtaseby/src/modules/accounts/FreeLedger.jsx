import { useEffect, useState } from 'react'
import { useLang } from '../../lib/i18n.jsx'
import { listRows, insertRow, updateRow, deleteRow } from '../../lib/db.js'
import { fmt } from '../../lib/tafqeet.js'
import { Modal, EmptyState } from '../../components/ui.jsx'
import { printHtml } from '../exports/exportQuote.js'
import { loadSettings } from '../../lib/supabase.js'

const invTotal = (inv) => (inv.items || []).reduce((s, i) => s + (+i.qty || 0) * (+i.price || 0) * (+i.days || 1), 0)
const invPaid = (inv) => (inv.payments || []).reduce((s, p) => s + (+p.amount || 0), 0)
const withVat = (inv) => invTotal(inv) * (inv.is_taxable ? 1.14 : 1)

// كشف حساب حر: فواتير لموردين مؤقتين غير مسجلين
export default function FreeLedger() {
  const { t } = useLang()
  const [invoices, setInvoices] = useState([])
  const [conferences, setConferences] = useState([])
  const [settings, setSettings] = useState(null)
  const [inv, setInv] = useState(null)

  const load = async () =>
    setInvoices((await listRows('supplier_invoices')).filter((x) => !x.supplier_id && x.temp_supplier))
  useEffect(() => { load(); listRows('conferences').then(setConferences); loadSettings().then(setSettings) }, [])

  const saveInv = async () => {
    if (!inv.temp_supplier?.trim()) return alert(t('required') + ': ' + t('tempSupplierName'))
    const payload = {
      supplier_id: null, temp_supplier: inv.temp_supplier.trim(),
      conference_id: inv.conference_id || null, free_conference: inv.conference_id ? '' : (inv.free_conference || ''),
      invoice_date: inv.invoice_date || null, is_taxable: !!inv.is_taxable,
      items: (inv.items || []).filter((i) => i.name?.trim()),
      payments: (inv.payments || []).filter((p) => +p.amount),
      notes: inv.notes || '',
    }
    if (inv.id) await updateRow('supplier_invoices', inv.id, payload)
    else await insertRow('supplier_invoices', payload)
    setInv(null); load()
  }

  const exportPdf = (i) => {
    let body = `<h1>كشف حساب — ${i.temp_supplier}</h1>
      <div class="head-grid">
        <div><b>التاريخ:</b> ${i.invoice_date || ''}</div>
        <div><b>المؤتمر:</b> ${conferences.find((c) => c.id === i.conference_id)?.name || i.free_conference || '—'}</div>
      </div>
      <table><thead><tr><th>البند</th><th>الكمية</th><th>الأيام</th><th>السعر</th><th>القيمة</th></tr></thead><tbody>`
    for (const x of (i.items || []))
      body += `<tr><td style="text-align:start">${x.name}</td><td>${x.qty || ''}</td><td>${x.days || 1}</td><td>${fmt(x.price)}</td><td>${fmt((+x.qty || 0) * (+x.price || 0) * (+x.days || 1))}</td></tr>`
    body += `</tbody></table>
      <div class="totals">
        <div><span>الإجمالي${i.is_taxable ? ' + ضريبة 14%' : ''}</span><b>${fmt(withVat(i))}</b></div>
        <div><span>المدفوع</span><b>− ${fmt(invPaid(i))}</b></div>
        <div class="grand"><span>الباقي</span><b>${fmt(withVat(i) - invPaid(i))} EGP</b></div></div>`
    if ((i.payments || []).length) {
      body += `<h3 style="font-size:12px;margin-top:5mm">الدفعات</h3><table><thead><tr><th>#</th><th>المبلغ</th><th>التاريخ</th><th>الوسيلة</th></tr></thead><tbody>`
      i.payments.forEach((p, j) => {
        body += `<tr><td>${j + 1}</td><td>${fmt(p.amount)}</td><td>${p.date || ''}</td><td>${p.method || ''}</td></tr>`
      })
      body += `</tbody></table>`
    }
    printHtml({ title: `كشف ${i.temp_supplier}`, bodyHtml: body, settings, letterhead: !!settings?.letterhead_url, stamp: false, sign: false, preview: false })
  }

  const field = (i, k, v) => setInv((p) => ({ ...p, items: p.items.map((y, j) => j === i ? { ...y, [k]: v } : y) }))
  const pfield = (i, k, v) => setInv((p) => ({ ...p, payments: p.payments.map((y, j) => j === i ? { ...y, [k]: v } : y) }))

  return (
    <div>
      <p className="page-sub" style={{ marginTop: 0 }}>{t('freeLedgerHint')}</p>
      <div className="toolbar">
        <button className="save-btn" style={{ padding: '9px 16px', fontSize: 13.5 }}
          onClick={() => setInv({ temp_supplier: '', conference_id: '', invoice_date: new Date().toISOString().slice(0, 10), is_taxable: false, items: [], payments: [], notes: '' })}>
          + {t('newSupplierInvoice')}
        </button>
      </div>

      {invoices.length === 0 ? <EmptyState /> : invoices.map((i) => (
        <div className="entity-card" key={i.id} style={{ marginBottom: 10 }}>
          <div className="entity-head">
            <b>👤 {i.temp_supplier} — {i.invoice_date}</b>
            <span className={`badge ${i.is_taxable ? 'inv' : ''}`}>{i.is_taxable ? t('taxable') : t('nonTaxable')}</span>
          </div>
          <div className="entity-meta">
            <span>{(i.items || []).map((x) => `${x.name} ×${x.qty}`).join(' · ')}</span>
            <span>{t('grandTotal')}: <b>{fmt(withVat(i))}</b> — {t('collected')}: {fmt(invPaid(i))} — <b style={{ color: withVat(i) - invPaid(i) > 0.01 ? '#A32D2D' : '#0F6E56' }}>{t('remainingAmt')}: {fmt(withVat(i) - invPaid(i))}</b></span>
          </div>
          <div className="entity-actions">
            <button onClick={() => setInv({ ...i, items: i.items || [], payments: i.payments || [] })}>{t('edit')}</button>
            <button onClick={() => exportPdf(i)}>🖨 PDF</button>
            <button className="danger" onClick={async () => { await deleteRow('supplier_invoices', i.id); load() }}>{t('delete')}</button>
          </div>
        </div>
      ))}

      {inv && (
        <Modal title={t('newSupplierInvoice')} onClose={() => setInv(null)} wide>
          <div className="grid2">
            <div className="field"><label>{t('tempSupplierName')} *</label>
              <input value={inv.temp_supplier || ''} onChange={(e) => setInv((p) => ({ ...p, temp_supplier: e.target.value }))}
                placeholder="مورد مؤقت / شخص / محل..." /></div>
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
            {t('taxable')} (14%)
          </label>

          <div className="field" style={{ marginTop: 10 }}>
            <label>{t('invItems')}</label>
            {(inv.items || []).map((x, i) => (
              <div className="sub-item-row" key={i} style={{ gridTemplateColumns: '1fr 70px 70px 100px 90px 36px' }}>
                <input placeholder={t('itemName')} value={x.name || ''} onChange={(e) => field(i, 'name', e.target.value)} />
                <input type="number" dir="ltr" placeholder={t('quantity')} value={x.qty ?? ''} onChange={(e) => field(i, 'qty', e.target.value)} />
                <input type="number" dir="ltr" placeholder={t('col_days')} value={x.days ?? ''} onChange={(e) => field(i, 'days', e.target.value)} />
                <input type="number" dir="ltr" placeholder={t('col_price')} value={x.price ?? ''} onChange={(e) => field(i, 'price', e.target.value)} />
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
                <input type="number" dir="ltr" placeholder={t('amount')} value={x.amount ?? ''} onChange={(e) => pfield(i, 'amount', e.target.value)} />
                <input type="date" value={x.date || ''} onChange={(e) => pfield(i, 'date', e.target.value)} />
                <select value={x.method || 'cash'} onChange={(e) => pfield(i, 'method', e.target.value)}>
                  <option value="cash">نقداً</option>
                  <option value="bank">{t('bank')}</option>
                  <option value="vodafone">{t('vodafone')}</option>
                  <option value="instapay">{t('instapay')}</option>
                  <option value="cheque">شيك</option>
                </select>
                <input placeholder={t('notes')} value={x.note || ''} onChange={(e) => pfield(i, 'note', e.target.value)} />
                <button type="button" className="icon-btn" onClick={() => setInv((p) => ({ ...p, payments: p.payments.filter((_, j) => j !== i) }))}>✕</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <button type="button" className="add-btn" style={{ padding: '7px 14px', fontSize: 13 }}
                onClick={() => setInv((p) => ({ ...p, payments: [...(p.payments || []), { amount: '', date: new Date().toISOString().slice(0, 10), method: 'cash', note: '' }] }))}>+ {t('addPayment')}</button>
              <span style={{ fontSize: 13.5 }}>
                {t('grandTotal')}: <b>{fmt(withVat(inv))}</b> — {t('remainingAmt')}: <b style={{ color: withVat(inv) - invPaid(inv) > 0.01 ? '#A32D2D' : '#0F6E56' }}>{fmt(withVat(inv) - invPaid(inv))}</b>
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="save-btn" onClick={saveInv}>{t('save')}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
