import { useEffect, useState } from 'react'

// حقل إدخال سريع: يكتب محلياً ويحفظ عند مغادرة الحقل فقط — يحل بطء الكتابة
export default function DebInput({ value, onCommit, ...props }) {
  const [v, setV] = useState(value ?? '')
  useEffect(() => { setV(value ?? '') }, [value])
  return (
    <input {...props} value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (String(v) !== String(value ?? '')) onCommit(v) }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }} />
  )
}
