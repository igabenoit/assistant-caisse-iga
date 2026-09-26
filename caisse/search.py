"""Conservative retrieval: never composes or invents procedure text.
A future intent resolver may return verified document IDs, never its own answer.
"""
import re
import unicodedata
from difflib import SequenceMatcher

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

def sim(a,b,partial=False):
    if a==b: return 1.0
    if partial and len(a)>=3 and b.startswith(a): return 0.94
    if min(len(a),len(b))>=4:
        r=SequenceMatcher(None,a,b).ratio()
        if r>=0.78: return r*0.92
    return 0

def product_results(query, products):
    q=tokens(query)
    if not q: return []
    ranked=[]
    for p in products:
        if normalize(query)==normalize(p['code']): ranked.append((2,p)); continue
        words=tokens(p['name']+' '+p['keywords']+' '+p['category'])
        scores=[max((sim(t,w,True) for w in words),default=0) for t in q]
        # Every meaningful token must match. "banane bio" must not return conventional bananas.
        if min(scores,default=0)>=0.70:
            ranked.append((sum(scores)/len(scores),p))
    return [p for _,p in sorted(ranked,key=lambda x:(-x[0],x[1]['name']))][:40]

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
