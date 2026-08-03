import { useEffect, useMemo, useState } from 'react'
import { useLang } from '../../lib/i18n.jsx'
import { listRows, insertRow, updateRow, deleteRow, uploadDoc, openFile, downloadFile } from '../../lib/db.js'
import { fmt } from '../../lib/tafqeet.js'
import { Modal, EmptyState } from '../../components/ui.jsx'
import { printHtml } from '../exports/exportQuote.js'
import { loadSettings } from '../../lib/supabase.js'
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
  const [expenses, setExpenses] = useState([])
  const [incomes, setIncomes] = useState([])
  const [conferences, setConferences] = useState([])
  const [flowScope, setFlowScope] = useState('all')   // all | آخر مشروع
  const [showSupBreak, setShowSupBreak] = useState(true)
  const [showExpBreak, setShowExpBreak] = useState(false)
  const [detail, setDetail] = useState(null)    // {kind, row}
  const [payForm, setPayForm] = useState(null)
  const [clientPay, setClientPay] = useState(null)
  const [settings, setSettings] = useState(null)

  // كشف حساب دوري PDF للعميل
  const printClientStatement = (r) => {
    const rowsHtml = r.bills.map((q) => {
      const pays = parsePays(q)
      const paid = pays.reduce((a, x) => a + (+x.amount || 0), 0)
      const rest = (+q.grand_total || 0) - paid
      const payLines = pays.map((p) =>
        `<div style="font-size:11px;color:#666">— ${p.date || ''} : ${fmt(p.amount)} (${t(p.method || 'cash')})</div>`
      ).join('')
      return `<tr>
        <td>${q.date_from || '—'}</td>
        <td style="text-align:start">${q.conference_name || '—'}${payLines}</td>
        <td>${fmt(q.grand_total)}</td>
        <td>${fmt(paid)}</td>
        <td style="font-weight:700;color:${rest > 0.01 ? '#A32D2D' : '#0F6E56'}">${fmt(rest)}</td>
      </tr>`
    }).join('')

    const body = `
      <h2 style="margin:0 0 4px">${t('clientStatement')}</h2>
      <div style="margin-bottom:10px">
        <b>${r.name}</b>${r.phone ? ` — ${r.phone}` : ''}<br>
        <small>${t('date')}: ${new Date().toISOString().slice(0, 10)}</small>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12.5px" border="1" cellpadding="6">
        <thead style="background:#f5f5f5">
          <tr><th>${t('date')}</th><th>${t('conferences')}</th>
          <th>${t('grandTotal')}</th><th>${t('collected')}</th><th>${t('remainingAmt')}</th></tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot style="background:#f5f5f5;font-weight:700">
          <tr><td colspan="2">${t('total')}</td>
          <td>${fmt(r.due)}</td><td>${fmt(r.paid)}</td>
          <td style="color:${r.balance > 0.01 ? '#A32D2D' : '#0F6E56'}">${fmt(r.balance)}</td></tr>
        </tfoot>
      </table>`

    printHtml({ title: `${t('clientStatement')} — ${r.name}`, bodyHtml: body,
      settings, letterhead: !!settings?.letterhead_url, stamp: false, sign: false, preview: false })
  }

  const setCP = (patch) => setClientPay((p) => p && ({ ...p, data: { ...p.data, ...patch } }))

  // كل دفعات العميل محفوظة داخل quotes.payments — مصدر واحد للحقيقة
  const saveQuotePayments = async (q, pays) => {
    const clean = pays.map(({ __up, ...rest }) => rest).filter((x) => +x.amount)
    await updateRow('quotes', q.id, { payments: JSON.stringify(clean) })
    load()
  }

  const saveClientPayment = async () => {
    if (!+clientPay.data.amount) return
    const pays = parsePays(clientPay.quote)
    const next = clientPay.index >= 0
      ? pays.map((x, i) => i === clientPay.index ? clientPay.data : x)
      : [...pays, clientPay.data]
    await saveQuotePayments(clientPay.quote, next)
    setClientPay(null)
  }

  // تذكير تحصيل للعميل المتأخر
  const sendCollectionReminder = (r) => {
    const c = r.client || {}
    const num = String(c.whatsapp_number || c.phone || '').replace(/[^\d]/g, '')
    if (!num) return alert(t('noWhatsappNumber'))
    const intl = num.startsWith('0') ? '20' + num.slice(1) : num.startsWith('20') ? num : '20' + num
    const open = r.bills.filter((q) => {
      const p = parsePays(q).reduce((a, x) => a + (+x.amount || 0), 0)
      return (+q.grand_total || 0) - p > 0.01
    })
    const lines = [
      `${t('collectionReminder')} — ${c.company_name || r.name}`,
      '',
      ...open.map((q) => {
        const p = parsePays(q).reduce((a, x) => a + (+x.amount || 0), 0)
        return `• ${q.conference_name || '—'} (${q.date_from || '—'}): ${fmt((+q.grand_total || 0) - p)}`
      }),
      '',
      `${t('remainingAmt')}: ${fmt(r.balance)}`,
      r.age != null ? `${t('agingDays')}: ${r.age} ${t('dayWord')}` : '',
    ].filter(Boolean)
    window.open(`https://wa.me/${intl}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank')
  }

  const sendClientReceipt = (client, q, pay) => {
    const num = String(client?.whatsapp_number || client?.phone || '').replace(/[^\d]/g, '')
    if (!num) return alert(t('noWhatsappNumber'))
    const intl = num.startsWith('0') ? '20' + num.slice(1) : num.startsWith('20') ? num : '20' + num
    const method = pay.method || 'cash'
    const lines = [
      `${t('paymentReceipt')} — ${client.company_name || ''}`,
      `${t('conferences')}: ${q.conference_name || '—'}`,
      `${t('amount')}: ${fmt(pay.amount)}`,
      `${t('date')}: ${pay.date || '—'}`,
      `${t('paymentMethod')}: ${t(method) !== method ? t(method) : method}`,
    ]
    if (pay.cheque_no) lines.push(`${t('chequeNumber')}: ${pay.cheque_no}`)
    if (pay.handed_by) lines.push(`${t('handedBy')}: ${pay.handed_by}`)
    if (pay.from_name) lines.push(`${t('receivedFromName')}: ${pay.from_name}`)
    if (pay.receipt_url) lines.push('', `${t('receiptImage')}: ${pay.receipt_url}`)
    window.open(`https://wa.me/${intl}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank')
  }

  const load = () => {
    listRows('quotes').then(setQuotes).catch(() => setQuotes([]))
    listRows('suppliers').then(setSuppliers).catch(() => setSuppliers([]))
    listRows('clients').then(setClients).catch(() => setClients([]))
    listRows('supplier_invoices').then(setInvoices).catch(() => setInvoices([]))
    listRows('supplier_payments').then(setPayments).catch(() => setPayments([]))
    listRows('supplier_adjustments').then(setAdjustments).catch(() => setAdjustments([]))
    listRows('expenses').then(setExpenses).catch(() => setExpenses([]))
    listRows('incomes').then(setIncomes).catch(() => setIncomes([]))
    listRows('conferences').then(setConferences).catch(() => setConferences([]))
  }
  useEffect(load, [])
  useEffect(() => { loadSettings().then(setSettings) }, [])

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

  /* ---------- تبويب: كل حركات الدفع للموردين في مكان واحد ---------- */
  const paidOutList = useMemo(() => {
    const supName = (id) => suppliers.find((s) => s.id === id)?.supplier_name
      || suppliers.find((s) => s.id === id)?.company_name || '—'
    const direct = payments.map((p) => ({
      source: 'direct', id: p.id, date: p.pay_date, amount: +p.amount || 0,
      method: p.method, note: p.note, receipt_url: p.receipt_url,
      supplier_id: p.supplier_id, supplier_name: supName(p.supplier_id),
      conference: conferences.find((c) => c.id === p.conference_id)?.name || '',
    }))
    const fromInv = invoices.flatMap((inv) =>
      (inv.payments || []).filter((p) => +p.amount).map((p, i) => ({
        source: 'invoice', invId: inv.id, idx: i,
        date: p.date || p.pay_date, amount: +p.amount || 0, method: p.method, note: p.note,
        supplier_id: inv.supplier_id, supplier_name: supName(inv.supplier_id),
        conference: conferences.find((c) => c.id === inv.conference_id)?.name || inv.free_conference || '',
      })))
    return [...direct, ...fromInv].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  }, [payments, invoices, suppliers, conferences])

  /* ---------- تبويب: كل حركات التحصيل من العملاء في مكان واحد ---------- */
  const collectedList = useMemo(() => {
    const clName = (id) => clients.find((c) => c.id === id)?.company_name || '—'
    return quotes.filter((q) => q.doc_type === 'invoice').flatMap((q) =>
      parsePays(q).map((p, i) => ({
        quote: q, index: i, date: p.date, amount: +p.amount || 0, method: p.method,
        note: p.note, receipt_url: p.receipt_url, from_name: p.from_name,
        client_id: q.client_id, client_name: clName(q.client_id), conference: q.conference_name || '—',
      })))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  }, [quotes, clients])

  /* ---------- تجميع هرمي: مورد → مؤتمراته (لكارت "مدفوع للموردين") ---------- */
  const paidBySupplier = useMemo(() => {
    const m = new Map()
    for (const p of paidOutList) {
      if (!p.supplier_id) continue
      if (!m.has(p.supplier_id)) m.set(p.supplier_id, { id: p.supplier_id, name: p.supplier_name, total: 0, count: 0, byConf: new Map() })
      const s = m.get(p.supplier_id)
      s.total += p.amount; s.count++
      const confKey = p.conference || t('freeSupplier')
      if (!s.byConf.has(confKey)) s.byConf.set(confKey, { name: confKey, total: 0, count: 0, items: [] })
      const c = s.byConf.get(confKey)
      c.total += p.amount; c.count++; c.items.push(p)
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [paidOutList, t])

  /* ---------- تجميع هرمي: عميل → مؤتمراته (لكارت "محصّل من العملاء") ---------- */
  const collectedByClient = useMemo(() => {
    const m = new Map()
    for (const p of collectedList) {
      const key = p.client_id || p.client_name
      if (!m.has(key)) m.set(key, { id: p.client_id, name: p.client_name, total: 0, count: 0, byConf: new Map() })
      const s = m.get(key)
      s.total += p.amount; s.count++
      const confKey = p.conference || '—'
      if (!s.byConf.has(confKey)) s.byConf.set(confKey, { name: confKey, total: 0, count: 0, items: [] })
      const c = s.byConf.get(confKey)
      c.total += p.amount; c.count++; c.items.push(p)
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [collectedList])

  // مسار التنقل جوه الكارت: null = قائمة الموردين/العملاء، بعدين المؤتمرات، بعدين التفاصيل
  const [paidDrill, setPaidDrill] = useState({ entity: null, conf: null })
  const [collectedDrill, setCollectedDrill] = useState({ entity: null, conf: null })

  const openTab = (name) => {
    setTab(name); setPaidDrill({ entity: null, conf: null }); setCollectedDrill({ entity: null, conf: null })
  }

  const shown = rows.filter((r) => {
    if (filter === 'open') return r.balance > 0.01
    if (filter === 'overdue') return r.balance > 0.01 && (r.age ?? 0) > 30
    return r.due > 0.01 || r.paid > 0.01
  }).sort((a, b) => b.balance - a.balance)

  // شرائح أعمار الديون (Aging Buckets) — معيار محاسبي عالمي
  const BUCKETS = [
    { key: 'current', max: 0 }, { key: 'b30', max: 30 },
    { key: 'b60', max: 60 }, { key: 'b90', max: 90 }, { key: 'b90p', max: Infinity },
  ]
  const bucketOf = (age) => {
    if (age == null || age <= 0) return 'current'
    if (age <= 30) return 'b30'
    if (age <= 60) return 'b60'
    if (age <= 90) return 'b90'
    return 'b90p'
  }
  const aging = useMemo(() => {
    const z = { current: 0, b30: 0, b60: 0, b90: 0, b90p: 0 }
    for (const r of rows) if (r.balance > 0.01) z[bucketOf(r.age)] += r.balance
    return z
  }, [rows])

  // ===== التدفق النقدي الكامل =====
  // اللي حصل فعلاً (كاش خرج/دخل) + اللي لسه متوقّع
  const cashFlow = useMemo(() => {
    // الربط مزدوج: البرنامج يربط بـ quote_id والبوت يربط بـ conference_id
    const selQuote = quotes.find((q) => q.id === flowScope)
    const selConf = selQuote?.conference_id || null
    const scoped = (row) => {
      if (flowScope === 'all') return true
      if (!row) return false
      if (row.quote_id && row.quote_id === flowScope) return true
      if (selConf && row.conference_id && row.conference_id === selConf) return true
      return false
    }

    // ① محصّل فعلاً من العملاء (دفعات مسجلة على الفواتير)
    const collected = quotes.reduce((s, q) => {
      if (q.doc_type !== 'invoice' || (flowScope !== 'all' && q.id !== flowScope)) return s
      return s + parsePays(q).reduce((a, x) => a + (+x.amount || 0), 0)
    }, 0)

    // ② إيرادات إضافية مسجلة في الخزنة
    const otherIn = incomes.reduce((s, i) => s + (scoped(i) ? (+i.amount || 0) : 0), 0)

    // ③ مدفوع فعلاً للموردين (دفعات الفواتير + الدفعات المستقلة) — مفصّلة مورد مورد
    const supplierBreakdown = []
    const paidSuppliers = suppliers.reduce((s, sup) => {
      const fromInv = invoices.filter((x) => x.supplier_id === sup.id && scoped(x))
        .reduce((a, i) => a + invPaid(i), 0)
      const direct = payments.filter((x) => x.supplier_id === sup.id && scoped(x))
        .reduce((a, p) => a + (+p.amount || 0), 0)
      const amt = fromInv + direct
      if (amt > 0.01) {
        supplierBreakdown.push({
          id: sup.id,
          name: sup.supplier_name || sup.company_name || '—',
          amount: amt,
          count: invoices.filter((x) => x.supplier_id === sup.id && scoped(x)).length
            + payments.filter((x) => x.supplier_id === sup.id && scoped(x)).length,
        })
      }
      return s + amt
    }, 0)
    supplierBreakdown.sort((a, b) => b.amount - a.amount)

    // ④ مصاريف الخزنة (بنزين، فطار، فندق... إلخ) — سطر سطر
    const expenseRows = expenses.filter((e) => scoped(e) && (+e.amount || 0) > 0.01)
    const spent = expenseRows.reduce((s, e) => s + (+e.amount || 0), 0)

    // ⑤ اللي لسه لينا / علينا
    const stillIn = quotes.reduce((s, q) => {
      if (q.doc_type !== 'invoice' || (flowScope !== 'all' && q.id !== flowScope)) return s
      const p = parsePays(q).reduce((a, x) => a + (+x.amount || 0), 0)
      return s + Math.max((+q.grand_total || 0) - p, 0)
    }, 0)
    const stillOut = flowScope === 'all'
      ? payables.reduce((s, r) => s + Math.max(r.balance, 0), 0)
      : suppliers.reduce((s, sup) => {
          // ① تكلفة بنود المورد داخل العرض المختار نفسه
          const auto = selQuote ? autoPulls(sup.id, [selQuote]) : 0
          // ② فواتير يدوية مربوطة بالعرض أو بمؤتمره
          const inv = invoices.filter((x) => x.supplier_id === sup.id && scoped(x))
          const manual = inv.reduce((a, i) => a + withVat(i, sup), 0)
          const paid = inv.reduce((a, i) => a + invPaid(i), 0)
            + payments.filter((x) => x.supplier_id === sup.id && scoped(x))
                .reduce((a, p) => a + (+p.amount || 0), 0)
          return s + Math.max(auto + manual - paid, 0)
        }, 0)

    const atRisk = flowScope === 'all'
      ? receivables.reduce((s, r) => s + (r.balance > 0.01 && (r.age ?? 0) > 90 ? r.balance : 0), 0)
      : 0

    // ===== الضرائب =====
    // grand_total = subtotal − WHT(3%) + VAT(14%)
    // فالـ WHT مخصومة أصلاً من الفاتورة (العميل يورّدها للمصلحة نيابةً عنك).
    // أما الـ VAT فداخلة ضمن ما تحصّله وهي ليست إيرادك — تورّدها للمصلحة.
    const taxable = quotes.filter((q) =>
      q.doc_type === 'invoice' && q.is_taxable && (flowScope === 'all' || q.id === flowScope))
    const vatTotal = taxable.reduce((a, q) => a + (+q.vat_amount || 0), 0)
    const whtTotal = taxable.reduce((a, q) => a + (+q.wht_amount || 0), 0)
    const grandTaxable = taxable.reduce((a, q) => a + (+q.grand_total || 0), 0)

    // نسبة التحصيل تحدد كم من الـ VAT وصل فعلاً لخزنتك
    const collectedTaxable = taxable.reduce((a, q) =>
      a + parsePays(q).reduce((x, p) => x + (+p.amount || 0), 0), 0)
    const ratio = grandTaxable > 0.01 ? Math.min(collectedTaxable / grandTaxable, 1) : 0
    const vatCollected = vatTotal * ratio

    const actualIn = collected + otherIn
    const actualOut = paidSuppliers + spent
    const actualNet = actualIn - actualOut
    const projectedNet = (actualIn + stillIn) - (actualOut + stillOut)

    return {
      collected, otherIn, paidSuppliers, spent, stillIn, stillOut, atRisk,
      supplierBreakdown, expenseRows,
      actualIn, actualOut, vatTotal, whtTotal, vatCollected,
      actualNet,                                     // الكاش اللي اتحرك فعلاً
      actualNetAfterVat: actualNet - vatCollected,   // بعد استبعاد VAT محصّلة
      projectedNet,                                  // لو كله اتحصّل واتدفع
      projectedNetAfterVat: projectedNet - vatTotal, // صافي خزنة الشركة
      likelyNet: (actualIn + stillIn - atRisk) - (actualOut + stillOut) - vatTotal,
    }
  }, [quotes, incomes, expenses, suppliers, invoices, payments, payables, receivables, flowScope])

  const totalOpen = rows.reduce((s, r) => s + (r.balance > 0.01 ? r.balance : 0), 0)
  const totalOverdue = rows.reduce((s, r) => s + (r.balance > 0.01 && (r.age ?? 0) > 30 ? r.balance : 0), 0)
  const netPosition = receivables.reduce((s, r) => s + Math.max(r.balance, 0), 0)
    - payables.reduce((s, r) => s + Math.max(r.balance, 0), 0)

  const savePayment = async () => {
    if (!+payForm.amount) return
    const body = {
      amount: +payForm.amount, method: payForm.method || 'cash',
      pay_date: payForm.pay_date, note: payForm.note || '',
      receipt_url: payForm.receipt_url || '',
    }
    if (payForm.id) await updateRow('supplier_payments', payForm.id, body)
    else await insertRow('supplier_payments', { ...body, supplier_id: payForm.supplier_id, conference_id: null })
    setPayForm(null); setDetail(null); load()
  }

  return (
    <div>
      <h1 className="page-title">💼 {t('accounts')}</h1>

      {/* كروت التنقل — كل كارت هو ملخص وباب دخول للتفاصيل */}
      <div className="tab-cards">
        <button className={`tab-card ${tab === 'payable' ? 'active' : ''}`} onClick={() => openTab('payable')}>
          <span className="tab-card-top"><span className="tab-card-icon">📤</span> {t('weOwe')}</span>
          <span className="tab-card-sub">{t('weOweSub')}</span>
          <b className="tab-card-value" style={{ color: '#A32D2D' }}>
            {fmt(payables.reduce((s, r) => s + Math.max(r.balance, 0), 0))}</b>
        </button>
        <button className={`tab-card ${tab === 'receivable' ? 'active' : ''}`} onClick={() => openTab('receivable')}>
          <span className="tab-card-top"><span className="tab-card-icon">📥</span> {t('owedToUs')}</span>
          <span className="tab-card-sub">{t('owedToUsSub')}</span>
          <b className="tab-card-value" style={{ color: '#0F6E56' }}>
            {fmt(receivables.reduce((s, r) => s + Math.max(r.balance, 0), 0))}</b>
        </button>
        <button className={`tab-card ${tab === 'paidOut' ? 'active' : ''}`} onClick={() => openTab('paidOut')}>
          <span className="tab-card-top"><span className="tab-card-icon">💸</span> {t('paidToSuppliers')}</span>
          <span className="tab-card-sub">{t('cashOut')}</span>
          <b className="tab-card-value" style={{ color: '#A32D2D' }}>
            {fmt(paidOutList.reduce((s, p) => s + p.amount, 0))}</b>
        </button>
        <button className={`tab-card ${tab === 'collected' ? 'active' : ''}`} onClick={() => openTab('collected')}>
          <span className="tab-card-top"><span className="tab-card-icon">💰</span> {t('collectedFromClients')}</span>
          <span className="tab-card-sub">{t('cashIn')}</span>
          <b className="tab-card-value" style={{ color: '#0F6E56' }}>
            {fmt(collectedList.reduce((s, p) => s + p.amount, 0))}</b>
        </button>
        <button className={`tab-card ${tab === 'free' ? 'active' : ''}`} onClick={() => openTab('free')}>
          <span className="tab-card-top"><span className="tab-card-icon">🧾</span> {t('freeSupplier')}</span>
          <span className="tab-card-sub">&nbsp;</span>
        </button>
      </div>

      {/* ملخص صافي المركز */}
      <div className="kpi-row" style={{ marginBottom: 14 }}>
        <div className="kpi big">
          <span>📊 {t('netPosition')}</span>
          <b style={{ color: netPosition >= 0 ? '#0F6E56' : '#A32D2D' }}>{fmt(netPosition)}</b>
        </div>
      </div>

      {tab === 'free' && <FreeLedger />}

      {tab === 'paidOut' && (() => {
        const { entity, conf } = paidDrill
        // المستوى 1: قائمة الموردين
        if (!entity) return (
          <div className="cards-grid">
            {paidBySupplier.map((s) => (
              <button key={s.id} className="entity-card" style={{ textAlign: 'start', cursor: 'pointer', width: '100%' }}
                onClick={() => setPaidDrill({ entity: s, conf: null })}>
                <div className="entity-head"><b>🏢 {s.name}</b>
                  <span className="badge">{s.byConf.size} {t('conferences')}</span></div>
                <div className="entity-meta">
                  <span>{t('amount')}: <b style={{ color: '#A32D2D' }}>{fmt(s.total)}</b>
                    <span className="hint-inline"> — {s.count} {t('paidToSuppliers')}</span></span>
                </div>
              </button>
            ))}
            {!paidBySupplier.length && <EmptyState />}
          </div>
        )
        // المستوى 2: مؤتمرات المورد المختار
        if (entity && !conf) return (
          <div>
            <button className="mini-btn" style={{ marginBottom: 12 }}
              onClick={() => setPaidDrill({ entity: null, conf: null })}>→ {t('all')}</button>
            <h3 style={{ fontSize: 15, margin: '0 0 10px' }}>🏢 {entity.name}</h3>
            <div className="cards-grid">
              {[...entity.byConf.values()].sort((a, b) => b.total - a.total).map((c) => (
                <button key={c.name} className="entity-card" style={{ textAlign: 'start', cursor: 'pointer', width: '100%' }}
                  onClick={() => setPaidDrill({ entity, conf: c })}>
                  <div className="entity-head"><b>🎪 {c.name}</b>
                    <span className="badge">{c.count}</span></div>
                  <div className="entity-meta">
                    <span>{t('amount')}: <b style={{ color: '#A32D2D' }}>{fmt(c.total)}</b></span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )
        // المستوى 3: التفاصيل الكاملة لمورد داخل مؤتمر معين
        return (
          <div>
            <button className="mini-btn" style={{ marginBottom: 12 }}
              onClick={() => setPaidDrill({ entity, conf: null })}>→ {entity.name}</button>
            <h3 style={{ fontSize: 15, margin: '0 0 10px' }}>🏢 {entity.name} — 🎪 {conf.name}</h3>
            <div style={{ overflowX: 'auto' }}><table className="quote-table">
              <thead><tr>
                <th>{t('date')}</th><th>{t('amount')}</th><th>{t('method')}</th><th>{t('notes')}</th><th></th>
              </tr></thead>
              <tbody>
                {conf.items.map((p) => (
                  <tr key={p.source + '-' + (p.id || p.invId + '-' + p.idx)}>
                    <td>{p.date || '—'}</td>
                    <td><b style={{ color: '#A32D2D' }}>{fmt(p.amount)}</b></td>
                    <td>{t(p.method || 'cash') !== (p.method || 'cash') ? t(p.method || 'cash') : p.method}</td>
                    <td className="wrap">{p.note || '—'}</td>
                    <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {p.receipt_url && (
                        <>
                          <button className="mini-btn" onClick={() => openFile(p.receipt_url)}>👁 {t('view')}</button>
                          <button className="mini-btn" onClick={() => downloadFile(p.receipt_url)}>💾 {t('download')}</button>
                        </>
                      )}
                      {p.source === 'direct' ? (
                        <>
                          <button className="mini-btn" onClick={() => setPayForm({
                            id: p.id, supplier_id: p.supplier_id, name: p.supplier_name,
                            amount: p.amount, pay_date: p.date, method: p.method || 'cash',
                            note: p.note || '', receipt_url: p.receipt_url || '',
                          })}>✏️ {t('edit')}</button>
                          <button className="mini-btn danger" onClick={async () => {
                            if (!confirm(t('confirmDelete'))) return
                            await deleteRow('supplier_payments', p.id); load()
                          }}>✕</button>
                        </>
                      ) : (
                        <button className="mini-btn" onClick={() => {
                          const sup = suppliers.find((s) => s.id === p.supplier_id)
                          if (sup) setDetail({ kind: 'payable', row: { supplier: sup } })
                        }}>{t('details')}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )
      })()}

      {tab === 'collected' && (() => {
        const { entity, conf } = collectedDrill
        // المستوى 1: قائمة العملاء
        if (!entity) return (
          <div className="cards-grid">
            {collectedByClient.map((s) => (
              <button key={s.id || s.name} className="entity-card" style={{ textAlign: 'start', cursor: 'pointer', width: '100%' }}
                onClick={() => setCollectedDrill({ entity: s, conf: null })}>
                <div className="entity-head"><b>👤 {s.name}</b>
                  <span className="badge">{s.byConf.size} {t('conferences')}</span></div>
                <div className="entity-meta">
                  <span>{t('amount')}: <b style={{ color: '#0F6E56' }}>{fmt(s.total)}</b>
                    <span className="hint-inline"> — {s.count} {t('collectedFromClients')}</span></span>
                </div>
              </button>
            ))}
            {!collectedByClient.length && <EmptyState />}
          </div>
        )
        // المستوى 2: مؤتمرات العميل المختار
        if (entity && !conf) return (
          <div>
            <button className="mini-btn" style={{ marginBottom: 12 }}
              onClick={() => setCollectedDrill({ entity: null, conf: null })}>→ {t('all')}</button>
            <h3 style={{ fontSize: 15, margin: '0 0 10px' }}>👤 {entity.name}</h3>
            <div className="cards-grid">
              {[...entity.byConf.values()].sort((a, b) => b.total - a.total).map((c) => (
                <button key={c.name} className="entity-card" style={{ textAlign: 'start', cursor: 'pointer', width: '100%' }}
                  onClick={() => setCollectedDrill({ entity, conf: c })}>
                  <div className="entity-head"><b>🎪 {c.name}</b>
                    <span className="badge">{c.count}</span></div>
                  <div className="entity-meta">
                    <span>{t('amount')}: <b style={{ color: '#0F6E56' }}>{fmt(c.total)}</b></span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )
        // المستوى 3: التفاصيل الكاملة لعميل داخل مؤتمر معين
        return (
          <div>
            <button className="mini-btn" style={{ marginBottom: 12 }}
              onClick={() => setCollectedDrill({ entity, conf: null })}>→ {entity.name}</button>
            <h3 style={{ fontSize: 15, margin: '0 0 10px' }}>👤 {entity.name} — 🎪 {conf.name}</h3>
            <div style={{ overflowX: 'auto' }}><table className="quote-table">
              <thead><tr>
                <th>{t('date')}</th><th>{t('amount')}</th><th>{t('method')}</th><th>{t('notes')}</th><th></th>
              </tr></thead>
              <tbody>
                {conf.items.map((p) => (
                  <tr key={p.quote.id + '-' + p.index}>
                    <td>{p.date || '—'}</td>
                    <td><b style={{ color: '#0F6E56' }}>{fmt(p.amount)}</b></td>
                    <td>{t(p.method || 'cash') !== (p.method || 'cash') ? t(p.method || 'cash') : p.method}</td>
                    <td className="wrap">{p.note || '—'}</td>
                    <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {p.receipt_url && (
                        <>
                          <button className="mini-btn" onClick={() => openFile(p.receipt_url)}>👁 {t('view')}</button>
                          <button className="mini-btn" onClick={() => downloadFile(p.receipt_url)}>💾 {t('download')}</button>
                        </>
                      )}
                      <button className="mini-btn" onClick={() => setClientPay({
                        quote: p.quote, index: p.index,
                        data: { amount: p.amount, date: p.date, method: p.method || 'cash',
                          note: p.note || '', from_name: p.from_name || '', receipt_url: p.receipt_url || '' },
                      })}>✏️ {t('edit')}</button>
                      <button className="mini-btn danger" onClick={async () => {
                        if (!confirm(t('confirmDelete'))) return
                        const pays = parsePays(p.quote)
                        await saveQuotePayments(p.quote, pays.filter((_, j) => j !== p.index))
                      }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )
      })()}

      {tab !== 'free' && tab !== 'paidOut' && tab !== 'collected' && <>
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

      {/* جدولة أعمار الديون */}
      {totalOpen > 0.01 && (
        <div className="card" style={{ padding: 12, marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>📅 {t('agingReport')}</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="quote-table" style={{ width: '100%' }}>
              <thead><tr>
                <th>{t('bucketCurrent')}</th><th>1–30</th><th>31–60</th>
                <th>61–90</th><th>+90</th><th>{t('total')}</th>
              </tr></thead>
              <tbody><tr>
                <td>{fmt(aging.current)}</td>
                <td style={{ color: aging.b30 > 0 ? '#B05E0B' : 'inherit' }}>{fmt(aging.b30)}</td>
                <td style={{ color: aging.b60 > 0 ? '#B05E0B' : 'inherit' }}>{fmt(aging.b60)}</td>
                <td style={{ color: aging.b90 > 0 ? '#A32D2D' : 'inherit' }}>{fmt(aging.b90)}</td>
                <td style={{ color: aging.b90p > 0 ? '#A32D2D' : 'inherit', fontWeight: 700 }}>{fmt(aging.b90p)}</td>
                <td><b>{fmt(totalOpen)}</b></td>
              </tr></tbody>
            </table>
          </div>
          {aging.b90p > 0.01 && (
            <p className="hint-inline" style={{ color: '#A32D2D' }}>
              ⚠ {t('agingWarn').replace('{amt}', fmt(aging.b90p))}
            </p>
          )}
        </div>
      )}

      {/* التدفق النقدي */}
      {tab !== 'free' && (
        <div className="card" style={{ padding: 12, marginBottom: 12 }}>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <h3 style={{ fontSize: 14, margin: 0, flex: 1 }}>💧 {t('cashFlow')}</h3>
            <select value={flowScope} onChange={(e) => setFlowScope(e.target.value)}>
              <option value="all">🌐 {t('allProjects')}</option>
              {quotes.filter((q) => q.doc_type === 'invoice')
                .sort((a, b) => String(b.date_from || '').localeCompare(String(a.date_from || '')))
                .slice(0, 40)
                .map((q) => <option key={q.id} value={q.id}>
                  {q.conference_name || '—'}{q.date_from ? ` — ${q.date_from}` : ''}</option>)}
            </select>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="quote-table" style={{ width: '100%' }}>
              <tbody>
                <tr style={{ background: '#E1F5EE' }}>
                  <td style={{ textAlign: 'start' }}><b>📥 {t('cashIn')}</b></td><td></td>
                </tr>
                <tr><td style={{ textAlign: 'start' }}>{t('collectedFromClients')}</td>
                  <td>{fmt(cashFlow.collected)}</td></tr>
                {cashFlow.otherIn > 0.01 && (
                  <tr><td style={{ textAlign: 'start' }}>{t('otherIncome')}</td>
                    <td>{fmt(cashFlow.otherIn)}</td></tr>
                )}
                <tr style={{ fontWeight: 700 }}>
                  <td style={{ textAlign: 'start' }}>{t('totalIn')}</td>
                  <td style={{ color: '#0F6E56' }}>{fmt(cashFlow.actualIn)}</td></tr>

                <tr style={{ background: '#FDECEC' }}>
                  <td style={{ textAlign: 'start' }}><b>📤 {t('cashOut')}</b></td><td></td>
                </tr>
                <tr style={{ cursor: cashFlow.supplierBreakdown.length ? 'pointer' : 'default' }}
                  onClick={() => cashFlow.supplierBreakdown.length && setShowSupBreak((v) => !v)}>
                  <td style={{ textAlign: 'start' }}>
                    {cashFlow.supplierBreakdown.length > 0 && (showSupBreak ? '▾ ' : '▸ ')}
                    {t('paidToSuppliers')}
                    {cashFlow.supplierBreakdown.length > 0 &&
                      <small className="hint-inline"> ({cashFlow.supplierBreakdown.length})</small>}
                  </td>
                  <td>{fmt(cashFlow.paidSuppliers)}</td></tr>
                {showSupBreak && cashFlow.supplierBreakdown.map((b) => (
                  <tr key={b.id} style={{ background: '#FAFAFA' }}>
                    <td style={{ textAlign: 'start', paddingInlineStart: 24, fontSize: 12.5, color: '#555' }}>
                      ↳ {b.name} <span className="hint-inline">({b.count})</span></td>
                    <td style={{ fontSize: 12.5, color: '#555' }}>{fmt(b.amount)}</td>
                  </tr>
                ))}

                <tr style={{ cursor: cashFlow.expenseRows.length ? 'pointer' : 'default' }}
                  onClick={() => cashFlow.expenseRows.length && setShowExpBreak((v) => !v)}>
                  <td style={{ textAlign: 'start' }}>
                    {cashFlow.expenseRows.length > 0 && (showExpBreak ? '▾ ' : '▸ ')}
                    {t('eventExpenses')}
                    {cashFlow.expenseRows.length > 0 &&
                      <small className="hint-inline"> ({cashFlow.expenseRows.length})</small>}
                  </td>
                  <td>{fmt(cashFlow.spent)}</td></tr>
                {showExpBreak && cashFlow.expenseRows.map((e) => (
                  <tr key={e.id} style={{ background: '#FAFAFA' }}>
                    <td style={{ textAlign: 'start', paddingInlineStart: 24, fontSize: 12.5, color: '#555' }}>
                      ↳ {e.name || '—'} {e.expense_date ? <span className="hint-inline">— {e.expense_date}</span> : ''}</td>
                    <td style={{ fontSize: 12.5, color: '#555' }}>{fmt(e.amount)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700 }}>
                  <td style={{ textAlign: 'start' }}>{t('totalOut')}</td>
                  <td style={{ color: '#A32D2D' }}>{fmt(cashFlow.actualOut)}</td></tr>

                <tr style={{ background: '#F5F5F5', fontWeight: 700, fontSize: 14 }}>
                  <td style={{ textAlign: 'start' }}>💰 {t('actualNet')}</td>
                  <td style={{ color: cashFlow.actualNet >= 0 ? '#0F6E56' : '#A32D2D' }}>
                    {fmt(cashFlow.actualNet)}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="entity-meta" style={{ marginTop: 10 }}>
            <span>⏳ {t('stillToCollect')}: <b style={{ color: '#0F6E56' }}>{fmt(cashFlow.stillIn)}</b></span>
            <span>⏳ {t('stillToPay')}: <b style={{ color: '#A32D2D' }}>{fmt(cashFlow.stillOut)}</b></span>
          </div>

          {/* من الصافي المتوقّع إلى صافي خزنة الشركة */}
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table className="quote-table" style={{ width: '100%' }}>
              <tbody>
                <tr><td style={{ textAlign: 'start' }}>📊 {t('projectedNet')}</td>
                  <td><b>{fmt(cashFlow.projectedNet)}</b></td></tr>
                {cashFlow.vatTotal > 0.01 && (
                  <tr><td style={{ textAlign: 'start' }}>− {t('vatDue')} (14%)</td>
                    <td style={{ color: '#A32D2D' }}>− {fmt(cashFlow.vatTotal)}</td></tr>
                )}
                <tr style={{ background: '#E1F5EE', fontWeight: 700, fontSize: 14 }}>
                  <td style={{ textAlign: 'start' }}>🏦 {t('netToCompany')}</td>
                  <td style={{ color: cashFlow.projectedNetAfterVat >= 0 ? '#0F6E56' : '#A32D2D' }}>
                    {fmt(cashFlow.projectedNetAfterVat)}</td></tr>
              </tbody>
            </table>
          </div>

          {cashFlow.whtTotal > 0.01 && (
            <p className="hint-inline">ℹ️ {t('whtNote').replace('{amt}', fmt(cashFlow.whtTotal))}</p>
          )}
          {cashFlow.atRisk > 0.01 && (
            <p className="hint-inline">⚠ {t('likelyNet')}: <b>{fmt(cashFlow.likelyNet)}</b> — {t('likelyHint')}</p>
          )}
          <p className="hint-inline">{t('cashFlowHint')}</p>
          <p className="hint-inline">{t('vatNote')}</p>
        </div>
      )}

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
                    {r.phone && <div className="hint-inline">☎ {r.phone}</div>}
                    {tab === 'receivable' && +r.client?.credit_limit > 0 && (
                      <div className="hint-inline"
                        style={{ color: r.balance > +r.client.credit_limit ? '#A32D2D' : 'inherit', fontWeight: r.balance > +r.client.credit_limit ? 700 : 400 }}>
                        {r.balance > +r.client.credit_limit ? '⛔ ' : '💳 '}
                        {t('creditLimit')}: {fmt(r.client.credit_limit)}
                        {r.balance > +r.client.credit_limit && ` — ${t('limitExceeded')}`}
                      </div>
                    )}</td>
                  <td>{fmt(r.due)}</td>
                  <td>{fmt(r.paid)}</td>
                  <td><b style={{ color: closed ? '#0F6E56' : '#A32D2D' }}>
                    {closed ? t('settled') : fmt(r.balance)}</b></td>
                  <td>
                    {r.age != null ? `${r.age} ${t('dayWord')}` : '—'}
                    {!closed && r.age != null && r.age > 0 && (
                      <div className="hint-inline" style={{ fontSize: 11 }}>
                        {t('bucket_' + bucketOf(r.age))}
                      </div>
                    )}
                  </td>
                  <td>
                    <button className="mini-btn" onClick={() => setDetail({ kind: tab, row: r })}>{t('details')}</button>
                    {tab === 'payable' && (
                      <button className="mini-btn" style={{ marginInlineStart: 4 }}
                        onClick={() => setDetail({ kind: 'payable', row: r, freeInv: true })}>
                        🧾 {t('freeInvoice')}</button>
                    )}
                    {tab === 'payable' && !closed && (
                      <button className="mini-btn ok" style={{ marginInlineStart: 4 }}
                        onClick={() => setDetail({ kind: 'payable', row: r, openPay: true })}>
                        💵 {t('pay')}</button>
                    )}
                    {tab === 'receivable' && (
                      <button className="mini-btn" style={{ marginInlineStart: 4 }}
                        onClick={() => printClientStatement(r)}>🖨 {t('statement')}</button>
                    )}
                    {tab === 'receivable' && late && (
                      <button className="mini-btn" style={{ marginInlineStart: 4 }}
                        onClick={() => sendCollectionReminder(r)}>🔔 {t('remind')}</button>
                    )}
                    {tab === 'receivable' && r.bills.length > 0 && (
                      <button className="mini-btn ok" style={{ marginInlineStart: 4 }}
                        onClick={() => {
                          // افتح على أقدم فاتورة لسه عليها باقي، وإلا آخر فاتورة
                          const open = r.bills.find((q) => {
                            const p = parsePays(q).reduce((a, x) => a + (+x.amount || 0), 0)
                            return (+q.grand_total || 0) - p > 0.01
                          }) || r.bills[r.bills.length - 1]
                          const p = parsePays(open).reduce((a, x) => a + (+x.amount || 0), 0)
                          const rest = (+open.grand_total || 0) - p
                          setDetail({ kind: 'receivable', row: r })
                          setClientPay({ quote: open, index: -1, data: {
                            amount: rest > 0 ? rest : '', date: new Date().toISOString().slice(0, 10),
                            method: 'cash', from_type: 'company', note: '' } })
                        }}>💵 {t('addPayment')}</button>
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
        <SupplierLedger
          supplier={{ ...detail.row.supplier,
            __openFreeInv: !!detail.freeInv, __openPay: !!detail.openPay }}
          onClose={() => { setDetail(null); load() }} />
      )}

      {detail && detail.kind === 'receivable' && (
        <Modal title={`📥 ${detail.row.name}`} onClose={() => { setDetail(null); load() }} wide>
          <div className="entity-meta" style={{ marginBottom: 12 }}>
            <span>{t('grandTotal')}: <b>{fmt(detail.row.due)}</b></span>
            <span>{t('collected')}: <b>{fmt(detail.row.paid)}</b></span>
            <span>{t('remainingAmt')}: <b style={{ color: detail.row.balance > 0.01 ? '#A32D2D' : '#0F6E56' }}>
              {fmt(detail.row.balance)}</b></span>
          </div>

          {detail.row.bills.map((q) => {
            const pays = parsePays(q)
            const p = pays.reduce((a, x) => a + (+x.amount || 0), 0)
            const rest = (+q.grand_total || 0) - p
            return (
              <div className="card" key={q.id} style={{ padding: 12, marginBottom: 10 }}>
                <div className="entity-head">
                  <b>🧾 {q.conference_name || '—'} <small className="hint-inline">{q.date_from || ''}</small></b>
                  <span>
                    <b>{fmt(q.grand_total)}</b> — {t('collected')}: {fmt(p)} —{' '}
                    <b style={{ color: rest > 0.01 ? '#A32D2D' : '#0F6E56' }}>
                      {rest > 0.01 ? `${t('remainingAmt')}: ${fmt(rest)}` : t('settled')}</b>
                  </span>
                </div>

                {pays.map((pay, i) => (
                  <div className="manage-row" key={i}>
                    <span>
                      {pay.date || '—'} — <b style={{ color: '#0F6E56' }}>{fmt(pay.amount)}</b>
                      {' — '}{t(pay.method || 'cash') !== (pay.method || 'cash') ? t(pay.method || 'cash') : pay.method}
                      {pay.cheque_no ? ` — ${t('chequeNumber')}: ${pay.cheque_no}` : ''}
                      {pay.handed_by ? ` — ${t('handedBy')}: ${pay.handed_by}` : ''}
                      {pay.from_type ? ` — ${t('receivedFromType')}: ${t('from' + pay.from_type.charAt(0).toUpperCase() + pay.from_type.slice(1))}` : ''}
                      {pay.from_name ? ` (${pay.from_name})` : ''}
                      {pay.note ? ` — ${pay.note}` : ''}
                    </span>
                    <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {pay.receipt_url && (
                        <>
                          <button className="mini-btn" onClick={() => openFile(pay.receipt_url)}>👁 {t('view')}</button>
                          <button className="mini-btn" onClick={() => downloadFile(pay.receipt_url)}>
                            💾 {t('download')}</button>
                        </>
                      )}
                      {(detail.row.client?.whatsapp_number || detail.row.client?.phone) && (
                        <button className="mini-btn ok" onClick={() => sendClientReceipt(detail.row.client, q, pay)}>
                          📲 {t('sendWhatsapp')}</button>
                      )}
                      <button className="mini-btn" onClick={() => setClientPay({ quote: q, index: i, data: { ...pay } })}>
                        ✏️ {t('edit')}</button>
                      <button className="mini-btn danger" onClick={async () => {
                        if (!confirm(t('confirmDelete'))) return
                        await saveQuotePayments(q, pays.filter((_, j) => j !== i))
                      }}>✕</button>
                    </span>
                  </div>
                ))}
                {!pays.length && <p className="hint-inline">{t('noPaymentsYet')}</p>}

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button className="mini-btn ok" onClick={() => setClientPay({
                    quote: q, index: -1,
                    data: { amount: rest > 0 ? rest : '', date: new Date().toISOString().slice(0, 10),
                      method: 'cash', from_type: 'company', note: '' },
                  })}>💵 {t('addPayment')}</button>
                </div>
              </div>
            )
          })}
          {!detail.row.bills.length && <p className="hint-inline">{t('noInvoicesYet')}</p>}
        </Modal>
      )}

      {/* نافذة دفعة العميل */}
      {clientPay && (
        <Modal title={clientPay.index >= 0 ? t('editPayment') : t('addPayment')}
          onClose={() => setClientPay(null)}>
          <div className="grid2">
            <div className="field"><label>{t('amount')}</label>
              <input type="number" dir="ltr" autoFocus value={clientPay.data.amount}
                onChange={(e) => setCP({ amount: e.target.value })} /></div>
            <div className="field"><label>{t('date')}</label>
              <input type="date" value={clientPay.data.date || ''}
                onChange={(e) => setCP({ date: e.target.value })} /></div>
            <div className="field"><label>{t('paymentMethod')}</label>
              <select value={clientPay.data.method || 'cash'} onChange={(e) => setCP({ method: e.target.value })}>
                <option value="cash">{t('cashWord')}</option>
                <option value="cheque">{t('chequeWord')}</option>
                <option value="bank">{t('bank')}</option>
                <option value="instapay">{t('instapay')}</option>
                <option value="vodafone">{t('vodafone')}</option>
              </select></div>
            <div className="field"><label>{t('receivedFromType')}</label>
              <select value={clientPay.data.from_type || 'company'} onChange={(e) => setCP({ from_type: e.target.value })}>
                <option value="company">{t('fromCompany')}</option>
                <option value="association">{t('fromAssociation')}</option>
                <option value="person">{t('fromPerson')}</option>
              </select></div>
            {(clientPay.data.method || 'cash') === 'cheque' && (
              <div className="field"><label>{t('chequeNumber')}</label>
                <input dir="ltr" value={clientPay.data.cheque_no || ''}
                  onChange={(e) => setCP({ cheque_no: e.target.value })} /></div>
            )}
            {(clientPay.data.method || 'cash') === 'cash' && (
              <div className="field"><label>{t('handedBy')}</label>
                <input value={clientPay.data.handed_by || ''}
                  onChange={(e) => setCP({ handed_by: e.target.value })} /></div>
            )}
            <div className="field"><label>{t('receivedFromName')}</label>
              <input value={clientPay.data.from_name || ''}
                onChange={(e) => setCP({ from_name: e.target.value })} /></div>
            <div className="field"><label>{t('notes')}</label>
              <input value={clientPay.data.note || ''} onChange={(e) => setCP({ note: e.target.value })} /></div>
            <div className="field" style={{ gridColumn: '1 / -1' }}><label>{t('receiptImage')}</label>
              <input type="file" accept="image/*,application/pdf" onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return
                try { setCP({ __up: true }); setCP({ receipt_url: await uploadDoc('receipt-docs', f), __up: false }) }
                catch (err) { setCP({ __up: false }); alert(t('uploadFailed') + ' ' + (err?.message || '')) }
              }} />
              {clientPay.data.__up && <span className="hint-inline">⏳ {t('uploading')}</span>}
              {clientPay.data.receipt_url && !clientPay.data.__up && (
                <span className="hint-inline">✅ {t('receiptAttached')}
                  <button type="button" className="mini-btn" style={{ marginInlineStart: 6 }}
                    onClick={() => openFile(clientPay.data.receipt_url)}>👁 {t('view')}</button>
                  <button type="button" className="mini-btn" style={{ marginInlineStart: 4 }}
                    onClick={() => setCP({ receipt_url: '' })}>✕</button>
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="save-btn" onClick={saveClientPayment}>{t('save')}</button>
          </div>
        </Modal>
      )}

      {/* تسجيل/تعديل دفعة لمورد */}
      {payForm && (
        <Modal title={`💵 ${payForm.id ? t('editPayment') : t('addPayment')} — ${payForm.name}`} onClose={() => setPayForm(null)}>
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
          <div className="field"><label>{t('receiptImage')}</label>
            <input type="file" accept="image/*,application/pdf" onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return
              try {
                setPayForm((p) => ({ ...p, __up: true }))
                const url = await uploadDoc('receipt-docs', f)
                setPayForm((p) => ({ ...p, receipt_url: url, __up: false }))
              } catch (err) { setPayForm((p) => ({ ...p, __up: false })); alert(t('uploadFailed') + ' ' + (err?.message || '')) }
            }} />
            {payForm.__up && <span className="hint-inline">⏳ {t('uploading')}</span>}
            {payForm.receipt_url && !payForm.__up && (
              <span className="hint-inline">✅ {t('receiptAttached')}
                <button type="button" className="mini-btn" style={{ marginInlineStart: 6 }}
                  onClick={() => openFile(payForm.receipt_url)}>👁 {t('view')}</button>
                <button type="button" className="mini-btn" style={{ marginInlineStart: 4 }}
                  onClick={() => setPayForm((p) => ({ ...p, receipt_url: '' }))}>✕</button>
              </span>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="save-btn" onClick={savePayment}>{t('save')}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
