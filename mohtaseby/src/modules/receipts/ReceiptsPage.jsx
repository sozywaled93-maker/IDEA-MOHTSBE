import { useEffect, useRef, useState } from 'react'
import { useLang } from '../../lib/i18n.jsx'
import { listRows, insertRow, deleteRow, uploadDoc, openFile } from '../../lib/db.js'
import { amountInWords, fmt } from '../../lib/tafqeet.js'
import { Modal, ConfirmDelete, EmptyState } from '../../components/ui.jsx'
import { printHtml } from '../exports/exportQuote.js'
import { viewFile } from '../../components/viewFile.js'
import { loadSettings } from '../../lib/supabase.js'

const empty = () => ({
  recipient_name: '', payer_name: 'شركة اياديا لتنظيم المؤتمرات', client_id: '',
  amount_egp: 0, amount_piasters: 0, payment_type: 'نقداً', cheque_number: '',
  purpose: '', receipt_date: new Date().toISOString().slice(0, 10),
  include_stamp: false, include_signature: false, attachment_url: null,
})

function receiptHtml(r, num) {
  const words = amountInWords(+r.amount_egp || 0, +r.amount_piasters || 0)
  return `<h1 style="text-decoration:underline">إيصال استلام نقدية</h1>
  <div style="text-align:start;font-size:13px;margin-bottom:6mm"><b>رقم الإيصال:</b> ${num}</div>
  <table style="width:60mm;margin-bottom:8mm"><tr><th>جنيه</th><th>قرش</th></tr>
    <tr><td style="font-size:15px"><b>${fmt(r.amount_egp)}</b></td><td>${r.amount_piasters || 0}</td></tr></table>
  <div style="font-size:13.5px;line-height:2.4">
    <div><b>اسم المستلم:</b> ${r.recipient_name || '.....................'}</div>
    <div><b>من السيد / </b> ${r.payer_name}</div>
    <div><b>المبلغ:</b> ${words}</div>
    <div><b>نقداً / شيك رقم:</b> ${r.payment_type === 'نقداً' ? 'نقداً' : 'شيك رقم ' + (r.cheque_number || '')}</div>
    <div><b>وذلك نظير:</b> ${r.purpose || ''}</div>
  </div>
  <div style="display:flex;justify-content:space-between;margin-top:14mm;font-size:13px">
    <div><b>التاريـخ:</b> ${r.receipt_date}</div>
    <div><b>اسم المستلم:</b> .....................</div>
    <div><b>التوقيع:</b> .....................</div>
  </div>
  <div style="margin-top:16mm;font-size:11px;color:#666;text-align:center">
    الرجاء تزويد قسم الحسابات بنسخة من بطاقة الرقم القومي الخاصة بكم
  </div>`
}

