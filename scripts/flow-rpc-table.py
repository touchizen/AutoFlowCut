#!/usr/bin/env python3
"""rpc_table.py — flow-xhr-capture.jsonl → rpcid 표(마스킹) + rpcid 별 샘플.
사용: python3 rpc_table.py capture.jsonl [--since T] [--marks T1:label,T2:label] [--out-md X] [--out-jsonl Y] [--verbose]
"""
import json, re, sys, collections, urllib.parse, argparse

class Masker:
    def __init__(self): self.uuid = {}; self.num = {}
    def _u(self, v):
        if v not in self.uuid: self.uuid[v] = f'<uuid#{len(self.uuid)+1}>'
        return self.uuid[v]
    def _n(self, v):
        if v not in self.num: self.num[v] = f'<id#{len(self.num)+1}>'
        return self.num[v]
    def mask(self, s):
        if not isinstance(s, str): s = json.dumps(s, ensure_ascii=False)
        s = re.sub(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', lambda m: self._u(m.group(0).lower()), s)
        s = re.sub(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '<email>', s)
        s = re.sub(r'(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/=_-]{200,}', lambda m: f'<b64 {len(m.group(0))} chars>', s)
        s = re.sub(r'https://lh3\.googleusercontent\.com/[^"\s\\]+', '<lh3-url>', s)
        s = re.sub(r'(at=)[^&\s]+', r'\1<at>', s)
        s = re.sub(r'(f\.sid=)[^&\s]+', r'\1<f.sid>', s)
        s = re.sub(r'(Signature=)[^&\s"]+', r'\1<sig>', s)
        s = re.sub(r'(?<!\d)\d{15,}(?!\d)', lambda m: self._n(m.group(0)), s)
        return s

def parse_response(text):
    out = []
    if not text: return out
    t = text[4:] if text.startswith(")]}'") else text
    dec = json.JSONDecoder(); i = 0; n = len(t)
    lenline = re.compile(r'[ \t\r]*(\d+)[ \t\r]*\n')
    while i < n:
        m = lenline.match(t, i)
        if m: i = m.end(); continue
        c = t[i]
        if c in ' \n\r\t': i += 1; continue
        if c != '[':
            j = t.find('\n', i); i = n if j < 0 else j + 1; continue
        try: obj, j = dec.raw_decode(t, i)
        except json.JSONDecodeError:
            j = t.find('\n', i); i = n if j < 0 else j + 1; continue
        i = j
        if not isinstance(obj, list): continue
        for item in obj:
            if not (isinstance(item, list) and item): continue
            if item[0] == 'wrb.fr':
                payload = item[2] if len(item) > 2 else None
                parsed = payload
                if isinstance(payload, str):
                    try: parsed = json.loads(payload)
                    except Exception: parsed = payload
                out.append({'rpcid': item[1], 'payload': parsed, 'tail': item[3:]})
            elif item[0] == 'er':
                out.append({'rpcid': None, 'er': item})
    return out

def parse_request(body):
    if not body: return None
    q = urllib.parse.parse_qs(body, keep_blank_values=True)
    freq = q.get('f.req', [None])[0]; at = q.get('at', [None])[0]
    calls = []
    if freq:
        try:
            for grp in json.loads(freq):
                for call in grp:
                    payload = call[1] if len(call) > 1 else None
                    parsed = payload
                    if isinstance(payload, str):
                        try: parsed = json.loads(payload)
                        except Exception: parsed = payload
                    calls.append({'rpcid': call[0], 'payload': parsed, 'tail': call[2:]})
        except Exception as e:
            calls.append({'rpcid': None, 'payload': freq, 'error': str(e)})
    return {'calls': calls, 'at_present': at is not None, 'at_len': len(at) if at else 0,
            'other_fields': sorted(k for k in q if k not in ('f.req', 'at'))}

def query_fields(url):
    try: u = urllib.parse.urlsplit(url); return dict((k, v[0]) for k, v in urllib.parse.parse_qs(u.query).items())
    except Exception: return {}

def compact(obj, limit):
    s = json.dumps(obj, ensure_ascii=False, separators=(',', ':')) if not isinstance(obj, str) else obj
    return s if len(s) <= limit else s[:limit] + f'…(+{len(s)-limit})'

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('jsonl'); ap.add_argument('--since', type=float, default=0); ap.add_argument('--until', type=float, default=1e18)
    ap.add_argument('--marks', default=''); ap.add_argument('--out-md'); ap.add_argument('--out-jsonl'); ap.add_argument('--verbose', action='store_true')
    ap.add_argument('--req-limit', type=int, default=700); ap.add_argument('--resp-limit', type=int, default=1200)
    a = ap.parse_args()
    marks = []
    for part in filter(None, a.marks.split(',')):
        t, label = part.split(':', 1); marks.append((float(t), label))
    marks.sort()
    def phase(t):
        lab = 'start'
        for mt, ml in marks:
            if t >= mt: lab = ml
        return lab
    rows = [json.loads(l) for l in open(a.jsonl) if l.strip()]
    rows = [r for r in rows if a.since <= r.get('t', 0) <= a.until]
    t0 = min((r['t'] for r in rows), default=0)
    M = Masker()
    by = collections.OrderedDict()
    wiz_keys = None; headers_seen = collections.Counter(); url_fields = collections.Counter(); hosts = collections.Counter()
    other = collections.Counter()
    for r in rows:
        src = r.get('source')
        if src == 'wiz':
            try: wiz_keys = sorted(json.loads(r['wiz']).keys())
            except Exception: pass
            continue
        url = r.get('url') or ''
        if 'batchexecute' not in url:
            other[(src, r.get('method'), re.sub(r'\?.*', '', M.mask(url))[:100], r.get('status'))] += 1
            continue
        qf = query_fields(url); url_fields.update(qf.keys())
        try: hosts[urllib.parse.urlsplit(url).hostname] += 1
        except Exception: pass
        for k, v in (r.get('reqHeaders') or {}).items(): headers_seen[f'{k}: {v}'] += 1
        req = parse_request(r.get('reqBody'))
        resp = parse_response(r.get('respBody')) if src == 'xhr' else []
        rpcids = r.get('rpcids') or ([x for x in qf.get('rpcids', '').split(',') if x] if qf.get('rpcids') else [])
        for rid in rpcids or ['?']:
            e = by.setdefault(rid, {'first': r['t'], 'last': r['t'], 'n_req': 0, 'n_resp': 0, 'phases': collections.Counter(), 'statuses': collections.Counter(),
                                    'req_samples': [], 'resp_samples': [], 'errors': [], 'sources': collections.Counter(), 'source_paths': collections.Counter(),
                                    'req_fields': collections.Counter(), 'raw_sample': None})
            e['first'] = min(e['first'], r['t']); e['last'] = max(e['last'], r['t']); e['sources'][src] += 1; e['phases'][phase(r['t'])] += 1
            e['source_paths'][M.mask(qf.get('source-path', ''))] += 1
            if req:
                e['req_fields'].update(req['other_fields'] + (['at'] if req['at_present'] else []))
                for c in req['calls']:
                    if c['rpcid'] == rid or len(rpcids) == 1:
                        e['n_req'] += 1
                        if len(e['req_samples']) < 3: e['req_samples'].append({'t': r['t'], 'phase': phase(r['t']), 'payload': c['payload'], 'tail': c.get('tail')})
            if src == 'xhr':
                e['statuses'][r.get('status')] += 1
                for c in resp:
                    if c.get('rpcid') == rid:
                        e['n_resp'] += 1
                        if len(e['resp_samples']) < 3: e['resp_samples'].append({'t': r['t'], 'phase': phase(r['t']), 'payload': c['payload'], 'tail': c.get('tail')})
                    elif c.get('er'):
                        e['errors'].append(c['er'])
                if e['raw_sample'] is None:
                    e['raw_sample'] = {'rpcid': rid, 'url': M.mask(url), 'reqHeaders': r.get('reqHeaders'), 'status': r.get('status'),
                                       'reqBody': M.mask(urllib.parse.unquote_plus(r.get('reqBody') or '')), 'respBody': M.mask((r.get('respBody') or '')[:20000])}
    out = []
    out.append(f'# batchexecute 캡처 표 — {len(rows)} entries, t0={t0}')
    out.append(f'- hosts: {dict(hosts)}')
    out.append(f'- URL query fields: {sorted(url_fields)}')
    out.append(f'- XHR request headers: {[k for k, _ in headers_seen.most_common()]}')
    out.append(f'- WIZ_global_data keys: {wiz_keys}')
    out.append(f'- non-batchexecute entries: {[(k, n) for k, n in other.most_common(20)]}')
    out.append('')
    out.append('| rpcid | first (+s) | phases | n_req | n_resp | status | source-path | req payload | resp payload |')
    out.append('|---|---|---|---|---|---|---|---|---|')
    for rid, e in sorted(by.items(), key=lambda kv: kv[1]['first']):
        rq = M.mask(compact(e['req_samples'][0]['payload'], 220)) if e['req_samples'] else '-'
        rs = M.mask(compact(e['resp_samples'][0]['payload'], 220)) if e['resp_samples'] else '-'
        cell = lambda s: s.replace('|', '\\|').replace('\n', ' ')
        out.append(f"| `{rid}` | {(e['first']-t0)/1000:.1f} | {dict(e['phases'])} | {e['n_req']} | {e['n_resp']} | {dict(e['statuses'])} | {cell(', '.join(f'{k}×{v}' for k, v in e['source_paths'].most_common(2)))} | {cell(rq)} | {cell(rs)} |")
    out.append('')
    for rid, e in sorted(by.items(), key=lambda kv: kv[1]['first']):
        out.append(f'## `{rid}` — req {e["n_req"]} / resp {e["n_resp"]} / sources {dict(e["sources"])} / phases {dict(e["phases"])}')
        for s in e['req_samples'][:2]:
            out.append(f'- request ({s["phase"]}, +{(s["t"]-t0)/1000:.1f}s):\n```json\n{M.mask(compact(s["payload"], a.req_limit))}\n```')
        for s in e['resp_samples'][:2]:
            out.append(f'- response ({s["phase"]}, +{(s["t"]-t0)/1000:.1f}s):\n```json\n{M.mask(compact(s["payload"], a.resp_limit))}\n```')
        if e['errors']: out.append(f'- errors: {M.mask(compact(e["errors"][:3], 400))}')
        out.append('')
    text = '\n'.join(out)
    if a.out_md: open(a.out_md, 'w').write(text)
    if a.out_jsonl:
        with open(a.out_jsonl, 'w') as f:
            for rid, e in by.items():
                if e['raw_sample']: f.write(json.dumps(e['raw_sample'], ensure_ascii=False) + '\n')
    if a.verbose or not a.out_md: print(text)
    else: print(f'rpcids: {len(by)} → {a.out_md}')
    print('mask map (uuids):', len(M.uuid), 'ids:', len(M.num), file=sys.stderr)
main()
