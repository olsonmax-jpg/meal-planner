// Vercel serverless function: fetch a recipe page, read schema.org JSON-LD + og:image.
// Env vars (set in Vercel): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, ALLOWED_EMAILS (comma separated).
import { parse } from 'node-html-parser'

const ALLOWED = (process.env.ALLOWED_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

function blocked(hostname) {
  return /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$)/i.test(hostname) || !hostname.includes('.')
}

async function authed(req) {
  const auth = req.headers.authorization || ''
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!auth || !url || !key || !ALLOWED.length) return false
  const r = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: auth, apikey: key } })
  if (!r.ok) return false
  const u = await r.json()
  return ALLOWED.includes(String(u.email || '').toLowerCase())
}

const dur = (iso) => {
  const m = /P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(iso || '')
  return m ? (parseInt(m[1] || 0) * 60 + parseInt(m[2] || 0)) || null : null
}
const first = (v) => (Array.isArray(v) ? v[0] : v)
const imageOf = (img) => {
  const i = first(img)
  return typeof i === 'string' ? i : i?.url || null
}
const findRecipe = (node) => {
  if (!node) return null
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipe(n); if (r) return r } return null }
  if (typeof node !== 'object') return null
  const t = node['@type']
  if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return node
  return findRecipe(node['@graph'])
}

const UNIT = '(?:kg|g|gr|gram|grams|ml|l|cl|dl|litre|liter|tsp|tbsp|teaspoons?|tablespoons?|cups?|oz|lb|lbs|pinch|handful|bunch|tins?|cans?|cloves?|slices?|sprigs?|el|tl|stuks?|blik|bos|teen|tenen)'
function splitIngredient(s) {
  const clean = String(s).replace(/\s+/g, ' ').trim()
  const m = new RegExp(`^([\\d½¼¾⅓⅔⅛.,/\\- ]+\\s*${UNIT}?\\b\\.?)\\s+(.*)$`, 'i').exec(clean)
  if (m && m[2]) return { quantity: m[1].trim(), name: m[2].trim() }
  return { quantity: '', name: clean }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  if (!(await authed(req))) return res.status(401).json({ error: 'Not signed in' })
  let target
  try {
    target = new URL((req.body && req.body.url) || '')
    if (!/^https?:$/.test(target.protocol) || blocked(target.hostname)) throw new Error('bad')
  } catch { return res.status(400).json({ error: 'That does not look like a valid link' }) }

  let html
  try {
    const r = await fetch(target, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; RecipeImporter/1.0)', accept: 'text/html' }, redirect: 'follow' })
    if (!r.ok) return res.status(502).json({ error: `Site answered ${r.status}` })
    html = await r.text()
  } catch { return res.status(502).json({ error: 'Could not reach that site' }) }

  const root = parse(html)
  let recipe = null
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try { recipe = findRecipe(JSON.parse(s.text)); if (recipe) break } catch {}
  }
  const og = root.querySelector('meta[property="og:image"]')?.getAttribute('content')
  const ogTitle = root.querySelector('meta[property="og:title"]')?.getAttribute('content')
  const image = (recipe && imageOf(recipe.image)) || og || null
  const title = (recipe?.name || ogTitle || root.querySelector('title')?.text || '').toString().trim()
  const ingredients = (recipe?.recipeIngredient || []).map(splitIngredient)
  const yieldRaw = String(first(recipe?.recipeYield) || '')
  const servings = parseInt((yieldRaw.match(/\d+/) || [])[0]) || null

  res.status(200).json({
    title,
    image_url: image ? new URL(image, target).toString() : null,
    minutes: dur(recipe?.totalTime) || (dur(recipe?.cookTime) || 0) + (dur(recipe?.prepTime) || 0) || null,
    servings,
    source_url: target.toString(),
    ingredients,
    found_recipe: !!recipe,
  })
}
