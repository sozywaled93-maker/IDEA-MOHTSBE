import { useEffect, useMemo, useState } from 'react'
import { useLang } from '../../lib/i18n.jsx'
import { listRows } from '../../lib/db.js'
import { fmt } from '../../lib/tafqeet.js'
import { goto } from '../../lib/nav.js'

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
      topClient, topClientId, topClientTotal: byClient[topClientId] || 0,
      topSupplier, topSupId, topSupplierTotal: bySupplier[topSupId] || 0,
      invoiceCount: quotes.filter((q) => q.doc_type === 'invoice').length,
      proposalCount: quotes.filter((q) => q.doc_type !== 'invoice').length,
    }
  }, [quotes, clients, suppliers, expenses, incomes, costs])

  return (
    <div>
      <h1 className="page-title">{t('dashboard')}</h1>
      <p className="page-sub">{now.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' })}</p>

      <div className="kpi-row">
        <button className="kpi big" style={{ cursor: 'pointer', textAlign: 'start' }}
          onClick={() => goto('treasury', { tab: 'overview' })}>
          <span>{t('monthProfit')}</span>
          <b style={{ color: stats.monthProfit >= 0 ? '#0F6E56' : '#A32D2D' }}>{fmt(stats.monthProfit)} EGP</b>
          <small className="hint-inline">{t('clickForSource')}</small>
        </button>
        <button className="kpi" style={{ cursor: 'pointer', textAlign: 'start' }}
          onClick={() => goto('treasury', { tab: 'income' })}>
          <span>{t('monthIncome')}</span><b>{fmt(stats.monthIncome)}</b>
        </button>
        <button className="kpi" style={{ cursor: 'pointer', textAlign: 'start' }}
          onClick={() => goto('treasury', { tab: 'expenses' })}>
          <span>{t('monthExpenses')}</span><b>{fmt(stats.monthExpense)}</b>
        </button>
      </div>

      <div className="kpi-row">
        <button className="kpi" style={{ cursor: stats.topClient ? 'pointer' : 'default', textAlign: 'start' }}
          onClick={() => stats.topClient && goto('quotes', { clientId: stats.topClientId })}>
          <span>{t('topClient')}</span>
          <b>{stats.topClient?.company_name || '—'}</b>
          {stats.topClient && <small>{fmt(stats.topClientTotal)} EGP — {t('clickForInvoices')}</small>}
        </button>
        <button className="kpi" style={{ cursor: stats.topSupplier ? 'pointer' : 'default', textAlign: 'start' }}
          onClick={() => stats.topSupplier && goto('accounts', { tab: 'paidOut', supplierId: stats.topSupId })}>
          <span>{t('topSupplier')}</span>
          <b>{stats.topSupplier?.supplier_name || '—'}</b>
          {stats.topSupplier && <small>{fmt(stats.topSupplierTotal)} EGP — {t('clickForInvoices')}</small>}
        </button>
        <button className="kpi" style={{ cursor: 'pointer', textAlign: 'start' }}
          onClick={() => goto('quotes', {})}>
          <span>{t('invoices')}</span><b>{stats.invoiceCount}</b>
        </button>
        <button className="kpi" style={{ cursor: 'pointer', textAlign: 'start' }}
          onClick={() => goto('quotes', {})}>
          <span>{t('proposals')}</span><b>{stats.proposalCount}</b>
        </button>
      </div>
    </div>
  )
}
