import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { supabase } from './supabase.js'
import { AISLES, guessAisle } from './aisles.js'
import Icon from './Icon.jsx'
import { scaleQty, annotate, parseMethod } from './recipeUtils.js'
import { GROCERIES } from './groceries.js'

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' } }
const UNIT = '(?:kg|g|gr|ml|l|cl|dl|tsp|tbsp|cups?|oz|lb|pinch|handful|bunch|tins?|cans?|cloves?|slices?|el|tl|blik|bos)'
function splitLine(s) {
  const clean = s.replace(/\s+/g, ' ').trim()
  const m = new RegExp(`^([\\d½¼¾⅓⅔.,/\\- ]+\\s*${UNIT}?\\b\\.?)\\s+(.*)$`, 'i').exec(clean)
  return m && m[2] ? { quantity: m[1].trim(), name: simplifyName(m[2]) } : { quantity: '', name: simplifyName(clean) }
}
// Shopping names stay short: drop notes in brackets and prep instructions after a comma.
function simplifyName(raw) {
  let n = String(raw || '').replace(/\s+/g, ' ')
  let prev
  do { prev = n; n = n.replace(/\s*\([^()]*\)/g, '') } while (n !== prev)
  n = n.replace(/\(.*$/, '').split(/,|;| – | - | — /)[0]
  n = n.replace(/\b(to taste|optional|for serving|for garnish|to serve|plus extra)\b.*$/i, '')
  n = n.replace(/\s+/g, ' ').replace(/[\s.,:-]+$/, '').trim()
  return n || String(raw || '').trim()
}
const AISLE_LABEL = { 'Vegetables & fruit': 'Produce', 'Spices & herbs': 'Spices & sauces' }
const aisleLabel = (a) => AISLE_LABEL[a] || a
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

const Chev = ({ down }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {down ? <path d="M6 9l6 6 6-6" /> : <path d="M9 6l6 6-6 6" />}
  </svg>
)
const Grip = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" style={{ color: 'var(--muted)', flex: 'none' }}>
    {[6, 14].flatMap(x => [4, 10, 16].map(y => <circle key={x + '-' + y} cx={x} cy={y} r="1.5" />))}
  </svg>
)

export default function App() {
  const [session, setSession] = useState(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])
  if (session === undefined) return <div className="center"><span className="caption">Loading…</span></div>
  if (!session) return <Login />
  return <Main session={session} />
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setErr(error.message)
  }
  return (
    <form className="center" onSubmit={submit}>
      <div className="overline">Welcome</div>
      <h1 className="display">What are we<br />eating?</h1>
      <input className="box-in" type="email" required placeholder="Your email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" />
      <input className="box-in" type="password" required placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
      {err && <div className="err">{err}</div>}
      <button className="cta" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  )
}

