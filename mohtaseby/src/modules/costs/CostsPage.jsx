import { useEffect, useMemo, useState } from 'react'
import { useLang } from '../../lib/i18n.jsx'
import { listRows, insertRow, updateRow, deleteRow, listCategories , supplierInCategory } from '../../lib/db.js'
import { fmt } from '../../lib/tafqeet.js'
import { EmptyState } from '../../components/ui.jsx'
import * as XLSX from 'xlsx'

const empty = (category) => ({
  category, supplier_id: '', item_name: '', cost_date: '', conference_name: '',
  quantity: 0, price: 0, num_days: 1, num_halls: 1,
  payment_1: 0, payment_2: 0, payment_3: 0, location: '',
})

export default function CostsPage() {
  const { t } = useLang()
  const [cats, setCats] = useState([])
  const [cat, setCat] = useState('')
  const [rows, setRows] = useState([])
  const [suppliers, setSuppliers] = useState([])

  const load = () => listRows('supplier_costs').then(setRows)
  useEffect(() => {
    load()
    listRows('suppliers').then(setSuppliers)
    listCategories().then((c) => { setCats(c); if (c[0]) setCat(c[0].name_ar) })
  }, [])

  const catRows = useMemo(() => rows.filter((r) => r.category === cat), [rows, cat])
  const catSuppliers = suppliers.filter((s) => supplierInCategory(s, cat))
  const supOf = (id) => suppliers.find((s) => s.id === id)

  const total = (r) => (+r.quantity || 0) * (+r.price || 0) * (+r.num_days || 0)
  const remaining = (r) => total(r) - (+r.payment_1 || 0) - (+r.payment_2 || 0) - (+r.payment_3 || 0)
  const addsTax = (r) => supOf(r.supplier_id)?.adds_tax
  const taxRate = (r) => +(supOf(r.supplier_id)?.tax_rate ?? 14)

  const add = async () => { await insertRow('supplier_costs', empty(cat)); load() }
  const patch = async (id, k, v) => { await updateRow('supplier_costs', id, { [k]: v }); load() }
  const remove = async (id) => { await deleteRow('supplier_costs', id); load() }

  const exportExcel = () => {
    const data = catRows.map((r) => ({
      DATE: r.cost_date || '', 'CONFERENCE NAME': r.conference_name || '',
      ITEM: r.item_name || '', SUPPLIER: supOf(r.supplier_id)?.supplier_name || '',
      'الكمية': +r.quantity || 0, PRICE: +r.price || 0, 'OF DAY': +r.num_days || 0, 'OF HALL': +r.num_halls || 0,
      'First payment': +r.payment_1 || 0, 'Second payment': +r.payment_2 || 0, 'Third payment': +r.payment_3 || 0,
      'Remaining': remaining(r), TOTAL: total(r),
      ...(addsTax(r) ? { 'TOTAL + VAT': total(r) * (1 + taxRate(r) / 100) } : {}),
      Location: r.location || '',
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), cat.substring(0, 30))
    XLSX.writeFile(wb, `costs-${cat}.xlsx`)
  }

  return (
    <div>
      <h1 className="page-title">{t('costs')}</h1>
      <div className="tabs" style={{ flexWrap: 'wrap' }}>
        {cats.map((c) => (
          <button key={c.id} className={cat === c.name_ar ? 'active' : ''} onClick={() => setCat(c.name_ar)}>{c.name_ar}</button>
        ))}
      </div>

      <div className="toolbar">
        <button className="add-btn" onClick={add}>+ {t('addItem')}</button>
        <button className="mini-btn" onClick={exportExcel}>⬇ Excel</button>
      </div>

      {catRows.length === 0 ? <EmptyState /> : (
        <div className="quote-scroll">
          <table className="quote-table costs-table">
            <thead><tr>
              <th>DATE</th><th>CONFERENCE</th><th>{t('itemName')}</th><th>{t('suppliers')}</th>
              <th>{t('quantity')}</th><th>PRICE</th><th>OF DAY</th><th>OF HALL</th>
              <th>{t('payment1')}</th><th>{t('payment2')}</th><th>{t('payment3')}</th>
              <th>TOTAL</th><th>Remaining</th><th>TOTAL+VAT</th><th>Location</th><th></th>
            </tr></thead>
            <tbody>
              {catRows.map((r) => (
                <tr key={r.id}>
                  <td><input type="date" value={r.cost_date || ''} onChange={(e) => patch(r.id, 'cost_date', e.target.value)} /></td>
                  <td><input value={r.conference_name || ''} onChange={(e) => patch(r.id, 'conference_name', e.target.value)} /></td>
                  <td>
                    <input list={'si-' + r.id} value={r.item_name || ''} onChange={(e) => {
                      const si = (supOf(r.supplier_id)?.sub_items || []).find((x) => x.name === e.target.value)
                      patch(r.id, 'item_name', e.target.value)
                      if (si?.price && !+r.price) patch(r.id, 'price', +si.price)
                    }} placeholder="P2 / بلكسي..." />
                    <datalist id={'si-' + r.id}>
                      {(supOf(r.supplier_id)?.sub_items || []).map((si, i) => <option key={i} value={si.name} />)}
                    </datalist>
                  </td>
                  <td>
                    <select value={r.supplier_id || ''} onChange={(e) => patch(r.id, 'supplier_id', e.target.value)}>
                      <option value="">—</option>
                      {catSuppliers.map((s) => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
                    </select>
                  </td>
                  {['quantity', 'price', 'num_days', 'num_halls', 'payment_1', 'payment_2', 'payment_3'].map((k) => (
                    <td key={k}><input className="num" type="number" min="0" value={r[k] ?? 0} onChange={(e) => patch(r.id, k, +e.target.value)} /></td>
                  ))}
                  <td className="cell-total"><b>{fmt(total(r))}</b></td>
                  <td className="cell-total" style={{ color: remaining(r) > 0 ? '#A32D2D' : '#0F6E56' }}>{fmt(remaining(r))}</td>
                  <td className="cell-total">{addsTax(r) ? fmt(total(r) * (1 + taxRate(r) / 100)) : '—'}</td>
                  <td><input value={r.location || ''} onChange={(e) => patch(r.id, 'location', e.target.value)} /></td>
                  <td><button className="icon-btn" onClick={() => remove(r.id)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
