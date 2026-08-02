import { useEffect, useMemo, useState } from 'react'
import { BlurInput } from '../../components/BlurInput.jsx'
import DebInput from '../../components/DebInput.jsx'
import { debSave } from '../../lib/debounce.js'
import { useLang } from '../../lib/i18n.jsx'
import { listRows, insertRow, updateRow, deleteRow } from '../../lib/db.js'
import { fmt } from '../../lib/tafqeet.js'
import { EmptyState, Modal } from '../../components/ui.jsx'
import * as XLSX from 'xlsx'

export default function TreasuryPage() {
  const { t } = useLang()
  const [tab, setTab] = useState('overview')
  const [expenses, setExpenses] = useState([])
  const [incomes, setIncomes] = useState([])
  const [quotes, setQuotes] = useState([])
  const [clients, setClients] = useState([])
  const [employees, setEmployees] = useState([])
  const [supplierCosts, setSupplierCosts] = useState([])
  const [regEmp, setRegEmp] = useState(null)   // تسجيل موظف جديد من خانة التسليم
  const [eventFilter, setEventFilter] = useState('all')

  const load = () => {
    listRows('expenses').then(setExpenses)
    listRows('incomes').then(setIncomes)
    listRows('quotes').then(setQuotes)
    listRows('clients').then(setClients)
    listRows('employees').then(setEmployees)
    listRows('supplier_costs').then(setSupplierCosts)
  }
  useEffect(load, [])

  const invoices = quotes.filter((q) => q.doc_type === 'invoice')
  const qName = (id) => quotes.find((q) => q.id === id)?.conference_name || '—'

  // إجماليات الخزنة
  const totIncome = incomes.reduce((s, r) => s + (+r.amount || 0), 0)
  const totExpense = expenses.reduce((s, r) => s + (+r.amount || 0), 0)
  const balance = totIncome - totExpense
  // المدفوع للموردين يُحتسب من دفعات جداول تكاليف الموردين فقط
  const supplierPaid = supplierCosts.reduce((s, r) => s + (+r.payment_1 || 0) + (+r.payment_2 || 0) + (+r.payment_3 || 0), 0)

  // ربح إيفنت معين = تحصيلاته - مصروفاته
  const eventProfit = (qid) => {
    const inc = incomes.filter((i) => i.quote_id === qid).reduce((s, r) => s + (+r.amount || 0), 0)
    const exp = expenses.filter((e) => e.quote_id === qid).reduce((s, r) => s + (+r.amount || 0), 0)
    return { inc, exp, profit: inc - exp }
  }

  const addExpense = async (type) => {
    await insertRow('expenses', {
      expense_type: type, quote_id: type === 'event' ? (eventFilter !== 'all' ? eventFilter : quotes[0]?.id || null) : null,
      name: '', amount: 0, expense_date: new Date().toISOString().slice(0, 10), notes: '',
    }); load()
  }
  const addIncome = async () => {
    await insertRow('incomes', {
      quote_id: eventFilter !== 'all' ? eventFilter : (invoices[0]?.id || null),
      client_id: null, amount: 0, income_date: new Date().toISOString().slice(0, 10), notes: '',
    }); load()
  }
  const patchE = (id, k, v) => {
    setExpenses((p) => p.map((x) => x.id === id ? { ...x, [k]: v } : x))
    debSave('expenses', id, { [k]: v })
  }
  const patchI = (id, k, v) => {
    setIncomes((p) => p.map((x) => x.id === id ? { ...x, [k]: v } : x))
    debSave('incomes', id, { [k]: v })
  }

  const visExpenses = expenses.filter((e) => eventFilter === 'all' || e.quote_id === eventFilter)
  const visIncomes = incomes.filter((i) => eventFilter === 'all' || i.quote_id === eventFilter)

  return (
    <div>
      <h1 className="page-title">{t('treasury')}</h1>

      <div className="kpi-row">
        <div className="kpi"><span>{t('cashBalance')}</span><b style={{ color: balance >= 0 ? '#0F6E56' : '#A32D2D' }}>{fmt(balance)} EGP</b></div>
        <div className="kpi"><span>{t('totalCollected')}</span><b>{fmt(totIncome)}</b></div>
        <div className="kpi"><span>{t('totalExpenses')}</span><b>{fmt(totExpense)}</b></div>
        <div className="kpi"><span>{t('paidToSuppliers')}</span><b>{fmt(supplierPaid)}</b></div>
      </div>

      <div className="tabs">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>{t('eventCosts')}</button>
        <button className={tab === 'expenses' ? 'active' : ''} onClick={() => setTab('expenses')}>{t('expenses')}</button>
        <button className={tab === 'income' ? 'active' : ''} onClick={() => setTab('income')}>{t('income')}</button>
      </div>

      {/* ===== تكاليف المؤتمر ===== */}
      {tab === 'overview' && (
        <div>
          <div className="toolbar">
            <select className="cat-filter" value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}>
              <option value="all">— {t('allEvents')} —</option>
              {quotes.map((q) => <option key={q.id} value={q.id}>{q.conference_name}</option>)}
            </select>
          </div>
          {eventFilter === 'all' ? (
            <div className="cards-grid">
              {quotes.map((q) => {
                const p = eventProfit(q.id)
                if (!p.inc && !p.exp) return null
                return (
                  <div className="entity-card" key={q.id}>
                    <div className="entity-head"><b>{q.conference_name}</b>
                      <span className={`badge ${p.profit >= 0 ? 'ok' : 'warn'}`}>{t('profit')}: {fmt(p.profit)}</span></div>
                    <div className="entity-meta">
                      <span>{t('collected')}: {fmt(p.inc)}</span>
                      <span>{t('eventExpenses')}: {fmt(p.exp)}</span>
                    </div>
                    <div className="entity-actions">
                      <button onClick={() => setEventFilter(q.id)}>{t('details')}</button>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (() => {
            const p = eventProfit(eventFilter)
            const evExpenses = expenses.filter((e) => e.quote_id === eventFilter)
            const evIncomes = incomes.filter((i) => i.quote_id === eventFilter)
            const empName = (id) => employees.find((e) => e.id === id)?.name || '—'
            return (
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <h3 style={{ margin: 0 }}>{qName(eventFilter)}</h3>
                  <button className="mini-btn" onClick={() => exportEventCosts(qName(eventFilter), evExpenses, evIncomes, empName, p, t)}>⬇ {t('exportSelected')}</button>
                </div>
                <div className="kpi-row">
                  <div className="kpi"><span>{t('collected')}</span><b>{fmt(p.inc)}</b></div>
                  <div className="kpi"><span>{t('eventExpenses')}</span><b>{fmt(p.exp)}</b></div>
                  <div className="kpi"><span>{t('netEventCost')}</span><b style={{ color: p.profit >= 0 ? '#0F6E56' : '#A32D2D' }}>{fmt(p.profit)} EGP</b></div>
                </div>
                <p className="hint-inline">{t('eventCostsHint')}</p>

                {evExpenses.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <h4 style={{ fontSize: 13.5, margin: '0 0 8px' }}>{t('expenses')}</h4>
                    <div className="quote-scroll">
                      <table className="quote-table">
                        <thead><tr><th>{t('expenseName')}</th><th>{t('amount')}</th><th>{t('handedTo')}</th><th>{t('receiptDate')}</th><th>{t('notes')}</th></tr></thead>
                        <tbody>
                          {evExpenses.map((e) => (
                            <tr key={e.id}>
                              <td style={{ textAlign: 'start' }}>{e.name || '—'}</td>
                              <td className="cell-total">{fmt(e.amount)}</td>
                              <td>{e.handed_to ? empName(e.handed_to) : '—'}</td>
                              <td>{e.expense_date || '—'}</td>
                              <td style={{ textAlign: 'start' }}>{e.notes || ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {evIncomes.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <h4 style={{ fontSize: 13.5, margin: '0 0 8px' }}>{t('income')}</h4>
                    <div className="quote-scroll">
                      <table className="quote-table">
                        <thead><tr><th>{t('amount')}</th><th>{t('receiptDate')}</th><th>{t('notes')}</th></tr></thead>
                        <tbody>
                          {evIncomes.map((i) => (
                            <tr key={i.id}>
                              <td className="cell-total">{fmt(i.amount)}</td>
                              <td>{i.income_date || '—'}</td>
                              <td style={{ textAlign: 'start' }}>{i.notes || ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* ===== المصروفات ===== */}
      {tab === 'expenses' && (
        <div>
          <div className="toolbar">
            <select className="cat-filter" value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}>
              <option value="all">— {t('allEvents')} —</option>
              {quotes.map((q) => <option key={q.id} value={q.id}>{q.conference_name}</option>)}
            </select>
            <button className="add-btn" onClick={() => addExpense('event')}>+ {t('eventExpense')}</button>
            <button className="add-btn" onClick={() => addExpense('general')}>+ {t('generalExpense')}</button>
          </div>
          {visExpenses.length === 0 ? <EmptyState /> : (
            <div className="quote-scroll">
              <table className="quote-table costs-table">
                <thead><tr><th>{t('expenseName')}</th><th>{t('type')}</th><th>{t('event')}</th><th>{t('amount')}</th><th>{t('handedTo')}</th><th>{t('receiptDate')}</th><th>{t('notes')}</th><th></th></tr></thead>
                <tbody>
                  {visExpenses.map((r) => (
                    <tr key={r.id}>
                      <td><DebInput value={r.name || ''} placeholder={t('phExpenseName')} onCommit={(v) => patchE(r.id, 'name', v)} /></td>
                      <td>
                        <select value={r.expense_type} onChange={(e) => patchE(r.id, 'expense_type', e.target.value)}>
                          <option value="event">{t('eventExpense')}</option>
                          <option value="general">{t('generalExpense')}</option>
                        </select>
                      </td>
                      <td>
                        <select value={r.quote_id || ''} disabled={r.expense_type !== 'event'}
                          onChange={(e) => patchE(r.id, 'quote_id', e.target.value || null)}>
                          <option value="">—</option>
                          {quotes.map((q) => <option key={q.id} value={q.id}>{q.conference_name}</option>)}
                        </select>
                      </td>
                      <td><BlurInput className="num" type="number" min="0" value={r.amount ?? 0} onCommit={(v) => patchE(r.id, "amount", +v)} /></td>
                      <td>
                        <select value={r.handed_to || ''} onChange={(e) => {
                          if (e.target.value === '__new__') setRegEmp({ expenseId: r.id, name: '', phone: '', emp_type: 'permanent', quote_id: r.quote_id })
                          else patchE(r.id, 'handed_to', e.target.value || null)
                        }}>
                          <option value="">—</option>
                          {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                          <option value="__new__">＋ {t('registerNewEmp')}</option>
                        </select>
                      </td>
                      <td><input type="date" value={r.expense_date || ''} onChange={(e) => patchE(r.id, 'expense_date', e.target.value)} /></td>
                      <td><BlurInput value={r.notes || ""} onCommit={(v) => patchE(r.id, "notes", v)} /></td>
                      <td><button className="icon-btn" onClick={async () => { await deleteRow('expenses', r.id); load() }}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ===== التحصيل ===== */}
      {tab === 'income' && (
        <div>
          <div className="toolbar">
            <select className="cat-filter" value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}>
              <option value="all">— {t('allEvents')} —</option>
              {quotes.map((q) => <option key={q.id} value={q.id}>{q.conference_name}</option>)}
            </select>
            <button className="add-btn" onClick={addIncome}>+ {t('addCollection')}</button>
          </div>
          {visIncomes.length === 0 ? <EmptyState /> : (
            <div className="quote-scroll">
              <table className="quote-table costs-table">
                <thead><tr><th>{t('event')}</th><th>{t('clients')}</th><th>{t('amount')}</th><th>{t('receiptDate')}</th><th>{t('remainingAmt')}</th><th>{t('notes')}</th><th></th></tr></thead>
                <tbody>
                  {visIncomes.map((r) => {
                    const inv = quotes.find((q) => q.id === r.quote_id)
                    const collectedForEvent = incomes.filter((i) => i.quote_id === r.quote_id).reduce((s, x) => s + (+x.amount || 0), 0)
                    const rem = inv ? (+inv.grand_total || 0) - collectedForEvent : null
                    return (
                      <tr key={r.id}>
                        <td>
                          <select value={r.quote_id || ''} onChange={(e) => patchI(r.id, 'quote_id', e.target.value || null)}>
                            <option value="">—</option>
                            {quotes.map((q) => <option key={q.id} value={q.id}>{q.conference_name}</option>)}
                          </select>
                        </td>
                        <td>{inv ? (clients.find((c) => c.id === inv.client_id)?.company_name || '—') : '—'}</td>
                        <td><BlurInput className="num" type="number" min="0" value={r.amount ?? 0} onCommit={(v) => patchI(r.id, "amount", +v)} /></td>
                        <td><input type="date" value={r.income_date || ''} onChange={(e) => patchI(r.id, 'income_date', e.target.value)} /></td>
                        <td className="cell-total" style={{ color: rem > 0.01 ? '#A32D2D' : '#0F6E56' }}>{rem === null ? '—' : fmt(rem)}</td>
                        <td><BlurInput value={r.notes || ""} onCommit={(v) => patchI(r.id, "notes", v)} /></td>
                        <td><button className="icon-btn" onClick={async () => { await deleteRow('incomes', r.id); load() }}>✕</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {regEmp && (
        <Modal title={t('registerNewEmp')} onClose={() => setRegEmp(null)}>
          <div className="grid2">
            <div className="field"><label>{t('empName')} *</label>
              <input value={regEmp.name} onChange={(e) => setRegEmp((p) => ({ ...p, name: e.target.value }))} /></div>
            <div className="field"><label>{t('phone')}</label>
              <input dir="ltr" value={regEmp.phone} onChange={(e) => setRegEmp((p) => ({ ...p, phone: e.target.value }))} /></div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>{t('empType')}</label>
              <div className="seg">
                <button className={regEmp.emp_type === 'permanent' ? 'active' : ''}
                  onClick={() => setRegEmp((p) => ({ ...p, emp_type: 'permanent' }))}>{t('empPermanent')}</button>
                <button className={regEmp.emp_type === 'event' ? 'active' : ''}
                  onClick={() => setRegEmp((p) => ({ ...p, emp_type: 'event' }))}>{t('empEventOnly')}</button>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="save-btn" onClick={async () => {
              if (!regEmp.name.trim()) return
              const emp = await insertRow('employees', {
                name: regEmp.name.trim(), phone: regEmp.phone,
                phones: regEmp.phone ? [{ number: regEmp.phone, is_primary: true }] : [],
                emp_type: regEmp.emp_type,
                quote_id: regEmp.emp_type === 'event' ? regEmp.quote_id : null,
              })
              await updateRow('expenses', regEmp.expenseId, { handed_to: emp.id })
              setRegEmp(null); load()
            }}>{t('save')}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// تصدير كشف مصروفات/تحصيل إيفنت محدد إلى Excel
function exportEventCosts(confName, expenses, incomes, empName, profit, t) {
  const wb = XLSX.utils.book_new()
  const aoa = [[confName], []]
  aoa.push(['المصروفات'])
  aoa.push(['البند', 'المبلغ', 'تم التسليم إلى', 'التاريخ', 'ملاحظات'])
  for (const e of expenses) aoa.push([e.name || '', +e.amount || 0, e.handed_to ? empName(e.handed_to) : '', e.expense_date || '', e.notes || ''])
  aoa.push([])
  aoa.push(['التحصيل'])
  aoa.push(['المبلغ', 'التاريخ', 'ملاحظات'])
  for (const i of incomes) aoa.push([+i.amount || 0, i.income_date || '', i.notes || ''])
  aoa.push([])
  aoa.push(['إجمالي التحصيل', profit.inc])
  aoa.push(['إجمالي المصروفات', profit.exp])
  aoa.push(['الصافي', profit.profit])
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 24 }]
  XLSX.utils.book_append_sheet(wb, ws, (confName || 'event').substring(0, 30))
  XLSX.writeFile(wb, `مصروفات-${confName || 'event'}.xlsx`)
}
