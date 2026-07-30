import * as XLSX from 'xlsx'
import { fmt } from '../../lib/tafqeet.js'

// ===== طباعة PDF عبر نافذة طباعة المتصفح (تدعم العربي RTL بالكامل) =====
export function printHtml({ title, bodyHtml, settings, letterhead, stamp, sign, preview, rtl = true }) {
  const bg = letterhead && settings?.letterhead_url
    ? `background-image:url('${settings.letterhead_url}');background-size:210mm 297mm;background-repeat:no-repeat;`
    : ''
  const logo = !letterhead && settings?.logo_url
    ? `<img src="${settings.logo_url}" style="height:60px;position:absolute;top:10mm;inset-inline-end:12mm">` : ''
  const stampImg = stamp && settings?.stamp_url
    ? `<img src="${settings.stamp_url}" style="height:80px;opacity:.9">` : ''
  const signImg = sign && settings?.signature_url
    ? `<img src="${settings.signature_url}" style="height:50px">` : ''

  const w = window.open('', '_blank')
  if (!w) { alert('المتصفح منع فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة (Popups) لهذا الموقع ثم أعد المحاولة'); return }
  w.document.write(`<!doctype html><html lang="${rtl ? 'ar' : 'en'}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<title>${title}</title>
<style>
  @page { size: A4; margin: 0; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
  body { margin:0; font-family:'IBM Plex Sans Arabic','Segoe UI',sans-serif; }
  .page { width:210mm; min-height:297mm; padding:38mm 14mm 40mm; box-sizing:border-box; position:relative; ${bg} background-color: #fff; }
  table { width:100%; border-collapse:collapse; font-size:11px; }
  th,td { border:1px solid #999; padding:5px 7px; text-align:center; }
  th { background:#F5E3D7; }
  h1 { font-size:18px; text-align:center; margin:0 0 6mm; }
  .head-grid { display:grid; grid-template-columns:1fr 1fr; gap:4px 20px; font-size:12.5px; margin-bottom:6mm; }
  .totals { margin-top:6mm; margin-inline-start:auto; width:70mm; font-size:12.5px; }
  .totals div { display:flex; justify-content:space-between; padding:3px 8px; border-bottom:1px solid #ddd; }
  .totals .grand { font-weight:700; background:#F5E3D7; }
  .sig-row { display:flex; justify-content:space-between; align-items:flex-end; margin-top:12mm; }
  .footer { position:absolute; bottom:32mm; inset-inline:14mm; font-size:10.5px; color:#555; }
  .pageno { position:absolute; bottom:28mm; inset-inline-end:14mm; font-size:10px; color:#888; }
</style></head><body>
<div class="page">
  ${logo}
  ${bodyHtml}
  <div class="sig-row"><div>${stampImg}</div><div>${signImg}</div></div>
  <div class="pageno">1</div>
  <div style="position:absolute;bottom:24mm;inset-inline:0;text-align:center;font-size:8.5px;color:#999">Powered by IDEA Operating System v1</div>
</div>
<script>window.onload = () => { ${preview ? '' : 'window.print();'} }</script>
</body></html>`)
  w.document.close()
}

// ===== تصدير عرض السعر =====
const L = {
  ar: {
    invoice: 'فاتورة', proposal: 'عرض سعر', internal: 'نسخة داخلية (بالتكلفة)',
    conf: 'اسم المؤتمر', org: 'الشركة المنظمة', date: 'التاريخ', place: 'المكان',
    item: 'البند', units: 'العدد', price: 'السعر', days: 'الأيام', total: 'الإجمالي', note: 'ملاحظات',
    hallSub: 'إجمالي القاعات', subtotal: 'الإجمالي قبل الضريبة', wht: 'خصم منبع (3%)', vat: 'قيمة مضافة (14%)',
    grand: 'الإجمالي النهائي', cost: 'إجمالي التكلفة', margin: 'هامش الربح',
    client: 'العميل', cr: 'س.ت', tax: 'ب.ض',
    vatIncl: 'هذه الفاتورة شاملة ضريبة القيمة المضافة', vatExcl: 'هذه الفاتورة غير شاملة ضريبة القيمة المضافة',
  },
  en: {
    invoice: 'INVOICE', proposal: 'QUOTATION', internal: 'Internal copy (cost)',
    conf: 'Conference', org: 'Organizing Company', date: 'Date', place: 'Location',
    item: 'ITEM / EQUIPMENT', units: 'Units', price: 'Price', days: 'Days', total: 'Total', note: 'Note',
    hallSub: 'Hall Subtotals', subtotal: 'Subtotal', wht: 'WHT (3%)', vat: 'VAT (14%)',
    grand: 'Grand Total', cost: 'Total Cost', margin: 'Profit Margin',
    client: 'Client', cr: 'CR No.', tax: 'Tax ID',
    vatIncl: 'This invoice is inclusive of VAT', vatExcl: 'This invoice is exclusive of VAT',
  },
}
// docLang: 'ar' | 'en' | 'both'
const lbl = (docLang, key) => docLang === 'both' ? `${L.ar[key]} / ${L.en[key]}` : L[docLang === 'en' ? 'en' : 'ar'][key]

