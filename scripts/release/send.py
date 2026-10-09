import json, os, subprocess
from pathlib import Path
os.umask(0o077)
key=Path('/tmp/demo-release-key')
key.write_text(os.environ['DEMO_SSH_KEY'].rstrip()+'\n')
try:
 payload=dict(image_digest=os.environ['IMAGE_DIGEST'], registry_user=os.environ['GITHUB_ACTOR'], registry_token=os.environ['GH_TOKEN'], source_commit=os.environ['SOURCE_COMMIT'], version=os.environ['RELEASE_VERSION'])
 subprocess.run(['ssh','-i',str(key),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile=scripts/release/known_hosts','-o','ConnectTimeout=15','root@173.249.220.229','deploy'], input=json.dumps(payload),text=True,check=True,timeout=900)
finally:
 key.unlink(missing_ok=True)
