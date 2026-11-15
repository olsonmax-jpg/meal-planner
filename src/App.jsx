import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from './supabase.js'
import { AISLES, guessAisle } from './aisles.js'
import Icon from './Icon.jsx'

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' } }
const UNIT = '(?:kg|g|gr|ml|l|cl|dl|tsp|tbsp|cups?|oz|lb|pinch|handful|bunch|tins?|cans?|cloves?|slices?|el|tl|blik|bos)'
function splitLine(s) {
  const clean = s.replace(/\s+/g, ' ').trim()
  const m = new RegExp(`^([\\d½¼¾⅓⅔.,/\\- ]+\\s*${UNIT}?\\b\\.?)\\s+(.*)$`, 'i').exec(clean)
  return m && m[2] ? { quantity: m[1].trim(), name: m[2].trim() } : { quantity: '', name: clean }
}

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
    <div className="center">
      <div className="overline">Welcome</div>
      <h1 className="display">What are we<br />eating?</h1>
      <form onSubmit={submit}>
        <div className="field"><input className="input" type="email" required placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" /></div>
        <div className="field"><input className="input" type="password" required placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></div>
        {err && <div className="err">{err}</div>}
        <button className="cta" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  )
}

function Main({ session }) {
  const [tab, setTab] = useState('recipes')
  const [cats, setCats] = useState([])
  const [recipes, setRecipes] = useState([])
  const [upNext, setUpNext] = useState([])
  const [shop, setShop] = useState([])
  const [view, setView] = useState(null) // {type:'category'|'recipe', id}
  const [sheet, setSheet] = useState(null) // 'add' | {type:'form', draft}
  const [ready, setReady] = useState(false)

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
    const ch = supabase.channel('sync')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => load())
      .subscribe()
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { supabase.removeChannel(ch); document.removeEventListener('visibilitychange', onVis) }
  }, [load])

  const addToShopping = async (items) => {
    if (!items.length) return
    const { error } = await supabase.from('shopping_items').insert(items.map(i => ({
      name: i.name, quantity: i.quantity || null, aisle: i.aisle || guessAisle(i.name), recipe_id: i.recipe_id || null,
    })))
    if (error) alert(error.message); else load()
  }

  const ctx = { cats, recipes, upNext, shop, load, addToShopping, setView, setSheet, setTab }
  const recipe = view?.type === 'recipe' ? recipes.find(r => r.id === view.id) : null
  const category = view?.type === 'category' ? cats.find(c => c.id === view.id) : null

  return (
    <div className="app">
      {recipe ? <RecipeDetail recipe={recipe} {...ctx} onBack={() => setView(null)} />
        : category ? <CategoryPage category={category} {...ctx} onBack={() => setView(null)} />
        : tab === 'recipes' ? <Recipes {...ctx} ready={ready} />
        : tab === 'week' ? <Week {...ctx} />
        : <Shopping {...ctx} session={session} />}

      {!view && tab === 'recipes' && (
        <button className="fab" aria-label="Add a recipe" onClick={() => setSheet('add')}><Icon name="add" size={28} /></button>
      )}
      <nav className="tabbar">
        {[['recipes', 'Recipes', 'menu_book'], ['week', 'The Week', 'calendar_month'], ['shop', 'Shopping List', 'shopping_basket']].map(([k, l, i]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setView(null) }}><Icon name={i} size={24} />{l}</button>
        ))}
      </nav>
      {sheet === 'add' && <AddSheet onClose={() => setSheet(null)} onPick={(d) => setSheet({ type: 'form', draft: d })} session={session} />}
      {sheet?.type === 'form' && <RecipeForm draft={sheet.draft} cats={cats} onClose={() => setSheet(null)}
        onSaved={async (id) => { setSheet(null); await load(); setView({ type: 'recipe', id }) }} />}
    </div>
  )
}

