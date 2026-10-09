#!/usr/bin/env python3
"""Installed by an administrator; invoked only by an app-scoped forced SSH command."""
import fcntl, html.parser, http.cookiejar, json, os, re, subprocess, sys, tempfile, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path('/opt/demos')
APPS={'leroa':3001,'tredaro':3002,'freeweight':3003}
def run(args, **kw):
 return subprocess.run(args,check=True,timeout=kw.pop('timeout',120),**kw)
def validate(app, payload):
 if app not in APPS: raise ValueError('Unknown app')
 for name,pattern in [('image_digest',r'sha256:[a-f0-9]{64}'),('source_commit',r'[a-f0-9]{40}'),('version',r'\d+\.\d+\.\d+'),('registry_user',r'[A-Za-z0-9_-]+')]:
  if not re.fullmatch(pattern,payload.get(name,'')): raise ValueError('Invalid '+name)
 if not isinstance(payload.get('registry_token'),str) or not payload['registry_token']: raise ValueError('Missing registry credential')
class Timer(html.parser.HTMLParser):
 def __init__(self): super().__init__(); self.active=False; self.value=''
 def handle_starttag(self,tag,attrs):
  if dict(attrs).get('role')=='timer': self.active=True
 def handle_endtag(self,tag):
  if tag=='span':self.active=False
 def handle_data(self,data):
  if self.active:self.value+=data

def verify(app):
 base=f'https://{app}.173.249.220.229.nip.io'
 jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
 def get(path):
  with client.open(base+path,timeout=30) as r:return r.geturl(),r.read().decode()
 url,login=get('/login')
 if 'Try the live demo' not in login:raise RuntimeError('Demo login missing')
 request=urllib.request.Request(base+'/demo',data=b'',headers={'Origin':base,'Content-Type':'application/x-www-form-urlencoded'})
 with client.open(request,timeout=60) as r:
  if not r.geturl().endswith('/dashboard'):raise RuntimeError('Demo creation failed')
 session=json.loads(get('/api/auth/get-session')[1])['session']
 parse=lambda s:datetime.fromisoformat(s.replace('Z','+00:00'))
 if (parse(session['expiresAt'])-parse(session['createdAt'])).total_seconds()!=480:raise RuntimeError('Session lifetime changed')
 def timer():
  url,body=get('/dashboard');p=Timer();p.feed(body)
  if not url.endswith('/dashboard') or not re.fullmatch(r'\d+:\d{2}',p.value.strip()):raise RuntimeError('Demo countdown missing')
  m,s=map(int,p.value.strip().split(':'));return m*60+s
 first=timer();time.sleep(2);second=timer()
 if not 0<second<first<=480:raise RuntimeError('Countdown failed')
 if json.loads(get('/api/auth/get-session')[1])['session']['expiresAt']!=session['expiresAt']:raise RuntimeError('Session refreshed')
 sid=session['id']
 if not re.fullmatch(r'[A-Za-z0-9_-]+',sid):raise RuntimeError('Invalid session ID')
 run(['docker','exec','-i',app+'-db-1','psql','-U',app,'-d',app,'-v','ON_ERROR_STOP=1','-At'],input=f"UPDATE session SET expires_at=now()-INTERVAL '1 second' WHERE id='{sid}';",text=True,stdout=subprocess.DEVNULL)
 url,_=get('/dashboard')
 if urllib.parse.urlsplit(url).path!='/login':raise RuntimeError('Expired session accepted')
 run(['systemctl','is-active','--quiet','caddy','demo-cpu-guard.timer'])
 health=subprocess.check_output(['docker','inspect','--format','{{.State.Health.Status}}',app+'-db-1'],text=True).strip()
 if health!='healthy':raise RuntimeError('Database unhealthy')
 print(app+': HTTPS demo, countdown, fixed expiry, database and CPU guard verified',flush=True)
def ready(app):
 for _ in range(60):
  try:
   with urllib.request.urlopen(f'http://127.0.0.1:{APPS[app]}/login',timeout=2) as r:
    if r.status==200:return
  except Exception:pass
  time.sleep(1)
 raise RuntimeError('App did not become ready')
def deploy(app,payload):
 validate(app,payload)
 os.chdir(ROOT/app)
 image='ghcr.io/maxffarrell/'+app
 immutable=image+'@'+payload['image_digest']
 with tempfile.TemporaryDirectory(prefix='demo-registry-',dir='/run') as config:
  env=dict(os.environ,DOCKER_CONFIG=config)
  run(['docker','login','ghcr.io','--username',payload['registry_user'],'--password-stdin'],input=payload['registry_token'],text=True,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  run(['docker','pull',immutable],env=env,timeout=300)
 old=subprocess.check_output(['docker','inspect','--format','{{.Image}}',app+'-app-1'],text=True).strip()
 stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 rollback=image+':rollback-'+stamp
 run(['docker','tag',old,rollback])
 folder=ROOT/'backups'/app;folder.mkdir(parents=True,exist_ok=True)
 backup=folder/(stamp+'.dump'); backed_up=False
 try:
  run(['docker','compose','stop','app'])
  with backup.open('wb') as f:run(['docker','exec',app+'-db-1','pg_dump','-U',app,'-d',app,'-Fc'],stdout=f)
  if not backup.stat().st_size:raise RuntimeError('Empty database backup')
  backed_up=True
  run(['docker','tag',immutable,image+':latest'])
  run(['docker','compose','up','-d','--no-build','--pull','never'])
  ready(app);verify(app)
  Path('release.json').write_text(json.dumps({k:payload[k] for k in ['image_digest','source_commit','version']}))
  print(f'{app} release {payload["version"]} deployed; rollback tag {rollback}',flush=True)
 except Exception:
  print('Deployment failed; restoring previous release',file=sys.stderr,flush=True)
  run(['docker','compose','stop','app'])
  if backed_up:
   with backup.open('rb') as f:run(['docker','exec','-i',app+'-db-1','pg_restore','-U',app,'-d',app,'--clean','--if-exists','--no-owner','--single-transaction'],stdin=f)
  run(['docker','tag',old,image+':latest'])
  run(['docker','compose','up','-d','--no-build','--pull','never'])
  ready(app)
  raise RuntimeError('Release rejected; previous image and database restored') from None

def main():
 os.umask(0o077)
 app=sys.argv[1]
 if app not in APPS:raise ValueError('Unknown app')
 command=os.environ.get('SSH_ORIGINAL_COMMAND','')
 if command=='probe':print('Restricted deployment key ready for '+app);return
 if command!='deploy':raise ValueError('Only deploy and probe commands are permitted')
 payload=json.loads(sys.stdin.read(16384));validate(app,payload)
 with open('/run/lock/demo-release.lock','w') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX);deploy(app,payload)
if __name__=='__main__':
 try:main()
 except Exception as e:
  # Never emit request contents, credentials, or subprocess arguments.
  print('Demo deployment failed: '+type(e).__name__,file=sys.stderr);sys.exit(1)
