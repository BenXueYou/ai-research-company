"""Publish the approved ticket plan; credentials remain in process memory."""
from pathlib import Path
import json
import re
import subprocess
import time
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / '.scratch' / 'phase1-published-tickets.json'
PLAN = (ROOT / '.scratch' / 'phase1-ticket-plan.md').read_text(encoding='utf-8')
SPEC = (ROOT / '需求设计' / '08-第一阶段实施规格Spec.md').read_text(encoding='utf-8')
REPO = 'BenXueYou/ai-research-company'
API = 'https://api.github.com/repos/' + REPO
PARENT = 'https://github.com/' + REPO + '/issues/1'

# Specific, externally observable criteria; the approved plan defines scope.
CRITERIA = {
1: ['真实应用和数据库可启动，初始平台账号经显式引导建立；邮箱认证与账号组织角色关联可验证。', '首次/重置后认证只允许本人强制改密和退出；直接请求业务接口同样拒绝，不能只靠页面跳转。', '本人改密校验当前密码及两次新密码；成功退出当前登录，新密码可登录，旧密码不可认证。', '密码仅保存加盐摘要，登录及改密审计不泄露密码、摘要或令牌；不自行决定其他设备退出范围。'],
2: ['开户电话或管理员邮箱缺少时拒绝；邮箱取表单原来源，不以电话、组织标识或发信地址替代。', '组织与首位管理员原子成功或回滚；同邮箱跨组织及并发创建仅一个成功。', '随机临时密码仅成功当次展示，一次复制目标邮箱及密码；复制失败可重试且不重复开户，关闭后不可回查旧密码。', '支持最多两级分销和平台/一级直开终端，二级不能再开分销；上级不可迁移，跨级开户拒绝。', '交付的凭据可登录并强制改密后访问授权入口；终端六入口、分销三入口随实际交付按角色展示，不提前开放后续阶段。'],
3: ['仅本企业管理员用姓名、邮箱和角色创建成员，不接收手填初始密码、不额外要求电话。', '邮箱全平台唯一含并发占用；临时密码当次展示可复制，复制内容与登录输入来源一致，成员首次登录强制改密。', '停用成员阻止登录及新业务访问，保留其档案、人工记录和历史操作；跨企业创建、停用被服务端拒绝。'],
4: ['只有本企业管理员重置本企业成员，只有直属上级重置下级组织管理员；直接接口跨企业或跨级请求拒绝。', '下级详情可重新生成临时密码并复制邮箱与新密码；不重新开户、不改邮箱或组织角色。', '重置成功旧密码立即不能认证，连续重置仅最新成功生成的密码有效；下一次登录强制改密。', '重置不恢复停用状态、不修改余额或业务资料，审计保留操作人目标时间结果且无凭据。'],
5: ['仅经指定运维核验身份后通过受控维护工具恢复平台管理员，保留核验依据引用、操作人、时间和结果。', '恢复生成新临时凭据，旧密码不可认证，下次登录强制改密；不增加短信或邮件找回。', '未授权维护操作拒绝，审计无密码、摘要或完整令牌；核验依据和维护工具授权方案未决时明确阻塞。'],
6: ['平台分别配置接口单价、统一X及全局单一m，不混同上游接口单价、分销售价与换算系数。', '销售用途采购按入账X生成四位小数内部库存并留采购金额及系数快照，重复提交不重复入账。', '补足上游覆盖、失败或超额成本的充值生成内部点数为0，按用途分别留账。', '账户余额和只增流水一致，X初始已确认默认1；后续系数变更不得绕过专门覆盖核验流程，其他未决值不自行补齐。'],
7: ['只有直属卖方可建单和定价，记录买卖双方、数量、单价、金额；双方状态和关系由服务端校验。', '确认一笔足额线下收款时按最新成本及m重验售价并原子预留库存；旧价过低阻止，由卖方重定价，不自动涨价。', '库存不足拒绝系统确认并明确提示线下款可能到账；不替用户决定补库存或退款。', '并发不超售，同一收款不可复用、重复确认不重复预留；未收款不可划拨，收款后数量及售价锁定。'],
8: ['仅已收款待划拨订单可一次完整划拨；同一事务卖方余额与预留减少、买方增加对应数量，内部划拨不调用腾道扣点。', '重复及并发提交仅到账一次，不支持分期、拆分或款项复用。', '买入后按剩余库存成本与新增采购成本计算移动加权平均成本；销售成本毛利留快照，后续采购不重算历史。', '成本或m变化后未收款旧价须重验；已收款继续按原数量售价履约、不追加付款、不超库存。'],
9: ['仅已收款未划拨订单允许卖方确认线下整单退款，确认后关单并释放销售预留。', '未确认线下退款不释放预留；重复退款幂等，留金额、依据、操作人和时间。', '已划拨订单拒绝普通退款或划拨冲销，不改变历史查询、邮件和档案；跨级或非卖方请求拒绝。'],
10: ['公司名通过免费企业列表逐页查询，name/countryCodes取正确选择来源；免费接口不冻结或扣内部点数但计账号调用次数。', '多个匹配或国家冲突不自动选第一条；待核实候选保留且不能直接变档案、查联系人或发信。', '逐接口DTO正确区分HTTP/业务success/code、content/list/对象及国家分隔符；不猜测标识兜底。', '共享账号令牌、安全日志与跨接口配额守卫随首次调用落地，付费未知结果禁止盲目重试；企业数据与缓存不跨租户复用。'],
11: ['只对已选择并核实身份的企业单独报价及确认详情费用；无价格、无可证明报价上限、取消或可用余额不足时无付费调用。', '确认快照锁定name/countryCode3、系数及最高额度，原子冻结终端账户；并发不能超用，不重复扣上级库存。', '详情按data.id判空、返回国家强校验；电话网址空不等于未匹配；档案本企业共享、跨企业隔离，本地再看不调用不收费。', '成功费用=min(ROUND(本页上游实际扣点合计×锁定X,4),确认上限)，先汇总再取整并释放差额，超额平台承担且后续未执行步骤暂停重新确认。', '真实零结果或最终无法提供可看结果不扣/退款，未知超时或保存不明先保留冻结显示结果确认中；重复执行或回执不能重复记账。'],
12: ['产品词查询必须选择采购企业所在国和贸易时间，确认页完整展示条件；不自动扩国家时间或用商品目的国冒充企业所在国。', '最小进口商名单只返回名称候选，每次仅取已确认一页，下一页另确认；不自动整页建档或查询联系人。', '名单、详情和联系人分别授权结算，后续匹配失败不退款此前成功名单；可衔接核实身份和详情建档完整流程。', '国家映射/方向、接口单价及本页最大计费量未核验时不开放相应生产计费能力，受控夹具不得当作证明。'],
13: ['结果确认中保留冻结，不因一次超时判最终失败或自动重试；平台可查看并按账单traceId和可查看结果证据人工处理。', '成功按原系数和上限结算，最终无可看结果释放或退回；记录依据、操作人和时间，不扩大跨级交易权限。', '重复核对、账单/结果乱序幂等；最终失败退款后迟到结果保留但不重扣。', '长期未决处理期限依账单延迟实测，不自行设固定期限或推定部分成功结算边界。'],
14: ['联系人只能从当前已确认档案页签发起，每页单独确认；companyName取已核实名称，mailsouId保留接口原来源，不以id/fileId替换。', '职位筛选保持原枚举TECHNOLGY及分隔符，解析data.list、展示可信度和单一企业最多200条提示，不当作完整人数。', '归属不一致保留返回公司名并默认不选标待核实；未确认不得入收件人，不覆盖源信息。', '无邮箱但联系人可查看仍按实际费用封顶结算；真实零结果、失败与未知状态分别沿用查询规则，本地查看免费且企业隔离。'],
15: ['企业和联系人展示最近获取时间；只有用户主动更新且再次确认费用才调用，取消或TTL到期不付费刷新。', '同企业本地查阅免费，其他企业首次获取仍独立授权查询，不借用跨企业缓存。', '更新未返回的旧联系人及其历史保留，标记本次更新未返回，不推断离职或邮箱失效；更新独立结算。'],
16: ['同企业成员共享查看补充档案，主营产品、采购需求、合作意向、下次跟进时间与源数据分区并记录修改人时间。', '保留星级标签，按跟进日期和线索/跟进中/已回复/无效筛选；状态人工修改，不增加主动提醒。', '仅企业管理员软删除和恢复；业务员和平台只读例外不能据此删除或跨企业修改，操作留痕。'],
17: ['回复摘要、备注及WhatsApp人工记录进入所属档案统一时间线，倒序展示并可按类型筛选。', '人工记录仅创建人编辑、企业管理员软删除，企业共享不赋予编辑他人记录权，服务端直接请求也校验。', 'WhatsApp只录时间、联系人或号码、摘要，号码加密脱敏；附件由附件票补齐，不新增方向/结果/我方账号字段或自动同步。'],
18: ['本企业成员上传下载档案及人工记录附件，管理员软删除；服务端校验企业和关联记录归属，越权无内容泄露。', '遵守jpg/png/webp、pdf/doc/docx/xls/xlsx/ppt/pptx、zip/rar白名单，≤20MB/文件、≤50/企业，并验证扩展名与MIME及并发数量上限。', '私有存储、受控签名下载、扫描与操作审计可验证；失败补偿不留下不可用半条记录。', 'WhatsApp附件可留档，不提供预览/重命名/替换或推导单附件恢复，也不自动变成邮件附件或腾道导出。'],
19: ['仅企业管理员维护本企业最多一套国内SMTP、真实可收信团队回复地址及默认渠道，业务员/跨企业维护拒绝。', '凭据仅服务端安全保管，页面及日志不回显秘密；受控适配器可验证配置输入、连通/失败状态及地址来源。', '不自动轮换渠道，不引入自动收信；真实DNS、认证及回复实收在正式联调单独报告。'],
20: ['平台统一采购并为终端企业配置隔离U-Mail资源，企业配合域名验证；每企业域名渠道最多一套，平台承担一期服务费。', '管理员只维护授权企业的回复地址与默认选择；资源关联和验证状态用受控响应可核对，跨企业读写拒绝。', '不将U-Mail smtp.php当作任意邮箱SMTP，不虚构供应商隔离能力；真实资源与域名能力待正式联调。'],
21: ['归属不一致联系人逐条确认并留说明才准入；企业邮箱优先、个人邮箱缺失不兜底，退订默认不选，手选须提示确认且不绕过供应商拒投。', '按最终邮箱同批去重；不同mailsouId同邮箱且变量冲突必须用户选择来源，不自动取第一条，不扩为跨批禁发。', '公共模板复制为本次内容；保存和预览不回写公共模板，缺失/未替换变量阻止确认，修改后重新预览保证快照一致。', '只带模板预设附件，不接受临时上传或档案附件自动附加；模板预览、变量补全不扣查询点数。'],
22: ['从档案选择联系人进入本次邮件，确认预览、固定渠道、退订提示及额度后才能单轮入队，无独立营销任务或定时多轮入口。', '按最终去重邮箱数原子预占企业共享日额度，并发成员不超限；受理转已用、明确未提交释放、未知保留，重复回执幂等。', '邮件不扣查询点数，不自动重发/切换渠道；未知显示待确认，受理不显示已送达或已回复。', '发送记录及档案系统邮件时间线可查看，不可人工修改删除，租户隔离；跨日未执行先暂停，已提交未知保留原日预占。'],
23: ['同一单轮流程可明确选择本批U-Mail渠道，企业团队与SMTP并发共用一份日额度，不自动轮换或跨渠道重发。', '受控适配器验证资源、任务、模板及地址归属；任务只执行已确认单轮，渠道与内容快照不被并发配置改写。', '逐项核对relpy_to原拼写、tpl_id优先风险、变量、本次编辑内容及预设附件，不能把公共模板覆盖本次内容当成功。', '逐收件人受理/明确失败/未知及回执遵守共享额度、幂等、跨日安全和不可手改系统记录规则，生产能力保留正式联调门槛。'],
24: ['结果不明先核对服务商证据且不自动重发，只有可靠投递证据才显示已送达；受理不当送达、阅读或回复。', '核对仍未知时必须提示可能重复，由用户决定重发；重发重新校验当前内容、渠道及额度，不先释放未知原占用。', '重复/乱序证据只更新正确收件人状态与对应额度事件；系统时间线不可手改删，邮件事件不自动推进客户状态。'],
25: ['Asia/Shanghai零点，未执行收件人暂停并解除原日对应预占，用户次日重新确认占新日额度，不累计。', '已提交未知继续原日核对，迟到受理转原日已用或明确失败释放原日预占，不重复占新日。', '用混合批覆盖未执行及已提交未知，验证并发确认、重复回执、23:59到00:00边界；规则由两渠道共用。'],
26: ['停用阻止本组织登录和新业务，余额、资料、流水保留；不级联停用下级，重置密码不能恢复启用。', '仅暂停涉及停用直属方的新增交易，正常启用下级仍可使用已有余额并向自己的下级销售，不允许跨级绕过。', '终端未执行查询邮件停止；已发出请求只核对不自动重试，查询按原授权及最终可看结果结算，邮件不承诺撤回。', '已收款未划拨订单暂停且保留销售预留，不自动退款/释放；恢复后按原数量售价处理，退款须另走授权流程。'],
27: ['调整X前系统内告知生效时间，新配置不改已有库存余额，生效前已确认查询按旧X结算。', '降低X核算全链未消耗点数，包含销售预留/查询冻结但只计一次；旧授权按旧X，其余按拟新X，区分上游已扣本地未结算在途。', '覆盖不足拒绝生效，先补上游且补款不增内部库存，满足覆盖才生效；重复/并发核验与生效不破坏授权快照。'],
28: ['终端点数用量只展示余额、冻结及可核对的预估/实际/退款流水，无成员排名或复杂图表。', '分销查看授权范围开户、余额、交易、汇总用量与交易利润，历史成本毛利不重算，自有账务导出不夹下级关键词/企业/联系人/邮件。', '平台可全链查看账务、终端档案与邮件，但不能据此跨级交易或跨企业修改/删除/发信；直接接口越权也拒绝。', '腾道数据不通过明细、日志或导出带出；退款和新渠道等事件使用统一只增账务与状态记录展示，不伪造未实现流程。'],
29: ['平台页可核对共享账号余额、有效期、调用次数及异常；调用次数与点数余额独立，免费接口也计次数。', '共享账号跨接口合并200次/分钟、数据类30000次/日，业务类按账号配置，账单独立限频按契约；多实例令牌与限流可验证，不自设业务默认余量。', '上游到期或不可用不清零内部点数、不对未成功查询收费，仍可查看本企业本地数据并显示获取时间，不自动付费刷新。', '仅系统内显示不足与异常，追踪traceId、脱敏参数、耗时与证据；日志/审计不泄密钥、令牌、密码或向分销泄露客户信息。'],
30: ['取得正式账号权限、商务单价、授权及允许的小范围真实调用条件后，核验采购企业所在国映射/方向、身份关联及覆盖填充率。', '按名单→核实→详情→联系人分别确认执行，记录最终参数来源、实际扣点、账单traceId、分页及最大计费条数/报价上限证据。', '核验真实配额、有效期与账单延迟，对未支持能力和未通过场景列阻塞；未决国家映射/报价能力不宣称生产就绪。'],
31: ['在获授权正式邮箱和验收收件人下验证真实认证/DNS、发送内容快照和模板预设附件，客户回复确实进入团队回复地址。', '记录实际渠道受理、失败、拒投/退信/未知及能提供的投递证据，受理不能当送达，不承诺未提供的能力。', '验证正式渠道额度及跨日未执行暂停/原日未知核对，交付实际结果、费用/额度及未验证流程报告。'],
32: ['使用两个企业的正式资源验证域名、任务、模板、地址池及结果隔离；确认小批量执行路径及平台采购模式。', '真实验证本次编辑内容、变量映射、relpy_to、tpl_id优先级风险、预设附件和回复地址实收，不以接口受理替代内容实证。', '核验频控/拒投/退信/回执能力、跨渠道并发共享额度和跨日原日核对，保留证据；供应商未支持分支明确阻塞，不擅自绕过。'],
}

