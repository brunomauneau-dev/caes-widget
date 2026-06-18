#!/usr/bin/env python3
"""Construit un index hybride léger pour parcoursup-kb-v1.json.
Sorties :
- parcoursup-kb-v2.json : KB enrichie avec champs search_text, source_weight, related_ids
- parcoursup-kb-index-v2.json : index inversé compact + relations
"""
import json, re, math, unicodedata, hashlib
from pathlib import Path
from collections import defaultdict, Counter
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent
KB_IN = ROOT / 'parcoursup-kb-v1.json'
KB_OUT = ROOT / 'parcoursup-kb-v2.json'
INDEX_OUT = ROOT / 'parcoursup-kb-index-v2.json'

STOP = set('''avec dans pour plus moins cette ces des les une un aux sur par que qui quoi dont etre est sont avoir du de la le l d a et ou il elle ils elles candidat candidats parcoursup dossier question demande vous votre vos leur leurs nos mes ses son sa au aux ce cet cette donc afin cela comme mais ne pas oui non en on se si au cas tout tous toute toutes depuis entre lors sans vers afin rubrique page voir peut peuvent faut doit dois conseil conseils formation formations voeux voeu vœu vœux sous'''.split())

SOURCE_WEIGHTS = {
    'officiel_interne': 1.00,
    'officiel_public': 0.96,
    'rapport_public': 0.88,
    'opendata': 0.86,
    'doctrine_saio': 0.78,
    'note_locale': 0.70,
}

def norm(s):
    s = str(s or '').lower()
    s = unicodedata.normalize('NFD', s)
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

def toks(s):
    return [w for w in norm(s).split() if len(w) >= 3 and w not in STOP]

def stable_hash(text):
    return hashlib.sha1(text.encode('utf-8')).hexdigest()[:12]

def main():
    data = json.loads(KB_IN.read_text(encoding='utf-8'))
    entries = data.get('entries', [])
    by_id = {}
    doc_tokens = {}
    df = Counter()

    for e in entries:
        eid = e.get('id') or stable_hash((e.get('title','') + e.get('content','')))
        e['id'] = eid
        tags = e.get('tags') or []
        text = ' '.join([e.get('title',''), e.get('parent',''), ' '.join(tags), e.get('summary',''), e.get('content','')])
        tokens = toks(text)
        doc_tokens[eid] = tokens
        for t in set(tokens):
            df[t] += 1
        tw = SOURCE_WEIGHTS.get(e.get('trust_level'), 0.75)
        e['source_weight'] = tw
        e['search_text'] = norm(' '.join([e.get('title',''), ' '.join(tags), e.get('summary','')]))
        by_id[eid] = e

    N = max(len(entries), 1)
    index = defaultdict(list)
    for e in entries:
        eid = e['id']
        counts = Counter(doc_tokens[eid])
        # Keep informative terms only.
        for t, c in counts.items():
            if df[t] > max(80, N * 0.25):
                continue
            idf = math.log((N + 1) / (df[t] + 1)) + 1
            weight = round((1 + math.log(c)) * idf * e.get('source_weight', 0.75), 4)
            if weight >= 1.25:
                index[t].append([eid, weight])

    # Keep top postings per term.
    compact = {}
    for t, postings in index.items():
        postings.sort(key=lambda x: x[1], reverse=True)
        compact[t] = postings[:80]

    # Lightweight related graph by tag overlap + same parent.
    tag_sets = {}
    for e in entries:
        tag_sets[e['id']] = set(toks(' '.join(e.get('tags') or []) + ' ' + e.get('title','')))
    parent_map = defaultdict(list)
    for e in entries:
        if e.get('parent'):
            parent_map[e.get('parent')].append(e['id'])
    related = {}
    for e in entries:
        eid = e['id']
        candidates = set()
        if e.get('parent'):
            candidates.update(parent_map[e.get('parent')][:40])
        own = tag_sets[eid]
        for other_id, other_tags in tag_sets.items():
            if other_id == eid: continue
            if len(own & other_tags) >= 2:
                candidates.add(other_id)
        scored = []
        for oid in candidates:
            if oid == eid: continue
            ov = len(own & tag_sets[oid])
            same_parent = 1 if by_id[oid].get('parent') == e.get('parent') else 0
            score = ov * 2 + same_parent
            if score > 0:
                scored.append((score, oid))
        scored.sort(reverse=True)
        rel = [oid for _, oid in scored[:5]]
        e['related_ids'] = rel
        if rel: related[eid] = rel

    data['meta'] = data.get('meta', {})
    data['meta'].update({
        'schema': 'parcoursup-kb-v2-hybrid',
        'version': 'v2-hybrid-index',
        'built_at': datetime.now(timezone.utc).isoformat(),
        'entry_count': len(entries),
        'index_terms': len(compact),
        'features': ['source_weighting', 'inverted_index', 'related_ids', 'debug_trace']
    })

    idx = {
        'meta': {
            'schema': 'parcoursup-kb-index-v2',
            'built_at': data['meta']['built_at'],
            'entry_count': len(entries),
            'term_count': len(compact),
            'source_weights': SOURCE_WEIGHTS,
            'note': 'Index lexical pondéré + relations légères. Ne contient pas d’embeddings externes.'
        },
        'index': compact,
        'related': related
    }
    KB_OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    INDEX_OUT.write_text(json.dumps(idx, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'OK: {len(entries)} fiches, {len(compact)} termes')

if __name__ == '__main__':
    main()