function Photo({ url, size, icon = 'dinner_dining' }) {
  const [bad, setBad] = useState(false)
  if (url && !bad) return <img src={url} alt="" loading="lazy" onError={() => setBad(true)} />
  return <div className="photo" style={size ? { width: size, height: size } : undefined}><Icon name={icon} size={32} /></div>
}

function RecipeCard({ r, setView, upNext }) {
  const inQ = upNext.some(u => u.recipe_id === r.id)
  return (
    <button className="card recipe-card" onClick={() => setView({ type: 'recipe', id: r.id })}>
      <Photo url={r.image_url} />
      <div className="meta">
        <div className="t">{r.title}</div>
        <div className="caption">{[r.minutes && `${r.minutes} min`, `${r.ingredients.length} ingredients`].filter(Boolean).join(' · ')}</div>
        {inQ && <div className="caption" style={{ color: 'var(--green)', fontWeight: 500 }}>In The Week</div>}
      </div>
    </button>
  )
}

function Recipes({ cats, recipes, setView, ready, upNext }) {
  const [q, setQ] = useState('')
  const hits = q.trim() ? recipes.filter(r => r.title.toLowerCase().includes(q.trim().toLowerCase())) : null
  return (
    <div className="screen">
      <div className="overline">Zonneweg Kitchen</div>
      <h1 className="display">Recipes</h1>
      <div className="field"><input className="input" placeholder="Search recipes" value={q} onChange={e => setQ(e.target.value)} /></div>
      {hits ? (hits.length ? hits.map(r => <RecipeCard key={r.id} r={r} setView={setView} upNext={upNext} />) : <div className="empty">No matches</div>) : (
        <>
          <div className="grid">
            {cats.map(c => (
              <button key={c.id} className="tile" onClick={() => setView({ type: 'category', id: c.id })}>
                <Icon name={c.icon} size={40} color="var(--green)" />
                <div><div className="name">{c.name}</div><div className="count">{recipes.filter(r => r.category_id === c.id).length}</div></div>
              </button>
            ))}
          </div>
          {ready && recipes.length === 0 && <div className="empty">No recipes yet. Tap + to add your first one.</div>}
        </>
      )}
    </div>
  )
}

function Top({ onBack, title, overline }) {
  return (
    <>
      <button className="round" onClick={onBack} aria-label="Back" style={{ marginBottom: 16 }}><Icon name="arrow_back" size={24} /></button>
      {overline && <div className="overline">{overline}</div>}
      <h1 className="display" style={{ marginTop: 6 }}>{title}</h1>
    </>
  )
}

function CategoryPage({ category, recipes, onBack, setView, upNext }) {
  const list = recipes.filter(r => r.category_id === category.id)
  return (
    <div className="screen">
      <Top onBack={onBack} title={category.name} overline={`${list.length} recipes`} />
      {list.length ? list.map(r => <RecipeCard key={r.id} r={r} setView={setView} upNext={upNext} />) : <div className="empty">Nothing in {category.name} yet</div>}
    </div>
  )
}

