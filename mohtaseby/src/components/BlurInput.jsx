import { useEffect, useState } from 'react'

// حل بطء الكتابة: التحديث محلي فوري، والحفظ للسيرفر عند مغادرة الخانة فقط
export function BlurInput({ value, onCommit, ...props }) {
  const [v, setV] = useState(value ?? '')
  useEffect(() => { setV(value ?? '') }, [value])
  return <input {...props} value={v}
    onChange={(e) => setV(e.target.value)}
    onBlur={() => { if (v !== (value ?? '')) onCommit(v) }}
    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }} />
}