function Main({ session }) {
  const [tab, setTab] = useState('recipes')
  const [cats, setCats] = useState([])
  const [recipes, setRecipes] = useState([])
  const [upNext, setUpNext] = useState([])
  const [shop, setShop] = useState([])
  const [view, setView] = useState(null)
  const [sheet, setSheet] = useState(null)
  const [ready, setReady] = useState(false)
  const [toastMsg, setToastMsg] = useState(null)
  const lock = useRef(false)
  const toastT = useRef()
  const toast = (m) => { setToastMsg({ m, k: Date.now() }); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToastMsg(null), 2400) }

  const load = useCallback(async () => {
    const [c, r, u, s] = await Promise.all([
      supabase.from('categories').select('*').order('sort'),
      supabase.from('recipes').select('*, ingredients(*)').order('created_at', { ascending: false }),
      supabase.from('up_next').select('*').order('position').order('added_at'),
      supabase.from('shopping_items').select('*').order('created_at'),
    ])
    if (c.data) setCats(c.data)
    if (r.data) setRecipes(r.data.map(x => ({ ...x, ingredients: (x.ingredients || []).sort((a, b) => a.position - b.position) })))
    if (u.data) setUpNext(u.data)
    if (s.data) setShop(s.data)
    setReady(true)
  }, [])

  useEffect(() => {
    load()
    const ch = supabase.channel('sync').on('postgres_changes', { event: '*', schema: 'public' }, () => load()).subscribe()
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { supabase.removeChannel(ch); document.removeEventListener('visibilitychange', onVis) }
  }, [load])

  const norm = (n) => n.toLowerCase().replace(/\s+/g, ' ').trim()
  const addToShopping = async (items) => {
    if (!items.length || lock.current) return
    lock.current = true
    try {
      const { data: have, error: e0 } = await supabase.from('shopping_items').select('id,name,checked')
      if (e0) { toast(e0.message); return }
      const map = new Map((have || []).map(h => [norm(h.name), h]))
      const fresh = []; const revive = []; let skipped = 0
      const seen = new Set()
      for (const raw of items) {
        const i = { ...raw, name: simplifyName(raw.name) }
        const k = norm(i.name)
        if (!k || seen.has(k)) { if (k) skipped++; continue }
        seen.add(k)
        const ex = map.get(k)
        if (!ex) fresh.push(i)
        else if (ex.checked) revive.push(ex.id)
        else skipped++
      }
      if (fresh.length) {
        const { error } = await supabase.from('shopping_items').insert(fresh.map(i => ({
          name: i.name.trim(), quantity: i.quantity || null, aisle: i.aisle || guessAisle(i.name), recipe_id: i.recipe_id || null,
        })))
        if (error) { toast(error.message); return }
      }
      for (const id of revive) await supabase.from('shopping_items').update({ checked: false }).eq('id', id)
      const added = fresh.length + revive.length
      toast(added ? `Added ${added}${skipped ? ` · ${skipped} already on your list` : ''}` : 'Already on your list')
      await load()
    } finally { lock.current = false }
  }

  const toggleQueue = async (r) => {
    if (lock.current) return
    lock.current = true
    try {
      const { data: ex } = await supabase.from('up_next').select('id').eq('recipe_id', r.id)
      if (ex && ex.length) { await supabase.from('up_next').delete().eq('recipe_id', r.id); toast('Removed from Up next') }
      else { await supabase.from('up_next').insert({ recipe_id: r.id, position: upNext.length }); toast('Added to Up next') }
      await load()
    } finally { lock.current = false }
  }

  const ctx = { cats, recipes, upNext, shop, load, addToShopping, setView, setSheet, setTab, toggleQueue, session, toast }
  const back = () => setView(null)
  const recipe = view?.type === 'recipe' ? recipes.find(r => r.id === view.id) : null
  const category = view?.type === 'category' ? cats.find(c => c.id === view.id) : null

  let body
  if (view?.type === 'import') body = <ImportPage {...ctx} onBack={back} />
  else if (view?.type === 'write') body = <WritePage {...ctx} draft={view.draft} onBack={back} />
  else if (recipe) body = <RecipeDetail recipe={recipe} {...ctx} onBack={back} />
  else if (category) body = <ListPage title={category.name} overline={plural(recipes.filter(r => r.category_id === category.id).length, 'recipe')} list={recipes.filter(r => r.category_id === category.id)} {...ctx} onBack={back} />
  else if (view?.type === 'all') body = <ListPage title="All recipes" overline={plural(recipes.length, 'recipe')} list={recipes} {...ctx} onBack={back} />
  else if (tab === 'recipes') body = <Recipes {...ctx} ready={ready} />
  else if (tab === 'week') body = <Week {...ctx} />
  else body = <Shopping {...ctx} />

  const fullPage = view?.type === 'import' || view?.type === 'write'

  return (
    <div className="app">
      <div key={tab + ':' + (view ? view.type + (view.id || '') : '')}>{body}</div>
      {!fullPage && (
        <nav className="tabbar">
          <span className="ind" style={{ transform: `translateX(${['recipes', 'week', 'shop'].indexOf(tab) * 100}%)` }} />
          {[['recipes', 'Recipes'], ['week', 'Up next'], ['shop', 'Shopping List']].map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setView(null) }}>{l}</button>
          ))}
        </nav>
      )}
      {toastMsg && <div key={toastMsg.k} className="toast">{toastMsg.m}</div>}
      {sheet === 'add' && <AddSheet onClose={() => setSheet(null)} onLink={() => { setSheet(null); setView({ type: 'import' }) }} onWrite={() => { setSheet(null); setView({ type: 'write', draft: {} }) }} />}
    </div>
  )
}

const Lock = ({ q, n }) => <span className="nm">{q ? <span className="qn">{q}</span> : null}{q ? ' ' : ''}{n}</span>

function Thumb({ url, icon = 'dinner_dining', size }) {
  const [bad, setBad] = useState(false)
  const st = size ? { width: size, height: size } : undefined
  return <div className="thumb" style={st}>{url && !bad ? <img src={url} alt="" loading="lazy" onError={() => setBad(true)} /> : <Icon name={icon} size={size ? 28 : 40} />}</div>
}

function RecipeCard({ r, cats, setView, upNext, toggleQueue }) {
  const inQ = upNext.some(u => u.recipe_id === r.id)
  const cat = cats.find(c => c.id === r.category_id)
  return (
    <div className="rcard" onClick={() => setView({ type: 'recipe', id: r.id })}>
      <div className="info">
        <div>
          <div className="t">{r.title}</div>
          <div className="caption">{[r.minutes && `${r.minutes} min`, plural(r.ingredients.length, 'ingredient')].filter(Boolean).join(' · ')}</div>
        </div>
        <button className={'pill-lime' + (inQ ? ' on' : '')} onClick={(e) => { e.stopPropagation(); toggleQueue(r) }}>{inQ ? 'In Up next' : '+ Up next'}</button>
      </div>
      <Thumb url={r.image_url} icon={cat?.icon} />
    </div>
  )
}

