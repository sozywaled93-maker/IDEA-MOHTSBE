import { useEffect, useMemo, useState } from 'react'
import { useLang } from '../../lib/i18n.jsx'
import { listRows } from '../../lib/db.js'
import { fmt } from '../../lib/tafqeet.js'

export default function DashboardPage() {
  const { t } = useLang()
  const [quotes, setQuotes] = useState([])
  const [clients, setClients] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [expenses, setExpenses] = useState([])
  const [incomes, setIncomes] = useState([])
  const [costs, setCosts] = useState([])

  useEffect(() => {
    listRows('quotes').then(setQuotes)
    listRows('clients').then(setClients)
    listRows('suppliers').then(setSuppliers)
    listRows('expenses').then(setExpenses)
    listRows('incomes').then(setIncomes)
    listRows('supplier_costs').then(setCosts)
  }, [])

  const now = new Date()
  const thisMonth = (d) => {
    if (!d) return false
    const x = new Date(d)
    return x.getFullYear() === now.getFullYear() && x.getMonth() === now.getMonth()
  }

  const stats = useMemo(() => {
    // أرباح الشهر = تحصيلات الشهر - مصروفات الشهر
    const inc = incomes.filter((i) => thisMonth(i.income_date)).reduce((s, r) => s + (+r.amount || 0), 0)
    const exp = expenses.filter((e) => thisMonth(e.expense_date)).reduce((s, r) => s + (+r.amount || 0), 0)

    // أكتر عميل
    const byClient = {}
    for (const q of quotes.filter((q) => q.doc_type === 'invoice')) {
      if (!q.client_id) continue
      byClient[q.client_id] = (byClient[q.client_id] || 0) + (+q.grand_total || 0)
    }
    const topClientId = Object.keys(byClient).sort((a, b) => byClient[b] - byClient[a])[0]
    const topClient = clients.find((c) => c.id === topClientId)

    // أكتر مورد (من جداول التكاليف والمصروفات)
    const bySupplier = {}
    for (const c of costs) {
      if (!c.supplier_id) continue
      bySupplier[c.supplier_id] = (bySupplier[c.supplier_id] || 0) + ((+c.quantity || 0) * (+c.price || 0) * (+c.num_days || 0))
    }
    const topSupId = Object.keys(bySupplier).sort((a, b) => bySupplier[b] - bySupplier[a])[0]
    const topSupplier = suppliers.find((s) => s.id === topSupId)

    return {
      monthProfit: inc - exp, monthIncome: inc, monthExpense: exp,
      topClient, topClientTotal: byClient[topClientId] || 0,
      topSupplier, topSupplierTotal: bySupplier[topSupId] || 0,
      invoiceCount: quotes.filter((q) => q.doc_type === 'invoice').length,
      proposalCount: quotes.filter((q) => q.doc_type !== 'invoice').length,
    }
  }, [quotes, clients, suppliers, expenses, incomes, costs])

  return (
    <div>
      <h1 className="page-title">{t('dashboard')}</h1>
      <p className="page-sub">{now.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' })}</p>

      <div className="kpi-row">
        <div className="kpi big">
          <span>{t('monthProfit')}</span>
          <b style={{ color: stats.monthProfit >= 0 ? '#0F6E56' : '#A32D2D' }}>{fmt(stats.monthProfit)} EGP</b>
        </div>
        <div className="kpi"><span>{t('monthIncome')}</span><b>{fmt(stats.monthIncome)}</b></div>
        <div className="kpi"><span>{t('monthExpenses')}</span><b>{fmt(stats.monthExpense)}</b></div>
      </div>

      <div className="kpi-row">
        <div className="kpi">
          <span>{t('topClient')}</span>
          <b>{stats.topClient?.company_name || '—'}</b>
          {stats.topClient && <small>{fmt(stats.topClientTotal)} EGP</small>}
        </div>
        <div className="kpi">
          <span>{t('topSupplier')}</span>
          <b>{stats.topSupplier?.supplier_name || '—'}</b>
          {stats.topSupplier && <small>{fmt(stats.topSupplierTotal)} EGP</small>}
        </div>
        <div className="kpi"><span>{t('invoices')}</span><b>{stats.invoiceCount}</b></div>
        <div className="kpi"><span>{t('proposals')}</span><b>{stats.proposalCount}</b></div>
      </div>
    </div>
  )
}
