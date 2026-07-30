// معادلة الضرائب المصرية:
// فاتورة بتاريخ في شهر M → الإقرار والسداد من أول يوم لآخر يوم في شهر M+1
export function taxDeadline(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  // آخر يوم في الشهر التالي
  return new Date(d.getFullYear(), d.getMonth() + 2, 0)
}

export const fmtDate = (d) => d ? new Date(d).toISOString().slice(0, 10) : ''
export const daysUntil = (d) => Math.ceil((new Date(d) - new Date()) / 864e5)

// حالة التذكيرات لكل الفواتير
export function buildReminders(quotes, manualTaxes = []) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const out = []
  for (const q of quotes) {
    const invDate = q.date_to || q.date_from
    const snoozed = q.snooze_until && new Date(q.snooze_until) > today

    // 1) تذكير الفاتورة الإلكترونية: من تاريخ المؤتمر لحد ما يقول تم
    if (q.doc_type === 'invoice' && invDate && new Date(invDate) <= today && !q.einvoice_done) {
      out.push({ kind: 'einvoice', level: 'big', quote: q,
        msg: `ارفع الفاتورة الإلكترونية — ${q.conference_name}` })
    }

    // 2) تذكير الإقرار والسداد للفواتير المنتهية
    if (q.doc_type === 'invoice' && q.finished && q.is_taxable && invDate) {
      const dl = taxDeadline(invDate)
      const left = daysUntil(dl)
      if (left <= 45) {
        const level = left <= 1 ? 'big' : (snoozed ? 'none' : 'flash')
        const tail = `(آخر موعد ${fmtDate(dl)}${left >= 0 ? ` — باقي ${left} يوم` : ' — متأخر!'})`
        if (level !== 'none' && !q.tax_filed) out.push({
          kind: 'tax', level, quote: q, deadline: fmtDate(dl), left,
          msg: `تذكير بموعد رفع إقرار القيمة المضافة — ${q.conference_name} ${tail}`,
        })
        if (level !== 'none' && !q.tax_paid) out.push({
          kind: 'tax', level, quote: q, deadline: fmtDate(dl), left,
          msg: `تذكير بموعد سداد الضريبة — ${q.conference_name} ${tail}`,
        })
      }
    }
  }
  // الضرائب المسجلة يدوياً
  for (const m of manualTaxes) {
    if (!m.invoice_date || (m.tax_filed && m.tax_paid)) continue
    const dl = taxDeadline(m.invoice_date)
    const left = daysUntil(dl)
    const snoozed = m.snooze_until && new Date(m.snooze_until) > today
    if (left <= 45) {
      const level = left <= 1 ? 'big' : (snoozed ? 'none' : 'flash')
      const name = m.conference_name || m.client_name || 'ضريبة مسجلة يدوياً'
      const tail = `(آخر موعد ${fmtDate(dl)}${left >= 0 ? ` — باقي ${left} يوم` : ' — متأخر!'})`
      if (level !== 'none' && !m.tax_filed) out.push({ kind: 'tax', level, quote: m, table: 'manual_taxes', msg: `تذكير بموعد رفع إقرار القيمة المضافة — ${name} ${tail}` })
      if (level !== 'none' && !m.tax_paid) out.push({ kind: 'tax', level, quote: m, table: 'manual_taxes', msg: `تذكير بموعد سداد الضريبة — ${name} ${tail}` })
    }
  }
  return out
}
