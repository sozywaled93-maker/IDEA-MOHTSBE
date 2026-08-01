import { useEffect, useRef, useState } from 'react'
import { Modal } from '../../components/ui.jsx'
import { BlurInput } from '../../components/BlurInput.jsx'
import { debSave } from '../../lib/debounce.js'
import { useLang } from '../../lib/i18n.jsx'
import { loadSettings, saveSettings, uploadAsset } from '../../lib/supabase.js'
import { listRows, insertRow, updateRow, deleteRow } from '../../lib/db.js'
import { TelegramBadge, TelegramInviteButton } from '../../components/TelegramBadge.jsx'

function UploadBox({ label, value, onChange, t }) {
  const ref = useRef(null)
  const pick = async (file) => {
    if (!file) return
    try { onChange(await uploadAsset(file, `${label}-${Date.now()}-${file.name}`)) }
    catch (e) { alert(e.message) }
  }
  return (
    <div className="field">
      <label>{label}</label>
      <div
        className="upload-box"
        onClick={() => !value && ref.current.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]) }}
      >
        {value ? (
          <>
            <img src={value} alt={label} />
            <div className="upload-actions" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => ref.current.click()}>{t('replace')}</button>
              <button className="danger" onClick={() => onChange(null)}>{t('remove')}</button>
            </div>
          </>
        ) : (
          <>
            <span style={{ fontSize: 26 }}>🖼️</span>
            <span className="hint">{t('uploadHint')}</span>
          </>
        )}
        <input hidden ref={ref} type="file" accept="image/png,image/jpeg" onChange={(e) => pick(e.target.files[0])} />
      </div>
    </div>
  )
}

const emptyAccount = { type: 'bank', bank_name: '', account_name: '', account_number: '', iban: '' }

