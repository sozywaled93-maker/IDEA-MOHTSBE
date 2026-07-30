// فتح صورة/ملف محفوظ (data URL أو رابط) في تبويب جديد بشكل موثوق
export function viewFile(src) {
  if (!src) return
  if (src.startsWith('data:')) {
    fetch(src).then((r) => r.blob()).then((b) => {
      const url = URL.createObjectURL(b)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    })
  } else {
    window.open(src, '_blank')
  }
}
