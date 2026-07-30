import { useEffect, useMemo, useState } from 'react'
import { useLang } from '../../lib/i18n.jsx'
import {
  listRows, insertRow, updateRow, deleteRow,
  listCategories, addCategory, deleteCategory, deleteUnit, listUnits, addUnit,
  supplierInCategory } from '../../lib/db.js'
import { Modal, ConfirmDelete, EmptyState } from '../../components/ui.jsx'
import SelectWithAdd from '../../components/SelectWithAdd.jsx'

const empty = { item_name: '', category: 'شاشات', default_unit: 'باليوم', cost_price: 0, notes: '' }

export default function EquipmentPage() {
  const { t } = useLang()
  const [rows, setRows] = useState([])
  const [links, setLinks] = useState([])        // equipment_suppliers
  const [suppliers, setSuppliers] = useState([])
  const [cats, setCats] = useState([])
  const [units, setUnits] = useState([])
  const [form, setForm] = useState(null)        // { ...item, supplier_links: [{supplier_id, cost_price}] }
  const [del, setDel] = useState(null)
  const [q, setQ] = useState('')
  const [catFilter, setCatFilter] = useState('all')

  const load = async () => {
    setRows(await listRows('equipment_library'))
    setLinks(await listRows('equipment_suppliers', 'id'))
  }
  useEffect(() => {
    load()
    listRows('suppliers').then(setSuppliers)
    listCategories().then(setCats)
    listUnits().then(setUnits)
  }, [])

  const linksOf = (eqId) => links.filter((l) => l.equipment_id === eqId)
  const supName = (id) => suppliers.find((s) => s.id === id)?.supplier_name || '؟'

  const openForm = (item) => {
    const sl = item.id
      ? linksOf(item.id).map((l) => ({ supplier_id: l.supplier_id, cost_price: l.cost_price }))
      : []
    setForm({ ...item, supplier_links: sl })
  }

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  const toggleSupplier = (sid) => setForm((p) => {
    const has = p.supplier_links.some((l) => l.supplier_id === sid)
    return {
      ...p,
      supplier_links: has
        ? p.supplier_links.filter((l) => l.supplier_id !== sid)
        : [...p.supplier_links, { supplier_id: sid, cost_price: p.cost_price || 0 }],
    }
  })

  const setLinkPrice = (sid, price) => setForm((p) => ({
    ...p,
    supplier_links: p.supplier_links.map((l) => (l.supplier_id === sid ? { ...l, cost_price: price } : l)),
  }))

  const save = async () => {
    if (!form.item_name.trim()) return alert(t('required') + ': ' + t('itemName'))
    const { supplier_links, ...item } = form
    let saved
    if (item.id) saved = await updateRow('equipment_library', item.id, item)
    else saved = await insertRow('equipment_library', item)
    // مزامنة روابط الموردين
    for (const l of linksOf(saved.id)) await deleteRow('equipment_suppliers', l.id)
    for (const l of supplier_links) {
      await insertRow('equipment_suppliers', { equipment_id: saved.id, supplier_id: l.supplier_id, cost_price: +l.cost_price || 0 })
    }
    setForm(null); load()
  }

  const removeItem = async (id) => {
    for (const l of linksOf(id)) await deleteRow('equipment_suppliers', l.id)
    await deleteRow('equipment_library', id)
    setDel(null); load()
  }

  const catSuppliers = useMemo(
    () => (form ? suppliers.filter((s) => supplierInCategory(s, form.category)) : []),
    [form?.category, suppliers],
  )

  const filtered = rows.filter((r) =>
    r.item_name.toLowerCase().includes(q.toLowerCase()) &&
    (catFilter === 'all' || r.category === catFilter))

  return (
    <div>
      <h1 className="page-title">{t('equipment')}</h1>

      <div className="toolbar">
        <input className="search" placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="cat-filter" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="all">— {t('category')} —</option>
          {cats.map((c) => <option key={c.id} value={c.name_ar}>{c.name_ar}</option>)}
        </select>
        <button className="save-btn" onClick={() => openForm({ ...empty, category: cats[0]?.name_ar || 'شاشات' })}>
          + {t('addItem')}
        </button>
      </div>

      {filtered.length === 0 ? <EmptyState /> : (
        <div className="cards-grid">
          {filtered.map((r) => {
            const ls = linksOf(r.id)
            return (
              <div className="entity-card" key={r.id}>
                <div className="entity-head">
                  <b>{r.item_name}</b>
                  <span className={`badge ${ls.length ? '' : 'warn'}`}>{t('suppliersCount', ls.length)}</span>
                </div>
                <div className="entity-sub">{r.category} · {r.default_unit}</div>
                <div className="entity-meta">
                  <span>{t('costPrice')}: {Number(r.cost_price).toLocaleString('en-EG')} EGP</span>
                  {ls.length > 0 && (
                    <span>
                      {ls.map((l) => `${supName(l.supplier_id)} (${Number(l.cost_price).toLocaleString('en-EG')})`).join(' · ')}
                    </span>
                  )}
                  {r.notes && <span>📝 {r.notes}</span>}
                </div>
                <div className="entity-actions">
                  <button onClick={() => openForm(r)}>{t('edit')}</button>
                  <button className="danger" onClick={() => setDel(r.id)}>{t('delete')}</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {form && (
        <Modal title={form.id ? t('edit') : t('addItem')} onClose={() => setForm(null)} wide>
          <div className="grid2">
            <div className="field"><label>{t('itemName')} *</label>
              <input value={form.item_name} onChange={(e) => set('item_name', e.target.value)} placeholder="LED SCREEN P2" /></div>
            <div className="field"><label>{t('category')}</label>
              <SelectWithAdd value={form.category}
                onChange={(v) => setForm((p) => ({ ...p, category: v, supplier_links: [] }))}
                options={cats} addLabel={t('addCategory')}
                onDelete={async (id) => { await deleteCategory(id); setCats((p) => p.filter((c) => c.id !== id)) }}
                onAdd={async (n) => { const c = await addCategory(n); setCats((p) => [...p, c]); return c }} />
            </div>
            <div className="field"><label>{t('defaultUnit')}</label>
              <SelectWithAdd value={form.default_unit} onChange={(v) => set('default_unit', v)}
                options={units} addLabel={t('addUnitCustom')}
                onDelete={async (id) => { await deleteUnit(id); setUnits((p) => p.filter((u) => u.id !== id)) }}
                onAdd={async (n) => { const u = await addUnit(n); setUnits((p) => [...p, u]); return u }} />
            </div>
            <div className="field"><label>{t('costPrice')} (EGP)</label>
              <input type="number" dir="ltr" value={form.cost_price} onChange={(e) => set('cost_price', +e.target.value)} /></div>
            <div className="field" style={{ gridColumn: '1 / -1' }}><label>{t('notes')}</label>
              <input value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
          </div>

          <div className="field" style={{ marginTop: 14 }}>
            <label>{t('linkedSuppliers')} <span className="hint-inline">({t('sameCategoryOnly')})</span></label>
            {catSuppliers.length === 0 ? (
              <div className="hint-inline" style={{ padding: '10px 0' }}>{t('noSuppliersInCat')}</div>
            ) : (
              <div className="supplier-links">
                {catSuppliers.map((s) => {
                  const link = form.supplier_links.find((l) => l.supplier_id === s.id)
                  return (
                    <div className={`supplier-link ${link ? 'on' : ''}`} key={s.id}>
                      <label className="check-row" style={{ padding: 0, flex: 1 }}>
                        <input type="checkbox" checked={!!link} onChange={() => toggleSupplier(s.id)} />
                        {s.supplier_name}
                      </label>
                      {link && (
                        <input type="number" dir="ltr" placeholder={t('supplierPrice')}
                          value={link.cost_price}
                          onChange={(e) => setLinkPrice(s.id, e.target.value)}
                          style={{ width: 120 }} />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="save-btn" onClick={save}>{t('save')}</button>
          </div>
        </Modal>
      )}

      {del && <ConfirmDelete onCancel={() => setDel(null)} onConfirm={() => removeItem(del)} />}
    </div>
  )
}
