from pathlib import Path
import os
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
p = root / '原型设计/原型V2.html'
s = p.read_text(encoding='utf-8')
s = s.replace("'Segoe UI','Microsoft YaHei','PingFang SC',sans-serif", "'Microsoft YaHei','PingFang SC','Segoe UI',sans-serif")
s = s.replace('body[data-variant=C] #archiveRows{overflow:auto}', 'body[data-variant=C] #archiveRows{overflow:auto}body[data-variant=C] #archiveRows table{min-width:540px}body[data-variant=C] #archiveRows td:first-child{min-width:160px}')
p.write_text(s, encoding='utf-8')

# Capture only this prototype on a throwaway branch. Never touch the user's index,
# current branch, or other in-progress files.
index_path = Path(tempfile.gettempdir()) / 'codex-v2-prototype-capture.index'
env = {**os.environ, 'GIT_INDEX_FILE': str(index_path)}
def git(*args):
    return subprocess.check_output(['git', *args], cwd=root, env=env, text=True, encoding='utf-8').strip()
try:
    git('read-tree','HEAD')
    git('add','--','原型设计/原型V2.html','原型设计/原型V2-设计说明.md')
    tree = git('write-tree')
    commit = git('commit-tree', tree, '-p', 'HEAD', '-m', 'Prototype reference-style V2: three light workspace layouts; verdict pending selection')
    git('update-ref','refs/heads/codex/prototype-v2-reference-style',commit)
    print('Prototype snapshot:', commit)
    print('Current branch:', git('branch','--show-current'))
finally:
    index_path.unlink(missing_ok=True)
