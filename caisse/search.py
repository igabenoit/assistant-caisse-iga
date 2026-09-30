"""Conservative retrieval: never composes or invents procedure text.
A future intent resolver may return verified document IDs, never its own answer.
"""
import re
import unicodedata
from difflib import SequenceMatcher
from functools import lru_cache

UNKNOWN = "Je n’ai pas cette information. Demande au superviseur."
STOP = set('le la les l j un une des de du d au aux a et est c ce ces cet cette quoi quel quelle quels quelles je tu il elle on nous vous ils elles me mon ma mes pour comment faire fais fait faut faire peux peut puis dois doit que qui en avec dans sur svp stp s y ai as avez il merci si mais indique affiche produit code plu acheter vend vendre voudrais veux cherche rechercher trouve trouver appelle appeler'.split())
ALIASES = {'remboursement':'retour','rembourser':'retour','retourner':'retour','rembourse':'retour','rembourserai':'retour','ticket':'facture','recu':'facture','recu':'facture','paiement':'payer','paye':'payer','passe':'accepte','passee':'accepte','passé':'accepte','cadeaux':'cadeau','biologique':'bio','biologiques':'bio','organic':'bio','cilantro':'coriandre','scallion':'echalote','erreurs':'erreur','fonctionne':'fonctionner','marche':'fonctionner'}

def normalize(s):
    return re.sub(r'[^a-z0-9]+', ' ', ''.join(c for c in unicodedata.normalize('NFD',str(s).lower()) if unicodedata.category(c) != 'Mn')).strip()

def tokens(s, stop=True):
    words = normalize(s).split()
    result=[]
    for w in words:
        if stop and w in STOP: continue
        w=ALIASES.get(w,w)
        if len(w)>4 and w.endswith('s'): w=w[:-1]
        result.append(w)
    return result

@lru_cache(maxsize=32768)
def sim(a,b,partial=False):
    if a==b: return 1.0
    # A guessed digit could change a package size or a code.
    if any(c.isdigit() for c in a+b): return 0
    if partial and len(a)>=3 and b.startswith(a): return 0.94
    if min(len(a),len(b))>=4:
        r=SequenceMatcher(None,a,b).ratio()
        if r>=0.78: return r*0.92
    return 0

@lru_cache(maxsize=16384)
def product_words(name, keywords, category):
    return tuple(tokens(name+' '+keywords+' '+category))

def product_results(query, products):
    # Preserve punctuation and leading zeroes: A-1 and A.1 are distinct codes.
    raw=query.strip()
    for code_query in [raw,re.sub(r'^(?:code|plu)(?:\s*[:#]\s*|\s+)', '', raw, flags=re.I)]:
        exact=[p for p in products if p['code']==code_query]
        if not exact: exact=[p for p in products if p['code'].casefold()==code_query.casefold()]
        if exact: return sorted(exact,key=lambda p:p['name'])
    q=tokens(query)
    if not q: return []
    ranked=[]
    for p in products:
        if q==[p['code'].casefold()]: ranked.append((3,2,2,p)); continue
        words=product_words(p['name'],p['keywords'],p['category'])
        scores=[]
        for t in q:
            score=max((sim(t,w,True) for w in words),default=0)
            if score<.70: break
            scores.append(score)
        if len(scores)!=len(q): continue
        name_tokens=tokens(p['name'])
        priority=2 if normalize(query)==normalize(p['name']) else 1 if q==name_tokens else 0
        ranked.append((priority,min(scores),sum(scores)/len(scores),p))
    # Exact names precede varieties/keywords. Never guess a digit or omit bio.
    if any(minimum>=.94 for _,minimum,_,_ in ranked):
        ranked=[r for r in ranked if r[1]>=.94]
    return [p for _,_,_,p in sorted(ranked,key=lambda x:(-x[0],-x[2],normalize(x[3]['name']),x[3]['code']))][:40]

def knowledge_results(query, documents):
    q=tokens(query)
    if not q: return []
    ranked=[]
    for doc in documents:
        best=0
        for phrase in [doc['title']]+re.split(r'[;|\n]',doc['keywords']):
            p=tokens(phrase)
            if len(p)<2: continue
            qs=[max((sim(t,w) for w in p),default=0) for t in q]
            ps=[max((sim(t,w) for w in q),default=0) for t in p]
            # Both directions, including qualifiers (sans/avec, facture, débit, etc.).
            # Unknown modifiers must never cause an unrelated procedure to be asserted.
            if min(qs,default=0)<0.7 or min(ps,default=0)<0.7: continue
            if ('sans' in q)!=('sans' in p): continue
            best=max(best,(sum(qs)/len(qs)+sum(ps)/len(ps))/2)
        if best>=0.80: ranked.append((best,doc))
    return [d for _,d in sorted(ranked,key=lambda x:-x[0])][:5]

def looks_question(query):
    n=normalize(query)
    return any(w in n.split() for w in ['comment','pourquoi','remboursement','retour','facture','paiement','debit','poste','procedure','client','cadeau','superviseur','erreur','politique']) or ('?' in query and 'code' not in n and 'plu' not in n)

def resolve(query, products, documents):
    ps=product_results(query,products)
    if ps: return {'kind':'product','products':ps,'answers':[],'found':True}
    docs=knowledge_results(query,documents)
    if len(docs)==1: return {'kind':'question','products':[],'answers':docs,'found':True}
    if len(docs)>1:
        return {'kind':'question','products':[],'answers':[], 'suggestions':[{'id':d['id'],'title':d['title'],'demo':d['demo']} for d in docs],'found':False,'message':'Plusieurs procédures correspondent. Précise ta question ou choisis le sujet exact.'}
    return {'kind':'question' if looks_question(query) else 'product','products':[],'answers':[],'found':False,'message':UNKNOWN}