def expand(value):
    result = []
    for item in value.split(','):
        bounds = [int(x) for x in item.strip().split('-')]
        result.extend(range(bounds[0], bounds[-1] + 1))
    return result

def parse_tickets():
    trace = {int(m[0]): {'stories': expand(m[1]), 'rules': expand(m[2]), 'at': expand(m[3])}
             for m in re.findall(r'^\| (\d+) \| ([\d, -]+) \| ([\d, -]+) \| ([\d, -]+) \|$', PLAN, re.M)}
    external = []
    section = PLAN.split('## 外部阻塞及未决项')[1].split('## 批准后的发布方式')[0]
    for refs, text in re.findall(r'^\| ([\d, -]+) \| (.+) \|$', section, re.M):
        external.append((expand(refs), text))
    tickets = []
    for m in re.finditer(r'^(\d+)\. \*\*(.*?)\*\*\n\s+- 阻塞：([^\n]+)\n\s+- 交付：([^\n]+)', PLAN, re.M):
        tid = int(m[1])
        tickets.append({'ticket': tid, 'title': m[2], 'blocked_by': [int(x) for x in re.findall(r'\d+', m[3].split('；')[0])],
                        'scope': m[4], 'extra': m[3].split('；', 1)[1] if '；' in m[3] else '',
                        'external': [text for refs, text in external if tid in refs], **trace[tid]})
    assert [t['ticket'] for t in tickets] == list(range(1, 33))
    assert set(CRITERIA) == set(range(1, 33))
    for ticket in tickets:
        assert all(dep < ticket['ticket'] for dep in ticket['blocked_by'])
    for key, count in [('stories', 85), ('rules', 77), ('at', 24)]:
        assert set().union(*(set(t[key]) for t in tickets)) == set(range(1, count + 1))
    return tickets

