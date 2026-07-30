import { useEffect, useState } from 'react'
import { useDirty } from '../../lib/useDirty.js'
import { useLang } from '../../lib/i18n.jsx'
import { listRows, insertRow, updateRow, deleteRow } from '../../lib/db.js'
import { Modal, ConfirmDelete, EmptyState } from '../../components/ui.jsx'
import ViewDetails from '../../components/ViewDetails.jsx'
import ChatIdField from '../../components/ChatIdField.jsx'
import SupplierLedger from './SupplierLedger.jsx'
import { WorkOrderModal } from '../quotes/QuotesPage.jsx'
import { loadSettings } from '../../lib/supabase.js'
import { BlurInput } from '../../components/BlurInput.jsx'

const empty = {
  supplier_name: '', company_name: '', adds_tax: false, tax_rate: 14,
  phones: [], payment_accounts: [], address: '', location_url: '',
}

export default function SuppliersTab() {
  const { t } = useLang()
  const [rows, setRows] = useState([])
  const [mains, setMains] = useState([])
  const [links, setLinks] = useState([])       // supplier_main_items
  const [form, setForm] = useState(null)       // { ...supplier, main_ids: [] }
  const [del, setDel] = useState(null)
  const [ledger, setLedger] = useState(null)
  const [quotes, setQuotes] = useState([])
  const [supWorkOrders, setSupWorkOrders] = useState(null)   // { supplier, list: [quotes مرتبطة] }
  const [printQuote, setPrintQuote] = useState(null)          // { quote, supplierId } — أمر الشغل المفتوح للطباعة
  const [settings, setSettings] = useState(null)
  const [pricing, setPricing] = useState(null)   // مودال أسعار المورد
  const [subs, setSubs] = useState([])
  const [subPrices, setSubPrices] = useState([])
  const [q, setQ] = useState('')
  const [formOriginal, setFormOriginal] = useState(null)
  const isDirty = useDirty(form, formOriginal)
  const [viewRow, setViewRow] = useState(null)

  const load = async () => {
    setRows(await listRows('suppliers'))
    setQuotes(await listRows('quotes'))
    setMains(await listRows('library_main'))
    setLinks(await listRows('supplier_main_items', 'id'))
    setSubs(await listRows('library_sub'))
    setSubPrices(await listRows('sub_supplier_prices', 'id'))
  }
  useEffect(() => { load(); loadSettings().then(setSettings) }, [])

  const mainsOf = (sid) => links.filter((l) => l.supplier_id === sid)
    .map((l) => mains.find((m) => m.id === l.main_id)?.name).filter(Boolean)

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  const openForm = (r) => {
    const f = {
      ...empty, ...r,
      phones: Array.isArray(r?.phones) ? r.phones : [],
      payment_accounts: Array.isArray(r?.payment_accounts) ? r.payment_accounts : [],
      main_ids: r?.id ? links.filter((l) => l.supplier_id === r.id).map((l) => l.main_id) : [],
    }
    setForm(f)
    setFormOriginal(f)
  }

  const addMainItem = async () => {
    const name = prompt(t('mainItemName'))
    if (!name?.trim()) return
    const m = await insertRow('library_main', { name: name.trim() })
    setMains((p) => [m, ...p])
    setForm((p) => ({ ...p, main_ids: [...p.main_ids, m.id] }))
  }

  const save = async () => {
    if (!form.supplier_name.trim()) return alert(t('required') + ': ' + t('supplierName'))
    const { main_ids, ...sup } = form
    sup.phones = (sup.phones || []).filter((p) => p.number?.trim())
    sup.payment_accounts = (sup.payment_accounts || []).filter((a) => a.account?.trim())
    sup.phone = sup.phones.find((p) => p.is_primary)?.number || sup.phones[0]?.number || ''
    let saved
    if (sup.id) saved = await updateRow('suppliers', sup.id, sup)
    else saved = await insertRow('suppliers', { ...sup, public_token: crypto.randomUUID().replace(/-/g, '') })
    // مزامنة البنود الأساسية
    for (const l of links.filter((l) => l.supplier_id === saved.id)) await deleteRow('supplier_main_items', l.id)
    for (const mid of main_ids) await insertRow('supplier_main_items', { supplier_id: saved.id, main_id: mid })
    setForm(null); load()
  }

  const filtered = rows.filter((r) =>
    (r.supplier_name + ' ' + (r.company_name || '')).toLowerCase().includes(q.toLowerCase()))

  return (
    <div>
      <div className="toolbar">
        <input className="search" placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="save-btn" onClick={() => openForm(null)}>+ {t('addSupplier')}</button>
      </div>

      {filtered.length === 0 ? <EmptyState /> : (
        <div className="cards-grid">
          {filtered.map((r) => (
            <div className="entity-card" key={r.id}>
              <div className="entity-head">
                <b>{r.supplier_name}</b>
                {r.adds_tax && <span className="badge inv">{t('addsTax')} {r.tax_rate}%</span>}
              </div>
              {r.company_name && <div className="entity-sub">{r.company_name}</div>}
              {mainsOf(r.id).length > 0 && (
                <div className="chip-row">
                  {mainsOf(r.id).map((n, i) => <span className="chip" key={i}>{n}</span>)}
                </div>
              )}
              <div className="entity-meta">
                {(r.phones || []).slice(0, 2).map((p, i) => <span key={i} dir="ltr">📞 {p.number}{p.is_primary ? ' ★' : ''}</span>)}
                {(r.payment_accounts || []).slice(0, 2).map((a, i) => <span key={i}>{t(a.method)} · <span dir="ltr">{a.account}</span></span>)}
                {r.address && <span>📍 {r.address}</span>}
              </div>
              <div className="entity-actions">
                <button onClick={() => setViewRow(r)}>👁 {t('view')}</button>
                <button onClick={() => openForm(r)}>{t('edit')}</button>
                <button onClick={() => setPricing(r)}>💲 {t('supplierPrices')}</button>
                <button onClick={() => setLedger(r)}>📒 {t('ledger')}</button>
                {(() => {
                  const list = quotes.filter((qq) => (() => {
                    const d = typeof qq.data === 'string' ? JSON.parse(qq.data || '{}') : (qq.data || {})
                    return (d.items || []).some((it) => it.supplier_id === r.id)
                  })())
                  return list.length > 0 && (
                    <button className="mini-btn tg" onClick={() => setSupWorkOrders({ supplier: r, list })}>🛠 {t('workOrder')} ({list.length})</button>
                  )
                })()}
                <button className="convert" onClick={() => setLedger({ ...r, __openPay: true })}>💵 {t('addPayment')}</button>
                <button className="danger" onClick={() => setDel(r.id)}>{t('delete')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {form && (
        <Modal title={form.id ? t('edit') : t('addSupplier')} onClose={() => setForm(null)} wide
          dirty={isDirty} onSaveAndClose={save}>
          <div className="grid2">
            <div className="field"><label>{t('supplierName')} *</label>
              <input value={form.supplier_name} onChange={(e) => set('supplier_name', e.target.value)} /></div>
            <div className="field"><label>{t('companyName')}</label>
              <input value={form.company_name || ''} onChange={(e) => set('company_name', e.target.value)} /></div>
            <div className="field"><label>{t('address')}</label>
              <input value={form.address || ''} onChange={(e) => set('address', e.target.value)} /></div>
            <div className="field"><label>{t('locationLink')}</label>
              <input dir="ltr" value={form.location_url || ''} onChange={(e) => set('location_url', e.target.value)} placeholder="https://maps.google.com/..." /></div>
            <ChatIdField label={t('telegramChatId')} value={form.telegram_chat_id} onChange={(v) => set('telegram_chat_id', v)} phone={form.phones?.find((p) => p.is_primary)?.number || form.phones?.[0]?.number} />
            <div className="field"><label>{t('whatsappNumber')}</label>
              <input dir="ltr" value={form.whatsapp_number || ''} onChange={(e) => set('whatsapp_number', e.target.value)} /></div>
            <div className="field">
              <label>{t('addsTax')}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label className="check-row" style={{ padding: 0 }}>
                  <input type="checkbox" checked={form.adds_tax} onChange={(e) => set('adds_tax', e.target.checked)} />
                  {form.adds_tax ? t('yes') : t('no')}
                </label>
                {form.adds_tax && <input type="number" style={{ width: 90 }} value={form.tax_rate}
                  onChange={(e) => set('tax_rate', +e.target.value)} />}
              </div>
            </div>
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <label>{t('phone')}</label>
            {(form.phones || []).map((p, i) => (
              <div className="sub-item-row" key={i} style={{ gridTemplateColumns: '1fr 120px 36px' }}>
                <input dir="ltr" placeholder={t('phone')} value={p.number || ''}
                  onChange={(e) => set('phones', (form.phones || []).map((x, j) => j === i ? { ...x, number: e.target.value } : x))} />
                <label className="check-row" style={{ padding: 0, fontSize: 12.5 }}>
                  <input type="radio" name="sup-primary" checked={!!p.is_primary}
                    onChange={() => set('phones', (form.phones || []).map((x, j) => ({ ...x, is_primary: j === i })))} />
                  {t('primaryPhone')}
                </label>
                <button type="button" className="icon-btn" onClick={() => set('phones', (form.phones || []).filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button type="button" className="mini-btn" onClick={() => set('phones', [...(form.phones || []), { number: '', is_primary: !(form.phones || []).length }])}>+ {t('addPhone')}</button>
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <label>{t('bankDetails')}</label>
            {(form.payment_accounts || []).map((a, i) => (
              <div className="sub-item-row" key={i} style={{ gridTemplateColumns: '150px 1fr 36px' }}>
                <select value={a.method || 'bank'}
                  onChange={(e) => set('payment_accounts', (form.payment_accounts || []).map((x, j) => j === i ? { ...x, method: e.target.value } : x))}>
                  <option value="bank">{t('bank')}</option>
                  <option value="vodafone">{t('vodafone')}</option>
                  <option value="instapay">{t('instapay')}</option>
                </select>
                <input dir="ltr" placeholder={t('accountNumber')} value={a.account || ''}
                  onChange={(e) => set('payment_accounts', (form.payment_accounts || []).map((x, j) => j === i ? { ...x, account: e.target.value } : x))} />
                <button type="button" className="icon-btn" onClick={() => set('payment_accounts', (form.payment_accounts || []).filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button type="button" className="mini-btn" onClick={() => set('payment_accounts', [...(form.payment_accounts || []), { method: 'bank', account: '' }])}>+ {t('addAccount')}</button>
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <label>{t('mainItems')} <span className="hint-inline">({t('mainItemsHint')})</span></label>
            <div className="chip-row">
              {mains.map((m) => {
                const on = (form.main_ids || []).includes(m.id)
                return (
                  <button type="button" key={m.id} className={`chip selectable ${on ? 'on' : ''}`}
                    onClick={() => set('main_ids', on ? (form.main_ids || []).filter((x) => x !== m.id) : [...(form.main_ids || []), m.id])}>
                    {m.name}
                  </button>
                )
              })}
              <button type="button" className="chip selectable" style={{ color: 'var(--brand)' }} onClick={addMainItem}>＋ {t('addMainItem')}</button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="save-btn" onClick={save}>{t('save')}</button>
          </div>
        </Modal>
      )}

      {pricing && (() => {
        const supMains = links.filter((l) => l.supplier_id === pricing.id).map((l) => mains.find((m) => m.id === l.main_id)).filter(Boolean)
        const priceOf = (subId) => subPrices.find((p) => p.sub_id === subId && p.supplier_id === pricing.id)
        const setPrice = async (subId, field, v) => {
          const ex = priceOf(subId)
          if (ex) await updateRow('sub_supplier_prices', ex.id, { [field]: +v || 0 })
          else await insertRow('sub_supplier_prices', { sub_id: subId, supplier_id: pricing.id, cost_price: 0, sell_price: null, [field]: +v || 0 })
          setSubPrices(await listRows('sub_supplier_prices', 'id'))
        }
        return (
          <Modal title={`💲 ${t('supplierPrices')} — ${pricing.supplier_name}`} onClose={() => setPricing(null)} wide>
            {supMains.length === 0 ? <p className="hint-inline">{t('noMainsLinked')}</p> : supMains.map((m) => (
              <div className="card" key={m.id} style={{ padding: 14 }}>
                <h3 style={{ fontSize: 14.5 }}>{m.name}</h3>
                {subs.filter((x) => x.main_id === m.id).length === 0
                  ? <p className="hint-inline">{t('noSubsYet')}</p>
                  : (
                    <table className="quote-table" style={{ width: '100%' }}>
                      <thead><tr><th style={{ textAlign: 'start' }}>{t('subItemName')}</th><th>{t('defaultUnit')}</th><th>{t('supplierCostCol')}</th><th>{t('supplierSellCol')}</th></tr></thead>
                      <tbody>
                        {subs.filter((x) => x.main_id === m.id).map((sub) => (
                          <tr key={sub.id}>
                            <td style={{ textAlign: 'start' }}>{sub.name}</td>
                            <td>{sub.unit}</td>
                            <td style={{ width: 130 }}>
                              <BlurInput className="num" type="number" min="0"
                                value={priceOf(sub.id)?.cost_price ?? ''}
                                placeholder="—" onCommit={(v) => setPrice(sub.id, v)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
              </div>
            ))}
            <p className="hint-inline">{t('supplierPricesHint')}</p>
          </Modal>
        )
      })()}
      {supWorkOrders && (
        <Modal title={`🛠 ${t('workOrder')} — ${supWorkOrders.supplier.supplier_name}`} onClose={() => setSupWorkOrders(null)}>
          <p className="hint-inline">{t('chooseConfForWorkOrder')}</p>
          {supWorkOrders.list.map((qq) => (
            <button key={qq.id} className="supplier-link picker" style={{ width: '100%', marginBottom: 8 }}
              onClick={() => { setPrintQuote({ quote: qq, supplierId: supWorkOrders.supplier.id }); setSupWorkOrders(null) }}>
              <span>🎪 {qq.conference_name} — {qq.date_from || ''}</span>
            </button>
          ))}
        </Modal>
      )}
      {printQuote && (
        <WorkOrderModal
          q={{ ...printQuote.quote, ...(typeof printQuote.quote.data === 'string' ? JSON.parse(printQuote.quote.data || '{}') : (printQuote.quote.data || {})) }}
          suppliers={rows} conferences={[]} settings={settings} t={t}
          onlySupplierId={printQuote.supplierId}
          onClose={() => setPrintQuote(null)}
        />
      )}
      {ledger && <SupplierLedger supplier={ledger} onClose={() => setLedger(null)} />}
      {viewRow && (
        <ViewDetails title={viewRow.supplier_name} onClose={() => setViewRow(null)} rows={[
          { label: t('companyName'), value: viewRow.company_name },
          { label: t('addsTax'), value: viewRow.adds_tax ? `${t('yes')} (${viewRow.tax_rate}%)` : t('no') },
          { label: t('mainItems'), value: mainsOf(viewRow.id).join(' · ') },
          ...(viewRow.phones || []).map((p, i) => ({ label: i === 0 ? t('phone') : '', value: p.number + (p.is_primary ? ' ★' : ''), ltr: true })),
          ...(viewRow.payment_accounts || []).map((a, i) => ({ label: i === 0 ? t('bankDetails') : '', value: `${t(a.method)} · ${a.account}` })),
          { label: t('address'), value: viewRow.address },
          { label: t('locationLink'), value: viewRow.location_url, ltr: true },
          { label: 'Telegram Chat ID', value: viewRow.telegram_chat_id, ltr: true },
          { label: t('whatsappNumber'), value: viewRow.whatsapp_number, ltr: true },
        ]} />
      )}
      {del && <ConfirmDelete onCancel={() => setDel(null)}
        onConfirm={async () => { await deleteRow('suppliers', del); setDel(null); load() }} />}
    </div>
  )
}