export default function ReceiptsPage() {
  const { t } = useLang()
  const [rows, setRows] = useState([])
  const [clients, setClients] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [recipients, setRecipients] = useState([])
  const [settings, setSettings] = useState(null)
  const [form, setForm] = useState(null)
  const [del, setDel] = useState(null)
  const [preview, setPreview] = useState(false)
  const fileRef = useRef(null)

  const load = () => listRows('cash_receipts').then(setRows)
  useEffect(() => {
    load(); listRows('clients').then(setClients); loadSettings().then(setSettings)
    listRows('suppliers').then(setSuppliers); listRows('recipients').then(setRecipients)
  }, [])

  const nextNumber = () => rows.length ? Math.max(...rows.map((r) => +r.receipt_number || 0)) + 1 : 1
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  const save = async () => {
    if (!form.recipient_name.trim()) return alert(t('required') + ': ' + t('recipientName'))
    const name = form.recipient_name.trim()
    let supplier_id = suppliers.find((x) => x.supplier_name === name)?.id || null
    let recipient_id = recipients.find((x) => x.name === name)?.id || null
    // لو اسم يدوي غير مسجل: اسأل أسجله؟ عشان نتابع دفعاته قدام
    if (!supplier_id && !recipient_id) {
      if (confirm(t('registerRecipientQ').replace('{name}', name))) {
        const rec = await insertRow('recipients', { name, phone: '' })
        setRecipients((p) => [rec, ...p]); recipient_id = rec.id
      }
    }
    const { attachment_url, ...rest } = form
    const payload = { ...rest, supplier_id, recipient_id, receipt_number: nextNumber(), amount_in_words: amountInWords(+form.amount_egp || 0, +form.amount_piasters || 0) }
    const saved = await insertRow('cash_receipts', payload)
    if (attachment_url) {
      await insertRow('receipt_attachments', { receipt_id: saved.id, file_url: attachment_url, file_type: 'national_id' })
    }
    setForm(null); load()
  }

  const doPrint = (r, num, prev) => printHtml({
    title: `إيصال ${num}`, bodyHtml: receiptHtml(r, num), settings,
    letterhead: !!settings?.letterhead_url, stamp: r.include_stamp, sign: r.include_signature, preview: prev,
  })

  return (
    <div>
      <h1 className="page-title">{t('receipts')}</h1>
      <div className="toolbar">
        <button className="save-btn" onClick={() => setForm(empty())}>+ {t('newReceipt')}</button>
      </div>

      {rows.length === 0 ? <EmptyState /> : (
        <div className="cards-grid">
          {rows.map((r) => (
            <div className="entity-card" key={r.id}>
              <div className="entity-head">
                <b>#{r.receipt_number} — {r.recipient_name}</b>
                <span className="badge">{fmt(r.amount_egp)} EGP</span>
              </div>
              <div className="entity-sub">{r.receipt_date} · {r.payment_type}</div>
              <div className="entity-meta"><span>{r.amount_in_words}</span>{r.purpose && <span>نظير: {r.purpose}</span>}</div>
              <div className="entity-actions">
                <button onClick={() => doPrint(r, r.receipt_number, false)}>🖨 {t('print')}</button>
                <button className="danger" onClick={() => setDel(r.id)}>{t('delete')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {form && (
        <Modal title={`${t('newReceipt')} — #${nextNumber()}`} onClose={() => setForm(null)} wide>
          <div className="grid2">
            <div className="field"><label>{t('recipientName')} *</label>
              <input list="recipient-names" value={form.recipient_name} onChange={(e) => set('recipient_name', e.target.value)}
                placeholder={t('recipientHint')} />
              <datalist id="recipient-names">
                {suppliers.map((x) => <option key={'s' + x.id} value={x.supplier_name} />)}
                {recipients.map((x) => <option key={'r' + x.id} value={x.name} />)}
              </datalist>
              {(() => {
                const prev = rows.filter((r) => r.recipient_name === form.recipient_name.trim() && form.recipient_name.trim())
                if (!prev.length) return null
                const tot = prev.reduce((s, r) => s + (+r.amount_egp || 0), 0)
                return <div className="hint-inline" style={{ marginTop: 4 }}>
                  💡 {t('prevPayments')}: {prev.length} — {Number(tot).toLocaleString('en-EG')} EGP
                  ({prev.slice(0, 3).map((r) => r.receipt_date).join(' · ')})
                </div>
              })()}
            </div>
            <div className="field"><label>{t('payerName')}</label>
              <select value={form.client_id} onChange={(e) => {
                const c = clients.find((x) => x.id === e.target.value)
                setForm((p) => ({ ...p, client_id: e.target.value, payer_name: c ? c.company_name : 'شركة اياديا لتنظيم المؤتمرات' }))
              }}>
                <option value="">{t('defaultCompany')}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select></div>
            <div className="field"><label>{t('pounds')}</label>
              <input type="number" dir="ltr" min="0" value={form.amount_egp} onChange={(e) => set('amount_egp', e.target.value)} /></div>
            <div className="field"><label>{t('piastres')}</label>
              <input type="number" dir="ltr" min="0" max="99" value={form.amount_piasters} onChange={(e) => set('amount_piasters', e.target.value)} /></div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>{t('amountWords')}</label>
              <div className="words-preview">{amountInWords(+form.amount_egp || 0, +form.amount_piasters || 0)}</div>
            </div>
            <div className="field"><label>{t('cashWord')} / {t('chequeWord')}</label>
              <div className="seg">
                <button className={form.payment_type === 'نقداً' ? 'active' : ''} onClick={() => set('payment_type', 'نقداً')}>{t('cashWord')}</button>
                <button className={form.payment_type === 'شيك' ? 'active' : ''} onClick={() => set('payment_type', 'شيك')}>{t('chequeWord')}</button>
              </div>
            </div>
            {form.payment_type === 'شيك' && (
              <div className="field"><label>{t('chequeNumber')}</label>
                <input dir="ltr" value={form.cheque_number} onChange={(e) => set('cheque_number', e.target.value)} /></div>
            )}
            <div className="field"><label>{t('receiptDate')}</label>
              <input type="date" value={form.receipt_date} onChange={(e) => set('receipt_date', e.target.value)} /></div>
            <div className="field" style={{ gridColumn: '1 / -1' }}><label>{t('forPurpose')}</label>
              <input value={form.purpose} onChange={(e) => set('purpose', e.target.value)} placeholder={t('phPurpose')} /></div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>{t('nationalId')}</label>
              <div className="upload-box" style={{ minHeight: 90 }}
                onClick={() => !form.attachment_url && fileRef.current.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={async (e) => { e.preventDefault(); const f0 = e.dataTransfer.files[0]; if (f0) try { set('attachment_url', await uploadDoc('receipt-docs', f0, `${Date.now()}-${f0.name}`)) } catch (err) { alert(err.message) } }}>
                {form.attachment_url ? (
                  <>
                    <img src={form.attachment_url} alt="" style={{ maxHeight: 55 }} />
                    <div className="upload-actions" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => openFile(form.attachment_url)}>{t('view')}</button>
                      <button className="danger" onClick={() => set('attachment_url', null)}>{t('remove')}</button>
                    </div>
                  </>
                ) : <span className="hint">📎 {t('uploadHint')} (JPG/PNG/PDF)</span>}
                <input hidden ref={fileRef} type="file" accept="image/png,image/jpeg,application/pdf"
                  onChange={async (e) => e.target.files[0] && set('attachment_url', await uploadDoc('receipt-docs', e.target.files[0], `${Date.now()}-${e.target.files[0].name}`))} />
              </div>
            </div>
            <div className="check-row"><input type="checkbox" id="rst" checked={form.include_stamp} onChange={(e) => set('include_stamp', e.target.checked)} /><label htmlFor="rst">{t('includeStamp')}</label></div>
            <div className="check-row"><input type="checkbox" id="rsg" checked={form.include_signature} onChange={(e) => set('include_signature', e.target.checked)} /><label htmlFor="rsg">{t('includeSignature')}</label></div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="add-btn" onClick={() => doPrint(form, nextNumber(), true)}>{t('preview')}</button>
            <button className="save-btn" onClick={save}>{t('save')}</button>
          </div>
        </Modal>
      )}

      {del && <ConfirmDelete onCancel={() => setDel(null)}
        onConfirm={async () => { await deleteRow('cash_receipts', del); setDel(null); load() }} />}
    </div>
  )
}