def credential():
    result = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n', text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('Git credential helper failed; no credential output disclosed')
    fields = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    if not fields.get('password'):
        raise RuntimeError('No GitHub credential available')
    return fields['password']

TOKEN = None

class ApiError(RuntimeError):
    def __init__(self, status, message):
        self.status = status
        super().__init__(f'GitHub API HTTP {status}: {message}')

def api(method, path, payload=None):
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8') if payload is not None else None
    request = urllib.request.Request(API + path, data=body, method=method, headers={
        'Authorization': 'Bearer ' + TOKEN, 'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Codex-Approved-Ticket-Publisher',
        'Content-Type': 'application/json; charset=utf-8'})
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        try:
            message = json.loads(exc.read()).get('message', 'API request failed')
        except (ValueError, AttributeError):
            message = 'API request failed'
        raise ApiError(exc.code, message) from None
    except (urllib.error.URLError, TimeoutError):
        raise RuntimeError('Network outcome uncertain; rerun reconciles issue markers before any creation') from None

def paginate(path):
    items = []
    for page in range(1, 101):
        chunk = api('GET', path + ('&' if '?' in path else '?') + f'per_page=100&page={page}')
        assert isinstance(chunk, list)
        items.extend(chunk)
        if len(chunk) < 100:
            return items
    raise RuntimeError('Unexpected pagination size')

