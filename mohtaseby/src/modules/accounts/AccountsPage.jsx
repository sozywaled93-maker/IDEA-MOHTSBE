import { useEffect, useMemo, useState } from 'react'
import { useLang } from '../../lib/i18n.jsx'
import { listRows, insertRow } from '../../lib/db.js'
import { fmt } from '../../lib/tafqeet.js'
import { Modal, EmptyState } from '../../components/ui.jsx'
import SupplierLedger from './SupplierLedger.jsx'
import FreeLedger from './FreeLedger.jsx'

/* ---------- حسابات مطابقة لكشف حساب المورد حرفياً ---------- */
const invTotal = (inv) => (inv.items || []).reduce((s, i) => s + (+i.qty || 0) * (+i.price || 0) * (+i.days || 1), 0)
const invPaid = (inv) => (inv.payments || []).reduce((s, p) => s + (+p.amount || 0), 0)
const withVat = (inv, sup) => invTotal(inv) * (inv.is_taxable ? 1 + (+(sup?.tax_rate ?? 14)) / 100 : 1)

const parseData = (q) => {
  try { return typeof q.data === 'string' ? JSON.parse(q.data || '{}') : (q.data || {}) } catch { return {} }
}
const parsePays = (q) => {
  try { return typeof q.payments === 'string' ? JSON.parse(q.payments || '[]') : (q.payments || []) } catch { return [] }
}

// السحب التلقائي: تكلفة بنود المورد داخل فواتير المؤتمرات المنتهية
function autoPulls(supplierId, quotes) {
  let total = 0
  for (const q of quotes) {
    if (q.doc_type !== 'invoice' || !q.finished) continue
    const d = parseData(q)
    for (const it of (d.items || [])) {
      if (it.supplier_id !== supplierId) continue
      for (const h of (d.halls || [])) {
        const c = (it.cells && it.cells[h.key]) || {}
        total += (+c.units || 0) * (+it.cost_price || 0) * (+c.days || 0)
      }
    }
  }
  return total
}

const ageOf = (dateStr) => {
  if (!dateStr) return null
  return Math.floor((new Date() - new Date(dateStr)) / 864e5)
}

