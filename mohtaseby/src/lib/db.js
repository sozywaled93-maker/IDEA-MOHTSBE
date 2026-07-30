import { supabase } from './supabase.js'

// طبقة بيانات موحدة: Supabase أو localStorage في وضع التجربة
const local = {
  get: (table) => JSON.parse(localStorage.getItem('mohtaseby_' + table) || '[]'),
  set: (table, rows) => {
    try {
      localStorage.setItem('mohtaseby_' + table, JSON.stringify(rows))
    } catch (e) {
      throw new Error('مساحة التخزين التجريبية بالمتصفح ممتلئة — يُرجى ربط Supabase من ملف .env لتخزين غير محدود، أو حذف بعض المرفقات.')
    }
  },
}

export async function listRows(table, orderBy = 'created_at') {
  if (!supabase) return local.get(table)
  const { data, error } = await supabase.from(table).select('*').order(orderBy, { ascending: false })
  if (error) throw error
  return data
}

// تعقيم القيم قبل الإرسال: '' في حقول UUID/التواريخ تسبب أخطاء على Supabase
function clean(row) {
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined) continue
    if (k === 'id' && !v) continue   // id فارغ لا يُرسل أبداً (يمنع خطأ invalid uuid)
    if (v === '' && (k === 'id' || k.endsWith('_id') || k.endsWith('_date') || k === 'snooze_until' || k === 'date_from' || k === 'date_to' || k === 'invoice_date' || k === 'cost_date')) {
      out[k] = null
    } else out[k] = v
  }
  return out
}

export async function insertRow(table, row) {
  if (!supabase) {
    const rows = local.get(table)
    const r = { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() }
    try { local.set(table, [r, ...rows]) }
    catch (e) {
      alert('تعذر الحفظ: مساحة التخزين المحلي ممتلئة. اربط البرنامج بـ Supabase أو احذف بعض الصور القديمة.')
      throw e
    }
    return r
  }
  const cleaned = clean(row)
  const { data, error } = await supabase.from(table).insert(cleaned).select().single()
  if (error) { alert(`خطأ في الحفظ (${table}): ` + error.message); throw error }
  return data
}

export async function updateRow(table, id, patch) {
  if (!supabase) {
    const rows = local.get(table).map((r) => (r.id === id ? { ...r, ...patch } : r))
    local.set(table, rows)
    return rows.find((r) => r.id === id)
  }
  if (!id) { console.warn(`updateRow(${table}) called without id`, patch); return null }
  const cleaned = clean(patch)
  const { error } = await supabase.from(table).update(cleaned).eq('id', id)
  if (error) { alert(`خطأ في التعديل (${table}): ` + error.message); throw error }
  return { id, ...cleaned }
}

export async function deleteRow(table, id) {
  if (!supabase) {
    local.set(table, local.get(table).filter((r) => r.id !== id))
    return
  }
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) throw error
}

// ضغط الصور قبل التخزين المحلي لتفادي امتلاء مساحة المتصفح
async function compressImage(file, maxDim = 1200, quality = 0.72) {
  if (!file.type.startsWith('image/')) return null
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file)
  })
  const img = await new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl
  })
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}

function safeDocPath(name) {
  const ext = (name.match(/\.[A-Za-z0-9]+$/) || ['.jpg'])[0].toLowerCase()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
}

export async function uploadDoc(bucket, file, path) {
  path = safeDocPath(file.name)
  if (!supabase) {
    const compressed = await compressImage(file)
    if (compressed) return compressed
    // PDF أو ملفات أخرى: تخزين كما هي (مع تنبيه لو الحجم كبير في وضع التجربة)
    return new Promise((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(r.result)
      r.onerror = () => rej(new Error('تعذرت قراءة الملف'))
      r.readAsDataURL(file)
    })
  }
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true })
  if (error) throw error
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 365)
  return data.signedUrl
}

// عرض الملفات: روابط data: لا تُفتح مباشرة في المتصفح — نحولها Blob
export function openFile(url) {
  if (!url) return
  if (url.startsWith('data:')) {
    const [meta, b64] = url.split(',')
    const mime = meta.match(/data:(.*?);/)?.[1] || 'application/octet-stream'
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    window.open(URL.createObjectURL(new Blob([bytes], { type: mime })), '_blank')
  } else {
    window.open(url, '_blank')
  }
}

const DEFAULT_CATEGORIES = [
  { name_ar: 'شاشات', name_en: 'Screens' },
  { name_ar: 'ستيدج', name_en: 'Stage' },
  { name_ar: 'صوت', name_en: 'Audio' },
  { name_ar: 'تصوير', name_en: 'Photo & Video' },
  { name_ar: 'لوجيستيات', name_en: 'Logistics' },
  { name_ar: 'ديكور', name_en: 'Decor' },
  { name_ar: 'مطبوعات', name_en: 'Prints' },
]

let seeding = {}
async function dedupe(table, rows) {
  const seen = new Set(); const out = []
  for (const r of rows) {
    if (seen.has(r.name_ar)) { await deleteRow(table, r.id); continue }
    seen.add(r.name_ar); out.push(r)
  }
  return out
}

export async function listCategories() {
  let rows = await listRows('categories', supabase ? 'name_ar' : 'created_at')
  rows = await dedupe('categories', rows)
  if (rows.length === 0 && !seeding.categories) {
    seeding.categories = true
    for (const c of DEFAULT_CATEGORIES) rows.push(await insertRow('categories', c))
  }
  return rows
}

export const deleteCategory = (id) => deleteRow('categories', id)
export const deleteUnit = (id) => deleteRow('units', id)

export async function addCategory(name_ar) {
  return insertRow('categories', { name_ar, name_en: name_ar })
}

const DEFAULT_UNITS = [
  { name_ar: 'باليوم', name_en: 'Per day' },
  { name_ar: 'بالمتر', name_en: 'Per meter' },
  { name_ar: 'بالقطعة', name_en: 'Per piece' },
  { name_ar: 'بالساعة', name_en: 'Per hour' },
]

export async function listUnits() {
  let rows = await listRows('units', supabase ? 'name_ar' : 'created_at')
  rows = await dedupe('units', rows)
  if (rows.length === 0 && !seeding.units) {
    seeding.units = true
    for (const u of DEFAULT_UNITS) rows.push(await insertRow('units', u))
  }
  return rows
}

export async function addUnit(name_ar) {
  return insertRow('units', { name_ar, name_en: name_ar })
}

// هل المورد يعمل ضمن هذا القسم؟ (يدعم الأقسام المتعددة)
export const supplierInCategory = (s, cat) =>
  (s.categories?.length ? s.categories : [s.category]).includes(cat)