def save(state):
    temp = STATE.with_suffix('.json.tmp')
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(STATE)

def snapshot(parent):
    return {key: parent[key] for key in ('title', 'body', 'state', 'labels', 'assignees', 'milestone')}

def marker(tid):
    return f'<!-- phase1-spec-issue-1-approved-ticket:T{tid:02d} -->'

def scope_refs(text, mapping):
    # Replace only the draft's explicit cross-ticket prose, never business numbers.
    for old, numbers in [('由27', [27]), ('由18', [18]), ('由22/24', [22, 24]), ('由31', [31]), ('由32', [32]), ('对23', [23])]:
        if old in text:
            resolved = ' / '.join('#' + str(mapping[n]['number']) if n in mapping else f'T{n:02d}（本计划后续票）' for n in numbers)
            text = text.replace(old, old[0] + resolved)
    return text

def build_body(ticket, mapping):
    tid = ticket['ticket']
    blocks = '\n'.join('- #' + str(mapping[n]['number']) + ' — ' + mapping[n]['title'] for n in ticket['blocked_by']) or 'None — 无票间阻塞；仍须遵守下述外部前置条件。'
    external = '\n'.join('- ' + item for item in ticket['external']) or '- 未决参数仍遵守父规格，不自行采用原型或示例默认值。'
    if ticket['extra']:
        external += '\n- ' + ticket['extra']
    common = PLAN.split('## 所有功能票共同完成标准\n\n')[1].split('\n## 编号清单')[0].strip()
    criteria = '\n'.join('- [ ] ' + item for item in CRITERIA[tid])
    if tid < 30:
        criteria += '\n- [ ] UI驱动真实服务端及测试数据库完成本票流程；越权、并发、乱序补充公开接口场景，拒绝路径同时核对无外部付费调用、错误账务或数据泄露。'
    criteria += '\n- [ ] 使用互不相同的相关标识和地址，提交参数的值及来源与用户选择一致；交付报告列出已执行场景、账务/额度结果及未验证流程。'
    stories = {int(n): text for n, text in re.findall(r'^(\d+)\. (As a .+)$', SPEC, re.M)}
    story_text = '\n'.join(f'- US-{n:02d}: {stories[n]}' for n in ticket['stories'])
    rules = '、'.join(f'R{n:02d}' for n in ticket['rules'])
    ats = '、'.join(f'AT-{n:02d}' for n in ticket['at'])
    return f'''{marker(tid)}
## Parent

{PARENT}

基线：第一阶段实施规格 Spec v1.0、PRD v3.1、技术设计 v3.1及已确认领域术语。用户已批准32张纵向切片拆分；本票为 T{tid:02d}。父规格的业务规则、接口契约及未决项继续适用。

## What to build

{scope_refs(ticket['scope'], mapping)}

## Acceptance criteria

{criteria}

## Blocked by

{blocks}

## 外部前置条件与未决项

{external}

ready-for-agent表示可领取已确定的工作，不表示外部阻塞已解除；受阻实现分支及验收必须明确记录，不用夹具或默认值冒充决策/正式联调结果。

## 追溯与验收边界

- PRD规则：{rules}。
- Spec验收场景：{ats}。仅承担本票交付范围；同组其他行为由对应票交付，不能据组号扩大本票权限或范围。
- 功能票使用外部适配器可控响应，真实鉴权、事务、账务和数据库不可替换为原型内存；正式供应商联调票单独记录真实证据。

{story_text}

## 共同业务契约与完成标准

{common}

本票不授权额外业务范围：不擅改请求来源、标识映射、枚举、默认值、兜底顺序、校验或提交条件；疑似业务问题单独记录。不把旧HTML原型验证当真实实现，不以构建/类型检查代替相关业务流程验收。
'''

