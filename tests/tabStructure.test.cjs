'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname,'../dashboard.html'),'utf8');
// Track real div ancestry, rather than testing isolated render functions against
// fake top-level hosts: a hidden ancestor made four fully rendered tabs invisible.
function structure(source) {
  const markup=source.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
  const stack=[],nodes=[];
  for(const match of markup.matchAll(/<\/?div\b[^>]*>/gi)) {
    if(/^<\//.test(match[0])) {assert.ok(stack.length,'Unexpected closing div');stack.pop();continue;}
    const tag=match[0],id=tag.match(/\bid="([^"]+)"/)?.[1];
    const classes=new Set((tag.match(/\bclass="([^"]+)"/)?.[1]||'').split(/\s+/));
    const node={id,parent:stack.at(-1),classes};
    node.classList={add:c=>classes.add(c),remove:c=>classes.delete(c)};
    nodes.push(node);stack.push(node);
  }
  assert.equal(stack.length,0,'Every div must close');
  return nodes;
}
const tabs=['dashboard','ai','watchlist','portfolio','markets','news','trending','screener'];
test('every workspace tab is a direct sibling in main, never inside a hidden tab',()=>{
  const nodes=structure(html);
  for(const tab of tabs){
    const node=nodes.find(n=>n.id==='view-'+tab);
    assert.ok(node,tab+' exists');
    assert.ok(node.parent?.classes.has('main'),tab+' must be directly inside main');
    for(let parent=node.parent;parent;parent=parent.parent)
      assert.equal(parent.classes.has('tab-view'),false,tab+' has hidden tab ancestor');
  }
});
test('actual switchTab reveals Markets, News, Movers and Screener after leaving Portfolio',()=>{
  const nodes=structure(html),views=nodes.filter(n=>n.classes.has('tab-view'));
  for(const node of nodes)node.querySelector=()=>null;
  const fn=html.slice(html.indexOf('function switchTab(e, name)'),html.indexOf('// ── Modal close on overlay'));
  const scope={document:{title:'',getElementById:id=>nodes.find(n=>n.id===id),
    querySelectorAll:selector=>selector==='.tab-view'?views:[],querySelector:()=>null,dispatchEvent(){}},
    window:{innerWidth:1200},CustomEvent:function(){}};
  vm.createContext(scope);vm.runInContext(fn+'\nthis.switch=switchTab;',scope);
  for(const tab of tabs){
    scope.switch(null,'portfolio');scope.switch(null,tab);
    const node=nodes.find(n=>n.id==='view-'+tab);
    assert.ok(node.classes.has('active'),tab+' selected');
    for(let parent=node.parent;parent;parent=parent.parent)
      assert.ok(!parent.classes.has('tab-view')||parent.classes.has('active'),tab+' visible through all ancestors');
    assert.equal(views.filter(n=>n.classes.has('active')).length,1);
  }
});