export default function AccountsPage() {
  const { t } = useLang()
  const [tab, setTab] = useState('payable')     // payable | receivable
  const [filter, setFilter] = useState('open')  // all | open | overdue
  const [quotes, setQuotes] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [clients, setClients] = useState([])
  const [invoices, setInvoices] = useState([])
  const [payments, setPayments] = useState([])
  const [adjustments, setAdjustments] = useState([])
  const [detail, setDetail] = useState(null)    // {kind, row}
  const [payForm, setPayForm] = useState(null)

  const load = () => {
    listRows('quotes').then(setQuotes).catch(() => setQuotes([]))
    listRows('suppliers').then(setSuppliers).catch(() => setSuppliers([]))
    listRows('clients').then(setClients).catch(() => setClients([]))
    listRows('supplier_invoices').then(setInvoices).catch(() => setInvoices([]))
    listRows('supplier_payments').then(setPayments).catch(() => setPayments([]))
    listRows('supplier_adjustments').then(setAdjustments).catch(() => setAdjustments([]))
  }
  useEffect(load, [])

  /* ---------- اللي علينا: كل مورد ورصيده ---------- */
  const payables = useMemo(() => suppliers.map((sup) => {
    const myInv = invoices.filter((x) => x.supplier_id === sup.id)
    const myPay = payments.filter((x) => x.supplier_id === sup.id)
    const myAdj = adjustments.filter((x) => x.supplier_id === sup.id)
    const due = autoPulls(sup.id, quotes)
      + myInv.reduce((s, i) => s + withVat(i, sup), 0)
      + myAdj.reduce((s, a) => s + (+a.amount || 0), 0)
    const paid = myInv.reduce((s, i) => s + invPaid(i), 0)
      + myPay.reduce((s, p) => s + (+p.amount || 0), 0)
    const dates = myInv.map((i) => i.invoice_date).filter(Boolean).sort()
    return {
      id: sup.id, name: sup.supplier_name || sup.company_name || '—', phone: sup.phone,
      due, paid, balance: due - paid, oldest: dates[0] || null, age: ageOf(dates[0]),
      invoices: myInv, payments: myPay, supplier: sup,
    }
  }), [suppliers, invoices, payments, adjustments, quotes])

  /* ---------- اللي لينا: كل عميل ورصيده من الفواتير ---------- */
  const receivables = useMemo(() => clients.map((cl) => {
    const bills = quotes.filter((q) => q.client_id === cl.id && q.doc_type === 'invoice')
    const due = bills.reduce((s, q) => s + (+q.grand_total || 0), 0)
    const paid = bills.reduce((s, q) => s + parsePays(q).reduce((a, p) => a + (+p.amount || 0), 0), 0)
    const dates = bills.map((q) => q.date_to || q.date_from).filter(Boolean).sort()
    return {
      id: cl.id, name: cl.company_name || '—', phone: cl.phone,
      due, paid, balance: due - paid, oldest: dates[0] || null, age: ageOf(dates[0]),
      bills, client: cl,
    }
  }), [clients, quotes])

  const rows = tab === 'payable' ? payables : receivables
  const shown = rows.filter((r) => {
    if (filter === 'open') return r.balance > 0.01
    if (filter === 'overdue') return r.balance > 0.01 && (r.age ?? 0) > 30
    return r.due > 0.01 || r.paid > 0.01
  }).sort((a, b) => b.balance - a.balance)

  const totalOpen = rows.reduce((s, r) => s + (r.balance > 0.01 ? r.balance : 0), 0)
  const totalOverdue = rows.reduce((s, r) => s + (r.balance > 0.01 && (r.age ?? 0) > 30 ? r.balance : 0), 0)
  const netPosition = receivables.reduce((s, r) => s + Math.max(r.balance, 0), 0)
    - payables.reduce((s, r) => s + Math.max(r.balance, 0), 0)

  const savePayment = async () => {
    if (!+payForm.amount) return
    await insertRow('supplier_payments', {
      supplier_id: payForm.supplier_id, amount: +payForm.amount,
      method: payForm.method || 'cash', pay_date: payForm.pay_date,
      note: payForm.note || '', conference_id: null,
    })
    setPayForm(null); setDetail(null); load()
  }

  return (
    <div>
      <h1 className="page-title">💼 {t('accounts')}</h1>

      {/* ملخص علوي */}
      <div className="kpi-row" style={{ marginBottom: 14 }}>
        <div className="kpi">
          <span>📤 {t('totalPayable')}</span>
          <b style={{ color: '#A32D2D' }}>{fmt(payables.reduce((s, r) => s + Math.max(r.balance, 0), 0))}</b>
        </div>
        <div className="kpi">
          <span>📥 {t('totalReceivable')}</span>
          <b style={{ color: '#0F6E56' }}>{fmt(receivables.reduce((s, r) => s + Math.max(r.balance, 0), 0))}</b>
        </div>
        <div className="kpi big">
          <span>📊 {t('netPosition')}</span>
          <b style={{ color: netPosition >= 0 ? '#0F6E56' : '#A32D2D' }}>{fmt(netPosition)}</b>
        </div>
      </div>

      {/* التابات */}
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={tab === 'payable' ? 'active' : ''} onClick={() => setTab('payable')}>
          📤 {t('weOwe')}
        </button>
        <button className={tab === 'receivable' ? 'active' : ''} onClick={() => setTab('receivable')}>
          📥 {t('owedToUs')}
        </button>
        <button className={tab === 'free' ? 'active' : ''} onClick={() => setTab('free')}>
          🧾 {t('freeSupplier')}
        </button>
      </div>

      {tab === 'free' && <FreeLedger />}

      {tab !== 'free' && <>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <div className="seg">
          <button className={filter === 'open' ? 'active' : ''} onClick={() => setFilter('open')}>{t('openOnly')}</button>
          <button className={filter === 'overdue' ? 'active' : ''} onClick={() => setFilter('overdue')}>⚠ {t('overdue30')}</button>
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>{t('all')}</button>
        </div>
        <span className="badge">
          {t('openTotal')}: <b>{fmt(totalOpen)}</b>
          {totalOverdue > 0.01 && <> — ⚠ {t('overdue')}: <b style={{ color: '#A32D2D' }}>{fmt(totalOverdue)}</b></>}
        </span>
      </div>

      {shown.length === 0 ? <EmptyState /> : (
        <div style={{ overflowX: 'auto' }}><table className="quote-table">
          <thead><tr>
            <th>{tab === 'payable' ? t('supplier') : t('client')}</th>
            <th>{t('grandTotal')}</th><th>{t('collected')}</th>
            <th>{t('remainingAmt')}</th><th>{t('agingDays')}</th><th></th>
          </tr></thead>
          <tbody>
            {shown.map((r) => {
              const closed = r.balance <= 0.01
              const late = !closed && (r.age ?? 0) > 30
              return (
                <tr key={r.id} style={late ? { background: '#FDECEC' } : {}}>
                  <td><b>{closed ? '🟢' : late ? '🔴' : '🟡'} {r.name}</b>
                    {r.phone && <div className="hint-inline">☎ {r.phone}</div>}</td>
                  <td>{fmt(r.due)}</td>
                  <td>{fmt(r.paid)}</td>
                  <td><b style={{ color: closed ? '#0F6E56' : '#A32D2D' }}>
                    {closed ? t('settled') : fmt(r.balance)}</b></td>
                  <td>{r.age != null ? `${r.age} ${t('dayWord')}` : '—'}</td>
                  <td>
                    <button className="mini-btn" onClick={() => setDetail({ kind: tab, row: r })}>{t('details')}</button>
                    {tab === 'payable' && !closed && (
                      <button className="mini-btn ok" style={{ marginInlineStart: 4 }}
                        onClick={() => setPayForm({
                          supplier_id: r.id, amount: r.balance, method: 'cash',
                          pay_date: new Date().toISOString().slice(0, 10), note: '', name: r.name,
                        })}>💵 {t('pay')}</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table></div>
      )}
      </>}

      {/* كشف الحساب الكامل */}
      {detail && detail.kind === 'payable' && (
        <SupplierLedger supplier={detail.row.supplier}
          onClose={() => { setDetail(null); load() }} />
      )}

      {detail && detail.kind === 'receivable' && (
        <Modal title={`📥 ${detail.row.name}`} onClose={() => setDetail(null)} wide>
          <div className="entity-meta" style={{ marginBottom: 12 }}>
            <span>{t('grandTotal')}: <b>{fmt(detail.row.due)}</b></span>
            <span>{t('collected')}: <b>{fmt(detail.row.paid)}</b></span>
            <span>{t('remainingAmt')}: <b style={{ color: detail.row.balance > 0.01 ? '#A32D2D' : '#0F6E56' }}>
              {fmt(detail.row.balance)}</b></span>
          </div>
          <div className="card" style={{ padding: 12 }}>
            <h3 style={{ fontSize: 14 }}>🧾 {t('invoices')}</h3>
            {detail.row.bills.map((q) => {
              const p = parsePays(q).reduce((a, x) => a + (+x.amount || 0), 0)
              return (
                <div className="manage-row" key={q.id}>
                  <span>{q.date_from || '—'} — {q.conference_name || '—'} — <b>{fmt(q.grand_total)}</b>
                    {' — '}{t('collected')}: {fmt(p)}
                    {' — '}<b style={{ color: q.grand_total - p > 0.01 ? '#A32D2D' : '#0F6E56' }}>
                      {t('remainingAmt')}: {fmt(q.grand_total - p)}</b></span>
                </div>
              )
            })}
            {!detail.row.bills.length && <p className="hint-inline">{t('noInvoicesYet')}</p>}
          </div>
          <p className="hint-inline">{t('clientPaymentsHint')}</p>
        </Modal>
      )}

      {/* تسجيل دفعة لمورد */}
      {payForm && (
        <Modal title={`💵 ${t('addPayment')} — ${payForm.name}`} onClose={() => setPayForm(null)}>
          <div className="field"><label>{t('amount')}</label>
            <input type="number" value={payForm.amount}
              onChange={(e) => setPayForm((p) => ({ ...p, amount: e.target.value }))} /></div>
          <div className="field"><label>{t('date')}</label>
            <input type="date" value={payForm.pay_date}
              onChange={(e) => setPayForm((p) => ({ ...p, pay_date: e.target.value }))} /></div>
          <div className="field"><label>{t('method')}</label>
            <select value={payForm.method} onChange={(e) => setPayForm((p) => ({ ...p, method: e.target.value }))}>
              <option value="cash">{t('cashWord')}</option>
              <option value="cheque">{t('chequeWord')}</option>
              <option value="instapay">InstaPay</option>
              <option value="vodafone">Vodafone Cash</option>
            </select></div>
          <div className="field"><label>{t('notes')}</label>
            <input value={payForm.note}
              onChange={(e) => setPayForm((p) => ({ ...p, note: e.target.value }))} /></div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="save-btn" onClick={savePayment}>{t('save')}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
