import importlib.util, json, os, subprocess, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('deploy_server',HERE/'deploy-server.py')
server=importlib.util.module_from_spec(spec);spec.loader.exec_module(server)
PAYLOAD=dict(image_digest='sha256:'+'a'*64,source_commit='b'*40,version='0.0.2',registry_user='maxffarrell',registry_token='test-only')
class DeploymentTests(unittest.TestCase):
 def test_session_timestamp_creation_lag_without_allowing_extension(self):
  created='2026-10-13T00:00:00.001Z'
  self.assertTrue(server.valid_session_lifetime(created,'2026-10-13T00:08:00.000Z'))
  self.assertTrue(server.valid_session_lifetime(created,'2026-10-13T00:08:00.001Z'))
  self.assertFalse(server.valid_session_lifetime(created,'2026-10-13T00:08:00.002Z'))
  self.assertFalse(server.valid_session_lifetime(created,'2026-10-13T00:07:58.999Z'))
 def test_rejects_untrusted_image_or_version(self):
  for field,value in [('image_digest','evil/image:latest'),('source_commit',';sh'),('version','../x'),('registry_user','x;sh')]:
   with self.subTest(field=field), self.assertRaises(ValueError):server.validate('leroa',dict(PAYLOAD,**{field:value}))
 def test_failed_verification_restores_database_and_image(self):
  calls=[]
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);(root/'leroa').mkdir()
   def run(args,**kw):
    calls.append(args)
    if 'pg_dump' in args:kw['stdout'].write(b'backup')
   real_temp=tempfile.TemporaryDirectory
   with patch.object(server,'ROOT',root),patch.object(server,'run',run),patch.object(server.os,'chdir'),patch.object(server.subprocess,'check_output',return_value='sha256:old\n'),patch.object(server,'ready'),patch.object(server,'verify',side_effect=RuntimeError('regression')),patch.object(server.tempfile,'TemporaryDirectory',side_effect=lambda **kw:real_temp()):
    with self.assertRaisesRegex(RuntimeError,'previous image and database restored'):server.deploy('leroa',PAYLOAD)
   restore=next(i for i,a in enumerate(calls) if 'pg_restore' in a)
   retag=next(i for i,a in enumerate(calls) if a[:3]==['docker','tag','sha256:old'] and a[-1].endswith(':latest'))
   self.assertIn('--create',calls[restore])
   self.assertIn('--exit-on-error',calls[restore])
   self.assertEqual(calls[restore][calls[restore].index('-d')+1],'postgres')
   self.assertNotIn('--single-transaction',calls[restore])
   self.assertLess(restore,retag)
   self.assertEqual(calls[-1],['docker','compose','up','-d','--no-build','--pull','never'])
class PlanTests(unittest.TestCase):
 def plan(self,event_name,old,new,before_zero=False):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder)
   def git(*args):return subprocess.check_output(['git',*args],cwd=root,stderr=subprocess.DEVNULL,text=True).strip()
   git('init');git('config','user.email','test@example.invalid');git('config','user.name','Test')
   (root/'package.json').write_text(json.dumps({'version':old}));git('add','.');git('commit','-m','Initial');before=git('rev-parse','HEAD')
   (root/'package.json').write_text(json.dumps({'version':new}));(root/'event.json').write_text(json.dumps({'before':'0'*40 if before_zero else before}))
   if event_name=='workflow_dispatch':git('tag','v'+new)
   env=dict(os.environ,GITHUB_EVENT_NAME=event_name,GITHUB_EVENT_PATH=str(root/'event.json'),GITHUB_OUTPUT=str(root/'output'))
   subprocess.run(['node',str(HERE.resolve()/'plan.mjs')],cwd=root,env=env,check=True)
   return (root/'output').read_text()
 def test_ordinary_commit_does_not_deploy(self):self.assertIn('deploy=false',self.plan('push','0.0.1','0.0.1'))
 def test_version_merge_deploys(self):self.assertIn('deploy=true',self.plan('push','0.0.1','0.0.2'))
 def test_manual_retry_deploys(self):self.assertIn('deploy=true',self.plan('workflow_dispatch','0.0.1','0.0.1'))
 def test_pr_never_deploys(self):self.assertIn('deploy=false',self.plan('pull_request','0.0.1','0.0.2'))
 def test_initial_push_does_not_deploy(self):self.assertIn('deploy=false',self.plan('push','0.0.1','0.0.2',True))
if __name__=='__main__':unittest.main()
