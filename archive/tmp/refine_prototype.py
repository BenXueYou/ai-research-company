from pathlib import Path
p=Path(__file__).resolve().parents[2]/'原型设计/prototype-smart-acquisition.html'
s=p.read_text(encoding='utf-8')
s=s.replace('</style>','''.main,.sidebar,.panel,#view{min-width:0}.app{grid-template-columns:215px minmax(0,1fr)}.tabs{overflow-x:auto}.tabs button{flex-shrink:0}.panel{overflow-wrap:anywhere}.tablewrap{max-width:100%}.topbar{margin-top:0}.main{align-self:start}.sidebar nav{max-width:100%}.flow span{min-width:0}@media(max-width:850px){.app{grid-template-columns:minmax(0,1fr)}.sidebar nav .nav{flex-shrink:0}.panel{padding:17px}.panel>table{font-size:11px}td,th{padding:10px 7px}.topbar .row{width:100%;justify-content:space-between}.flow{flex-wrap:wrap}.flow span{flex-basis:50%}.row button{max-width:100%}}\n</style>''')
s=s.replace("S.savedDraft={...draft};toast", "S.savedDraft={...draft,companyId:company().id,selected:JSON.parse(JSON.stringify(S.selected))};toast")
s=s.replace("'<div class=\"row between\"><h3>联系人</h3>","'<div class=\"row between\"><h3>联系人</h3>")
s=s.replace("为所选联系人写邮件</button></div>';}","为所选联系人写邮件</button> <button onclick=\"restoreDraft()\">继续本次草稿</button></div>';}")
insert="""
function restoreDraft(){if(!S.savedDraft||S.savedDraft.companyId!==company().id)return toast('当前档案没有已保存的本次草稿');S.selected=JSON.parse(JSON.stringify(S.savedDraft.selected));draft={...S.savedDraft,previewed:false,previewSnapshot:null};drawComposer()}
function repriceOrder(){const o=S.supplier.order;if(o?.state!=='待收款')return;openModal('重新定价未收款订单','<label>新售价（模拟）<input type="number" id="newOrderPrice" value="'+o.price+'" step="0.01"></label><p class="hint">按最新平均进价与m重新校验；系统不自动改价。</p><div class="actions"><button onclick="saveOrderPrice()">保存新售价</button></div>')}
function saveOrderPrice(){const a=S.supplier,o=a.order,p=Number($('newOrderPrice').value);if(o?.state!=='待收款')return;if(p<a.averageCost*(1+a.m))return toast('售价仍低于当前下限');o.price=p;o.amount=Number((o.quantity*p).toFixed(2));closeModal();ordersView()}
"""
s=s.replace("window.prototypeState=S;",insert+"window.prototypeState=S;")
s=s.replace("确认足额线下收款并预留</button>'", "确认足额线下收款并预留</button><button onclick=\"repriceOrder()\">修改未收款价格</button>'")
p.write_text(s,encoding='utf-8')
