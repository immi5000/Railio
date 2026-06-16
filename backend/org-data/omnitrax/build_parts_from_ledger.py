# One-off: parse the OmniTRAX/MOEL NetSuite "Stock Ledger" PDF into parts.json.
# Coordinate-based extraction (PyMuPDF): words are bucketed into visual rows by
# Y, assigned to columns by X, then re-assembled into one part per ledger ITEM
# (Total qty/value when present, else summed locations). Pre-passes stitch ITEM
# numbers that wrap across lines. Requires PyMuPDF (`pip install pymupdf`).
# Update PDF path below and re-run to regenerate parts.json, then `load_org omnitrax`.
import fitz, json, re
from collections import defaultdict

PDF='/Users/imranhusain/Downloads/Stock Ledger - NetSuite (OmniTRAX)MOEL.pdf'
doc=fitz.open(PDF)
COLS=[('item',30,80),('location',80,131),('description',131,203),('inv_class',203,227),
      ('department',227,270),('subsidiary',270,314),('qty',314,351),('avg_cost',351,388),('value',388,440)]
def col_for(x):
    for n,lo,hi in COLS:
        if lo<=x<hi: return n

def page_rows(page):
    words=page.get_text('words')
    d=defaultdict(lambda: defaultdict(list))
    for x0,y0,x1,y1,t,*_ in words:
        if t.strip()=='':continue
        ymid=round((y0+y1)/2);key=None
        for k in list(d.keys()):
            if abs(k-ymid)<=3:key=k;break
        if key is None:key=ymid
        c=col_for(x0)
        if c:d[key][c].append((x0,t))
    out=[]
    for y in sorted(d):
        if y<58 or y>765: continue   # page top/bottom margins only
        cells={c:' '.join(t for _,t in sorted(ws)) for c,ws in d[y].items()}
        blob=' '.join(cells.values())
        # Skip the repeated column-header rows and the running page title/footer.
        if 'BEGINNING' in blob or cells.get('item','').strip()=='ITEM': continue
        if 'Stock Ledger' in blob or 'OmniTRAX' in blob: continue
        if cells.get('qty','').strip() in ('INV QTY','ON-HAND'): continue
        out.append(cells)
    return out

rows=[]
for pg in doc: rows.extend(page_rows(pg))

def only_item(r):
    it=r.get('item','').strip()
    others=any(r.get(k,'').strip() for k in ['location','description','qty','avg_cost','value','department','subsidiary','inv_class'])
    return it if (it and not others) else None

# --- Pre-pass: stitch wrapped ITEM-column lines ---
# An item value ending in '-' on an otherwise-empty row is wrapped; the next
# item-only fragment completes it (covers 'Total - L-' + '40004235' and
# 'L-' + '1990333AESS-UX').
def has_data(r):
    return any(r.get(k,'').strip() for k in ['location','description','qty','avg_cost','value'])

# --- Pre-pass: stitch wrapped ITEM-column part numbers ---
# A part number too long for the column wraps: the head row holds '<base>-' (or
# 'Total - <base>-') with no other data; the suffix is the first token of the
# NEXT row's item cell. We append the suffix to the head and remove just that
# token from the next row, leaving any location data on that next row intact so
# it attaches to the completed item.
stitched=[]
i=0
while i<len(rows):
    r=dict(rows[i])
    it=r.get('item','').strip()
    guard=0
    while it.endswith('-') and not has_data(r) and i+1<len(rows) and guard<5:
        nxt=dict(rows[i+1])
        frag=nxt.get('item','').strip()
        if not frag or frag.startswith('Total'):
            break
        toks=frag.split(' ', 1)
        it = it + toks[0]
        nxt['item'] = toks[1] if len(toks) > 1 else ''
        r['item'] = it
        rows[i+1] = nxt
        if has_data(nxt) or nxt['item']:
            # suffix row carries this item's data (locations) — keep it as the
            # next row to process normally; stop extending the head here.
            break
        i += 1   # suffix row fully consumed
        guard += 1
    r['item'] = it
    stitched.append(r)
    i += 1
rows = stitched

# Second pre-pass: 'Total - <base>-' wraps where the suffix is a bare item row.
# The Total row carries qty/value, so the generic stitch above skips it.
fixed=[]
j=0
while j<len(rows):
    r=dict(rows[j]); it=r.get('item','').strip()
    if it.startswith('Total -') and it.endswith('-') and j+1<len(rows):
        nxt=rows[j+1]; frag=nxt.get('item','').strip()
        nother=any(nxt.get(k,'').strip() for k in ['location','description','qty','avg_cost','value'])
        if frag and not frag.startswith('Total') and not nother:
            tok=frag.split(' ',1)[0]
            r['item']=it+tok
            fixed.append(r); j+=2; continue
    fixed.append(r); j+=1
rows=fixed

# Third pre-pass: item-number wrap where the HEAD row also carries location data
# (e.g. item 'L-' with a location/qty on the same line, suffix on the next row's
# item cell). Absorb the next row's leading item token into the head's number;
# the head keeps its own location data.
def _data(r):
    return any(r.get(k,'').strip() for k in ['location','qty','avg_cost','value'])
patched=[]
k=0
while k<len(rows):
    r=dict(rows[k]); it=r.get('item','').strip()
    if it.endswith('-') and not it.startswith('Total') and k+1<len(rows):
        nxt=dict(rows[k+1]); frag=nxt.get('item','').strip()
        if frag and not frag.startswith('Total'):
            tok=frag.split(' ',1)[0]
            r['item']=it+tok
            nxt['item']=(frag.split(' ',1)[1] if ' ' in frag else '')
            patched.append(r)
            # keep the remainder of the suffix row only if it still has data/desc
            if nxt.get('item') or any(nxt.get(c,'').strip() for c in ['location','description','qty','avg_cost','value']):
                rows[k+1]=nxt
                k+=1; continue
            else:
                k+=2; continue
    patched.append(r); k+=1
