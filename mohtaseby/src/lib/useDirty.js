import { useMemo } from 'react'

// يقارن الحالة الحالية بالحالة الأصلية (وقت الفتح) لمعرفة وجود تعديلات غير محفوظة
export function useDirty(current, original) {
  return useMemo(() => {
    if (!current) return false
    try { return JSON.stringify(current) !== JSON.stringify(original ?? {}) }
    catch { return false }
  }, [current, original])
}