function Recipes(p) {
  const { cats, recipes, setView, ready, setSheet } = p
  const [q, setQ] = useState('')
  const hits = q.trim() ? recipes.filter(r => r.title.toLowerCase().includes(q.trim().toLowerCase())) : null
  return (
    <div className="screen">
      <div className="head pagehead">
        <div className="titleblock"><div className="overline">Zonneweg Kitchen</div><h1 className="display">Recipes</h1></div>
        <button className="pill-lime" onClick={() => setSheet('add')}>+ Add</button>
      </div>
      <label className="search">
        <Icon name="search" size={20} />
        <input placeholder={`Search ${recipes.length} recipes`} value={q} onChange={e => setQ(e.target.value)} />
      </label>
      {hits ? (hits.length ? hits.map(r => <RecipeCard key={r.id} r={r} {...p} />) : <div className="empty">No matches</div>) : (
        <>
          <div className="row-between"><h2 className="heading">Categories</h2><button className="link" onClick={() => setView({ type: 'all' })}>All recipes</button></div>
          <div className="grid">
            {cats.map(c => (
              <button key={c.id} className="tile" onClick={() => setView({ type: 'category', id: c.id })}>
                <Icon name={c.icon} size={40} color="var(--green)" />
                <div><div className="name">{c.name}</div><div className="count">{plural(recipes.filter(r => r.category_id === c.id).length, 'recipe')}</div></div>
              </button>
            ))}
          </div>
          <h2 className="heading">Recently added</h2>
          {recipes.slice(0, 6).map(r => <RecipeCard key={r.id} r={r} {...p} />)}
          {ready && recipes.length === 0 && <div className="empty">No recipes yet. Tap + Add to save your first one.</div>}
        </>
      )}
    </div>
  )
}

function Back({ onBack }) {
  return <button className="round" onClick={onBack} aria-label="Back"><Icon name="arrow_back" size={24} /></button>
}

function MiniCard({ r, cats, setView, upNext, toggleQueue }) {
  const inQ = upNext.some(u => u.recipe_id === r.id)
  const cat = cats.find(c => c.id === r.category_id)
  return (
    <div className="mcard" onClick={() => setView({ type: 'recipe', id: r.id })}>
      <div className="mimg"><Thumb url={r.image_url} icon={cat?.icon} />
        <button className={'mq' + (inQ ? ' on' : '')} aria-label={inQ ? 'Remove from Up next' : 'Add to Up next'} onClick={(e) => { e.stopPropagation(); toggleQueue(r) }}><Icon name={inQ ? 'check' : 'add'} size={20} /></button>
      </div>
      <div className="t">{r.title}</div>
      <div className="caption">{[r.minutes && `${r.minutes} min`, plural(r.ingredients.length, 'ingredient')].filter(Boolean).join(' · ')}</div>
    </div>
  )
}

function ViewToggle({ mode, setMode }) {
  const ic = (d) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
  return (
    <div className="seg vt" role="group" aria-label="View">
      <button className={mode === 'list' ? 'on' : ''} aria-label="List view" onClick={() => setMode('list')}>{ic(<><path d="M4 6h16M4 12h16M4 18h16" /></>)}</button>
      <button className={mode === 'cards' ? 'on' : ''} aria-label="Card view" onClick={() => setMode('cards')}>{ic(<><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>)}</button>
    </div>
  )
}

function ListPage({ title, overline, list, onBack, ...p }) {
  const [mode, setModeState] = useState(() => { try { return localStorage.getItem('viewMode') || 'list' } catch { return 'list' } })
  const setMode = (m) => { setModeState(m); try { localStorage.setItem('viewMode', m) } catch { /* ignore */ } }
  return (
    <div className="screen">
      <div className="row-between"><Back onBack={onBack} /><ViewToggle mode={mode} setMode={setMode} /></div>
      <div className="titleblock"><div className="overline">{overline}</div><h1 className="display">{title}</h1></div>
      {!list.length ? <div className="empty">Nothing here yet</div>
        : mode === 'cards' ? <div className="cgrid">{list.map(r => <MiniCard key={r.id} r={r} {...p} />)}</div>
        : list.map(r => <RecipeCard key={r.id} r={r} {...p} />)}
    </div>
  )
}

