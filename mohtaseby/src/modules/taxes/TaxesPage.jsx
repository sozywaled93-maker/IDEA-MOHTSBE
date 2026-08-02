import { useEffect, useState } from 'react'
import { useLang } from '../../lib/i18n.jsx'
import { listRows, insertRow, updateRow, deleteRow } from '../../lib/db.js'
import { fmt } from '../../lib/tafqeet.js'
import { taxDeadline, rowDeadline, taxBaseDate, fmtDate, daysUntil } from '../../lib/taxes.js'
import { EmptyState } from '../../components/ui.jsx'

export default function TaxesPage({ onChanged }) {
  const { t } = useLang()
  const [quotes, setQuotes] = useState([])
  const [clients, setClients] = useState([])
  const [manual, setManual] = useState([])

  const load = () => {
    listRows('quotes').then(setQuotes)
    listRows('clients').then(setClients)
    listRows('manual_taxes').then(setManual)
  }
  useEffect(load, [])

  const addManual = async () => {
    await insertRow('manual_taxes', {
      conference_name: '', invoice_date: new Date().toISOString().slice(0, 10), client_name: '',
      subtotal: 0, wht_amount: 0, vat_amount: 0, grand_total: 0,
      tax_filed: false, tax_paid: false, notes: '',
    }); load(); onChanged?.()
  }
  const patchManual = async (id, k, v) => {
    const row = manual.find((m) => m.id === id)
    const upd = { ...row, [k]: v }
    if (['subtotal'].includes(k)) {
      upd.wht_amount = +upd.subtotal * 0.03
      upd.vat_amount = +upd.subtotal * 0.14
      upd.grand_total = +upd.subtotal - upd.wht_amount + upd.vat_amount
    }
    await updateRow('manual_taxes', id, upd); load(); onChanged?.()
  }

  // بتتسحب أوتوماتيك: الفواتير اللي اتعلم عليها "تم الانتهاء من المؤتمر"
  const rows = quotes.filter((q) => q.doc_type === 'invoice' && q.finished)

  const toggle = async (id, k, v) => {
    await updateRow('quotes', id, { [k]: v })
    load(); onChanged?.()
  }

  const clientNames = clients.map((c) => c.company_name)
  return (
    <div>
      <datalist id="mt-clients">{clientNames.map((n, i) => <option key={i} value={n} />)}</datalist>
      <h1 className="page-title">{t('taxes')}</h1>
      <p className="page-sub">{t('taxesSub')}</p>

      {rows.length === 0 ? <EmptyState /> : (
        <div className="quote-scroll">
          <table className="quote-table">
            <thead><tr>
              <th>{t('conferenceName')}</th><th>{t('receiptDate')}</th><th>{t('clients')}</th>
              <th>Subtotal</th><th>WHT 3%</th><th>VAT 14%</th><th>{t('grandTotal')}</th>
              <th>{t('filingDeadline')}</th><th>{t('paymentDeadline')}</th>
              <th>{t('taxFiled')}</th><th>{t('taxPaid')}</th><th>{t('einvoice')}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const invDate = taxBaseDate(r)
                const dl = r.is_taxable && invDate ? rowDeadline(r) : null
                const left = dl ? daysUntil(dl) : null
                const overdue = dl && left < 0 && (!r.tax_filed || !r.tax_paid)
                return (
                  <tr key={r.id} style={overdue ? { background: '#FDECEC' } : {}}>
                    <td style={{ textAlign: 'start' }}><b>{r.conference_name}</b></td>
                    <td>{invDate || '—'}</td>
                    <td>{clients.find((c) => c.id === r.client_id)?.company_name || '—'}</td>
                    <td>{fmt(r.subtotal)}</td>
                    <td>{r.is_taxable ? '− ' + fmt(r.wht_amount) : '—'}</td>
                    <td>{r.is_taxable ? fmt(r.vat_amount) : '—'}</td>
                    <td><b>{fmt(r.grand_total)}</b></td>
                    <td>
                      {dl ? (
                        <span style={{ color: (overdue && !r.tax_filed) ? '#A32D2D' : left <= 7 ? '#B05E0B' : 'inherit', fontWeight: 600 }}>
                          {fmtDate(dl)} {r.tax_filed ? '✓' : left >= 0 ? `(${left} ${t('daysLeft')})` : `(${t('overdue')})`}
                        </span>
                      ) : '—'}
                    </td>
                    <td>
                      {dl ? (
                        <span style={{ color: (overdue && !r.tax_paid) ? '#A32D2D' : left <= 7 ? '#B05E0B' : 'inherit', fontWeight: 600 }}>
                          {fmtDate(dl)} {r.tax_paid ? '✓' : left >= 0 ? `(${left} ${t('daysLeft')})` : `(${t('overdue')})`}
                        </span>
                      ) : '—'}
                    </td>
                    <td>
                      {r.is_taxable ? (
                        <button className={`tax-btn ${r.tax_filed ? 'done' : ''}`}
                          onClick={() => toggle(r.id, 'tax_filed', !r.tax_filed)}>
                          {r.tax_filed ? '✓ ' + t('done_') : t('taxFiled')}
                        </button>
                      ) : '—'}
                    </td>
                    <td>
                      {r.is_taxable ? (
                        <button className={`tax-btn ${r.tax_paid ? 'done' : ''}`}
                          onClick={() => toggle(r.id, 'tax_paid', !r.tax_paid)}>
                          {r.tax_paid ? '✓ ' + t('done_') : t('taxPaid')}
                        </button>
                      ) : '—'}
                    </td>
                    <td>
                      <button className={`tax-btn ${r.einvoice_done ? 'done' : ''}`}
                        onClick={() => {
                          const on = !r.einvoice_done
                          toggle(r.id, 'einvoice_done', on)
                          // أول ما يتعلّم "تم الرفع" نثبّت تاريخ اليوم كأساس للمهلة
                          if (on && !r.einvoice_date) toggle(r.id, 'einvoice_date', new Date().toISOString().slice(0, 10))
                        }}>
                        {r.einvoice_done ? '✓ ' + t('done_') : t('einvoice')}
                      </button>
                      {r.einvoice_done && (
                        <div style={{ marginTop: 4 }}>
                          <input type="date" style={{ fontSize: 12 }}
                            value={r.einvoice_date || ''}
                            onChange={(e) => toggle(r.id, 'einvoice_date', e.target.value || null)} />
                          <div className="hint-inline" style={{ fontSize: 11 }}>{t('deadlineFromThis')}</div>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginTop: 18 }}>
        <h3>{t('manualTaxes')}</h3>
        <p className="hint-inline" style={{ marginTop: -8 }}>{t('manualTaxesHint')}</p>
        <div className="toolbar"><button className="add-btn" onClick={addManual}>+ {t('addManualTax')}</button></div>
        {manual.length > 0 && (
          <div className="quote-scroll">
            <table className="quote-table costs-table">
              <thead><tr>
                <th>{t('conferenceName')}</th><th>{t('receiptDate')}</th><th>{t('clients')}</th>
                <th>Subtotal</th><th>WHT 3%</th><th>VAT 14%</th><th>{t('grandTotal')}</th>
                <th>{t('filingDeadline')}</th>
                <th>{t('taxFiled')}</th><th>{t('taxPaid')}</th><th></th>
              </tr></thead>
              <tbody>
                {manual.map((m) => {
                  const dl = taxBaseDate(m) ? rowDeadline(m) : null
                  const left = dl ? daysUntil(dl) : null
                  return (
                  <tr key={m.id} style={!m.invoice_date ? { background: '#FFF7E6' } : {}}>
                    <td><input value={m.conference_name || ''} onChange={(e) => patchManual(m.id, 'conference_name', e.target.value)} /></td>
                    <td>
                      <input type="date" value={m.invoice_date || ''} onChange={(e) => patchManual(m.id, 'invoice_date', e.target.value)} />
                      {!m.invoice_date && <div className="hint-inline" style={{ color: '#B05E0B' }}>⚠ {t('dateRequiredForAlerts')}</div>}
                    </td>
                    <td><input value={m.client_name || ''} onChange={(e) => patchManual(m.id, 'client_name', e.target.value)} /></td>
                    <td><input className="num" type="number" value={m.subtotal ?? 0} onChange={(e) => patchManual(m.id, 'subtotal', +e.target.value)} /></td>
                    <td>{fmt(m.wht_amount)}</td>
                    <td>{fmt(m.vat_amount)}</td>
                    <td><b>{fmt(m.grand_total)}</b></td>
                    <td>
                      {dl ? (
                        <span style={{ color: left < 0 && !(m.tax_filed && m.tax_paid) ? '#A32D2D' : left <= 7 ? '#B05E0B' : 'inherit', fontWeight: 600, fontSize: 12.5 }}>
                          {fmtDate(dl)} {left >= 0 ? `(${left} ${t('daysLeft')})` : `(${t('overdue')})`}
                        </span>
                      ) : '—'}
                    </td>
                    <td><button className={`tax-btn ${m.tax_filed ? 'done' : ''}`} onClick={() => patchManual(m.id, 'tax_filed', !m.tax_filed)}>{m.tax_filed ? '✓ ' + t('done_') : t('taxFiled')}</button></td>
                    <td><button className={`tax-btn ${m.tax_paid ? 'done' : ''}`} onClick={() => patchManual(m.id, 'tax_paid', !m.tax_paid)}>{m.tax_paid ? '✓ ' + t('done_') : t('taxPaid')}</button></td>
                    <td><button className="icon-btn" onClick={async () => { await deleteRow('manual_taxes', m.id); load(); onChanged?.() }}>✕</button></td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h3>{t('taxRule')}</h3>
        <p style={{ fontSize: 13.5, margin: 0, lineHeight: 1.9 }}>{t('taxRuleText')}</p>
      </div>
    </div>
  )
}