rows=patched



def money(s):
    if not s: return None
    s=s.replace('$','').replace(',','').strip()
    try: return float(s)
    except: return None
def qnum(s):
    if not s: return None
    try: return float(s.replace(',','').strip())
    except: return None

items={}; order=[]; cur=None
def new_item(pn):
    if pn not in items:
        items[pn]={'part_number':pn,'description':'','inv_class':None,'department':None,
                   'subsidiary':None,'locations':[],'_tq':None,'_tv':None}
        order.append(pn)
    return items[pn]
def push(it,loc,desc,cls,dept,subs,qty,cost,val):
    it['locations'].append({'location':loc,'qty':qty,'avg_cost':cost,'value':val,'desc':desc or ''})
    if cls and not it['inv_class']: it['inv_class']=cls
    if dept and not it['department']: it['department']=dept
    if subs and not it['subsidiary']: it['subsidiary']=subs

for r in rows:
    item=r.get('item','').strip(); loc=r.get('location','').strip()
    if item.startswith('Total -'):
        pn=item[len('Total -'):].strip()
        it=items.get(pn) or new_item(pn)
        it['_tq']=qnum(r.get('qty')); it['_tv']=money(r.get('value'))
        cur=None; continue
    if item:
        if loc or r.get('qty'):
            it=new_item(item); cur=it
            push(it,loc,r.get('description','').strip(),r.get('inv_class','').strip(),
                 r.get('department','').strip(),r.get('subsidiary','').strip(),
                 qnum(r.get('qty')),money(r.get('avg_cost')),money(r.get('value')))
        else:
            cur=new_item(item)
        continue
    if cur is None: continue
    if r.get('qty') or r.get('value'):
        push(cur,loc,r.get('description','').strip(),r.get('inv_class','').strip(),
             r.get('department','').strip(),r.get('subsidiary','').strip(),
             qnum(r.get('qty')),money(r.get('avg_cost')),money(r.get('value')))
    else:
        if cur['locations']:
            last=cur['locations'][-1]
            if loc: last['location']=(last['location']+' '+loc).strip()
            d=r.get('description','').strip()
            if d: last['desc']=(last.get('desc','')+' '+d).strip()

parts=[]
for pn in order:
    it=items[pn]; locs=it['locations']
    tq=it['_tq'] if it['_tq'] is not None else sum(l['qty'] or 0 for l in locs)
    tv=it['_tv'] if it['_tv'] is not None else sum(l['value'] or 0 for l in locs)
    qty=int(round(tq)) if tq is not None else 0
    avg=round(tv/tq,2) if tq else (locs[0]['avg_cost'] if locs else None)
    names=[l['location'] for l in locs if l['location']]
    binloc=(names[0] if len(names)==1 else (f'Multiple — {len(names)} locations' if names else None))
    cand=[re.sub(r'\s+',' ',l.get('desc','')).strip() for l in locs]
    cand=[c for c in cand if c]
    desc=max(cand,key=len) if cand else pn
    parts.append({'part_number':pn,'name':desc,'description':desc,'compatible_units':[],
        'bin_location':binloc,'qty_on_hand':qty,
        'avg_cost':avg,'on_hand_value':round(tv,2) if tv is not None else None,
        'locations':[{'location':re.sub(r'\s+',' ',l['location']).strip(),
                      'qty':int(round(l['qty'])) if l['qty'] is not None else 0,
                      'avg_cost':l['avg_cost'],'value':l['value']} for l in locs],
        'department':it['department'],'subsidiary':it['subsidiary'],'inv_class':it['inv_class']})

print('TOTAL ITEMS:',len(parts))
print('no-loc:',sum(1 for p in parts if not p['locations']),
      '| desc==pn:',sum(1 for p in parts if p['description']==p['part_number']),
      '| qty==0:',sum(1 for p in parts if p['qty_on_hand']==0))
for pn in ['L-8478045','L-9526885','5437-165','L-40004235','40004235','L-1990333AESS-UX']:
    m=[p for p in parts if p['part_number']==pn]
    if m:
        p=m[0]; print(pn,'-> qty=%s val=%s locs=%s'%(p['qty_on_hand'],p['on_hand_value'],len(p['locations'])))
    else: print(pn,'-> NOT FOUND')
# Drop the ledger grand-total footer row (not a real part).
parts=[pp for pp in parts if pp['part_number'].strip().lower()!='total']
# Normalize the wrapped '- No Class -' label.
for pp in parts:
    if pp.get('inv_class') and pp['inv_class'].strip()=='- No':
        pp['inv_class']='- No Class -'
# Strip residual trailing-dash artifacts from part numbers (empty wrap suffix).
seen=set()
for pp in parts:
    if pp['part_number'].endswith('-'):
        pp['part_number']=pp['part_number'][:-1]
# Drop exact-duplicate part numbers created by cleanup, merging is unnecessary
# here since none collided in practice; assert uniqueness instead.
pns=[pp['part_number'] for pp in parts]
assert len(pns)==len(set(pns)), 'duplicate part_number after cleanup: '+str([x for x in pns if pns.count(x)>1][:5])

json.dump(parts,open('/tmp/omnitrax_parts.json','w'),indent=2)