function useWakeLock(toast) {
  const [on, setOn] = useState(false)
  const lock = useRef(null)
  const acquire = async () => {
    try { lock.current = await navigator.wakeLock.request('screen'); lock.current.addEventListener('release', () => { lock.current = null }) } catch { /* ignore */ }
  }
  useEffect(() => {
    if (!on) return
    const vis = () => { if (document.visibilityState === 'visible' && !lock.current) acquire() }
    document.addEventListener('visibilitychange', vis)
    return () => document.removeEventListener('visibilitychange', vis)
  }, [on])
  useEffect(() => () => { lock.current?.release?.() }, [])
  const toggle = async () => {
    if (on) { await lock.current?.release?.(); lock.current = null; setOn(false); toast('Cook mode off'); return }
    if (!('wakeLock' in navigator)) { toast('Your browser can\u2019t keep the screen awake'); return }
    await acquire()
    if (lock.current) { setOn(true); toast('Cook mode on · screen stays awake') } else toast('Couldn\u2019t keep the screen awake')
  }
  return [on, toggle]
}

function RecipeDetail({ recipe, cats, upNext, addToShopping, onBack, load, setView, toggleQueue, toast }) {
  const [sel, setSel] = useState(() => new Set())
  const [mult, setMult] = useState(1)
  const [done, setDone] = useState(() => new Set())
  const [cook, toggleCook] = useWakeLock(toast)
  const cat = cats.find(c => c.id === recipe.category_id)
  const inQ = upNext.some(u => u.recipe_id === recipe.id)
  const all = sel.size === recipe.ingredients.length
  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const add = async () => {
    await addToShopping(recipe.ingredients.filter(i => sel.has(i.id)).map(i => ({ name: i.name, quantity: scaleQty(i.quantity, mult), aisle: i.aisle, recipe_id: recipe.id })))
    setSel(new Set())
  }
  const del = async () => {
    if (!confirm('Delete this recipe?')) return
    await supabase.from('recipes').delete().eq('id', recipe.id); await load(); setView(null)
  }
  const groups = useMemo(() => {
    const out = []
    for (const i of recipe.ingredients) {
      const g = i.group_name || ''
      let x = out.find(o => o.g === g)
      if (!x) { x = { g, items: [] }; out.push(x) }
      x.items.push(i)
    }
    return out
  }, [recipe.ingredients])
  const steps = useMemo(() => annotate(Array.isArray(recipe.steps) ? recipe.steps : [], recipe.ingredients), [recipe.steps, recipe.ingredients])
  const byId = useMemo(() => Object.fromEntries(recipe.ingredients.map(i => [i.id, i])), [recipe.ingredients])
  const tick = (n) => setDone(d => { const x = new Set(d); x.has(n) ? x.delete(n) : x.add(n); return x })
  return (
    <div className="screen tall">
      <div className="hero">
        {recipe.image_url ? <img src={recipe.image_url} alt="" /> : <Icon name={cat?.icon || 'dinner_dining'} size={72} />}
        <div className="scrim" />
        <Back onBack={onBack} />
        <button className={'cookpill' + (cook ? ' on' : '')} onClick={toggleCook}><span className="dot" />{cook ? 'Cooking' : 'Cook mode'}</button>
      </div>
      <div className="row-between" style={{ marginTop: 8 }}>
        {cat ? <span className="chip">{cat.name}</span> : <span />}
        <button className={'pill-lime' + (inQ ? ' on' : '')} onClick={() => toggleQueue(recipe)}>{inQ ? 'In Up next' : '+ Up next'}</button>
      </div>
      <h1 className="title">{recipe.title}</h1>
      <div className="caption">{[recipe.minutes && `${recipe.minutes} min`, recipe.servings && `Serves ${Math.round(recipe.servings * mult)}`, plural(recipe.ingredients.length, 'ingredient')].filter(Boolean).join(' · ')}</div>
      <div className="seg" role="group" aria-label="Scale recipe">
        {[1, 2, 3].map(m => <button key={m} className={mult === m ? 'on' : ''} onClick={() => setMult(m)}>{m === 1 ? 'Original' : `${m}×`}</button>)}
      </div>
      {recipe.source_url && (
        <a className="source" href={recipe.source_url} target="_blank" rel="noopener noreferrer">
          <div><div className="body-medium">Cook from the original</div><div className="caption">{host(recipe.source_url)}</div></div>
          <Icon name="arrow_outward" size={24} color="var(--green)" />
        </a>
      )}
      <div className="row-between"><h2 className="heading">Ingredients</h2>
        <button className="link" onClick={() => setSel(all ? new Set() : new Set(recipe.ingredients.map(i => i.id)))}>{all ? 'Select none' : 'Select all'}</button></div>
      {groups.map(({ g, items }) => (
        <div key={g}>
          {g && <div className="overline ghead">{g}</div>}
          {items.map(i => (
            <button key={i.id} className="crow" onClick={() => toggle(i.id)} style={{ borderBottom: '1px solid var(--line)' }}>
              <span className={'box' + (sel.has(i.id) ? ' on' : '')}>{sel.has(i.id) && <Icon name="check" size={18} />}</span>
              <Lock q={scaleQty(i.quantity, mult)} n={i.name} />
            </button>
          ))}
        </div>
      ))}
      <h2 className="heading" style={{ marginTop: 12 }}>Method</h2>
      {steps.length === 0 && <div className="muted">No method saved for this recipe{recipe.source_url ? '. Use “Cook from the original” above.' : '.'}</div>}
      <div className="steps">
        {steps.map((st, n) => (
          <div key={n}>
            {st.s && st.s !== steps[n - 1]?.s && <div className="overline ghead" style={{ marginTop: n ? 22 : 0 }}>{st.s}</div>}
            <button className={'step' + (done.has(n) ? ' done' : '')} onClick={() => tick(n)}>
              <span className="snum">{done.has(n) ? <Icon name="check" size={16} /> : n + 1}</span>
              <p>{st.parts.map((p, k) => p.chip ? <span key={k} className="qchip">{scaleQty(byId[p.chip].quantity, mult)}</span> : <React.Fragment key={k}>{p.t}</React.Fragment>)}</p>
            </button>
          </div>
        ))}
      </div>
      <button className="link" style={{ marginTop: 28, color: '#9b2c1f' }} onClick={del}>Delete recipe</button>
      <div className="cta-bar"><button className="cta" disabled={!sel.size} onClick={add}>{sel.size ? `Add ${sel.size} to shopping list` : 'Select ingredients to add'}</button></div>
    </div>
  )
}

