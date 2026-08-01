import { useEffect, useMemo, useRef, useState } from 'react'
import { debSave } from '../../lib/debounce.js'
import { useLang } from '../../lib/i18n.jsx'
import { listRows, insertRow, updateRow, deleteRow } from '../../lib/db.js'
import { fmt } from '../../lib/tafqeet.js'
import { Modal, ConfirmDelete, EmptyState } from '../../components/ui.jsx'
import { BlurInput } from '../../components/BlurInput.jsx'
import ChatIdField from '../../components/ChatIdField.jsx'

const genBarcode = () => 'IDEA' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase()

const STATUS = {
  available: { key: 'stAvailable', color: '#0F6E56', bg: '#E1F5EE' },
  out: { key: 'stOut', color: '#B05E0B', bg: '#FAEEDA' },
  maintenance: { key: 'stMaintenance', color: '#1D6FB8', bg: '#E3ECFA' },
  damaged: { key: 'stDamaged', color: '#A32D2D', bg: '#FDECEC' },
}

export default function InventoryPage() {
  const { t } = useLang()
  const [items, setItems] = useState([])
  const [units, setUnits] = useState([])
  const [movements, setMovements] = useState([])
  const [conferences, setConferences] = useState([])
  const [sel, setSel] = useState('')
  const [del, setDel] = useState(null)
  const [scan, setScan] = useState(false)
  const [scanned, setScanned] = useState(null)   // وحدة تم مسحها
  const [lenMove, setLenMove] = useState(null)   // حركة أمتار
  const [tab, setTab] = useState('stock')        // stock | permits | dashboard
  const [permits, setPermits] = useState([])
  const [recipients, setRecipients] = useState([])
  const [employees, setEmployees] = useState([])
  const [permit, setPermit] = useState(null)     // إذن خروج جديد/مفتوح
  const [purchase, setPurchase] = useState(null) // إدخال مشتريات

  const load = async () => {
    const it = await listRows('inventory_items'); setItems(it)
    setUnits(await listRows('inventory_units'))
    setMovements(await listRows('stock_movements'))
    if (!sel && it[0]) setSel(it[0].id)
  }
  useEffect(() => {
    load()
    listRows('conferences').then(setConferences)
    listRows('exit_permits').then(setPermits)
    listRows('recipients').then(setRecipients)
    listRows('employees').then(setEmployees)
  }, [])
  const reloadPermits = async () => setPermits(await listRows('exit_permits'))

  const item = items.find((x) => x.id === sel)
  const itemUnits = units.filter((u) => u.item_id === sel)
  const itemMoves = movements.filter((m) => m.item_id === sel)

  const addItem = async (type) => {
    const name = prompt(t('invItemName'))
    if (!name?.trim()) return
    const r = await insertRow('inventory_items', {
      name: name.trim(), item_type: type,
      unit_label: type === 'length' ? t('metre') : t('piece'), length_balance: 0, notes: '',
    })
    setSel(r.id); load()
  }

  const addUnit = async () => setPurchase({
    item_id: sel || '', new_name: '', count: 1, serial: '', length_m: '',
    condition: 'new', brand: '', source: '', date: new Date().toISOString().slice(0, 10), note: '',
  })
  const doPurchase = async () => {
    let itemId = purchase.item_id
    if (!itemId) {
      if (!purchase.new_name?.trim()) return alert(t('required') + ': ' + t('invItemName'))
      const r = await insertRow('inventory_items', { name: purchase.new_name.trim(), item_type: 'unit', unit_label: t('piece'), length_balance: 0, notes: '' })
      itemId = r.id
    }
    const n = Math.max(1, Math.min(500, +purchase.count || 1))
    const hasSerial = !!purchase.serial?.trim()
    if (hasSerial) {
      // بسيريال: كل قطعة صف مستقل بسيريال مميز وباركود خاص
      for (let k = 0; k < n; k++) {
        await insertRow('inventory_units', {
          item_id: itemId, barcode: genBarcode(),
          serial: n === 1 ? purchase.serial : `${purchase.serial}-${k + 1}`,
          length_m: +purchase.length_m || null, condition: purchase.condition || 'new',
          qty: 1, status: 'available', conference_id: null, brand: purchase.brand || '',
          source: purchase.source || '', purchase_date: purchase.date || null, notes: purchase.note || '',
        })
      }
    } else {
      // بدون سيريال: القطع المتطابقة (نفس الطول والحالة) تحت باركود واحد بعمود "عدد"
      await insertRow('inventory_units', {
        item_id: itemId, barcode: genBarcode(), serial: '',
        length_m: +purchase.length_m || null, condition: purchase.condition || 'new',
        qty: n, status: 'available', conference_id: null, brand: purchase.brand || '',
        source: purchase.source || '', purchase_date: purchase.date || null, notes: purchase.note || '',
      })
    }
    await insertRow('stock_movements', { item_id: itemId, movement: 'add', qty: n, mv_date: purchase.date, notes: `مشتريات — المصدر: ${purchase.source || '—'}` })
    setSel(itemId); setPurchase(null); load()
  }
  const patchUnit = (id, patch) => {
    setUnits((p) => p.map((x) => x.id === id ? { ...x, ...patch } : x))
    debSave('inventory_units', id, patch)
  }

  // حركات الأمتار للكابلات
  const doLenMove = async () => {
    const qty = +lenMove.qty || 0
    if (!qty) return
    const dir = lenMove.movement === 'add' || lenMove.movement === 'return' ? 1 : -1
    await insertRow('stock_movements', {
      item_id: sel, conference_id: lenMove.conference_id || null,
      movement: lenMove.movement, qty, mv_date: new Date().toISOString().slice(0, 10), notes: lenMove.notes || '',
    })
    await updateRow('inventory_items', sel, { length_balance: (+item.length_balance || 0) + dir * qty })
    setLenMove(null); load()
  }

  // المسح بالكاميرا
  const scannerRef = useRef(null)
  useEffect(() => {
    if (!scan) return
    let scanner
    import('html5-qrcode').then(({ Html5Qrcode }) => {
      scanner = new Html5Qrcode('scan-box')
      scannerRef.current = scanner
      scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 140 } },
        (text) => {
          const u = units.find((x) => x.barcode === text)
          scanner.stop().catch(() => {})
          setScan(false)
          if (u) { setSel(u.item_id); setScanned(u) }
          else alert(t('barcodeNotFound') + ': ' + text)
        }, () => {})
    }).catch((e) => { alert(e.message); setScan(false) })
    return () => { scannerRef.current?.stop().catch(() => {}) }
  }, [scan])

  // طباعة ملصقات الباركود
  const printLabels = async () => {
    const JsBarcode = (await import('jsbarcode')).default
    const w = window.open('', '_blank')
    w.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>
      body{font-family:sans-serif;display:flex;flex-wrap:wrap;gap:8mm;padding:8mm}
      .lbl{border:1px dashed #999;padding:4mm;text-align:center;page-break-inside:avoid}
      .lbl b{font-size:11px;display:block;margin-bottom:2mm}</style></head><body>
      ${itemUnits.map((u) => `<div class="lbl"><b>${item.name}${u.serial ? ' — ' + u.serial : ''}${!u.serial && u.qty > 1 ? ' ×' + u.qty : ''}</b><svg class="bc" data-code="${u.barcode}"></svg></div>`).join('')}
      </body></html>`)
    w.document.close()
    w.document.querySelectorAll('.bc').forEach((el) => JsBarcode(el, el.dataset.code, { format: 'CODE128', width: 1.6, height: 44, fontSize: 11 }))
    setTimeout(() => w.print(), 400)
  }

  const confName = (id) => conferences.find((c) => c.id === id)?.name || '—'

  return (
    <div>
      <h1 className="page-title">📦 {t('inventory')}</h1>
      <p className="page-sub">{t('inventorySub')}</p>

      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <button className="add-btn" onClick={() => setPurchase({
          item_id: sel || '', new_name: '', count: 1, serial: '', length_m: '',
          condition: 'new', source: '', date: new Date().toISOString().slice(0, 10), note: '',
        })}>+ {t('addStockEntry')}</button>
        <div style={{ flex: 1 }} />
        <button className="save-btn" style={{ padding: '9px 18px', fontSize: 14 }} onClick={() => setScan(true)}>📷 {t('scanBarcode')}</button>
      </div>

      <div className="tabs">
        <button className={tab === 'stock' ? 'active' : ''} onClick={() => setTab('stock')}>📦 {t('stockTab')}</button>
        <button className={tab === 'permits' ? 'active' : ''} onClick={() => setTab('permits')}>📤 {t('permitsTab')} ({permits.filter((p) => p.status === 'open').length})</button>
        <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>📊 {t('invDashboard')}</button>
        <button className={tab === 'summary' ? 'active' : ''} onClick={() => setTab('summary')}>📋 {t('invSummary')}</button>
        <button className={tab === 'recipients' ? 'active' : ''} onClick={() => setTab('recipients')}>👤 {t('recipientsTab')} ({recipients.length})</button>
      </div>

      {tab === 'permits' && <PermitsTab {...{ t, permits, recipients, employees, conferences, units, items, reloadPermits, load, setPermit, permit }} />}
      {tab === 'dashboard' && <InvDashboard {...{ t, units, items, permits, recipients, conferences }} />}
      {tab === 'summary' && <InvSummary {...{ t, units, items }} />}
      {tab === 'recipients' && <RecipientsTab recipients={recipients} reload={async () => setRecipients(await listRows('recipients'))} />}

      {tab === 'stock' && <>
      <div className="tabs" style={{ flexWrap: 'wrap' }}>
        {items.map((x) => (
          <button key={x.id} className={sel === x.id ? 'active' : ''} onClick={() => setSel(x.id)}>
            {x.item_type === 'length' ? '〰️' : '🔖'} {x.name}
            {sel === x.id && <span className="icon-btn" style={{ fontSize: 11, marginInlineStart: 6 }}
              onClick={(e) => { e.stopPropagation(); setDel(x.id) }}>✕</span>}
          </button>
        ))}
      </div>

      {item && (
        <div className="field" style={{ maxWidth: 520, marginBottom: 12 }}>
          <BlurInput placeholder={t('specsHint')} value={item.specs || ''}
            onCommit={async (v) => { await updateRow('inventory_items', item.id, { specs: v }); load() }} />
        </div>
      )}
      {!item ? <EmptyState /> : item.item_type === 'unit' ? (
        <>
          <div className="toolbar">
            <button className="add-btn" onClick={addUnit}>+ {t('addPiece')}</button>
            {itemUnits.length > 0 && <button className="mini-btn" onClick={printLabels}>🖨 {t('printLabels')}</button>}
            <span className="hint-inline">
              {Object.entries(STATUS).map(([k, v]) => {
                const n = itemUnits.filter((u) => u.status === k).length
                return n ? `${t(v.key)}: ${n}  ` : ''
              })}
            </span>
          </div>
          {itemUnits.length === 0 ? <EmptyState /> : (
            <div className="quote-scroll">
              <table className="quote-table costs-table">
                <thead><tr><th>{t('barcode')}</th><th>{t('serial')}</th><th>{t('countLbl')}</th><th>{t('cableLength')}</th><th>{t('conditionLbl')}</th><th>{t('status')}</th><th>{t('conferences')}</th><th>{t('notes')}</th><th></th></tr></thead>
                <tbody>
                  {itemUnits.map((u) => (
                    <tr key={u.id}>
                      <td dir="ltr" style={{ fontFamily: 'monospace', fontSize: 12 }}>{u.barcode}</td>
                      <td><input dir="ltr" value={u.serial || ''} onChange={(e) => patchUnit(u.id, { serial: e.target.value })} /></td>
                      <td>
                        {u.serial ? 1 : (
                          <input className="num" type="number" min="1" value={u.qty ?? 1}
                            onChange={(e) => patchUnit(u.id, { qty: Math.max(1, +e.target.value || 1) })} />
                        )}
                      </td>
                      <td><input className="num" type="number" dir="ltr" placeholder="—" value={u.length_m ?? ''}
                        onChange={(e) => patchUnit(u.id, { length_m: e.target.value === '' ? null : +e.target.value })} /></td>
                      <td>
                        <select value={u.condition || 'new'} onChange={(e) => patchUnit(u.id, { condition: e.target.value })}>
                          <option value="new">{t('condNew')}</option>
                          <option value="used">{t('condUsed')}</option>
                        </select>
                      </td>
                      <td>
                        <select value={u.status} style={{ color: STATUS[u.status]?.color, fontWeight: 600 }}
                          onChange={(e) => {
                            const v = e.target.value
                            const extra = v === 'damaged' ? { damage_reason: prompt(t('damageReason')) || '' } : {}
                            patchUnit(u.id, { status: v, ...extra, ...(v !== 'out' ? { conference_id: null } : {}) })
                          }}>
                          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{t(v.key)}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={u.conference_id || ''} disabled={u.status !== 'out'}
                          onChange={(e) => patchUnit(u.id, { conference_id: e.target.value || null })}>
                          <option value="">—</option>
                          {conferences.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </td>
                      <td><input value={u.notes || ''} onChange={(e) => patchUnit(u.id, { notes: e.target.value })} /></td>
                      <td><button className="icon-btn" onClick={async () => { await deleteRow('inventory_units', u.id); load() }}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="kpi-row">
            <div className="kpi big"><span>{t('lengthBalance')}</span>
              <b style={{ color: (+item.length_balance || 0) > 0 ? '#0F6E56' : '#A32D2D' }}>{fmt(item.length_balance)} {item.unit_label}</b></div>
          </div>
          <div className="toolbar">
            <button className="add-btn" onClick={() => setLenMove({ movement: 'add', qty: '', conference_id: '', notes: '' })}>+ {t('mvAdd')}</button>
            <button className="add-btn" onClick={() => setLenMove({ movement: 'out', qty: '', conference_id: conferences[0]?.id || '', notes: '' })}>⬆ {t('mvOut')}</button>
            <button className="add-btn" onClick={() => setLenMove({ movement: 'return', qty: '', conference_id: conferences[0]?.id || '', notes: '' })}>⬇ {t('mvReturn')}</button>
          </div>
          {itemMoves.length === 0 ? <EmptyState /> : (
            <div className="quote-scroll">
              <table className="quote-table">
                <thead><tr><th>{t('receiptDate')}</th><th>{t('type')}</th><th>{t('quantity')}</th><th>{t('conferences')}</th><th>{t('notes')}</th></tr></thead>
                <tbody>
                  {itemMoves.map((m) => (
                    <tr key={m.id}>
                      <td>{m.mv_date}</td>
                      <td>{m.movement === 'add' ? t('mvAdd') : m.movement === 'out' ? t('mvOut') : t('mvReturn')}</td>
                      <td>{fmt(m.qty)} {item.unit_label}</td>
                      <td>{confName(m.conference_id)}</td>
                      <td>{m.notes || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      </>}

      {/* مودال حركة الأمتار */}
      {lenMove && (
        <Modal title={lenMove.movement === 'add' ? t('mvAdd') : lenMove.movement === 'out' ? t('mvOut') : t('mvReturn')} onClose={() => setLenMove(null)}>
          <div className="grid2">
            <div className="field"><label>{t('quantity')} ({item.unit_label})</label>
              <input type="number" dir="ltr" min="0" autoFocus value={lenMove.qty}
                onChange={(e) => setLenMove((p) => ({ ...p, qty: e.target.value }))} /></div>
            {lenMove.movement !== 'add' && (
              <div className="field"><label>{t('conferences')}</label>
                <select value={lenMove.conference_id} onChange={(e) => setLenMove((p) => ({ ...p, conference_id: e.target.value }))}>
                  <option value="">—</option>
                  {conferences.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
            )}
            <div className="field" style={{ gridColumn: '1 / -1' }}><label>{t('notes')}</label>
              <input value={lenMove.notes} onChange={(e) => setLenMove((p) => ({ ...p, notes: e.target.value }))} /></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="save-btn" onClick={doLenMove}>{t('save')}</button>
          </div>
        </Modal>
      )}

      {purchase && (
        <Modal title={`＋ ${t('addStockEntry')}`} onClose={() => setPurchase(null)}>
          <div className="grid2">
            <div className="field"><label>{t('invItemName')} *</label>
              <select value={purchase.item_id} onChange={(e) => setPurchase((p) => ({ ...p, item_id: e.target.value }))}>
                <option value="">＋ {t('newItemOption')}</option>
                {items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              {!purchase.item_id && (
                <input style={{ marginTop: 6 }} placeholder={t('invItemName')} autoFocus
                  value={purchase.new_name} onChange={(e) => setPurchase((p) => ({ ...p, new_name: e.target.value }))} />
              )}
            </div>
            <div className="field"><label>{t('brand')}</label>
              <input list="brand-list" value={purchase.brand || ''} placeholder={t('brandHint')}
                onChange={(e) => setPurchase((p) => ({ ...p, brand: e.target.value }))} />
              <datalist id="brand-list">
                {[...new Set(units.map((u) => u.brand).filter(Boolean))].map((b, i) => <option key={i} value={b} />)}
              </datalist>
            </div>
            <div className="field"><label>{t('serial')}</label>
              <input dir="ltr" value={purchase.serial} onChange={(e) => setPurchase((p) => ({ ...p, serial: e.target.value }))} /></div>
            <div className="field"><label>{t('countLbl')}</label>
              <input type="number" dir="ltr" min="1" max="100" value={purchase.count}
                onChange={(e) => setPurchase((p) => ({ ...p, count: e.target.value }))} /></div>
            <div className="field"><label>{t('cableLength')}</label>
              <input type="number" dir="ltr" min="0" placeholder="—" value={purchase.length_m}
                onChange={(e) => setPurchase((p) => ({ ...p, length_m: e.target.value }))} /></div>
            <div className="field"><label>{t('conditionLbl')}</label>
              <div className="seg">
                <button type="button" className={purchase.condition === 'new' ? 'active' : ''}
                  onClick={() => setPurchase((p) => ({ ...p, condition: 'new' }))}>{t('condNew')}</button>
                <button type="button" className={purchase.condition === 'used' ? 'active' : ''}
                  onClick={() => setPurchase((p) => ({ ...p, condition: 'used' }))}>{t('condUsed')}</button>
              </div></div>
            <div className="field"><label>{t('sourceLbl')}</label>
              <input value={purchase.source} onChange={(e) => setPurchase((p) => ({ ...p, source: e.target.value }))}
                placeholder={t('phSource')} /></div>
            <div className="field"><label>{t('receiptDate')}</label>
              <input type="date" value={purchase.date} onChange={(e) => setPurchase((p) => ({ ...p, date: e.target.value }))} /></div>
            <div className="field"><label>{t('notes')}</label>
              <input value={purchase.note} onChange={(e) => setPurchase((p) => ({ ...p, note: e.target.value }))} /></div>
          </div>
          <p className="hint-inline">{t('batchHint')}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="save-btn" onClick={doPurchase}>{t('save')}</button>
          </div>
        </Modal>
      )}

      {/* مودال المسح بالكاميرا */}
      {scan && (
        <Modal title={`📷 ${t('scanBarcode')}`} onClose={() => { scannerRef.current?.stop().catch(() => {}); setScan(false) }}>
          <div id="scan-box" style={{ width: '100%' }} />
          <p className="hint-inline" style={{ textAlign: 'center' }}>{t('scanHint')}</p>
        </Modal>
      )}

      {/* نتيجة المسح: بطاقة القطعة بإجراءات سريعة */}
      {scanned && (() => {
        const u = units.find((x) => x.id === scanned.id) || scanned
        const it = items.find((x) => x.id === u.item_id)
        return (
          <Modal title={`🔖 ${it?.name || ''}`} onClose={() => setScanned(null)}>
            <div className="entity-meta" style={{ fontSize: 14 }}>
              <span dir="ltr" style={{ fontFamily: 'monospace' }}>{u.barcode}</span>
              {u.serial && <span>{t('serial')}: <span dir="ltr">{u.serial}</span></span>}
              <span>{t('status')}: <b style={{ color: STATUS[u.status]?.color }}>{t(STATUS[u.status]?.key)}</b>
                {u.status === 'out' && ` — ${confName(u.conference_id)}`}</span>
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label>{t('quickActions')}</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {u.status !== 'out' && conferences.length > 0 && (
                  <select onChange={async (e) => {
                    if (!e.target.value) return
                    await patchUnit(u.id, { status: 'out', conference_id: e.target.value })
                    setScanned({ ...u, status: 'out', conference_id: e.target.value })
                  }} defaultValue="">
                    <option value="">📤 {t('mvOut')}...</option>
                    {conferences.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
                {u.status === 'out' && (
                  <button className="mini-btn ok" onClick={async () => {
                    await patchUnit(u.id, { status: 'available', conference_id: null })
                    setScanned({ ...u, status: 'available', conference_id: null })
                  }}>⬇ {t('mvReturn')}</button>
                )}
                <button className="mini-btn" onClick={async () => {
                  await patchUnit(u.id, { status: 'maintenance', conference_id: null })
                  setScanned({ ...u, status: 'maintenance' })
                }}>🔧 {t(STATUS.maintenance.key)}</button>
              </div>
            </div>
          </Modal>
        )
      })()}

      {del && <ConfirmDelete onCancel={() => setDel(null)}
        onConfirm={async () => { await deleteRow('inventory_items', del); if (sel === del) setSel(''); setDel(null); load() }} />}
    </div>
  )
}

// ==================== أذون الخروج ====================
function PermitsTab({ t, permits, recipients, employees, conferences, units, items, reloadPermits, load, setPermit, permit }) {
  const [tgChats, setTgChats] = useState(null)
  const open = permits.filter((p) => p.status === 'open')
  const closed = permits.filter((p) => p.status !== 'open')
  const permitUnits = (pid) => units.filter((u) => u.permit_id === pid)
  const itemName = (id) => items.find((x) => x.id === id)?.name || ''

  const newPermit = () => setPermit({
    recipient_id: '', recipient_new: '', exit_type: 'conference', conference_id: '',
    employee_id: '', exit_date: new Date().toISOString().slice(0, 10), expected_return: '',
    unit_ids: [], item_notes: {}, notes: '',
  })

  const [returnModal, setReturnModal] = useState(null)   // { permit, drafts: [{unitId, qty, returnQty, damaged}] }

  // إيجاد صف "متاح" آخر بنفس خصائص القطعة (لدمج الكمية المرتجعة فيه بدل تكرار الصفوف)
  const findMatchingAvailable = (allUnits, u) => allUnits.find((x) =>
    x.id !== u.id && x.status === 'available' && x.item_id === u.item_id &&
    (x.length_m || null) === (u.length_m || null) && (x.serial || '') === (u.serial || '') &&
    (x.condition || 'new') === (u.condition || 'new') && (x.brand || '') === (u.brand || ''))

  const openReturnModal = (p) => {
    const us = permitUnits(p.id)
    setReturnModal({
      permit: p,
      drafts: us.map((u) => ({ unitId: u.id, name: itemName(u.item_id) + (u.length_m ? ` (${u.length_m} م)` : ''), max: u.qty || 1, goodQty: u.qty || 1, damagedQty: 0 })),
    })
  }

  const confirmReturn = async () => {
    const { permit: p, drafts } = returnModal
    const allUnits = await listRows('inventory_units')
    for (const d of drafts) {
      const u = allUnits.find((x) => x.id === d.unitId)
      if (!u) continue
      const full = u.qty || 1
      const back = Math.max(0, Math.min(+d.goodQty || 0, full))
      const damagedQty = Math.max(0, Math.min(+d.damagedQty || 0, full - back))

      if (back === 0 && damagedQty >= full) {
        // الكل تالف/مفقود بالكامل: يبقى مسجلاً كتالف، لا يُضاف للرصيد المتاح
        await updateRow('inventory_units', u.id, { lost_or_damaged: true, status: 'damaged', permit_id: null, conference_id: null })
        continue
      }
      if (back > 0) {
        const match = findMatchingAvailable(allUnits, u)
        if (match) {
          // دمج الكمية السليمة المرتجعة مع صف متاح مطابق بدل تكرار صف جديد
          await updateRow('inventory_units', match.id, { qty: (match.qty || 1) + back })
          if (damagedQty > 0) {
            await updateRow('inventory_units', u.id, { qty: damagedQty, status: 'damaged', lost_or_damaged: true, permit_id: null, conference_id: null })
          } else {
            await deleteRow('inventory_units', u.id)
          }
        } else if (damagedQty > 0) {
          // جزء رجع سليماً وجزء تالف: قسّم الصف لاثنين
          await updateRow('inventory_units', u.id, { qty: back, status: 'available', permit_id: null, conference_id: null })
          await insertRow('inventory_units', {
            item_id: u.item_id, barcode: u.barcode + '-DMG' + Date.now().toString(36).slice(-4),
            serial: u.serial || '', length_m: u.length_m || null, condition: u.condition || 'new',
            qty: damagedQty, status: 'damaged', lost_or_damaged: true, brand: u.brand || '',
            source: u.source || '', purchase_date: u.purchase_date || null, notes: u.notes || '',
          })
        } else {
          await updateRow('inventory_units', u.id, { status: 'available', conference_id: null, permit_id: null })
        }
      } else if (damagedQty > 0) {
        // كله بقي تالف جزئياً (نادر: back=0 لكن damagedQty < full يعني الباقي غير محسوب - نتعامل معه كتالف كامل احتياطاً)
        await updateRow('inventory_units', u.id, { qty: full, status: 'damaged', lost_or_damaged: true, permit_id: null, conference_id: null })
      }
    }
    await updateRow('exit_permits', p.id, { status: 'closed' })
    setReturnModal(null); reloadPermits(); load()
  }

  const closePermit = (p) => openReturnModal(p)

  const Card = ({ p }) => {
    const us = permitUnits(p.id)
    const rec = recipients.find((r) => r.id === p.recipient_id)
    const emp = employees.find((e) => e.id === p.employee_id)
    const overdue = p.status === 'open' && p.expected_return && new Date(p.expected_return) < new Date()
    return (
      <div className="entity-card" style={overdue ? { borderColor: '#F0C5C5', background: '#FDF7F7' } : {}}>
        <div className="entity-head">
          <b>📤 #{p.permit_number} — {rec?.name || '—'} {rec?.phone && <small dir="ltr" style={{ color: '#888' }}>({rec.phone})</small>}</b>
          <span className={`badge ${p.status === 'open' ? (overdue ? 'warn' : '') : 'ok'}`}>
            {p.status === 'open' ? (overdue ? t('overdue') : t('permitOpen')) : t('permitClosed')}
          </span>
        </div>
        <div className="entity-meta">
          <span>{t(p.exit_type === 'rent' ? 'exitRent' : p.exit_type === 'internal' ? 'exitInternal' : 'conferences')}
            {p.conference_id ? ` — ${conferences.find((c) => c.id === p.conference_id)?.name || ''}` : ''}</span>
          <span>📅 {p.exit_date} {p.expected_return ? `← ${t('expectedReturn')}: ${p.expected_return}` : ''}</span>
          {emp && <span>👤 {t('responsibleEmp')}: {emp.name}</span>}
          <span>{us.map((u) => itemName(u.item_id)).join(' · ') || '—'} ({us.length})</span>
        </div>
        <div className="entity-actions">
          {p.status === 'open' && <button onClick={() => setPermit({ ...p, recipient_new: '', unit_ids: us.map((u) => u.id) })}>{t('edit')}</button>}
          {p.status === 'open' && <button className="convert" onClick={() => closePermit(p)}>⬇ {t('returnAll')}</button>}
          <button onClick={() => printPermit(p, us)}>🖨 PDF</button>
          <button className="danger" onClick={async () => {
            if (!confirm(t('confirmDelete'))) return
            if (p.status === 'open') {
              for (const u of units.filter((x) => x.permit_id === p.id)) {
                await updateRow('inventory_units', u.id, { status: 'available', conference_id: null, permit_id: null })
              }
            }
            await deleteRow('exit_permits', p.id)
            reloadPermits(); load()
          }}>{t('delete')}</button>
          <button onClick={async () => {
            const txt = prompt(t('msgToRecipient'), `تنبيه: تأخرت عن موعد تسليم معدات إذن خروج #${p.permit_number} — برجاء الإرجاع في أقرب وقت.`)
            if (!txt) return
            const { loadSettings } = await import('../../lib/supabase.js')
            const st = await loadSettings()
            if (!rec?.telegram_chat_id && !rec?.whatsapp_number && !rec?.phone) {
              return alert(t('noContactMethod'))
            }
            try {
              const { sendMessage } = await import('../../lib/messaging.js')
              const results = await sendMessage(st, rec, '📢 ' + txt)
              const ok = results.filter((r) => r.ok).map((r) => r.ch).join(', ')
              const failed = results.filter((r) => !r.ok)
              alert((ok ? `✓ ${t('sentTo')} ${rec.name} (${ok})` : '') + (failed.length ? '\n⚠ ' + failed.map((f) => f.error).join(' — ') : ''))
            } catch (e) { alert(e.message) }
          }}>📨 {t('msgRecipientBtn')}{!rec?.telegram_chat_id && !rec?.whatsapp_number && ' ⚠️'}</button>
          {emp?.telegram_chat_id && (
            <button onClick={async () => {
              const { tgSend } = await import('../../lib/telegram.js')
              const { loadSettings } = await import('../../lib/supabase.js')
              const st = await loadSettings()
              const msg = `📤 <b>إذن خروج #${p.permit_number}</b>\nالمستلم: ${rec?.name || '—'}\nالتاريخ: ${p.exit_date}${p.expected_return ? '\nالإرجاع المتوقع: ' + p.expected_return : ''}\n\nالمعدات:\n${us.map((u) => '• ' + itemName(u.item_id) + ' (' + u.barcode + ')').join('\n')}\n\nأنت المسؤول عن هذا التسليم.`
              try { await tgSend(st?.telegram_bot_token, emp.telegram_chat_id, msg); alert('✓ ' + t('sentTo') + ' ' + emp.name) }
              catch (e) { alert(e.message) }
            }}>📨 TG</button>
          )}
        </div>
      </div>
    )
  }

  const printPermit = async (p, us) => {
    const { printHtml } = await import('../exports/exportQuote.js')
    const { loadSettings } = await import('../../lib/supabase.js')
    const st = await loadSettings()
    const rec = recipients.find((r) => r.id === p.recipient_id)
    let body = `<h1>إذن خروج معدات — رقم ${p.permit_number}</h1>
      <div class="head-grid">
        <div><b>المستلم:</b> ${rec?.name || ''} ${rec?.phone ? '— ' + rec.phone : ''}</div>
        <div><b>الجهة:</b> ${rec?.company || '—'}</div>
        <div><b>التاريخ:</b> ${p.exit_date}</div>
        <div><b>الإرجاع المتوقع:</b> ${p.expected_return || '—'}</div>
      </div>
      <table><thead><tr><th>#</th><th>الصنف</th><th>الباركود</th><th>السيريال</th></tr></thead><tbody>`
    us.forEach((u, i) => { body += `<tr><td>${i + 1}</td><td style="text-align:start">${itemName(u.item_id)}</td><td dir="ltr">${u.barcode}</td><td dir="ltr">${u.serial || ''}</td></tr>` })
    body += `</tbody></table>
      <div class="sig-row" style="margin-top:14mm"><div>توقيع المستلم: ..................</div><div>توقيع المسؤول: ..................</div></div>`
    printHtml({ title: `إذن خروج ${p.permit_number}`, bodyHtml: body, settings: st, letterhead: !!st?.letterhead_url, stamp: false, sign: false, preview: false })
  }

  if (permit) {
    return <PermitEditor {...{ t, permit, setPermit, recipients, employees, conferences, units, items, reloadPermits, load }} />
  }

  return (
    <div>
      <div className="toolbar">
        <button className="save-btn" onClick={newPermit}>+ {t('newPermit')}</button>
        <button className="mini-btn tg" onClick={async () => {
          try {
            const { tgGetChats } = await import('../../lib/telegram.js')
            const { loadSettings } = await import('../../lib/supabase.js')
            const st = await loadSettings()
            setTgChats(await tgGetChats(st?.telegram_bot_token))
          } catch (e) { alert(e.message) }
        }}>🤖 {t('linkRecipientsTg')}</button>
      </div>
      {tgChats && (
        <div className="card" style={{ padding: 14 }}>
          <h3 style={{ fontSize: 14 }}>{t('fetchTgUsers')}</h3>
          {tgChats.length === 0 ? <p className="hint-inline">{t('noTgUsers')}</p> : tgChats.map((c) => {
            const linked = recipients.find((r) => r.telegram_chat_id === c.id)
            return (
              <div className="manage-row" key={c.id}>
                <span><b>{c.name}</b> {c.username} <small className="hint-inline" dir="ltr">({c.id})</small>
                  {linked && <span className="badge ok" style={{ marginInlineStart: 8 }}>{linked.name} ✓</span>}</span>
                <select value={linked?.id || ''} style={{ maxWidth: 200 }} onChange={async (e) => {
                  if (!e.target.value) return
                  const { updateRow: up } = await import('../../lib/db.js')
                  await up('recipients', e.target.value, { telegram_chat_id: c.id })
                  load()
                }}>
                  <option value="">— {t('linkToRecipient')} —</option>
                  {recipients.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            )
          })}
        </div>
      )}
      {open.length === 0 && closed.length === 0 ? <EmptyState /> : (
        <div className="cards-grid">
          {open.map((p) => <Card p={p} key={p.id} />)}
          {closed.map((p) => <Card p={p} key={p.id} />)}
        </div>
      )}

      {returnModal && (
        <Modal title={`⬇ ${t('returnAll')} — #${returnModal.permit.permit_number}`} onClose={() => setReturnModal(null)}>
          <p className="hint-inline">{t('returnHint2')}</p>
          {returnModal.drafts.map((d, i) => {
            const sum = (+d.goodQty || 0) + (+d.damagedQty || 0)
            const mismatch = sum !== d.max
            const setField = (field, val) => setReturnModal((p) => ({
              ...p,
              drafts: p.drafts.map((x, j) => j === i ? { ...x, [field]: Math.max(0, Math.min(d.max, +val || 0)) } : x),
            }))
            return (
              <div className="return-row-v2" key={d.unitId}>
                <div className="return-name">{d.name} <span className="hint-inline">({t('totalOut')}: {d.max})</span></div>
                <div className="return-controls-v2">
                  <div className="return-field">
                    <label className="hint-inline">✅ {t('returnedQty')}</label>
                    <input type="number" className="qty-input" min="0" max={d.max} value={d.goodQty}
                      onChange={(e) => setField('goodQty', e.target.value)} />
                  </div>
                  <div className="return-field">
                    <label className="hint-inline" style={{ color: '#A32D2D' }}>🔴 {t('damagedOrLostQty')}</label>
                    <input type="number" className="qty-input" min="0" max={d.max} value={d.damagedQty}
                      onChange={(e) => setField('damagedQty', e.target.value)} />
                  </div>
                </div>
                {mismatch && <div className="hint-inline" style={{ color: '#B05E0B' }}>⚠ {t('qtyMismatchHint')} ({sum}/{d.max})</div>}
              </div>
            )
          })}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="save-btn" onClick={confirmReturn}>✓ {t('confirmReturn')}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function PermitEditor({ t, permit, setPermit, recipients, employees, conferences, units, items, reloadPermits, load }) {
  const set = (k, v) => setPermit((p) => ({ ...p, [k]: v }))
  const available = units.filter((u) => u.status === 'available')
  const itemName = (id) => items.find((x) => x.id === id)?.name || ''
  const [scanOn, setScanOn] = useState(false)
  const scRef = useRef(null)

  useEffect(() => {
    if (!scanOn) return
    let sc
    import('html5-qrcode').then(({ Html5Qrcode }) => {
      sc = new Html5Qrcode('permit-scan')
      scRef.current = sc
      sc.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 140 } }, (text) => {
        const u = units.find((x) => x.barcode === text)
        if (!u) return
        if (u.status !== 'available') return alert(t('pieceNotAvailable'))
        setPermit((p) => p.unit_ids.includes(u.id) ? p : { ...p, unit_ids: [...p.unit_ids, u.id] })
      }, () => {})
    })
    return () => { scRef.current?.stop().catch(() => {}) }
  }, [scanOn])

  const [confirmSummary, setConfirmSummary] = useState(false)

  const qtyOf = (uid) => {
    if (permit.partial_qty && permit.partial_qty[uid] !== undefined) return permit.partial_qty[uid]
    return units.find((x) => x.id === uid)?.qty || 1
  }

  const buildItemsSummary = () => {
    const grouped = {}
    for (const uid of permit.unit_ids) {
      const u = units.find((x) => x.id === uid)
      if (!u) continue
      const q = qtyOf(uid)
      if (q <= 0) continue
      const label = (items.find((i) => i.id === u.item_id)?.name || '') + (u.length_m ? ' (' + u.length_m + ' م)' : '')
      grouped[uid] = { name: label, qty: q, note: permit.item_notes?.[uid] || '' }
    }
    return Object.values(grouped)
  }

  const doSave = async () => {
    let recipient_id = permit.recipient_id || null
    if (!recipient_id && permit.recipient_new?.trim()) {
      const r = await insertRow('recipients', {
        name: permit.recipient_new.trim(), phone: permit.recipient_phone_new || '',
        telegram_chat_id: permit.recipient_tg_new || '', company: '', job_title: '',
      })
      recipient_id = r.id
    }
    const payload = {
      recipient_id, exit_type: permit.exit_type, conference_id: permit.conference_id || null,
      employee_id: permit.employee_id || null, exit_date: permit.exit_date,
      expected_return: permit.expected_return || null, item_notes: permit.item_notes || {}, notes: permit.notes || '',
    }
    let saved
    if (permit.id) {
      saved = await updateRow('exit_permits', permit.id, payload)
      for (const u of units.filter((x) => x.permit_id === permit.id && !permit.unit_ids.includes(x.id))) {
        await updateRow('inventory_units', u.id, { status: 'available', conference_id: null, permit_id: null })
      }
    } else {
      saved = await insertRow('exit_permits', { ...payload, status: 'open' })
      try {
        const { sendMessage } = await import('../../lib/messaging.js')
        const { loadSettings } = await import('../../lib/supabase.js')
        const st = await loadSettings()
        const rec = recipients.find((r) => r.id === recipient_id) || { telegram_chat_id: permit.recipient_tg_new, phone: permit.recipient_phone_new, name: permit.recipient_new }
        const emp = employees.find((e2) => e2.id === permit.employee_id)
        const itemsTxt = buildItemsSummary().map((g) => '• ' + g.name + ' ×' + g.qty + (g.note ? ' (' + g.note + ')' : '')).join('\n')
        if (permit.notify_recipient !== false) {
          await sendMessage(st, rec,
            '📤 إذن خروج #' + saved.permit_number + '\nالمعدات المستلمة:\n' + itemsTxt + '\n' + (permit.expected_return ? 'موعد الإرجاع المتوقع: ' + permit.expected_return : '')).catch(() => {})
        }
        if (permit.notify_employee !== false && emp) {
          await sendMessage(st, emp,
            '✅ تم توثيق إذن خروج #' + saved.permit_number + ' باسمك كمسؤول التسليم\nالمستلم: ' + (rec?.name || '—') + '\n' + itemsTxt).catch(() => {})
        }
      } catch {}
    }
    // إخراج العدد المطلوب فقط من كل وحدة؛ لو طُلب جزء من صف جماعي، يُقسَّم الصف: جزء "خارج" والباقي يبقى متاحاً
    for (const uid of permit.unit_ids) {
      const u = units.find((x) => x.id === uid)
      if (!u) continue
      const wanted = qtyOf(uid)
      if (wanted <= 0) continue
      const full = u.qty || 1
      if (wanted >= full) {
        await updateRow('inventory_units', uid, { status: 'out', conference_id: permit.conference_id || null, permit_id: saved.id })
      } else {
        await updateRow('inventory_units', uid, { qty: full - wanted })
        await insertRow('inventory_units', {
          item_id: u.item_id, barcode: u.barcode + '-OUT' + Date.now().toString(36).slice(-4),
          serial: u.serial || '', length_m: u.length_m || null, condition: u.condition || 'new',
          qty: wanted, status: 'out', conference_id: permit.conference_id || null, permit_id: saved.id,
          brand: u.brand || '', source: u.source || '', purchase_date: u.purchase_date || null, notes: u.notes || '',
        })
      }
    }
    setPermit(null); setConfirmSummary(false); reloadPermits(); load()
  }

  const save = () => {
    if (!(permit.recipient_id || permit.recipient_new?.trim())) return alert(t('required') + ': ' + t('recipientName'))
    if (!permit.unit_ids.length) return alert(t('required') + ': ' + t('permitItems'))
    setConfirmSummary(true)
  }

  return (
    <div>
      <div className="toolbar">
        <button className="mini-btn" onClick={() => { scRef.current?.stop().catch(() => {}); setPermit(null) }}>← {t('permitsTab')}</button>
      </div>
      <h1 className="page-title">📤 {t('newPermit')}</h1>
      <div className="card">
      <div className="grid2">
        <div className="field"><label>{t('recipientName')} *</label>
          <select value={permit.recipient_id} onChange={(e) => set('recipient_id', e.target.value)}>
            <option value="">— {t('newRecipient')} —</option>
            {recipients.map((r) => <option key={r.id} value={r.id}>{r.name} {r.company ? `(${r.company})` : ''}</option>)}
          </select>
        </div>
        {!permit.recipient_id && (
          <>
            <div className="field"><label>{t('newRecipientName')} *</label>
              <input value={permit.recipient_new} onChange={(e) => set('recipient_new', e.target.value)} /></div>
            <div className="field"><label>{t('phone')}</label>
              <input dir="ltr" value={permit.recipient_phone_new || ''} onChange={(e) => set('recipient_phone_new', e.target.value)} /></div>
            <ChatIdField label="TG Chat ID" value={permit.recipient_tg_new || ''} onChange={(v) => set('recipient_tg_new', v)} phone={permit.recipient_phone_new} />
          </>
        )}
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>{t('notifyOnIssue')}</label>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <label className="check-row" style={{ padding: 0 }}>
              <input type="checkbox" checked={permit.notify_recipient !== false} onChange={(e) => set('notify_recipient', e.target.checked)} />
              {t('notifyRecipient')}
            </label>
            <label className="check-row" style={{ padding: 0 }}>
              <input type="checkbox" checked={permit.notify_employee !== false} onChange={(e) => set('notify_employee', e.target.checked)} />
              {t('notifyEmployee')}
            </label>
          </div>
        </div>
        <div className="field"><label>{t('exitType')}</label>
          <div className="seg">
            <button type="button" className={permit.exit_type === 'conference' ? 'active' : ''} onClick={() => set('exit_type', 'conference')}>{t('conferences')}</button>
            <button type="button" className={permit.exit_type === 'rent' ? 'active' : ''} onClick={() => set('exit_type', 'rent')}>{t('exitRent')}</button>
            <button type="button" className={permit.exit_type === 'internal' ? 'active' : ''} onClick={() => set('exit_type', 'internal')}>{t('exitInternal')}</button>
          </div>
        </div>
        {permit.exit_type === 'conference' && (
          <div className="field"><label>{t('conferences')}</label>
            <select value={permit.conference_id} onChange={(e) => set('conference_id', e.target.value)}>
              <option value="">—</option>
              {conferences.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
        )}
        <div className="field"><label>{t('responsibleEmp')}</label>
          <select value={permit.employee_id} onChange={(e) => set('employee_id', e.target.value)}>
            <option value="">—</option>
            {employees.map((e2) => <option key={e2.id} value={e2.id}>{e2.name}</option>)}
          </select></div>
        <div className="field"><label>{t('receiptDate')}</label>
          <input type="date" value={permit.exit_date} onChange={(e) => set('exit_date', e.target.value)} /></div>
        <div className="field"><label>{t('expectedReturn')}</label>
          <input type="date" value={permit.expected_return} onChange={(e) => set('expected_return', e.target.value)} /></div>
      </div>

      <div className="field" style={{ marginTop: 10 }}>
        <label>{t('permitItems')} ({permit.unit_ids.length})
          <button type="button" className="mini-btn tg" style={{ marginInlineStart: 10 }}
            onClick={() => setScanOn((v) => !v)}>📷 {scanOn ? t('done') : t('scanBarcode')}</button>
        </label>
        {scanOn && <div id="permit-scan" style={{ maxWidth: 380, margin: '8px 0' }} />}

        <ItemPickerGrid
          items={items} units={units} permit={permit} set={set} t={t}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="save-btn" onClick={save}>{t('save')}</button>
      </div>
      </div>

      {confirmSummary && (
        <Modal title={`🛠 ${t('workOrderPrep')}`} onClose={() => setConfirmSummary(false)}>
          <p className="hint-inline">{t('workOrderPrepHint')}</p>
          <div className="card" style={{ padding: 14 }}>
            {buildItemsSummary().map((g, i) => (
              <div className="manage-row" key={i}>
                <span>{g.name} — <b>×{g.qty}</b> {g.note && <small className="hint-inline">({g.note})</small>}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
            <button className="add-btn" onClick={() => setConfirmSummary(false)}>✏️ {t('edit')}</button>
            <button className="save-btn" onClick={doSave}>💾 {t('confirmAndSave')}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ==================== اختيار الأصناف جنباً إلى جنب: كل صنف بعداد وملاحظة ====================
function ItemPickerGrid({ items, units, permit, set, t }) {
  const itemName = (id) => items.find((x) => x.id === id)?.name || ''

  // كل صف "وحدة" (unit) بمفرده يمثل مجموعة متجانسة: نفس الصنف + نفس الطول + نفس السيريال
  // بهذا تظهر كابل 10م وكابل 20م كبطاقتين منفصلتين تماماً، ولا يختلط رصيدهما أبداً
  const availUnits = units.filter((u) =>
    u.status === 'available' || permit.unit_ids.includes(u.id))
    .filter((u) => u.status === 'available' || permit.unit_ids.includes(u.id))

  const rows = units.filter((u) => u.status === 'available')

  const selectedQtyOf = (unitId) => {
    // العدد المُختار من هذه الوحدة بعينها = qty الأصلي لو كانت كل الوحدة مُختارة، أو صفر/كامل (لا تجزئة فرعية)
    return permit.unit_ids.includes(unitId) ? (units.find((u) => u.id === unitId)?.qty || 1) : 0
  }

  // ملاحظة: كل صف Unit جماعي (qty > 1) يُختار أو يُترك ككتلة واحدة، أما تعديل عدد جزئي منه فيتطلب دعم "سحب جزئي"
  // ندعم هنا سحب عدد جزئي من الصف عبر تخزينه في permit.partial_qty[unitId]
  const partialQty = (unitId) => {
    if (permit.partial_qty && permit.partial_qty[unitId] !== undefined) return permit.partial_qty[unitId]
    return permit.unit_ids.includes(unitId) ? (units.find((u) => u.id === unitId)?.qty || 1) : 0
  }

  const setPartialQty = (u, qty) => {
    const max = u.qty || 1
    qty = Math.max(0, Math.min(qty, max))
    const partial = { ...(permit.partial_qty || {}), [u.id]: qty }
    const unitIds = qty > 0
      ? [...new Set([...permit.unit_ids, u.id])]
      : permit.unit_ids.filter((id) => id !== u.id)
    set('unit_ids', unitIds)
    set('partial_qty', partial)
  }

  const noteOf = (unitId) => permit.item_notes?.[unitId] || ''
  const setNote = (unitId, note) => set('item_notes', { ...(permit.item_notes || {}), [unitId]: note })

  const label = (u) => {
    const parts = [itemName(u.item_id)]
    if (u.length_m) parts.push(`${u.length_m} م`)
    if (u.serial) parts.push(u.serial)
    if (u.brand) parts.push(u.brand)
    return parts.join(' — ')
  }

  const relevant = rows.filter((u) => u.item_type !== 'length' || true) // القطع المتاحة كلها (وحدة/طول)
    .filter((u) => (u.qty || 1) > 0)

  return (
    <div className="item-picker-grid">
      {relevant.length === 0 ? (
        <p className="hint-inline">{t('noAvailableItems')}</p>
      ) : relevant.map((u) => {
        const max = u.qty || 1
        const qty = partialQty(u.id)
        const active = qty > 0
        return (
          <div className={`item-pick-card ${active ? 'active' : ''}`} key={u.id}>
            <div className="item-pick-name">{label(u)}</div>
            <div className="item-pick-row">
              <button type="button" className="qty-btn" onClick={() => setPartialQty(u, qty - 1)} disabled={qty <= 0}>−</button>
              <input type="number" className="qty-input" min="0" max={max} value={qty}
                onChange={(e) => setPartialQty(u, +e.target.value || 0)} />
              <button type="button" className="qty-btn" onClick={() => setPartialQty(u, qty + 1)} disabled={qty >= max}>+</button>
              <span className="qty-max">/ {max}</span>
            </div>
            {active && (
              <input className="item-pick-note" placeholder={t('itemNote')} value={noteOf(u.id)}
                onChange={(e) => setNote(u.id, e.target.value)} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ==================== لوحة المخزن اللحظية ====================
function InvDashboard({ t, units, items, permits, recipients, conferences }) {
  const avail = units.filter((u) => u.status === 'available').length
  const out = units.filter((u) => u.status === 'out').length
  const maint = units.filter((u) => u.status === 'maintenance').length
  const damaged = units.filter((u) => u.status === 'damaged')
  const openPermits = permits.filter((p) => p.status === 'open')
  const overdue = openPermits.filter((p) => p.expected_return && new Date(p.expected_return) < new Date())
  const itemName = (id) => items.find((x) => x.id === id)?.name || ''

  return (
    <div>
      <div className="kpi-row">
        <div className="kpi"><span>{t('availableNow')}</span><b style={{ color: '#0F6E56' }}>{avail}</b></div>
        <div className="kpi"><span>{t('outNow')}</span><b style={{ color: '#B05E0B' }}>{out}</b></div>
        <div className="kpi"><span>{t('inMaintenance')}</span><b style={{ color: '#1D6FB8' }}>{maint}</b></div>
        <div className="kpi"><span>{t('damagedCount')}</span><b style={{ color: '#A32D2D' }}>{damaged.length}</b></div>
        <div className="kpi"><span>{t('overdueReturns')}</span><b style={{ color: overdue.length ? '#A32D2D' : '#0F6E56' }}>{overdue.length}</b></div>
      </div>

      <div className="card">
        <h3>{t('whoHasWhat')}</h3>
        {openPermits.length === 0 ? <p className="hint-inline">{t('noData')}</p> : openPermits.map((p) => {
          const rec = recipients.find((r) => r.id === p.recipient_id)
          const us = units.filter((u) => u.permit_id === p.id)
          const late = p.expected_return && new Date(p.expected_return) < new Date()
          return (
            <div className="manage-row" key={p.id} style={late ? { background: '#FDECEC', borderRadius: 8 } : {}}>
              <span><b>{rec?.name || '—'}</b> — {us.map((u) => itemName(u.item_id)).join(' · ')}
                {p.expected_return && <small className="hint-inline"> ({t('expectedReturn')}: {p.expected_return}{late ? ' — ' + t('overdue') : ''})</small>}
              </span>
              <span className="badge">#{p.permit_number}</span>
            </div>
          )
        })}
      </div>

      {damaged.length > 0 && (
        <div className="card">
          <h3>{t('damageLog')}</h3>
          {damaged.map((u) => (
            <div className="manage-row" key={u.id}>
              <span>{itemName(u.item_id)} — <span dir="ltr" style={{ fontFamily: 'monospace', fontSize: 11 }}>{u.barcode}</span>
                {u.damage_reason && <small className="hint-inline"> — {u.damage_reason}</small>}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function InvSummary({ t, units, items }) {
  const itemName = (id) => items.find((x) => x.id === id)?.name || '—'
  const rows = units.filter((u) => (u.qty ?? 1) > 0 || u.item_type !== 'length')
  const totalPieces = rows.reduce((s, u) => s + (+u.qty || 1), 0)

  return (
    <div>
      <div className="kpi-row">
        <div className="kpi big"><span>{t('totalPieces')}</span><b>{totalPieces}</b></div>
        <div className="kpi"><span>{t('totalItemTypes')}</span><b>{items.length}</b></div>
      </div>
      {rows.length === 0 ? <EmptyState /> : (
        <div className="quote-scroll">
          <table className="quote-table costs-table">
            <thead><tr>
              <th>{t('invItemName')}</th><th>{t('brand')}</th><th>{t('barcode')}</th><th>{t('serial')}</th>
              <th>{t('countLbl')}</th><th>{t('cableLength')}</th><th>{t('conditionLbl')}</th><th>{t('status')}</th>
            </tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td style={{ textAlign: 'start' }}>{itemName(u.item_id)}</td>
                  <td>{u.brand || '—'}</td>
                  <td dir="ltr" style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{u.barcode}</td>
                  <td dir="ltr">{u.serial || '—'}</td>
                  <td><b>{u.qty ?? 1}</b></td>
                  <td>{u.length_m ? `${u.length_m} م` : '—'}</td>
                  <td>{u.condition === 'used' ? t('condUsed') : t('condNew')}</td>
                  <td>{STATUS[u.status] ? t(STATUS[u.status].key) : u.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RecipientsTab({ recipients, reload }) {
  const { t } = useLang()
  const [form, setForm] = useState(null)
  const [del, setDel] = useState(null)

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))
  const save = async () => {
    if (!form.name?.trim()) return alert(t('required') + ': ' + t('recipientName'))
    if (form.id) await updateRow('recipients', form.id, form)
    else await insertRow('recipients', form)
    setForm(null); reload()
  }

  return (
    <div>
      <div className="toolbar">
        <button className="save-btn" onClick={() => setForm({ name: '', phone: '', whatsapp_number: '', telegram_chat_id: '', company: '', job_title: '' })}>+ {t('addRecipient')}</button>
      </div>
      {recipients.length === 0 ? <EmptyState /> : (
        <div className="cards-grid">
          {recipients.map((r) => (
            <div className="entity-card" key={r.id}>
              <div className="entity-head">
                <b>{r.name}</b>
                {r.telegram_chat_id && <span className="badge ok">TG ✓</span>}
              </div>
              {r.company && <div className="entity-sub">{r.company} {r.job_title ? `— ${r.job_title}` : ''}</div>}
              <div className="entity-meta">
                {r.phone && <span dir="ltr">📞 {r.phone}</span>}
                {r.whatsapp_number && <span dir="ltr">🟢 {r.whatsapp_number}</span>}
              </div>
              <div className="entity-actions">
                <button onClick={() => setForm({ ...r })}>{t('edit')}</button>
                <button className="danger" onClick={() => setDel(r.id)}>{t('delete')}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {form && (
        <Modal title={form.id ? t('edit') : t('addRecipient')} onClose={() => setForm(null)}>
          <div className="grid2">
            <div className="field"><label>{t('recipientName')} *</label>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
            <div className="field"><label>{t('phone')}</label>
              <input dir="ltr" value={form.phone || ''} onChange={(e) => set('phone', e.target.value)} /></div>
            <div className="field"><label>{t('company')}</label>
              <input value={form.company || ''} onChange={(e) => set('company', e.target.value)} /></div>
            <div className="field"><label>{t('jobTitle')}</label>
              <input value={form.job_title || ''} onChange={(e) => set('job_title', e.target.value)} /></div>
            <div className="field"><label>{t('whatsappNumber')}</label>
              <input dir="ltr" value={form.whatsapp_number || ''} onChange={(e) => set('whatsapp_number', e.target.value)} /></div>
            <ChatIdField label={t('telegramChatId')} value={form.telegram_chat_id} onChange={(v) => set('telegram_chat_id', v)} phone={form.phone} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="save-btn" onClick={save}>{t('save')}</button>
          </div>
        </Modal>
      )}
      {del && <ConfirmDelete onCancel={() => setDel(null)} onConfirm={async () => { await deleteRow('recipients', del); setDel(null); reload() }} />}
    </div>
  )
}
