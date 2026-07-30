// تحويل الأرقام إلى كلمات عربية (تفقيط)
const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
  'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر']
const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون']
const hundreds = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة']

function below1000(n) {
  const h = Math.floor(n / 100), r = n % 100
  const parts = []
  if (h) parts.push(hundreds[h])
  if (r) {
    if (r < 20) parts.push(ones[r])
    else {
      const o = r % 10, t = Math.floor(r / 10)
      parts.push(o ? `${ones[o]} و${tens[t]}` : tens[t])
    }
  }
  return parts.join(' و')
}

function scale(n, [one, two, few, many]) {
  if (n === 1) return one
  if (n === 2) return two
  if (n >= 3 && n <= 10) return `${below1000(n)} ${few}`
  return `${below1000(n)} ${many}`
}

export function numberToArabicWords(num) {
  num = Math.floor(Math.abs(num))
  if (num === 0) return 'صفر'
  const parts = []
  const millions = Math.floor(num / 1e6)
  const thousands = Math.floor((num % 1e6) / 1e3)
  const rest = num % 1e3
  if (millions) parts.push(scale(millions, ['مليون', 'مليونان', 'ملايين', 'مليوناً']))
  if (thousands) {
    if (thousands === 1) parts.push('ألف')
    else if (thousands === 2) parts.push('ألفان')
    else if (thousands <= 10) parts.push(`${below1000(thousands)} آلاف`)
    else parts.push(`${below1000(thousands)} ألف`)
  }
  if (rest) parts.push(below1000(rest))
  return parts.join(' و')
}

// 50000 -> "فقط خمسون ألف جنيه مصري لا غير"
export function amountInWords(egp, piasters = 0) {
  let s = 'فقط ' + numberToArabicWords(egp) + ' جنيه مصري'
  if (piasters > 0) s += ' و' + numberToArabicWords(piasters) + ' قرشاً'
  return s + ' لا غير'
}

export const fmt = (n) => Number(n || 0).toLocaleString('en-EG', { maximumFractionDigits: 2 })
