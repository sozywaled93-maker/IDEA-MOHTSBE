import { useEffect, useMemo, useState } from 'react'
import { listRows } from '../../lib/db.js'
import { fmt } from '../../lib/tafqeet.js'
import { autoPulls } from '../contacts/SupplierLedger.jsx'

// صفحة عامة للمورد فقط (يفتحها عبر QR) — قراءة بدون أي وصول للنظام
export default function PublicStatement({ token }) {
  const [supplier, setSupplier] = useState(null)
  const [quotes, setQuotes] = useState([])
  const [invoices, setInvoices] = useState([])
  const [adjustments, setAdjustments] = useState([])
  const [conferences, setConferences] = useState([])
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    (async () => {
      const sups = await listRows('suppliers')
      const sp = sups.find((x) => x.public_token === token)
      if (!sp) return setNotFound(true)
      setSupplier(sp)
      setQuotes(await listRows('quotes'))
      setInvoices((await listRows('supplier_invoices')).filter((x) => x.supplier_id === sp.id))
      setAdjustments((await listRows('supplier_adjustments')).filter((x) => x.supplier_id === sp.id))
      setConferences(await listRows('conferences'))
    })()
  }, [token])

  const pulls = useMemo(() => supplier ? autoPulls(supplier.id, quotes) : [], [supplier, quotes])
  const invTotal = (inv) => (inv.items || []).reduce((s, i) => s + (+i.qty || 0) * (+i.price || 0) * (+i.days || 1), 0)
  const withVat = (inv) => invTotal(inv) * (inv.is_taxable ? 1 + (+(supplier?.tax_rate ?? 14)) / 100 : 1)
  const invPaid = (inv) => (inv.payments || []).reduce((s, p) => s + (+p.amount || 0), 0)

  const totals = useMemo(() => {
    const auto = pulls.reduce((s, p) => s + p.total, 0)
    const manual = invoices.reduce((s, i) => s + withVat(i), 0)
    const adj = adjustments.reduce((s, a) => s + (+a.amount || 0), 0)
    const paid = invoices.reduce((s, i) => s + invPaid(i), 0)
    return { due: auto + manual + adj, paid, balance: auto + manual + adj - paid }
  }, [pulls, invoices, adjustments])

  if (notFound) return <div className="public-page"><div className="card">⚠️ الرابط غير صحيح أو تم إلغاؤه</div></div>
  if (!supplier) return <div className="public-page"><div className="card">جارٍ التحميل...</div></div>

  return (
    <div className="public-page" dir="rtl">
      <div className="card" style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ margin: 0 }}>كشف حساب — {supplier.supplier_name}</h2>
            <p className="hint-inline">بتاريخ {new Date().toLocaleDateString('ar-EG')}</p>
          </div>
          <button className="save-btn" onClick={() => window.print()}>🖨 حفظ PDF</button>
        </div>

        <div className="kpi-row" style={{ marginTop: 14 }}>
          <div className="kpi"><span>إجمالي المستحق</span><b>{fmt(totals.due)}</b></div>
          <div className="kpi"><span>المدفوع</span><b>{fmt(totals.paid)}</b></div>
          <div className="kpi"><span>الرصيد</span>
            <b style={{ color: totals.balance > 0.01 ? '#A32D2D' : '#0F6E56' }}>{fmt(totals.balance)} EGP</b></div>
        </div>

        {pulls.length > 0 && <>
          <h3 style={{ fontSize: 15 }}>المسحوبات من المؤتمرات</h3>
          <table className="quote-table" style={{ width: '100%' }}>
            <thead><tr><th>المؤتمر</th><th>التاريخ</th><th>البند</th><th>الكمية</th><th>القيمة</th></tr></thead>
            <tbody>
              {pulls.map((p) => p.items.map((i, j) => (
                <tr key={p.quote.id + j}>
                  <td>{j === 0 ? p.conference : ''}</td><td>{j === 0 ? (p.date || '') : ''}</td>
                  <td>{i.name}</td><td>{i.qty}</td><td>{fmt(i.cost)}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </>}

        {invoices.length > 0 && <>
          <h3 style={{ fontSize: 15, marginTop: 18 }}>فواتير ودفعات</h3>
          <table className="quote-table" style={{ width: '100%' }}>
            <thead><tr><th>التاريخ</th><th>المؤتمر</th><th>الإجمالي</th><th>المدفوع</th><th>الباقي</th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td>{i.invoice_date || ''}</td>
                  <td>{conferences.find((c) => c.id === i.conference_id)?.name || '—'}</td>
                  <td>{fmt(withVat(i))}</td><td>{fmt(invPaid(i))}</td>
                  <td style={{ color: withVat(i) - invPaid(i) > 0.01 ? '#A32D2D' : '#0F6E56' }}><b>{fmt(withVat(i) - invPaid(i))}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>}

        {adjustments.length > 0 && <>
          <h3 style={{ fontSize: 15, marginTop: 18 }}>تسويات</h3>
          <table className="quote-table" style={{ width: '100%' }}>
            <thead><tr><th>التاريخ</th><th>البيان</th><th>المبلغ</th></tr></thead>
            <tbody>
              {adjustments.map((a) => (
                <tr key={a.id}><td>{a.adj_date || ''}</td><td>{a.reason || '—'}</td><td>{a.amount >= 0 ? '+' : ''}{fmt(a.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        </>}

        <p className="hint-inline" style={{ textAlign: 'center', marginTop: 24 }}>Powered by IDEA Operating System v1</p>
      </div>
    </div>
  )
}
