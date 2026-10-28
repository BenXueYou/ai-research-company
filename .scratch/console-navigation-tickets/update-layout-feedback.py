from pathlib import Path
import json
import os
import subprocess
import urllib.request

root = Path(__file__).resolve().parent
os.environ['GIT_TERMINAL_PROMPT'] = '0'
os.environ['GCM_INTERACTIVE'] = 'Never'
result = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n', text=True, capture_output=True, check=True)
credentials = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
url = 'https://api.github.com/repos/BenXueYou/ai-research-company/issues/34'
headers = {'Authorization': 'Bearer ' + credentials['password'], 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}

def request(method='GET', payload=None):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=data, method=method, headers={**headers, 'Content-Type': 'application/json; charset=utf-8'})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)

before = request()
addition = (root / 'layout-feedback-2026-10-28.md').read_text(encoding='utf-8').strip()
marker = '<!-- console-layout-feedback-2026-10-28 -->'
assert marker not in before['body'], 'Supplement already present; review before updating again.'
body = before['body'].rstrip() + '\n\n' + addition + '\n'
updated = request('PATCH', {'body': body})
verified = request()
assert verified['body'] == body
assert verified['state'] == before['state']
assert verified['title'] == before['title']
(root / '01-issue.md').write_text(body, encoding='utf-8')
(root / 'issue34-after-layout-feedback.json').write_text(json.dumps(verified, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'number': verified['number'], 'url': verified['html_url'], 'state': verified['state'], 'body_verified': True, 'original_body_preserved': body.startswith(before['body'].rstrip())}, ensure_ascii=True))