function Week({ upNext, recipes, cats, load, addToShopping, setView, setTab, setSheet }) {
  const items = upNext.map(u => ({ u, r: recipes.find(r => r.id === u.recipe_id) })).filter(x => x.r)
  const open = items.filter(x => !x.u.cooked)
  const rm = async (id) => { await supabase.from('up_next').delete().eq('id', id); load() }
  const done = async (x) => { await supabase.from('up_next').update({ cooked: !x.u.cooked }).eq('id', x.u.id); load() }
  const total = open.reduce((n, x) => n + x.r.ingredients.length, 0)
  const addAll = async () => {
    await addToShopping(open.flatMap(x => x.r.ingredients.map(i => ({ name: i.name, quantity: i.quantity, aisle: i.aisle, recipe_id: x.r.id }))))
    setTab('shop')
  }
  return (
    <div className="screen">
      <div className="titleblock pagehead"><div className="overline">{plural(open.length, 'recipe')} queued</div><h1 className="display">Up next</h1></div>
      {items.map((x, n) => (
        <div key={x.u.id} className={'qitem' + (n === 0 ? ' first' : '')} style={{ opacity: x.u.cooked ? .55 : 1 }}>
          <button className="num" onClick={() => done(x)} aria-label="Mark cooked" style={{ justifyContent: 'center' }}>{x.u.cooked ? <Icon name="check" size={18} /> : n + 1}</button>
          <div onClick={() => setView({ type: 'recipe', id: x.r.id })} style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 1, minWidth: 0, cursor: 'pointer' }}>
            <Thumb url={x.r.image_url} icon={cats.find(c => c.id === x.r.category_id)?.icon} size={64} />
            <div className="info"><div className="heading" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.r.title}</div>
              <div className="caption">{[x.r.servings && `Serves ${x.r.servings}`, plural(x.r.ingredients.length, 'ingredient')].filter(Boolean).join(' · ')}</div></div>
          </div>
          <button onClick={() => rm(x.u.id)} aria-label="Remove" style={{ color: 'var(--muted)' }}><Icon name="close" size={22} /></button>
        </div>
      ))}
      <button className="dashed" onClick={() => setTab('recipes')}>+ Add a recipe</button>
      {open.length > 0 && <div className="caption" style={{ textAlign: 'center' }}>{plural(total, 'ingredient')} · merged and sorted by aisle</div>}
      {open.length > 0 && <div className="cta-bar"><button className="cta" onClick={addAll}>Add all to shopping list</button></div>}
    </div>
  )
}

