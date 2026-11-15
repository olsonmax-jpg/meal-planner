const FR = { '½': .5, '¼': .25, '¾': .75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': .125 }
const NUM = '(?:\\d+\\s*[½¼¾⅓⅔⅛]|\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+[.,]\\d+|\\d+|[½¼¾⅓⅔⅛])'
const LEAD = new RegExp(`^(\\s*)(${NUM})(?:(\\s*[-–]\\s*)(${NUM}))?`)

function val(s) {
  s = s.trim()
  let m
  if ((m = /^(\d+)\s*([½¼¾⅓⅔⅛])$/.exec(s))) return +m[1] + FR[m[2]]
  if (FR[s]) return FR[s]
  if ((m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s))) return +m[1] + m[2] / m[3]
  if ((m = /^(\d+)\/(\d+)$/.exec(s))) return m[1] / m[2]
  return parseFloat(s.replace(',', '.'))
}
function fmt(n) {
  if (n >= 10) return String(Math.round(n))
  const whole = Math.floor(n + 1e-9)
  const frac = n - whole
  const opts = [[0, ''], [.125, '⅛'], [.25, '¼'], [1 / 3, '⅓'], [.5, '½'], [2 / 3, '⅔'], [.75, '¾'], [1, '']]
  let best = opts[0]
  for (const o of opts) if (Math.abs(o[0] - frac) < Math.abs(best[0] - frac)) best = o
  if (Math.abs(best[0] - frac) > .06) return String(Math.round(n * 10) / 10)
  const w = whole + (best[0] === 1 ? 1 : 0)
  return `${w || ''}${best[1]}` || '0'
}
export function scaleQty(q, mult) {
  if (!q || mult === 1) return q || ''
  const m = LEAD.exec(q)
  if (!m) return q
  const a = fmt(val(m[2]) * mult)
  const b = m[4] ? fmt(val(m[4]) * mult) : null
  return `${m[1]}${a}${b ? m[3] + b : ''}${q.slice(m[0].length)}`.trim()
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function terms(name) {
  const base = name.toLowerCase().replace(/\([^)]*\)/g, ' ').split(/,| - | – /)[0].replace(/\b(fresh|freshly|finely|roughly|chopped|diced|sliced|minced|grated|large|small|medium|ripe|extra|virgin|good|quality|to taste|optional)\b/g, ' ').replace(/\s+/g, ' ').trim()
  const w = base.split(' ').filter(Boolean)
  const out = []
  for (let i = 0; i < w.length; i++) out.push(w.slice(i).join(' '))
  return [...new Set(out)].filter(t => t.length >= 3)
}

// Split step text into [{t}] and [{chip, id}] parts. Each ingredient gets its amount chip at its first mention in the recipe.
export function annotate(steps, ings, used = new Set()) {
  return steps.map(st => {
    const hits = []
    for (const ing of ings) {
      if (used.has(ing.id) || !ing.quantity) continue
      for (const t of terms(ing.name)) {
        const re = new RegExp(`\\b${esc(t)}(?:e?s)?\\b`, 'i')
        const m = re.exec(st.t)
        if (m) { hits.push({ id: ing.id, start: m.index, end: m.index + m[0].length, len: t.length }); break }
      }
    }
    hits.sort((a, b) => a.start - b.start || b.len - a.len)
    const picked = []
    let last = -1
    for (const h of hits) if (h.start >= last) { picked.push(h); last = h.end }
    const parts = []
    let pos = 0
    for (const h of picked) {
      used.add(h.id)
      parts.push({ t: st.t.slice(pos, h.end) }, { chip: h.id })
      pos = h.end
    }
    parts.push({ t: st.t.slice(pos) })
    return { ...st, parts }
  })
}

export function parseMethod(text) {
  return text.split(/\n\s*\n|\n/).map(s => s.replace(/^\s*(?:step\s*)?\d+[.):]\s*/i, '').trim()).filter(Boolean).map(t => ({ t, s: null }))
}
