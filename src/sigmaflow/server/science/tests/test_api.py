"""HTTP/SSE protocol checks against `npm run dev` (standard library only)."""
import json
import os
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

BASE=os.environ.get('CS_BASE_URL','http://127.0.0.1:5173')
results=[]
def call(path,body=None,origin=None):
    headers={'Content-Type':'application/json'}
    if origin: headers['Origin']=origin
    request=Request(BASE+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
    with urlopen(request,timeout=5) as response:
        return json.load(response)
def check(name):
    results.append({'test':name,'status':'passed'});print('PASS:',name,flush=True)

assert call('/api/health')['demo'] is True
check('Health explicitly identifies a demo backend')
run=call('/api/runs',{'prompt':'Protocol test','steps':[{'title':'Metadata','tool':'input.inspect'},{'title':'Report','tool':'report.export'}]})
id=run['id']
assert call('/api/runs/'+id)['status']=='running'
check('Create and read a task')
with urlopen(BASE+'/api/runs/'+id+'/events',timeout=5) as stream:
    assert stream.headers['Content-Type']=='text/event-stream'
    assert stream.readline().decode().strip()=='event: state'
    snapshot=json.loads(stream.readline().decode()[6:])
    assert snapshot['isDemo'] is True and snapshot['id']==id
check('SSE emits a valid state snapshot')
call('/api/runs/'+id+'/control',{'action':'pause'})
a=call('/api/runs/'+id)['progress'];time.sleep(1)
assert call('/api/runs/'+id)['progress']==a
call('/api/runs/'+id+'/control',{'action':'resume'})
time.sleep(.9)
assert call('/api/runs/'+id)['progress']>a
check('Server-side pause and resume')
call('/api/runs/'+id+'/control',{'action':'cancel'})
assert call('/api/runs/'+id)['status']=='cancelled'
try:
    call('/api/runs/'+id+'/control',{'action':'resume'})
    raise AssertionError('Expected 409')
except HTTPError as err:
    assert err.code==409
check('Cancellation is terminal')
for body in [{'prompt':'','steps':[]},{'prompt':'ok','steps':[]}]:
    try:
        call('/api/runs',body);raise AssertionError('Expected 400')
    except HTTPError as err:
        assert err.code==400
check('Invalid request validation')
try:
    call('/api/runs',{'prompt':'test','steps':[{}]},origin='https://untrusted.invalid')
    raise AssertionError('Expected 403')
except HTTPError as err:
    assert err.code==403
check('Cross-origin demo writes are rejected')
for url in ['/server.mjs','/package.json','/js/../../server.mjs']:
    try:
        urlopen(BASE+url,timeout=3);raise AssertionError('Expected 404')
    except HTTPError as err:
        assert err.code==404
check('Server source and unlisted paths are not served')
with urlopen(BASE+'/',timeout=3) as response:
    assert 'Content-Security-Policy' in response.headers
    assert 'SigmaFlow Science' in response.read().decode()
check('Static entrypoint and security headers')
(Path(__file__).parent/'api-results.json').write_text(json.dumps({'tests':results,'count':len(results)},ensure_ascii=False,indent=2))
print(f'\n{len(results)} API protocol checks passed.')