function Shopping({ shop, recipes, load, addToShopping, toast }) {
  const [name, setName] = useState('')
  const [copied, setCopied] = useState(false)
  const [out, setOut] = useState(() => new Set())
  const groups = useMemo(() => {
    const g = {}
    for (const i of shop) (g[i.aisle] ||= []).push(i)
    return AISLES.filter(a => g[a]).map(a => [a, [...g[a]].sort((x, y) => x.checked - y.checked)])
  }, [shop])
  const pool = useMemo(() => {
    const m = new Map()
    const put = (n) => { const x = simplifyName(n); const k = x.toLowerCase(); if (x && x.length < 40 && !m.has(k)) m.set(k, x) }
    shop.forEach(i => put(i.name)); recipes.forEach(r => r.ingredients.forEach(i => put(i.name))); GROCERIES.forEach(put)
    return [...m.values()]
  }, [shop, recipes])
  const typed = splitLine(name)
  const term = typed.name.toLowerCase().trim()
  const suggestions = useMemo(() => {
    if (term.length < 2) return []
    const onList = new Set(shop.filter(i => !i.checked).map(i => i.name.toLowerCase()))
    const scored = []
    for (const c of pool) {
      const l = c.toLowerCase()
      if (l === term || onList.has(l)) continue
      const sc = l.startsWith(term) ? 0 : l.split(' ').some(w => w.startsWith(term)) ? 1 : -1
      if (sc >= 0) scored.push([sc, l.length, c])
    }
    return scored.sort((a, b) => a[0] - b[0]).slice(0, 5).map(x => x[2])
  }, [term, pool, shop])
  const pick = async (n) => { setName(''); await addToShopping([{ name: n, quantity: typed.quantity }]) }
  const left = shop.filter(i => !i.checked).length
  const nChecked = shop.length - left
  const add = async (e) => {
    e.preventDefault()
    const n = name.trim(); if (!n) return
    const { quantity, name: nm } = splitLine(n)
    setName('')
    await addToShopping([{ name: nm, quantity }])
  }
  const toggle = async (i) => { await supabase.from('shopping_items').update({ checked: !i.checked }).eq('id', i.id); load() }
  const remove = async (ids) => {
    setOut(s => new Set([...s, ...ids]))
    await new Promise(r => setTimeout(r, 260))
    await supabase.from('shopping_items').delete().in('id', ids)
    await load(); setOut(new Set())
  }
  const clearAll = async () => { if (confirm('Clear the whole shopping list?')) { await remove(shop.map(i => i.id)); toast('List cleared') } }
  const copy = async () => {
    const text = groups.map(([, items]) => items.filter(i => !i.checked).map(i => `${i.quantity ? i.quantity + ' ' : ''}${i.name}`).join('\n')).filter(Boolean).join('\n')
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { prompt('Copy your list', text) }
  }
  return (
    <div className="screen">
      <div className="head pagehead">
        <div className="titleblock"><div className="overline">{plural(left, 'item')} · sorted by aisle</div><h1 className="display">Shopping list</h1></div>
        <button className="pill-lime" onClick={copy}>{copied ? 'Copied' : 'Copy list'}</button>
      </div>
      <form className="additem" onSubmit={add}>
        <Icon name="add" size={24} />
        <input placeholder="Add an item, e.g. 2 lemons" value={name} enterKeyHint="done" autoComplete="off" autoCorrect="off" onChange={e => setName(e.target.value)} />
        {name.trim() && <button type="submit" className="pill-lime pop" style={{ padding: '8px 16px' }}>Add</button>}
      </form>
      {suggestions.length > 0 && (
        <div className="suggest" role="listbox">
          {suggestions.map(c => {
            const i = c.toLowerCase().indexOf(term)
            return (
              <button key={c} type="button" role="option" onMouseDown={e => e.preventDefault()} onClick={() => pick(c)}>
                <Icon name="add" size={20} />
                <span>{i >= 0 ? <>{c.slice(0, i)}<b>{c.slice(i, i + term.length)}</b>{c.slice(i + term.length)}</> : c}</span>
              </button>
            )
          })}
        </div>
      )}
      {shop.length > 0 && (
        <div className="row-between">
          <button className="link" disabled={!nChecked} style={{ opacity: nChecked ? 1 : .4 }} onClick={() => remove(shop.filter(i => i.checked).map(i => i.id))}>Clear checked{nChecked ? ` (${nChecked})` : ''}</button>
          <button className="link" style={{ color: '#9b2c1f' }} onClick={clearAll}>Clear all</button>
        </div>
      )}
      {shop.length === 0 && <div className="empty">Your list is empty</div>}
      {groups.map(([aisle, items]) => (
        <div key={aisle} className="panel">
          <div className="sh"><div className="overline">{aisleLabel(aisle)}</div><div className="caption">{items.length}</div></div>
          {items.map(i => (
            <div key={i.id} className={'crow srow' + (i.checked ? ' done' : '') + (out.has(i.id) ? ' out' : '')}>
              <button className="srow-main" onClick={() => toggle(i)}>
                <span className={'box' + (i.checked ? ' on' : '')}>{i.checked && <Icon name="check" size={18} />}</span>
                <Lock q={i.quantity} n={i.name} />
              </button>
              <button className="x" aria-label={`Remove ${i.name}`} onClick={() => remove([i.id])}><Icon name="close" size={20} /></button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function AddSheet({ onClose, onLink, onWrite }) {
  const opts = [
    ['link', 'Paste a link', 'Import ingredients and photo from a recipe site', onLink, false],
    ['add_a_photo', 'Scan a photo', 'Coming soon', null, true],
    ['edit_note', 'Write it yourself', 'Type in a recipe from memory or a book', onWrite, false],
  ]
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="grabber" />
        <h2 className="title">Add a recipe</h2>
        {opts.map(([ic, t, s, fn, off]) => (
          <button key={t} className="option" disabled={off} onClick={fn}>
            <span className="ic"><Icon name={ic} size={28} /></span>
            <span className="tx"><div className="body-medium">{t}</div><div className="caption">{s}</div></span>
            <span style={{ color: 'var(--muted)' }}><Chev /></span>
          </button>
        ))}
      </div>
    </div>
  )
}

function CategorySheet({ cats, value, onPick, onClose }) {
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="grabber" />
        <h2 className="title">Choose a category</h2>
        <div className="chips">
          {cats.map(c => <button key={c.id} className={'chip' + (value === c.id ? ' on' : '')} onClick={() => { onPick(c.id); onClose() }}>{c.name}</button>)}
        </div>
      </div>
    </div>
  )
}

function CategorySelect({ cats, value, onChange }) {
  const [open, setOpen] = useState(false)
  const cat = cats.find(c => c.id === value)
  return (
    <>
      <button type="button" className={'select' + (cat ? ' has' : '')} onClick={() => setOpen(true)}>
        <span>{cat ? cat.name : 'Choose'}</span><Chev down />
      </button>
      {open && <CategorySheet cats={cats} value={value} onPick={onChange} onClose={() => setOpen(false)} />}
    </>
  )
}

async function saveRecipe(r, ings) {
  const { data, error } = await supabase.from('recipes').insert({
    title: r.title.trim(), category_id: r.category_id, minutes: r.minutes ? +r.minutes : null, servings: r.servings ? +r.servings : null,
    source_url: r.source_url || null, image_url: r.image_url || null,
    steps: r.steps && r.steps.length ? r.steps : null,
  }).select().single()
  if (error) throw new Error(error.message)
  const rows = ings.filter(i => i.name.trim()).map((i, n) => ({ recipe_id: data.id, position: n, name: i.name.trim(), quantity: (i.quantity || '').trim() || null, aisle: guessAisle(i.name), group_name: i.group || null }))
  if (rows.length) {
    const { error: e2 } = await supabase.from('ingredients').insert(rows)
    if (e2) throw new Error(e2.message)
  }
  return data.id
}

function ImportPage({ cats, load, setView, session, onBack }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [found, setFound] = useState(null)
  const [skip, setSkip] = useState(() => new Set())
  const [showAll, setShowAll] = useState(false)
  const [cat, setCat] = useState(null)

  const fetchIt = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/import', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ url: url.trim() }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Import failed')
      if (!j.found_recipe || !j.ingredients?.length) {
        setView({ type: 'write', draft: { ...j, source_url: url.trim(), ingredients: j.ingredients || [], notice: 'No recipe data found on that page. Fill in what you can.' } })
        setBusy(false); return
      }
      setFound({ ...j, source_url: url.trim() })
    } catch (ex) { setErr(ex.message) }
    setBusy(false)
  }
  const save = async () => {
    setBusy(true); setErr('')
    try {
      const ings = found.ingredients.filter((_, n) => !skip.has(n))
      const id = await saveRecipe({ ...found, category_id: cat }, ings)
      await load(); setView({ type: 'recipe', id })
    } catch (ex) { setErr(ex.message); setBusy(false) }
  }
  const list = found ? (showAll ? found.ingredients : found.ingredients.slice(0, 3)) : []
  return (
    <div className="screen form">
      <Back onBack={onBack} />
      <div className="titleblock" style={{ gap: 8 }}>
        <h1 className="title">Import a recipe</h1>
        <div className="muted">Paste a link from any recipe site. We pull out the ingredients for you.</div>
      </div>
      <div className="urlfield">
        <input type="url" inputMode="url" autoFocus placeholder="Paste a recipe link" value={url} onChange={e => { setUrl(e.target.value); setFound(null) }} />
        {found && <span className="found"><Icon name="check" size={16} /></span>}
      </div>
      {err && <div className="err">{err}</div>}
      {found && (
        <>
          <div className="preview">
            <div className="top">
              <Thumb url={found.image_url} size={72} />
              <div style={{ minWidth: 0 }}>
                <div className="overline">Found {found.ingredients.length} ingredients{found.steps?.length ? ` + ${found.steps.length} steps` : ''}{found.image_url ? ' + photo' : ''}</div>
                <div className="heading">{found.title}</div>
                <div className="caption">{[host(url), found.minutes && `${found.minutes} min`].filter(Boolean).join(' · ')}</div>
              </div>
            </div>
            <hr />
            {list.map((i, n) => (
              <React.Fragment key={n}>
              {i.group && i.group !== list[n - 1]?.group && <div className="overline ghead">{i.group}</div>}
              <button className="crow" onClick={() => setSkip(s => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x })}>
                <span className={'box' + (skip.has(n) ? '' : ' on')}>{!skip.has(n) && <Icon name="check" size={18} />}</span>
                <Lock q={i.quantity} n={i.name} />
              </button>
              </React.Fragment>
            ))}
            {!showAll && found.ingredients.length > 3 && <button className="link" onClick={() => setShowAll(true)}>+ {found.ingredients.length - 3} more ingredients</button>}
          </div>
          <div className="field"><div className="overline">Category</div><CategorySelect cats={cats} value={cat} onChange={setCat} /></div>
        </>
      )}
      <div className="cta-bar low">
        {found
          ? <button className="cta" disabled={busy || !cat} onClick={save}>{busy ? 'Saving…' : cat ? 'Save recipe' : 'Choose a category to save'}</button>
          : <button className="cta" disabled={busy || !url.trim()} onClick={fetchIt}>{busy ? 'Finding recipe…' : 'Find recipe'}</button>}
      </div>
    </div>
  )
}

function WritePage({ cats, load, setView, draft, onBack }) {
  const [title, setTitle] = useState(draft.title || '')
  const [cat, setCat] = useState(null)
  const [servings, setServings] = useState(draft.servings || '')
  const [ings, setIngs] = useState(draft.ingredients?.length ? draft.ingredients.map(i => ({ quantity: i.quantity || '', name: i.name, group: i.group || null })) : [{ quantity: '', name: '' }, { quantity: '', name: '' }, { quantity: '', name: '' }])
  const [method, setMethod] = useState((draft.steps || []).map(x => x.t).join('\n\n'))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const setIng = (n, k, v) => setIngs(a => a.map((x, i) => i === n ? { ...x, [k]: v } : x))
  const ok = title.trim() && cat
  const save = async () => {
    setBusy(true); setErr('')
    try {
      const id = await saveRecipe({ title, category_id: cat, servings, minutes: draft.minutes, source_url: draft.source_url, image_url: draft.image_url, steps: parseMethod(method) }, ings)
      await load(); setView({ type: 'recipe', id })
    } catch (ex) { setErr(ex.message); setBusy(false) }
  }
  return (
    <div className="screen form">
      <Back onBack={onBack} />
      <div className="titleblock"><div className="overline">Write it yourself</div><h1 className="title">New recipe</h1></div>
      {draft.notice && <div className="err">{draft.notice}</div>}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        <div className="photobox">{draft.image_url ? <img src={draft.image_url} alt="" /> : <Icon name="add_a_photo" size={32} />}</div>
        <div className="field" style={{ flex: 1 }}><div className="overline">Recipe name</div><input className="box-in" value={title} onChange={e => setTitle(e.target.value)} /></div>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="field" style={{ flex: 2 }}><div className="overline">Category</div><CategorySelect cats={cats} value={cat} onChange={setCat} /></div>
        <div className="field" style={{ flex: 1 }}><div className="overline">Serves</div><input className="box-in" inputMode="numeric" value={servings} onChange={e => setServings(e.target.value)} /></div>
      </div>
      <div className="field" style={{ gap: 8 }}>
        <div className="overline">Ingredients</div>
        {ings.map((i, n) => (
          <div key={n} className="irow">
            <input className="box-in q" style={{ padding: '12px 14px', borderRadius: 14, minHeight: 48 }} placeholder="Qty" value={i.quantity} onChange={e => setIng(n, 'quantity', e.target.value)} />
            <input className="box-in n" style={{ padding: '12px 14px', borderRadius: 14, minHeight: 48 }} placeholder="Ingredient" value={i.name} onChange={e => setIng(n, 'name', e.target.value)} />
            <button type="button" aria-label="Remove" onClick={() => setIngs(a => a.length > 1 ? a.filter((_, k) => k !== n) : a)}><Icon name="close" size={24} /></button>
          </div>
        ))}
        <button className="link" onClick={() => setIngs(a => [...a, { quantity: '', name: '' }])}>+ Add ingredient</button>
      </div>
      <div className="field"><div className="overline">Method</div><textarea className="box-in" rows={6} placeholder={'One step per paragraph. Mention ingredients by name and their amounts appear inline.'} value={method} onChange={e => setMethod(e.target.value)} style={{ resize: 'vertical' }} /></div>
      {err && <div className="err">{err}</div>}
      <div className="cta-bar low"><button className="cta" disabled={busy || !ok} onClick={save}>{busy ? 'Saving…' : ok ? 'Save recipe' : 'Add a name and category'}</button></div>
    </div>
  )
}