function RecipeDetail({ recipe, cats, upNext, addToShopping, onBack, load, setTab, setView }) {
  const [sel, setSel] = useState(() => new Set(recipe.ingredients.map(i => i.id)))
  const [added, setAdded] = useState(false)
  const cat = cats.find(c => c.id === recipe.category_id)
  const inQ = upNext.find(u => u.recipe_id === recipe.id)
  const all = sel.size === recipe.ingredients.length
  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleQ = async () => {
    if (inQ) await supabase.from('up_next').delete().eq('id', inQ.id)
    else await supabase.from('up_next').insert({ recipe_id: recipe.id, position: upNext.length })
    load()
  }
  const add = async () => {
    await addToShopping(recipe.ingredients.filter(i => sel.has(i.id)).map(i => ({ name: i.name, quantity: i.quantity, aisle: i.aisle, recipe_id: recipe.id })))
    setAdded(true); setTimeout(() => setAdded(false), 2000)
  }
  const del = async () => {
    if (!confirm('Delete this recipe?')) return
    await supabase.from('recipes').delete().eq('id', recipe.id); await load(); setView(null)
  }
  return (
    <div className="screen">
      <div className="hero">
        {recipe.image_url ? <img src={recipe.image_url} alt="" /> : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--green)' }}><Icon name="dinner_dining" size={72} /></div>}
        <button className="round back" onClick={onBack} aria-label="Back"><Icon name="arrow_back" size={24} /></button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '20px 0 12px' }}>
        {cat ? <span className="chip">{cat.name}</span> : <span />}
        <button className={'pill-lime' + (inQ ? ' on' : '')} onClick={toggleQ}>{inQ ? 'In The Week' : '+ The Week'}</button>
      </div>
      <h1 className="title">{recipe.title}</h1>
      <div className="caption" style={{ marginTop: 8 }}>{[recipe.minutes && `${recipe.minutes} min`, recipe.servings && `Serves ${recipe.servings}`, `${recipe.ingredients.length} ingredients`].filter(Boolean).join(' · ')}</div>
      {recipe.source_url && (
        <a className="source" href={recipe.source_url} target="_blank" rel="noopener noreferrer">
          <div><div className="body-medium">Cook from the original</div><div className="caption">{host(recipe.source_url)}</div></div>
          <Icon name="arrow_outward" size={24} color="var(--green)" />
        </a>
      )}
      {!recipe.source_url && <div style={{ height: 22 }} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="heading">Ingredients</h2>
        <button className="link-btn" onClick={() => setSel(all ? new Set() : new Set(recipe.ingredients.map(i => i.id)))}>{all ? 'Select none' : 'Select all'}</button>
      </div>
      <div style={{ marginBottom: 96 }}>
        {recipe.ingredients.map(i => (
          <button key={i.id} className="row" onClick={() => toggle(i.id)}>
            <span className={'box' + (sel.has(i.id) ? ' on' : '')}>{sel.has(i.id) && <Icon name="check" size={18} />}</span>
            <span>{i.name}</span><span className="qty">{i.quantity}</span>
          </button>
        ))}
        <button className="link-btn" style={{ marginTop: 28, color: '#9b2c1f' }} onClick={del}>Delete recipe</button>
      </div>
      <div className="cta-bar"><button className="cta" disabled={!sel.size} onClick={add}>{added ? 'Added to shopping list' : `Add ${sel.size} to shopping list`}</button></div>
    </div>
  )
}

function Week({ upNext, recipes, load, addToShopping, setView, setTab }) {
  const items = upNext.map(u => ({ u, r: recipes.find(r => r.id === u.recipe_id) })).filter(x => x.r)
  const open = items.filter(x => !x.u.cooked)
  const rm = async (id) => { await supabase.from('up_next').delete().eq('id', id); load() }
  const cooked = async (x) => { await supabase.from('up_next').update({ cooked: !x.u.cooked }).eq('id', x.u.id); load() }
  const addAll = async () => {
    await addToShopping(open.flatMap(x => x.r.ingredients.map(i => ({ name: i.name, quantity: i.quantity, aisle: i.aisle, recipe_id: x.r.id }))))
    setTab('shop')
  }
  return (
    <div className="screen">
      <div className="overline">Up next</div>
      <h1 className="display">The Week</h1>
      {items.length === 0 && <div className="empty">Nothing planned. Open a recipe and tap + The Week.</div>}
      {items.map(x => (
        <div key={x.u.id} className="card recipe-card" style={{ opacity: x.u.cooked ? .55 : 1 }}>
          <button onClick={() => setView({ type: 'recipe', id: x.r.id })} style={{ display: 'flex', gap: 14, alignItems: 'center', flex: 1, minWidth: 0, textAlign: 'left' }}>
            <Photo url={x.r.image_url} /><div className="meta"><div className="t">{x.r.title}</div><div className="caption">{x.r.ingredients.length} ingredients</div></div>
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="round" onClick={() => cooked(x)} aria-label="Mark cooked" style={{ background: x.u.cooked ? 'var(--green)' : 'var(--sage)', color: x.u.cooked ? 'var(--lime)' : 'var(--green)' }}><Icon name="check" size={22} /></button>
            <button className="round" onClick={() => rm(x.u.id)} aria-label="Remove" style={{ background: 'var(--cream)' }}><Icon name="close" size={22} /></button>
          </div>
        </div>
      ))}
      {open.length > 0 && <div className="cta-bar"><button className="cta" onClick={addAll}>Add all ingredients to shopping list</button></div>}
    </div>
  )
}

