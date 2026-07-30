import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// يعمل بدون Supabase في وضع التجربة المحلية (localStorage)
export const supabase = url && key ? createClient(url, key) : null

export async function loadSettings() {
  if (!supabase) {
    const raw = localStorage.getItem('mohtaseby_settings')
    return raw ? JSON.parse(raw) : null
  }
  const { data } = await supabase.from('company_settings').select('*').limit(1).maybeSingle()
  return data
}

export async function saveSettings(settings) {
  if (!supabase) {
    localStorage.setItem('mohtaseby_settings', JSON.stringify(settings))
    return settings
  }
  const payload = { ...settings, updated_at: new Date().toISOString() }
  delete payload.created_at
  if (settings.id) {
    const { data, error } = await supabase.from('company_settings').update(payload).eq('id', settings.id).select().single()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase.from('company_settings').insert(payload).select().single()
  if (error) throw error
  return data
}

// مسار آمن للتخزين: Supabase لا يقبل العربية أو المسافات في أسماء الملفات
function safePath(name) {
  const ext = (name.match(/\.[A-Za-z0-9]+$/) || ['.jpg'])[0].toLowerCase()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
}

// رفع صورة إلى Supabase Storage أو حفظ base64 محلياً في وضع التجربة
export async function uploadAsset(file, path) {
  path = safePath(file.name)
  if (!supabase) {
    return new Promise((res) => {
      const r = new FileReader()
      r.onload = () => res(r.result)
      r.readAsDataURL(file)
    })
  }
  const { error } = await supabase.storage.from('company-assets').upload(path, file, { upsert: true })
  if (error) throw error
  const { data } = await supabase.storage.from('company-assets').createSignedUrl(path, 60 * 60 * 24 * 365)
  return data.signedUrl
}