export function exportQuote(args) { try { return _exportQuote(args) } catch (e) { alert('خطأ في التصدير: ' + e.message); console.error(e) } }
function _exportQuote({ quote, clients, settings, suppliers, format, letterhead, version, stamp, sign, preview, docLang = 'ar', t }) {
  const _ = (k) => lbl(docLang, k)
  const d = typeof quote.data === 'string' ? JSON.parse(quote.data || '{}') : (quote.data || {})
  const halls = d.halls || [], items = d.items || []
  const client = clients.find((c) => c.id === quote.client_id)
  const internal = version === 'internal'
  const cellVal = (it, h) => it.cells?.[h.key] || {}
  const rowTotal = (c) => (+c.units || 0) * (+c.price || 0) * (+c.days || 0)

  const isInvoice = quote.doc_type === 'invoice'
  const docTitle = _(isInvoice ? 'invoice' : 'proposal')
  const rtl = docLang !== 'en'
  if (format === 'pdf' || format === 'both') {
    let head = `<h1>${internal ? docTitle + ' — ' + _('internal') : docTitle}</h1>
    ${quote.preamble ? `<div style="font-size:12.5px;margin-bottom:5mm;white-space:pre-wrap">${quote.preamble}</div>` : ''}
    <div class="head-grid">
      <div><b>${_('conf')}:</b> ${quote.conference_name || ''}</div>
      <div><b>${_('org')}:</b> ${client?.company_name || ''}</div>
      <div><b>${_('date')}:</b> ${quote.date_from || ''} ${quote.date_to ? '— ' + quote.date_to : ''}</div>
      <div><b>${_('place')}:</b> ${quote.location || ''}</div>
    </div>`

    const showN = quote.show_notes !== false
    let table = `<table><thead><tr><th rowspan="2">${_('item')}</th>`
    for (const h of halls) table += `<th colspan="${(internal ? 5 : 4) + (showN ? 1 : 0)}">${h.name}</th>`
    table += `<th rowspan="2">${_('total')}</th></tr><tr>`
    for (const __h of halls) table += `<th>${_('units')}</th><th>${_('price')}</th>${internal ? `<th>${_('cost')}</th>` : ''}<th>${_('days')}</th><th>${_('total')}</th>${showN ? `<th>${_('note')}</th>` : ''}`
    table += `</tr></thead><tbody>`
    const hallSubs = {}
    for (const it of items) {
      let rowSum = 0
      table += `<tr><td style="text-align:start">${it.item_name}${it.item_note ? '<br><small style="color:#666">' + it.item_note + '</small>' : ''}${internal && it.supplier_id ? '<br><small>' + (suppliers.find((s) => s.id === it.supplier_id)?.supplier_name || '') + '</small>' : ''}</td>`
      for (const h of halls) {
        const c = cellVal(it, h); const tt = rowTotal(c)
        hallSubs[h.key] = (hallSubs[h.key] || 0) + tt; rowSum += tt
        table += `<td>${c.units || ''}</td><td>${c.price ? fmt(c.price) : ''}</td>${internal ? `<td>${it.cost_price ? fmt(it.cost_price) : ''}</td>` : ''}<td>${c.days || ''}</td><td>${tt ? fmt(tt) : ''}</td>${showN ? `<td style="font-size:9.5px">${c.note || ''}</td>` : ''}`
      }
      table += `<td><b>${fmt(rowSum)}</b></td></tr>`
    }
    table += `<tr><td><b>${_('hallSub')}</b></td>`
    for (const h of halls) table += `<td colspan="${(internal ? 5 : 4) + (showN ? 1 : 0)}"><b>${fmt(hallSubs[h.key] || 0)}</b></td>`
    table += `<td><b>${fmt(quote.subtotal)}</b></td></tr></tbody></table>`

    let totals = `<div class="totals"><div><span>${_('subtotal')}</span><b>${fmt(quote.subtotal)} EGP</b></div>`
    if (quote.is_taxable) totals += `<div><span>${_('wht')}</span><b>− ${fmt(quote.wht_amount)}</b></div>
      <div><span>${_('vat')}</span><b>${fmt(quote.vat_amount)}</b></div>`
    totals += `<div class="grand"><span>${_('grand')}</span><b>${fmt(quote.grand_total)} EGP</b></div></div>`
    if (internal) {
      const cost = items.reduce((s, it) => s + halls.reduce((a, h) => {
        const c = cellVal(it, h); return a + (+c.units || 0) * (+it.cost_price || 0) * (+c.days || 0)
      }, 0), 0)
      totals += `<div class="totals"><div><span>${_('cost')}</span><b>${fmt(cost)}</b></div>
        <div class="grand"><span>${_('margin')}</span><b>${fmt(quote.subtotal - cost)}</b></div></div>`
    }

    const vatNote = isInvoice
      ? `<div style="margin-top:5mm;font-size:10.5px;color:#555">${docLang === 'both' ? L.ar[quote.is_taxable ? 'vatIncl' : 'vatExcl'] + '<br>' + L.en[quote.is_taxable ? 'vatIncl' : 'vatExcl'] : _(quote.is_taxable ? 'vatIncl' : 'vatExcl')}</div>` : ''
    const footer = (client ? `<div class="footer">${_('client')}: ${client.company_name} — ${_('cr')}: ${client.commercial_reg_no || '—'} — ${_('tax')}: ${client.tax_card_no || '—'}</div>` : '') 
    printHtml({ title: quote.conference_name, bodyHtml: head + table + totals + vatNote + footer, settings, letterhead, stamp, sign, preview, rtl })
  }

  if (format === 'excel' || format === 'both') {
    const wb = XLSX.utils.book_new()
    const aoa = []
    // بيانات المؤتمر والشركة فوق
    aoa.push([docTitle])
    aoa.push([_('conf'), quote.conference_name || ''])
    aoa.push([_('org'), client?.company_name || ''])
    if (client?.commercial_reg_no) aoa.push([_('cr'), client.commercial_reg_no])
    if (client?.tax_card_no) aoa.push([_('tax'), client.tax_card_no])
    aoa.push([_('date'), `${quote.date_from || ''} - ${quote.date_to || ''}`])
    aoa.push([_('place'), quote.location || ''])
    aoa.push([])
    // البنود: قسم لكل قاعة في نفس الشيت
    for (const h of halls) {
      aoa.push([h.name])
      aoa.push([_('item'), _('units'), _('price'), _('days'), _('total'), _('note')])
      let sub = 0
      for (const it of items) {
        const c = cellVal(it, h); const tt = rowTotal(c); sub += tt
        aoa.push([it.item_name, +c.units || 0, +c.price || 0, +c.days || 0, tt, c.note || ''])
      }
      aoa.push([_('hallSub'), '', '', '', sub, ''])
      aoa.push([])
    }
    // الضرائب والإجمالي تحت آخر الفاتورة
    aoa.push([_('subtotal'), +quote.subtotal || 0])
    if (quote.is_taxable) {
      aoa.push([_('wht'), -(+quote.wht_amount || 0)])
      aoa.push([_('vat'), +quote.vat_amount || 0])
    }
    aoa.push([_('grand'), +quote.grand_total || 0])
    if (isInvoice) aoa.push([_(quote.is_taxable ? 'vatIncl' : 'vatExcl')])
    aoa.push(['Powered by IDEA Operating System v1'])
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = [{ wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 20 }]
    XLSX.utils.book_append_sheet(wb, ws, (quote.conference_name || 'Document').substring(0, 30))
    XLSX.writeFile(wb, `${quote.conference_name || 'quote'}.xlsx`)
  }
}
