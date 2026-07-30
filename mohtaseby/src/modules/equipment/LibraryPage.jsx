import { useEffect, useState, Fragment } from 'react'
import { BlurInput } from '../../components/BlurInput.jsx'
import DebInput from '../../components/DebInput.jsx'
import { debSave } from '../../lib/debounce.js'
import { useLang } from '../../lib/i18n.jsx'
import { listRows, insertRow, updateRow, deleteRow } from '../../lib/db.js'
import { fmt } from '../../lib/tafqeet.js'
import { ConfirmDelete, EmptyState } from '../../components/ui.jsx'

export default function LibraryPage() {
  const { t } = useLang()
  const [mains, setMains] = useState([])
  const [subs, setSubs] = useState([])
  const [prices, setPrices] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [supplierMains, setSupplierMains] = useState([])
  const [units, setUnits] = useState([])
  const [sel, setSel] = useState('')          // البند الأساسي المختار
  const [del, setDel] = useState(null)        // {type, id}

  const load = async () => {
    const m = await listRows('library_main'); setMains(m)
    setSubs(await listRows('library_sub'))
    setPrices(await listRows('sub_supplier_prices', 'id'))
    setSupplierMains(await listRows('supplier_main_items', 'id'))
    if (!sel && m[0]) setSel(m[0].id)
  }
  useEffect(() => {
    load()
    listRows('suppliers').then(setSuppliers)
    import('../../lib/db.js').then((d) => d.listUnits().then(setUnits))
  }, [])

  const addMain = async () => {
    const name = prompt(t('mainItemName'))
    if (!name?.trim()) return
    const r = await insertRow('library_main', { name: name.trim() })
    setSel(r.id); load()
  }
  const addSub = async () => {
    if (!sel) return
    await insertRow('library_sub', { main_id: sel, name: '', unit: units[0]?.name_ar || 'باليوم', client_price: 0, notes: '' })
    load()
  }
  const patchSub = (id, k, v) => {
    setSubs((p) => p.map((x) => x.id === id ? { ...x, [k]: v } : x))
    debSave('library_sub', id, { [k]: v })
  }

  // موردو البند الأساسي المختار
  const mainSuppliers = suppliers.filter((s) => supplierMains.some((x) => x.main_id === sel && x.supplier_id === s.id))
  const priceOf = (subId, supId) => prices.find((p) => p.sub_id === subId && p.supplier_id === supId)
  const setPrice = async (subId, supId, field, v) => {
    const ex = priceOf(subId, supId)
    if (ex) {
      await updateRow('sub_supplier_prices', ex.id, { [field]: +v || 0 })
      setPrices((p) => p.map((x) => x.id === ex.id ? { ...x, [field]: +v || 0 } : x))
    } else {
      const created = await insertRow('sub_supplier_prices', { sub_id: subId, supplier_id: supId, cost_price: 0, sell_price: 0, [field]: +v || 0 })
      setPrices((p) => [...p, created])
    }
  }

  const selSubs = subs.filter((x) => x.main_id === sel)

  return (
    <div>
      <h1 className="page-title">{t('equipment')}</h1>
      <p className="page-sub">{t('librarySub')}</p>

      <div className="tabs" style={{ flexWrap: 'wrap' }}>
        {mains.map((m) => (
          <button key={m.id} className={sel === m.id ? 'active' : ''} onClick={() => setSel(m.id)}>
            {m.name}
            {sel === m.id && (
              <span className="icon-btn" style={{ fontSize: 11, marginInlineStart: 6 }}
                onClick={(e) => { e.stopPropagation(); setDel({ type: 'library_main', id: m.id }) }}>✕</span>
            )}
          </button>
        ))}
        <button onClick={addMain} style={{ color: 'var(--brand)' }}>＋ {t('addMainItem')}</button>
      </div>

      {!sel ? <EmptyState /> : (
        <>
          <div className="toolbar">
            <button className="add-btn" onClick={addSub}>+ {t('addSubItemLib')}</button>
            <span className="hint-inline">
              {mainSuppliers.length
                ? `${t('linkedSuppliers')}: ${mainSuppliers.map((s) => s.supplier_name).join(' · ')}`
                : t('noSuppliersForMain')}
            </span>
          </div>
          <p className="hint-inline" style={{ marginBottom: 8 }}>{t('perSupplierPricingHint')}</p>

          {selSubs.length === 0 ? <EmptyState /> : (
            <div className="quote-scroll">
              <table className="quote-table costs-table">
                <thead><tr>
                  <th style={{ minWidth: 170 }}>{t('subItemName')}</th>
                  <th>{t('defaultUnit')}</th>
                  {mainSuppliers.map((s) => (
                    <th key={s.id} colSpan={2}>{s.supplier_name}</th>
                  ))}
                  <th>{t('notes')}</th><th></th>
                </tr></thead>
                <tr className="sub-head">
                  <th></th><th></th>
                  {mainSuppliers.map((s) => (
                    <Fragment key={s.id}>
                      <th style={{ fontSize: 11 }}>{t('cost_')}</th>
                      <th style={{ fontSize: 11 }}>{t('supplierSellCol')}</th>
                    </Fragment>
                  ))}
                  <th></th><th></th>
                </tr>
                <tbody>
                  {selSubs.map((r) => (
                    <tr key={r.id}>
                      <td><BlurInput value={r.name} placeholder="شاشة تاتش / P2 / P3..."
                        onCommit={(v) => patchSub(r.id, 'name', v)} /></td>
                      <td>
                        <select value={r.unit || ''} onChange={(e) => patchSub(r.id, 'unit', e.target.value)}>
                          {units.map((u) => <option key={u.id} value={u.name_ar}>{u.name_ar}</option>)}
                        </select>
                      </td>
                      {mainSuppliers.map((s) => (
                        <Fragment key={s.id}>
                          <td>
                            <BlurInput className="num" type="number" min="0"
                              value={priceOf(r.id, s.id)?.cost_price ?? ''}
                              placeholder="—"
                              onCommit={(v) => setPrice(r.id, s.id, 'cost_price', v)} />
                          </td>
                          <td>
                            <BlurInput className="num" type="number" min="0"
                              value={priceOf(r.id, s.id)?.sell_price ?? ''}
                              placeholder="—"
                              onCommit={(v) => setPrice(r.id, s.id, 'sell_price', v)} />
                          </td>
                        </Fragment>
                      ))}
                      <td><BlurInput value={r.notes || ''} onCommit={(v) => patchSub(r.id, 'notes', v)} /></td>
                      <td><button className="icon-btn" onClick={() => setDel({ type: 'library_sub', id: r.id })}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {del && <ConfirmDelete onCancel={() => setDel(null)}
        onConfirm={async () => {
          await deleteRow(del.type, del.id)
          if (del.type === 'library_main' && sel === del.id) setSel('')
          setDel(null); load()
        }} />}
    </div>
  )
}