def main():
    global TOKEN
    tickets = parse_tickets()
    TOKEN = credential()
    state = json.loads(STATE.read_text(encoding='utf-8')) if STATE.exists() else {'repo': REPO, 'parent': PARENT, 'approved_date': '2026-10-26', 'tickets': [], 'native_edges': [], 'status': 'publishing'}
    parent = api('GET', '/issues/1')
    if 'parent_snapshot' not in state:
        state['parent_snapshot'] = snapshot(parent)
        save(state)
    assert snapshot(parent) == state['parent_snapshot'], 'Parent changed; inspect before publishing'
    assert parent['body'].strip() == SPEC.strip(), 'Parent differs from approved local Spec'
    comments = paginate('/issues/1/comments')
    print(f'Preflight: parent unchanged; {len(comments)} parent comments', flush=True)
    existing = paginate('/issues?state=all')
    labels = paginate('/labels')
    assert any(label['name'] == 'ready-for-agent' for label in labels), 'Required triage label absent'
    mapping = {item['ticket']: item for item in state['tickets']}
    for ticket in tickets:
        tid = ticket['ticket']
        matches = [issue for issue in existing if marker(tid) in (issue.get('body') or '')]
        assert len(matches) <= 1, f'Duplicate marker for T{tid:02d}'
        if matches:
            issue = matches[0]
        elif tid in mapping:
            issue = api('GET', '/issues/' + str(mapping[tid]['number']))
            assert marker(tid) in (issue.get('body') or ''), 'Saved issue marker mismatch'
        else:
            title = f'[一期 T{tid:02d}] ' + ticket['title']
            issue = api('POST', '/issues', {'title': title, 'body': build_body(ticket, mapping), 'labels': ['ready-for-agent']})
            existing.append(issue)
            time.sleep(1.1)  # Space content writes; never retry uncertain issue creation.
        assert any(x['name'] == 'ready-for-agent' for x in issue['labels']), 'Missing triage label'
        item = {'ticket': tid, 'number': issue['number'], 'id': issue['id'], 'url': issue['html_url'], 'title': issue['title'], 'blocked_by': ticket['blocked_by']}
        mapping[tid] = item
        state['tickets'] = [mapping[n] for n in sorted(mapping)]
        save(state)
        print(f'T{tid:02d} -> #{issue["number"]}: {ticket["title"]}', flush=True)

    # Now every forward prose reference can use a real identifier too.
    for ticket in tickets:
        item = mapping[ticket['ticket']]
        expected = build_body(ticket, mapping)
        current = api('GET', '/issues/' + str(item['number']))
        if current['body'] != expected:
            api('PATCH', '/issues/' + str(item['number']), {'body': expected})
            time.sleep(1.1)

    native_available = state.get('native_available', True)
    if native_available:
        try:
            api('GET', '/issues/' + str(mapping[2]['number']) + '/dependencies/blocked_by')
        except ApiError as exc:
            if exc.status in (403, 404, 410):
                native_available = False
                state['native_fallback_reason'] = str(exc)
                print('Native blocking unavailable; real issue references retained in each body', flush=True)
            else:
                raise
    state['native_available'] = native_available
    save(state)
    if native_available:
        for ticket in tickets:
            item = mapping[ticket['ticket']]
            base = '/issues/' + str(item['number']) + '/dependencies/blocked_by'
            present = paginate(base)
            present_ids = {issue['id'] for issue in present}
            for dep in ticket['blocked_by']:
                blocker = mapping[dep]
                if blocker['id'] not in present_ids:
                    try:
                        api('POST', base, {'issue_id': blocker['id']})
                    except ApiError as exc:
                        if exc.status in (403, 404, 410):
                            native_available = False
                            state['native_available'] = False
                            state['native_fallback_reason'] = str(exc)
                            save(state)
                            print('Native blocking mutation unavailable; body references retained', flush=True)
                            break
                        raise
                    time.sleep(1.1)
                edge = [ticket['ticket'], dep]
                if edge not in state['native_edges']:
                    state['native_edges'].append(edge)
                    save(state)
            if not native_available:
                break
            print(f'Blocking checked T{ticket["ticket"]:02d}: {len(ticket["blocked_by"])}', flush=True)

    for ticket in tickets:
        item = mapping[ticket['ticket']]
        issue = api('GET', '/issues/' + str(item['number']))
        assert issue['body'] == build_body(ticket, mapping), 'Published body mismatch'
        assert issue['state'] == 'open'
        assert any(label['name'] == 'ready-for-agent' for label in issue['labels'])
        if native_available:
            present = paginate('/issues/' + str(item['number']) + '/dependencies/blocked_by')
            assert {x['id'] for x in present} == {mapping[n]['id'] for n in ticket['blocked_by']}, 'Native blockers mismatch'
    assert snapshot(api('GET', '/issues/1')) == state['parent_snapshot'], 'Parent changed during publication'
    state['status'] = 'published-and-verified'
    state['verification'] = {'issues': len(tickets), 'expected_edges': sum(len(t['blocked_by']) for t in tickets), 'native_blocking': native_available, 'parent_unchanged': True, 'labels_and_bodies_verified': True}
    save(state)
    lines = ['# 第一期 tickets 发布索引', '', f'父规格：{PARENT}', '', '状态：32张已发布并验证，父Issue保持不变。', '', '| 草案编号 | GitHub Issue | 阻塞项 |', '|---|---|---|']
    for ticket in tickets:
        item = mapping[ticket['ticket']]
        deps = '、'.join('#' + str(mapping[n]['number']) for n in ticket['blocked_by']) or '无票间依赖'
        lines.append(f'| T{ticket["ticket"]:02d} | [#{item["number"]} {ticket["title"]}]({item["url"]}) | {deps} |')
    lines += ['', '所有票均标记ready-for-agent，外部未决项仍保留。', '原生阻塞关系：' + ('全部建立并回读验证。' if native_available else '当前不可用；正文列出真实阻塞Issue引用。'), '', '本次只发布tickets，未实现代码、运行生产验收、真实扣费查询或发信。']
    (ROOT / '.scratch' / 'phase1-published-index.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps(state['verification'], ensure_ascii=False), flush=True)

if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # Credentials, headers and helper outputs never appear in diagnostics.
        print(f'STOPPED: {type(exc).__name__}: {exc}', flush=True)
        raise SystemExit(1)
