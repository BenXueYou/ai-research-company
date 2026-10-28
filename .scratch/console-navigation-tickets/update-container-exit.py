from pathlib import Path
import json
import os
import subprocess
import urllib.request

root = Path(__file__).resolve().parent
marker = '<!-- console-container-exit-2026-10-28 -->'
shared = '''## 应用根组件与兼容容器退出约定（2026-10-28）

依据用户确认的《控制台角色导航与页面迁移 Spec》v1.2「应用根组件与兼容容器的职责及退出条件」。Vue Router 管理路由，不替代应用根组件；保留 `App.vue` 组合身份界面、公共布局及 `RouterView`，按职责拆分公共逻辑。Pinia / Router 安装位于 `main.ts`，角色准入守卫位于路由模块，会话状态归会话 store。

`CompatWorkspace.vue` 仅为分批迁移保留旧业务实例与上下文，不是 Router 的必需组件，也不是最终布局。URL、菜单或 `EmptyRoute.vue` 占位不能作为独立业务页完成证据。

### 本票补充验收

'''
framework = '''- [ ] 公共框架保留应用根组件及公共布局、身份门禁和真实路由出口；不把业务组件重新集中堆入 `App.vue`。按 Spec 分清根组件、入口安装、路由守卫、会话 store 与页面生命周期的职责。
- [ ] 逐业务迁移票落实真实页面接入及旧兼容挂载退出；保留尚未迁移模块的角色条件和必要实例状态，不因引入 Router 直接删除整个兼容容器。
- [ ] 维护退出标准：迁移时移除对应旧挂载、专用 `target`、兼容路径判断及滚动定位，不与独立页重复挂载或发请求；验证表单、提交中、结果未确认、权限及会话切换。
- [ ] 全部角色的兼容模块迁移及相关业务验收完成、无剩余调用方后，由最后一个移出模块的票完成全局清理：删除 `CompatWorkspace.vue`、导入与挂载、`workspaceVisited`、`isCompatPath` 及剩余兼容专用逻辑，核对引用并汇总验证。公共框架完成不代表该全局退出已完成。
'''
business = '''- [ ] 核对本票页面的真实路由、兼容容器原挂载及角色条件、参数绑定和跨组件事件依赖；完成页面接入时同步移除本模块旧兼容挂载及仅服务本模块的 `target`、路径判断、滚动定位和手写导航。若本票没有对应旧挂载，记录核对结论；共享逻辑仍有调用方时保留，不重复挂载业务实例或发请求。
- [ ] 明确离开、返回、同组件参数更新及会话切换的生命周期策略，保留必要草稿、原请求标识、幂等及结果未确认上下文；仅按需要限定页面缓存，不统一缓存所有页面，不把缓存视为跨刷新恢复。
- [ ] 记录迁移前后请求值及来源，不同适用标识使用不同测试值；验证权限允许/拒绝、相关业务结果、切页返回、深链直达刷新、前进后退及无额外业务请求、收费操作或重复提交。交付中列明实际验证和未验证流程。
- [ ] 若本票移出后已没有任何角色依赖兼容模块，承担最终清理并核对全局引用：删除 `CompatWorkspace.vue`、其导入和挂载、`workspaceVisited`、`isCompatPath` 及剩余兼容专用逻辑，汇总相关验收；若仍有兼容模块，记录剩余范围并继续保留，不宣称已完成全局退出。保留 `App.vue` 应用根职责。
'''
ending = '\n本补充规定实施与退出验收要求，不表示当前模块已迁移或票据已完成；业务规则、接口契约、原验收项、状态与依赖保持原票约定。\n\n' + marker + '\n'

os.environ['GIT_TERMINAL_PROMPT'] = '0'
os.environ['GCM_INTERACTIVE'] = 'Never'
credential_result = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n', text=True, capture_output=True, check=True)
credentials = dict(line.split('=', 1) for line in credential_result.stdout.splitlines() if '=' in line)
headers = {'Authorization': 'Bearer ' + credentials['password'], 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json; charset=utf-8'}

def request(number, method='GET', payload=None):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(f'https://api.github.com/repos/BenXueYou/ai-research-company/issues/{number}', data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)

plans = []
for number in [34, *range(37, 60)]:
    before = request(number)
    if marker in (before.get('body') or ''):
        print(f'#{number}: already contains supplement', flush=True)
        continue
    body = (before.get('body') or '').rstrip() + '\n\n' + shared + (framework if number == 34 else business) + ending
    (root / f'issue{number}-before-container-exit.json').write_text(json.dumps(before, ensure_ascii=False, indent=2), encoding='utf-8')
    (root / f'issue{number}-container-exit-body.md').write_text(body, encoding='utf-8')
    plans.append((number, before, body))
print(f'Prepared {len(plans)} issue bodies', flush=True)

for number, before, body in plans:
    latest = request(number)
    assert latest['body'] == before['body'], f'#{number}: body changed; review before updating'
    request(number, 'PATCH', {'body': body})
    verified = request(number)
    assert verified['body'] == body
    assert verified['state'] == latest['state']
    assert verified['title'] == latest['title']
    assert verified['body'].startswith((before.get('body') or '').rstrip())
    (root / f'{number - 33:02d}-issue.md').write_text(body, encoding='utf-8')
    (root / f'issue{number}-after-container-exit.json').write_text(json.dumps(verified, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'#{number}: body verified; original content, title and state preserved', flush=True)
