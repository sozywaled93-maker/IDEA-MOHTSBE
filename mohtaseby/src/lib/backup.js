// النسخ الاحتياطي إلى Google Sheets عبر Google Apps Script Web App
import { listRows, insertRow } from './db.js'

const TABLES = [
  'company_settings', 'clients', 'suppliers', 'categories', 'units',
  'equipment_library', 'equipment_suppliers', 'quotes', 'supplier_costs',
  'cash_receipts', 'recipients', 'preambles', 'employees', 'tasks',
  'expenses', 'incomes', 'venues', 'manual_taxes',
]

export async function backupToSheets(scriptUrl) {
  if (!scriptUrl) throw new Error('لم يتم ضبط رابط Google Apps Script في إعدادات الشركة')
  const payload = { exported_at: new Date().toISOString(), tables: {} }
  for (const t of TABLES) {
    try { payload.tables[t] = await listRows(t) } catch { payload.tables[t] = [] }
  }
  // Apps Script يتطلب text/plain لتفادي preflight
  await fetch(scriptUrl, { method: 'POST', mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload) })
  try { await insertRow('backup_log', { status: 'sent', sheet_url: scriptUrl }) } catch {}
  return true
}