function Shopping({ shop, load }) {
  const [name, setName] = useState('')
  const [copied, setCopied] = useState(false)
  const groups = useMemo(() => {
    const g = {}
    for (const i of shop) (g[i.aisle] ||= []).push(i)
    return AISLES.filter(a => g[a]).map(a => [a, g[a].sort((x, y) => x.checked - y.checked)])
  }, [shop])
  const left = shop.filter(i => !i.checked).length
  const add = async (e) => {
    e.preventDefault()
    const n = name.trim(); if (!n) return
    const { quantity, name: nm } = splitLine(n)
    setName('')
    await supabase.from('shopping_items').insert({ name: nm, quantity: quantity || null, aisle: guessAisle(nm) })
    load()
  }
  const toggle = async (i) => { await supabase.from('shopping_items').update({ checked: !i.checked }).eq('id', i.id); load() }
  const clear = async () => { await supabase.from('shopping_items').delete().eq('checked', true); load() }
  const copy = async () => {
    const text = groups.map(([a, items]) => items.filter(i => !i.checked).map(i => `${i.quantity ? i.quantity + ' ' : ''}${i.name}`).join('\n')).filter(Boolean).join('\n')
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { prompt('Copy your list', text) }
  }
  return (
    <div className="screen">
      <div className="overline">{left} items · sorted by aisle</div>
      <h1 className="display">Shopping List</h1>
      <form className="add-row" onSubmit={add}>
        <input className="input" placeholder="Add an item, e.g. 2 lemons" value={name} onChange={e => setName(e.target.value)} />
        <button aria-label="Add"><Icon name="add" size={26} /></button>
      </form>
      <div className="caption">We pick the aisle</div>
      {shop.length === 0 && <div className="empty">Your list is empty</div>}
      {groups.map(([aisle, items]) => (
        <div key={aisle} className="aisle">
          <div className="overline">{aisle}</div>
          {items.map(i => (
            <button key={i.id} className={'row' + (i.checked ? ' done' : '')} onClick={() => toggle(i)}>
              <span className={'box' + (i.checked ? ' on' : '')}>{i.checked && <Icon name="check" size={18} />}</span>
              <span className="nm">{i.name}</span><span className="qty">{i.quantity}</span>
            </button>
          ))}
        </div>
      ))}
      {shop.length > 0 && (
        <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
          <button className="chip" onClick={copy}>{copied ? 'Copied' : 'Copy list'}</button>
          {shop.some(i => i.checked) && <button className="chip" onClick={clear}>Clear checked</button>}
        </div>
      )}
    </div>
  )
}