export default function CompanySettingsPage() {
  const { t, lang } = useLang()
  const [s, setS] = useState({
    company_name: '', address: '', tax_id: '', commercial_reg_no: '',
    logo_url: null, letterhead_url: null, stamp_url: null, signature_url: null,
    bank_accounts: [], default_stamp: false, default_signature: false,
  })
  const [status, setStatus] = useState('idle')
  const [employees, setEmployees] = useState([])
  const [quotes, setQuotes] = useState([])
  const [tgChats, setTgChats] = useState(null)
  const [empOpen, setEmpOpen] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [empSuppliers, setEmpSuppliers] = useState([])

  useEffect(() => {
    loadSettings().then((d) => d && setS((p) => ({ ...p, ...d })))
    listRows('employees').then(setEmployees)
    listRows('quotes').then(setQuotes)
    listRows('suppliers').then(setSuppliers).catch(() => setSuppliers([]))
    listRows('employee_suppliers', 'id').then(setEmpSuppliers).catch(() => setEmpSuppliers([]))
  }, [])

  const reloadEmpSuppliers = () =>
    listRows('employee_suppliers', 'id').then(setEmpSuppliers).catch(() => setEmpSuppliers([]))
  const toggleEmpSupplier = async (empId, supId, on) => {
    if (on) await insertRow('employee_suppliers', { employee_id: empId, supplier_id: supId })
    else {
      const link = empSuppliers.find((x) => x.employee_id === empId && x.supplier_id === supId)
      if (link) await deleteRow('employee_suppliers', link.id)
    }
    reloadEmpSuppliers()
  }

  const reloadEmp = () => listRows('employees').then(setEmployees)
  const patchEmp = (id, patch) => {
    setEmployees((p) => p.map((x) => x.id === id ? { ...x, ...patch } : x))
    debSave('employees', id, patch)
  }
  const addEmp = async () => {
    await insertRow('employees', { name: '', phone: '', phones: [], emp_type: 'permanent', quote_id: null })
    reloadEmp()
  }
  const addPhone = (emp) => patchEmp(emp.id, {
    phones: [...(emp.phones || []), { number: '', is_primary: !(emp.phones || []).length }],
  })
  const setPhone = (emp, i, number) => patchEmp(emp.id, {
    phones: emp.phones.map((p, j) => (j === i ? { ...p, number } : p)),
    phone: emp.phones.find((p) => p.is_primary)?.number || number,
  })
  const setPrimary = (emp, i) => patchEmp(emp.id, {
    phones: emp.phones.map((p, j) => ({ ...p, is_primary: j === i })),
    phone: emp.phones[i].number,
  })
  const delPhone = (emp, i) => patchEmp(emp.id, { phones: emp.phones.filter((_, j) => j !== i) })

  const set = (k, v) => setS((p) => ({ ...p, [k]: v }))
  const setAcc = (i, k, v) => setS((p) => {
    const a = [...p.bank_accounts]; a[i] = { ...a[i], [k]: v }; return { ...p, bank_accounts: a }
  })

  const save = async () => {
    setStatus('saving')
    try { const d = await saveSettings(s); setS((p) => ({ ...p, ...d })); setStatus('saved') }
    catch (e) { alert(e.message); setStatus('idle') }
    setTimeout(() => setStatus('idle'), 2500)
  }

  return (
    <div>
      <h1 className="page-title">{t('settings')}</h1>
      <p className="page-sub">{lang === 'ar' ? 'البيانات المستخدمة في كل عروض الأسعار والفواتير والإيصالات' : 'Used across all quotes, invoices and receipts'}</p>

      <div className="card">
        <h3>{t('companyData')}</h3>
        <div className="grid2">
          <div className="field"><label>{t('companyName')} *</label>
            <input value={s.company_name} onChange={(e) => set('company_name', e.target.value)} /></div>
          <div className="field"><label>{t('address')}</label>
            <input value={s.address} onChange={(e) => set('address', e.target.value)} /></div>
          <div className="field"><label>{t('taxId')}</label>
            <input value={s.tax_id} onChange={(e) => set('tax_id', e.target.value)} dir="ltr" /></div>
          <div className="field"><label>{t('crNo')}</label>
            <input value={s.commercial_reg_no} onChange={(e) => set('commercial_reg_no', e.target.value)} dir="ltr" /></div>
        </div>
      </div>

      <div className="card">
        <h3>{t('branding')}</h3>
        <div className="grid4">
          <UploadBox label={t('logo')} value={s.logo_url} onChange={(v) => set('logo_url', v)} t={t} />
          <UploadBox label={t('letterhead')} value={s.letterhead_url} onChange={(v) => set('letterhead_url', v)} t={t} />
          <UploadBox label={t('stamp')} value={s.stamp_url} onChange={(v) => set('stamp_url', v)} t={t} />
          <UploadBox label={t('signature')} value={s.signature_url} onChange={(v) => set('signature_url', v)} t={t} />
        </div>
        <div style={{ marginTop: 14 }}>
          <div className="check-row">
            <input type="checkbox" id="st" checked={s.default_stamp} onChange={(e) => set('default_stamp', e.target.checked)} />
            <label htmlFor="st">{t('includeStamp')}</label>
          </div>
          <div className="check-row">
            <input type="checkbox" id="sg" checked={s.default_signature} onChange={(e) => set('default_signature', e.target.checked)} />
            <label htmlFor="sg">{t('includeSignature')}</label>
          </div>
          <div className="check-row">
            <input type="checkbox" id="tk" checked={s.show_alerts_ticker !== false} onChange={(e) => set('show_alerts_ticker', e.target.checked)} />
            <label htmlFor="tk">{t('showAlertsTicker')}</label>
          </div>
          <div className="check-row">
            <input type="checkbox" id="uw" checked={s.show_upcoming_widget !== false} onChange={(e) => set('show_upcoming_widget', e.target.checked)} />
            <label htmlFor="uw">{t('showUpcomingWidget')}</label>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>{t('bankDetails')}</h3>
        {s.bank_accounts.map((a, i) => (
          <div className="bank-row" key={i}>
            <div className="field"><label>{t('accountType')}</label>
              <select value={a.type} onChange={(e) => setAcc(i, 'type', e.target.value)}>
                <option value="bank">{t('bank')}</option>
                <option value="vodafone">{t('vodafone')}</option>
                <option value="instapay">{t('instapay')}</option>
              </select></div>
            {a.type === 'bank' && (
              <div className="field"><label>{t('bankName')}</label>
                <input value={a.bank_name} onChange={(e) => setAcc(i, 'bank_name', e.target.value)} /></div>
            )}
            <div className="field"><label>{t('accountName')}</label>
              <input value={a.account_name} onChange={(e) => setAcc(i, 'account_name', e.target.value)} /></div>
            <div className="field"><label>{t('accountNumber')}</label>
              <input value={a.account_number} onChange={(e) => setAcc(i, 'account_number', e.target.value)} dir="ltr" /></div>
            {a.type === 'bank' && (
              <div className="field"><label>IBAN</label>
                <input value={a.iban} onChange={(e) => setAcc(i, 'iban', e.target.value)} dir="ltr" /></div>
            )}
            <button className="icon-btn" title={t('remove')}
              onClick={() => set('bank_accounts', s.bank_accounts.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button className="add-btn" onClick={() => set('bank_accounts', [...s.bank_accounts, { ...emptyAccount }])}>
          + {t('addAccount')}
        </button>
      </div>

      <div className="card">
        <h3>{t('employees')}</h3>
        <p className="hint-inline" style={{ marginTop: -8, marginBottom: 12 }}>{t('empCardsHint')}</p>
        <div className="emp-grid">
          {employees.map((emp) => (
            <button type="button" className="emp-mini" key={emp.id} onClick={() => setEmpOpen(emp)}>
              <b>{emp.name || '—'}</b>
              <span className="hint-inline">{emp.job_title || t('empType')}</span>
              <span className="hint-inline" dir="ltr">📞 {(emp.phones || []).find((p) => p.is_primary)?.number || emp.phone || '—'}</span>
              <TelegramBadge row={emp} small />
            </button>
          ))}
          <button type="button" className="emp-mini add" onClick={async () => {
            const r = await insertRow('employees', { name: '', job_title: '', phone: '', phones: [], emp_type: 'permanent' })
            reloadEmp(); setEmpOpen(r)
          }}>＋<br />{t('addEmployee')}</button>
        </div>

        {empOpen && (() => {
          const emp = employees.find((x) => x.id === empOpen.id) || empOpen
          return (
            <Modal title={emp.name || t('addEmployee')} onClose={() => setEmpOpen(null)} wide>
              <div className="grid2">
                <div className="field"><label>{t('empName')}</label>
                  <BlurInput value={emp.name || ''} onCommit={(v) => patchEmp(emp.id, { name: v })} /></div>
                <div className="field"><label>{t('jobTitle')}</label>
                  <BlurInput value={emp.job_title || ''} onCommit={(v) => patchEmp(emp.id, { job_title: v })} placeholder="فني صوت / سائق / منسق..." /></div>
                <div className="field"><label>{t('empType')}</label>
                  <div className="seg">
                    <button type="button" className={(!emp.emp_type || emp.emp_type === 'permanent') ? 'active' : ''}
                      onClick={() => patchEmp(emp.id, { emp_type: 'permanent', quote_id: null })}>{t('empPermanent')}</button>
                    <button type="button" className={emp.emp_type === 'parttime' ? 'active' : ''}
                      onClick={() => patchEmp(emp.id, { emp_type: 'parttime', quote_id: null })}>{t('empPartTime')}</button>
                    <button type="button" className={emp.emp_type === 'event' ? 'active' : ''}
                      onClick={() => patchEmp(emp.id, { emp_type: 'event' })}>{t('empEventOnly')}</button>
                  </div>
                </div>
                {emp.emp_type === 'event' && (
                  <div className="field"><label>{t('event')}</label>
                    <select value={emp.quote_id || ''} onChange={(e) => patchEmp(emp.id, { quote_id: e.target.value || null })}>
                      <option value="">—</option>
                      {quotes.map((qq) => <option key={qq.id} value={qq.id}>{qq.conference_name}</option>)}
                    </select></div>
                )}
              </div>

              <div className="field" style={{ marginTop: 10 }}>
                <label>{t('phone')}</label>
                {(emp.phones || []).map((p, i) => (
                  <div className="sub-item-row" key={i} style={{ gridTemplateColumns: '1fr 130px 36px' }}>
                    <BlurInput dir="ltr" value={p.number || ''} onCommit={(v) => setPhone(emp, i, v)} />
                    <label className="check-row" style={{ padding: 0, fontSize: 12.5 }}>
                      <input type="radio" checked={!!p.is_primary} onChange={() => setPrimary(emp, i)} />
                      {t('primaryPhone')}
                    </label>
                    <button type="button" className="icon-btn" onClick={() => delPhone(emp, i)}>✕</button>
                  </div>
                ))}
                <button type="button" className="mini-btn" onClick={() => addPhone(emp)}>+ {t('addPhone')}</button>
              </div>

              <div className="grid2" style={{ marginTop: 10 }}>
                <div className="field"><label>{t('paymentMethod')}</label>
                  <select value={emp.payment_method || ''} onChange={(e) => patchEmp(emp.id, { payment_method: e.target.value || null })}>
                    <option value="">—</option>
                    <option value="bank">{t('bank')}</option>
                    <option value="vodafone">{t('vodafone')}</option>
                    <option value="instapay">{t('instapay')}</option>
                  </select></div>
                <div className="field"><label>{t('accountNumber')}</label>
                  <BlurInput dir="ltr" value={emp.account_number || ''} onCommit={(v) => patchEmp(emp.id, { account_number: v })} /></div>
                <div className="field"><label>Telegram</label>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <TelegramBadge row={emp} />
                    <TelegramInviteButton targetType="employee" row={emp} />
                  </div>
                  <BlurInput dir="ltr" style={{ marginTop: 6 }} placeholder="Chat ID"
                    value={emp.telegram_chat_id || ''} onCommit={(v) => patchEmp(emp.id, { telegram_chat_id: v })} />
                  <p className="hint-inline">{t('contactsHint')}</p>
                </div>
                <div className="field"><label>{t('whatsappNumber')}</label>
                  <BlurInput dir="ltr" value={emp.whatsapp_number || ''} onCommit={(v) => patchEmp(emp.id, { whatsapp_number: v })} /></div>
              </div>

              <div className="field" style={{ marginTop: 10 }}>
                <label>{t('tgPermissions')}</label>
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                  <label className="check-row" style={{ padding: 0 }}>
                    <input type="checkbox" checked={!!emp.can_view_finance}
                      onChange={(e) => patchEmp(emp.id, { can_view_finance: e.target.checked })} />
                    💼 {t('canViewFinance')}
                  </label>
                  <label className="check-row" style={{ padding: 0 }}>
                    <input type="checkbox" checked={!!emp.can_log_expense}
                      onChange={(e) => patchEmp(emp.id, { can_log_expense: e.target.checked })} />
                    💰 {t('canLogExpense')}
                  </label>
                  <label className="check-row" style={{ padding: 0 }}>
                    <input type="checkbox" checked={!!emp.can_view_supplier_ledger}
                      onChange={(e) => patchEmp(emp.id, { can_view_supplier_ledger: e.target.checked })} />
                    📊 {t('canViewSupplierLedger')}
                  </label>
                  <label className="check-row" style={{ padding: 0 }}>
                    <input type="checkbox" checked={!!emp.can_view_supplier_prices}
                      onChange={(e) => patchEmp(emp.id, { can_view_supplier_prices: e.target.checked })} />
                    📋 {t('canViewSupplierPrices')}
                  </label>
                  <label className="check-row" style={{ padding: 0 }}>
                    <input type="checkbox" checked={(emp.supplier_scope || 'all') === 'all'}
                      onChange={(e) => patchEmp(emp.id, { supplier_scope: e.target.checked ? 'all' : 'selected' })} />
                    🌐 {t('seesAllSuppliers')}
                  </label>
                </div>
                <p className="hint-inline">{t('tgPermissionsHint')}</p>
              </div>

              {emp.supplier_scope === 'selected'
                && (emp.can_view_supplier_ledger || emp.can_view_supplier_prices) && (
                <div className="field" style={{ marginTop: 10 }}>
                  <label>{t('allowedSuppliers')}</label>
                  {suppliers.length ? (
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                      {suppliers.map((sup) => (
                        <label key={sup.id} className="check-row" style={{ padding: 0 }}>
                          <input type="checkbox"
                            checked={empSuppliers.some((x) => x.employee_id === emp.id && x.supplier_id === sup.id)}
                            onChange={(e) => toggleEmpSupplier(emp.id, sup.id, e.target.checked)} />
                          {sup.supplier_name || sup.company_name}
                        </label>
                      ))}
                    </div>
                  ) : <p className="hint-inline">{t('noSuppliersYet')}</p>}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
                <button className="mini-btn" style={{ color: '#A32D2D' }}
                  onClick={async () => { if (confirm(t('confirmDelete'))) { await deleteRow('employees', emp.id); setEmpOpen(null); reloadEmp() } }}>
                  🗑 {t('delete')}
                </button>
                <button className="save-btn" onClick={() => setEmpOpen(null)}>{t('done')}</button>
              </div>
            </Modal>
          )
        })()}
      </div>

      <div className="card">
        <h3>{t('integrations')}</h3>
        <div className="field" style={{ marginBottom: 12 }}>
          <label>{t('sendChannels')}</label>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <label className="check-row" style={{ padding: 0 }}>
              <input type="checkbox" checked={s.send_via_telegram !== false} onChange={(e) => set('send_via_telegram', e.target.checked)} />
              📨 Telegram
            </label>
            <label className="check-row" style={{ padding: 0 }}>
              <input type="checkbox" checked={!!s.send_via_whatsapp} onChange={(e) => set('send_via_whatsapp', e.target.checked)} />
              🟢 WhatsApp
            </label>
          </div>
          <p className="hint-inline">{t('sendChannelsHint')}</p>
        </div>
        <div className="grid2">
          <div className="field"><label>Telegram Bot Token <span className="hint-inline">({t('tgTokenHint')})</span></label>
            <input dir="ltr" value={s.telegram_bot_token || ''} onChange={(e) => set('telegram_bot_token', e.target.value)} placeholder="123456:ABC-DEF..." /></div>
          <div className="field"><label>{t('botUsername')} <span className="hint-inline">({t('botUsernameHint')})</span></label>
            <input dir="ltr" value={s.telegram_bot_username || ''} onChange={(e) => set('telegram_bot_username', e.target.value)} placeholder="idea360_bot" /></div>
          <div className="field"><label>Google Apps Script URL <span className="hint-inline">({t('gsUrlHint')})</span></label>
            <input dir="ltr" value={s.google_script_url || ''} onChange={(e) => set('google_script_url', e.target.value)} placeholder="https://script.google.com/macros/s/.../exec" /></div>
          {s.send_via_whatsapp && <>
            <div className="field"><label>WhatsApp API Token <span className="hint-inline">({t('waTokenHint')})</span></label>
              <input dir="ltr" value={s.whatsapp_api_token || ''} onChange={(e) => set('whatsapp_api_token', e.target.value)} /></div>
            <div className="field"><label>WhatsApp Phone Number ID</label>
              <input dir="ltr" value={s.whatsapp_phone_id || ''} onChange={(e) => set('whatsapp_phone_id', e.target.value)} /></div>
          </>}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="add-btn" onClick={async () => {
            try {
              const { backupToSheets } = await import('../../lib/backup.js')
              await backupToSheets(s.google_script_url)
              alert(t('backupSent'))
            } catch (e) { alert(e.message) }
          }}>⬆ {t('backupNow')}</button>
          <button type="button" className="add-btn" onClick={async () => {
            try {
              const { tgGetChats } = await import('../../lib/telegram.js')
              setTgChats(await tgGetChats(s.telegram_bot_token))
            } catch (e) { alert(e.message) }
          }}>🤖 {t('fetchTgUsers')}</button>
          <span className="hint-inline">{t('fetchTgHint')}</span>
        </div>

        {tgChats && (
          <div style={{ marginTop: 14 }}>
            {tgChats.length === 0 ? (
              <p className="hint-inline">{t('noTgUsers')}</p>
            ) : tgChats.map((c) => {
              const linked = employees.find((e) => e.telegram_chat_id === c.id)
              return (
                <div className="manage-row" key={c.id} style={{ gap: 10 }}>
                  <span><b>{c.name}</b> {c.username} <small className="hint-inline" dir="ltr">({c.id})</small>
                    {linked && <span className="badge ok" style={{ marginInlineStart: 8 }}>{linked.name} ✓</span>}
                  </span>
                  <select value={linked?.id || ''} onChange={async (e) => {
                    if (!e.target.value) return
                    await patchEmp(e.target.value, { telegram_chat_id: c.id })
                    const { tgSend } = await import('../../lib/telegram.js')
                    try { await tgSend(s.telegram_bot_token, c.id, '✅ تم ربطك بنظام IDEA 360° بنجاح') } catch {}
                  }} style={{ maxWidth: 200 }}>
                    <option value="">— {t('linkToEmployee')} —</option>
                    {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                  </select>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="card">
        <h3>🔐 {t('accessControl')}</h3>
        <div className="grid2">
          <div className="field"><label>{t('adminPass')} <span className="hint-inline">({t('adminPassHint')})</span></label>
            <input type="password" dir="ltr" value={s.admin_password || ''} onChange={(e) => set('admin_password', e.target.value)} /></div>
        </div>
        <AccessUsers t={t} employees={employees} />
      </div>

      <div className="save-bar">
        <button className="save-btn" disabled={status === 'saving'} onClick={save}>
          {status === 'saving' ? t('saving') : t('save')}
        </button>
        {status === 'saved' && <span className="saved-msg">{t('saved')}</span>}
      </div>
    </div>
  )
}


const ALL_PAGES = ['dashboard','conferences','quotes','treasury','taxes','alerts','tasks','workorders','contacts','equipment','inventory','receipts','settings']

function AccessUsers({ t, employees }) {
  const [users, setUsers] = useState([])
  const load = () => listRows('app_users').then(setUsers)
  useEffect(() => { load() }, [])

  const add = async () => {
    const name = prompt(t('empName'))
    if (!name?.trim()) return
    await insertRow('app_users', { name: name.trim(), token: crypto.randomUUID().replace(/-/g, ''), password: '', allowed_pages: [], is_admin: false })
    load()
  }
  const patch = async (id, p) => { await updateRow('app_users', id, p); load() }
  const link = (u) => `${location.origin}${location.pathname}?access=${u.token}`

  return (
    <div style={{ marginTop: 10 }}>
      <label style={{ fontSize: 13, fontWeight: 600 }}>{t('accessUsers')}</label>
      {users.map((u) => (
        <div className="emp-card" key={u.id}>
          <div className="emp-head">
            <b style={{ flex: 1 }}>{u.name}</b>
            <select value={u.employee_id || ''} onChange={(e) => patch(u.id, { employee_id: e.target.value || null })}>
              <option value="">— {t('employees')} —</option>
              {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
            <input type="password" dir="ltr" placeholder={t('optionalPass')} style={{ width: 130, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8 }}
              defaultValue={u.password || ''} onBlur={(e) => e.target.value !== (u.password || '') && patch(u.id, { password: e.target.value })} />
            <button type="button" className="mini-btn" onClick={() => { navigator.clipboard.writeText(link(u)); alert('✓ ' + t('linkCopied')) }}>🔗 {t('copyLink')}</button>
            <button type="button" className="icon-btn" onClick={async () => { await deleteRow('app_users', u.id); load() }}>✕</button>
          </div>
          <div className="chip-row" style={{ marginTop: 8 }}>
            {ALL_PAGES.map((pg) => {
              const on = (u.allowed_pages || []).includes(pg)
              return (
                <button type="button" key={pg} className={`chip selectable ${on ? 'on' : ''}`}
                  onClick={() => patch(u.id, { allowed_pages: on ? (u.allowed_pages || []).filter((x) => x !== pg) : [...(u.allowed_pages || []), pg] })}>
                  {t(pg)}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <button type="button" className="add-btn" onClick={add}>+ {t('addAccessUser')}</button>
      <p className="hint-inline" style={{ marginTop: 8 }}>{t('accessHint')}</p>
    </div>
  )
}