function AddSheet({ onClose, onPick, session }) {
  const [mode, setMode] = useState(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const doImport = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      const r = await fetch('/api/import', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ url: url.trim() }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Import failed')
      onPick({ ...j, ingredientsText: j.ingredients.map(i => `${i.quantity} ${i.name}`.trim()).join('\n'), notice: j.found_recipe ? '' : 'No recipe data found on that page. Fill in what you can.' })
    } catch (ex) { setErr(ex.message) }
    setBusy(false)
  }
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <h2 className="title" style={{ marginBottom: 18 }}>Add a recipe</h2>
        {!mode ? (
          <>
            <button className="option" onClick={() => setMode('link')}><span className="ic"><Icon name="link" size={28} /></span><span><div className="body-medium">Import from a link</div><div className="caption">We pull the photo and ingredients</div></span></button>
            <button className="option" disabled><span className="ic"><Icon name="document_scanner" size={28} /></span><span><div className="body-medium">Scan a recipe</div><div className="caption">Coming soon</div></span></button>
            <button className="option" onClick={() => onPick({ ingredientsText: '' })}><span className="ic"><Icon name="edit_note" size={28} /></span><span><div className="body-medium">Write it yourself</div><div className="caption">From a cookbook</div></span></button>
          </>
        ) : (
          <form onSubmit={doImport}>
            <div className="field"><input className="input" type="url" required autoFocus placeholder="Paste a recipe link" value={url} onChange={e => setUrl(e.target.value)} /></div>
            {err && <div className="err">{err}</div>}
            <button className="cta" disabled={busy}>{busy ? 'Importing…' : 'Import'}</button>
          </form>
        )}
      </div>
    </div>
  )
}

function RecipeForm({ draft, cats, onClose, onSaved }) {
  const [f, setF] = useState({ title: draft.title || '', category_id: null, minutes: draft.minutes || '', servings: draft.servings || '', source_url: draft.source_url || '', image_url: draft.image_url || '', ingredientsText: draft.ingredientsText || '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }))
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    const { data, error } = await supabase.from('recipes').insert({
      title: f.title.trim(), category_id: f.category_id, minutes: f.minutes ? +f.minutes : null, servings: f.servings ? +f.servings : null,
      source_url: f.source_url.trim() || null, image_url: f.image_url.trim() || null,
    }).select().single()
    if (error) { setErr(error.message); setBusy(false); return }
    const lines = f.ingredientsText.split('\n').map(s => s.trim()).filter(Boolean)
    if (lines.length) {
      const { error: e2 } = await supabase.from('ingredients').insert(lines.map((l, i) => { const p = splitLine(l); return { recipe_id: data.id, position: i, name: p.name, quantity: p.quantity || null, aisle: guessAisle(p.name) } }))
      if (e2) { setErr(e2.message); setBusy(false); return }
    }
    onSaved(data.id)
  }
  return (
    <div className="sheet-bg" onClick={onClose}>
      <form className="sheet" onClick={e => e.stopPropagation()} onSubmit={save}>
        <h2 className="title" style={{ marginBottom: 6 }}>{draft.source_url ? 'Check your recipe' : 'Write a recipe'}</h2>
        {draft.notice && <div className="err">{draft.notice}</div>}
        {draft.image_url && <div style={{ height: 140, borderRadius: 18, overflow: 'hidden', margin: '12px 0' }}><Photo url={draft.image_url} /></div>}
        <div className="field"><label className="label">Title</label><input className="input" required value={f.title} onChange={set('title')} /></div>
        <div className="field"><label className="label">Category</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {cats.map(c => <button type="button" key={c.id} className={'chip' + (f.category_id === c.id ? ' on' : '')} onClick={() => setF(s => ({ ...s, category_id: c.id }))}>{c.name}</button>)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="field" style={{ flex: 1 }}><label className="label">Minutes</label><input className="input" inputMode="numeric" value={f.minutes} onChange={set('minutes')} /></div>
          <div className="field" style={{ flex: 1 }}><label className="label">Serves</label><input className="input" inputMode="numeric" value={f.servings} onChange={set('servings')} /></div>
        </div>
        <div className="field"><label className="label">Ingredients (one per line)</label><textarea className="input" rows={7} placeholder={'800 g chicken thighs\n2 red onions'} value={f.ingredientsText} onChange={set('ingredientsText')} /></div>
        <div className="field"><label className="label">Original link (optional)</label><input className="input" type="url" value={f.source_url} onChange={set('source_url')} /></div>
        {err && <div className="err">{err}</div>}
        <button className="cta" disabled={busy || !f.title.trim()}>{busy ? 'Saving…' : 'Save recipe'}</button>
      </form>
    </div>
  )
}
