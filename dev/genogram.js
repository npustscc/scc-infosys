// dev/genogram.js — GenogramEditor（Bowen 家系圖繪製工具，拆 index.html 絞殺者第十九刀，v266）。
// 內容為從 index.html 逐字搬出的單一區段（原 5060~6091 行）：const GenogramEditor = IIFE
// ＋入口函式 openGenogramEditor。載入期副作用僅 IIFE 立即執行本身，其頂層只有
// const/let 宣告與 function 宣告（column-0 複核：無裸呼叫、無 addEventListener、
// 無 window.X=），外部引用僅 localStorage.getItem（瀏覽器 API）與字面值，故可安全
// 前移到主 inline script 之前載入（刀法①）。
// 函式內部在呼叫時才引用主檔全域（_detailReadonly、escHtml、showToast、個案草稿
// 相關 helper 等），定義位置不變，跨 script 全域可見。
// ════════════════════════════════════════════════════════════════
//  GenogramEditor — Bowen 家族圖繪製工具（全頁面版）
// ════════════════════════════════════════════════════════════════
const GenogramEditor = (() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const SZ = 22;
  const GRID = 20;
  const COUPLE_LTYPES = ['married','separated','divorced','bond','cohabiting']; // 所有視為「配偶」的結構關係線類型（觸發子女ㄇ字橫桿邏輯）
  // 內建常用模版（QM 原版 1/2/3/4 子設計）：配偶（男+女）+ N 位子女（預設男性方形，可選取後點側欄形狀改變），程式內建不存 configData
  const BUILTIN_TEMPLATES = [1,2,3,4].map(n=>{
    const childXs = n===1?[0] : n===2?[-45,45] : n===3?[-70,0,70] : [-105,-35,35,105];
    const objects = [
      {id:'a',type:'node',shapeType:'male',x:-45,y:0,label:''},
      {id:'b',type:'node',shapeType:'female',x:45,y:0,label:''},
      {id:'m',type:'link',from:'a',to:'b',linkType:'married'},
    ];
    childXs.forEach((cx,i)=>{
      const cid='c'+i;
      objects.push({id:cid,type:'node',shapeType:'male',x:cx,y:120,label:''});
      objects.push({id:'l'+i,type:'link',from:'a',to:cid,linkType:'parent',coupleId:'m',childId:cid,parentId:'a'});
    });
    return {name:n+' 子',objects,bbox:{w:270,h:180}};
  });
  let _svg=null,_vp=null;
  let _objs=[],_selId=null,_multiSel=new Set();
  let _tool='select',_placeShape='male',_linkType='married';
  let _zoom=1,_panX=0,_panY=0,_spaceDown=false;
  let _undo=[],_redo=[];
  let _idSeq=1,_dragBeforeState=null;
  let _dragging=null,_connectFrom=null,_connectLine=null;
  let _boxSel=null,_freehandPts=[],_freehandEl=null;
  let _fieldId=null,_storeKey=null,_caseId=null,_readOnly=false;
  let _textFontSize=12,_textBold=false,_textItalic=false,_textStrike=false;
  let _nodeLabelFontSize=+(localStorage.getItem('genoLblFz')||11);
  let _snapEnabled=true;
  let _sbCollapsed={nodes:false,structural:false,emotional:false,templates:false,custom:false};

  const _el=(tag,attrs={})=>{const e=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
  const _uid=()=>'g'+(++_idSeq)+'_'+(Date.now()%1000000);
  const _snapG=(v)=>_snapEnabled?Math.round(v/GRID)*GRID:Math.round(v);

  // ── Shape drawing ────────────────────────────────────────────────
  function _nodeEl(o,fe){
    const g=_el('g',{class:'geno-node','data-id':o.id,transform:`translate(${o.x},${o.y})`});
    const sel=!fe&&(o.id===_selId||_multiSel.has(o.id)),sc=sel?'#3182ce':(o.strokeColor||'#1a202c'),sw=sel?'2.5':'1.8',t=o.shapeType;
    const fc=(d)=>o.fillColor||d;
    if(t==='male'||t==='dead_m'||t==='ip_m'){
      g.appendChild(_el('rect',{x:-SZ,y:-SZ,width:SZ*2,height:SZ*2,fill:t==='dead_m'?fc('#e2e8f0'):t==='ip_m'?fc('#a0aec0'):fc('#fff'),stroke:sc,'stroke-width':sw}));
      if(t==='dead_m'){const r=SZ-4;g.appendChild(_el('line',{x1:-r,y1:-r,x2:r,y2:r,stroke:sc,'stroke-width':sw}));g.appendChild(_el('line',{x1:r,y1:-r,x2:-r,y2:r,stroke:sc,'stroke-width':sw}));}
    }else if(t==='female'||t==='dead_f'||t==='ip_f'){
      g.appendChild(_el('circle',{cx:0,cy:0,r:SZ,fill:t==='dead_f'?fc('#e2e8f0'):t==='ip_f'?fc('#a0aec0'):fc('#fff'),stroke:sc,'stroke-width':sw}));
      if(t==='dead_f'){const r=SZ*.65;g.appendChild(_el('line',{x1:-r,y1:-r,x2:r,y2:r,stroke:sc,'stroke-width':sw}));g.appendChild(_el('line',{x1:r,y1:-r,x2:-r,y2:r,stroke:sc,'stroke-width':sw}));}
    }else if(t==='pregnant'){
      g.appendChild(_el('polygon',{points:`0,${-SZ} ${SZ*.9},${SZ*.7} ${-SZ*.9},${SZ*.7}`,fill:fc('#fff'),stroke:sc,'stroke-width':sw}));
    }else if(t==='unknown'){
      g.appendChild(_el('polygon',{points:`0,${-SZ} ${SZ},0 0,${SZ} ${-SZ},0`,fill:fc('#fff'),stroke:sc,'stroke-width':sw}));
    }else if(t==='abort'){
      g.appendChild(_el('polygon',{points:`0,${-SZ*.8} ${SZ*.75},${SZ*.6} ${-SZ*.75},${SZ*.6}`,fill:fc(sc),stroke:'none'}));
    }else if(t==='stillbirth'){
      const s=SZ*.5;g.appendChild(_el('rect',{x:-s,y:-s,width:s*2,height:s*2,fill:fc(sc),stroke:'none'}));
    }else{
      g.appendChild(_el('circle',{cx:0,cy:0,r:SZ,fill:fc('#fff'),stroke:sc,'stroke-width':sw}));
    }
    // 慢性病（右半黑）／身心障礙（右上角四分之一黑）：QM 慣例疊加標記，與底層形狀/顏色無關
    if(o.chronicIllness)g.appendChild(_el('rect',{x:0,y:-SZ,width:SZ,height:SZ*2,fill:'#1a202c'}));
    if(o.disability)g.appendChild(_el('rect',{x:0,y:-SZ,width:SZ,height:SZ,fill:'#1a202c'}));
    if(sel)g.appendChild(_el('circle',{cx:0,cy:0,r:SZ+11,fill:'none',stroke:'#3182ce','stroke-width':'1','stroke-dasharray':'3,2',opacity:'0.5'}));
    if(o.label){const lbl=_el('text',{x:0,y:SZ+14,'text-anchor':'middle','font-size':String(_nodeLabelFontSize),fill:'#2d3748','font-family':'sans-serif'});lbl.textContent=o.label;g.appendChild(lbl);}
    g.appendChild(_el('rect',{x:-(SZ+8),y:-(SZ+8),width:(SZ+8)*2,height:(SZ+8)*2,fill:'transparent',stroke:'none'}));
    return g;
  }

  // 分居/離婚新版式（QM）：兩端往同一側短垂直勾形成ㄇ字外框，中間 1（分居）或 2（離婚）條對角斜線
  function _drawSeparationMarks(g,x1,y1,x2,y2,sc,tickCount){
    const dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy)||1;
    const nx=-dy/len,ny=dx/len,ux=dx/len,uy=dy/len,TICK=8,SL=8;
    g.appendChild(_el('line',{x1,y1,x2:x1+nx*TICK,y2:y1+ny*TICK,stroke:sc,'stroke-width':'1.8'}));
    g.appendChild(_el('line',{x1:x2,y1:y2,x2:x2+nx*TICK,y2:y2+ny*TICK,stroke:sc,'stroke-width':'1.8'}));
    const mx=(x1+x2)/2,my=(y1+y2)/2;
    for(let i=0;i<tickCount;i++){
      const off=tickCount===2?(i===0?-7:7):0,px=mx+ux*off,py=my+uy*off;
      g.appendChild(_el('line',{x1:px-ux*SL+nx*SL,y1:py-uy*SL+ny*SL,x2:px+ux*SL-nx*SL,y2:py+uy*SL-ny*SL,stroke:sc,'stroke-width':'1.8'}));
    }
  }
  function _linkEl(o,fe){
    const fm=_objs.find(x=>x.id===o.from),to=_objs.find(x=>x.id===o.to);
    if(!fm||!to)return null;
    const g=_el('g',{class:'geno-conn','data-id':o.id});
    const sel=!fe&&o.id===_selId,sc=sel?'#3182ce':(o.strokeColor||'#1a202c');
    const x1=fm.x,y1=fm.y,x2=to.x,y2=to.y,dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy)||1;
    const nx=-dy/len,ny=dx/len,lt=o.linkType;
    if(lt==='fused'){
      for(let i=-1;i<=1;i++){const ox=nx*i*4.5,oy=ny*i*4.5;g.appendChild(_el('line',{x1:x1+ox,y1:y1+oy,x2:x2+ox,y2:y2+oy,stroke:sc,'stroke-width':'1.6'}));}
    }else if(lt==='conflict'){
      const steps=Math.max(4,Math.floor(len/14)),pts=[];
      for(let i=0;i<=steps;i++){const t=i/steps,cx=x1+dx*t,cy=y1+dy*t,side=(i%2===0?1:-1)*(i>0&&i<steps?9:0);pts.push(`${cx+nx*side},${cy+ny*side}`);}
      g.appendChild(_el('polyline',{points:pts.join(' '),fill:'none',stroke:sc,'stroke-width':'1.8'}));
    }else if(lt==='cutoff'){
      const mx=(x1+x2)/2,my=(y1+y2)/2,ux=dx/len,uy=dy/len;
      g.appendChild(_el('line',{x1,y1,x2:mx-ux*8,y2:my-uy*8,stroke:sc,'stroke-width':'1.8'}));
      g.appendChild(_el('line',{x1:mx+ux*8,y1:my+uy*8,x2,y2,stroke:sc,'stroke-width':'1.8'}));
      for(const d of[-5,5]){const px=mx+nx*d,py=my+ny*d;g.appendChild(_el('line',{x1:px+nx*9,y1:py+ny*9,x2:px-nx*9,y2:py-ny*9,stroke:sc,'stroke-width':'1.8'}));}
    }else if(lt==='close'){
      for(const d of[-3.5,3.5]){const ox=nx*d,oy=ny*d;g.appendChild(_el('line',{x1:x1+ox,y1:y1+oy,x2:x2+ox,y2:y2+oy,stroke:sc,'stroke-width':'1.6'}));}
    }else if(lt==='ambivalent'){
      g.appendChild(_el('line',{x1:x1+nx*(-5),y1:y1+ny*(-5),x2:x2+nx*(-5),y2:y2+ny*(-5),stroke:sc,'stroke-width':'1.6'}));
      const steps=Math.max(4,Math.floor(len/14)),pts=[];
      for(let i=0;i<=steps;i++){const t2=i/steps,cx2=x1+dx*t2,cy2=y1+dy*t2,side=(i%2===0?1:-1)*(i>0&&i<steps?9:0);pts.push(`${cx2+nx*(side+7)},${cy2+ny*(side+7)}`);}
      g.appendChild(_el('polyline',{points:pts.join(' '),fill:'none',stroke:sc,'stroke-width':'1.8'}));
    }else if(lt==='twin'){
      const mx=(x1+x2)/2,my=(y1+y2)/2;
      g.appendChild(_el('line',{x1,y1,x2:mx,y2:my,stroke:sc,'stroke-width':'1.8'}));
      g.appendChild(_el('line',{x1:x2,y1:y2,x2:mx,y2:my,stroke:sc,'stroke-width':'1.8'}));
      g.appendChild(_el('line',{x1:mx+nx*12,y1:my+ny*12,x2:mx-nx*12,y2:my-ny*12,stroke:sc,'stroke-width':'1.8'}));
    }else if(lt==='deteriorating'){
      const ux=dx/len,uy=dy/len,HL=7;
      g.appendChild(_el('line',{x1,y1,x2,y2,stroke:sc,'stroke-width':'1.8'}));
      const steps=Math.max(4,Math.floor(len/16));
      for(let i=1;i<steps;i++){const t=i/steps,cx=x1+dx*t,cy=y1+dy*t;g.appendChild(_el('line',{x1:cx-ux*HL-nx*HL,y1:cy-uy*HL-ny*HL,x2:cx+ux*HL+nx*HL,y2:cy+uy*HL+ny*HL,stroke:sc,'stroke-width':'1.4'}));}
    }else{
      const dash=lt==='adopted'||lt==='dashed'?'7,4':lt==='foster'||lt==='dotted'?'2,5':lt==='cohabiting'?'4,3':'';
      const dp=`M${x1} ${y1}L${x2} ${y2}`;
      if(sel)g.appendChild(_el('path',{d:dp,fill:'none',stroke:'#bee3f8','stroke-width':'6'}));
      g.appendChild(_el('path',{d:dp,fill:'none',stroke:sc,'stroke-width':'1.8',...(dash?{'stroke-dasharray':dash}:{})}));
      if(lt==='separated'||lt==='divorced'){
        _drawSeparationMarks(g,x1,y1,x2,y2,sc,lt==='divorced'?2:1);
      }
    }
    g.appendChild(_el('path',{d:`M${x1} ${y1}L${x2} ${y2}`,fill:'none',stroke:'transparent','stroke-width':'14'}));
    return g;
  }

  function _linkElFamily(o,childLinks,fe){
    const A=_objs.find(x=>x.id===o.from),B=_objs.find(x=>x.id===o.to);
    if(!A||!B)return null;
    const g=_el('g',{class:'geno-conn','data-id':o.id});
    const sel=!fe&&o.id===_selId,sc=sel?'#3182ce':'#1a202c',lt=o.linkType;
    const ax=A.x,ay=A.y,bx=B.x,by=B.y;
    // 配偶線：永遠是直線，不因子女而彎曲（子女的ㄇ字橫桿獨立畫在子女那一側）
    const dp=`M${ax} ${ay}L${bx} ${by}`;
    g.appendChild(_el('path',{d:dp,fill:'none',stroke:sc,'stroke-width':'1.8'}));
    const midX=(ax+bx)/2,midY=(ay+by)/2;
    if(lt==='separated'||lt==='divorced'){
      _drawSeparationMarks(g,ax,ay,bx,by,sc,lt==='divorced'?2:1);
    }
    const chn=childLinks.map(cl=>({node:_objs.find(x=>x.id===cl.childId),cl})).filter(x=>x.node);
    if(chn.length){
      chn.sort((a,b)=>a.node.x-b.node.x);
      const twinGroups={};const normChn=[];
      for(const{node,cl}of chn){if(cl.twinGroupId){if(!twinGroups[cl.twinGroupId])twinGroups[cl.twinGroupId]=[];twinGroups[cl.twinGroupId].push({node,cl});}else{normChn.push({node,cl});}}
      const twinGroupList=Object.values(twinGroups);
      const dropY=Math.max(ay,by)+54;
      // 橫桿 X 範圍依「子女實際分布」決定（含多胞胎群組代表點），不再夾在配偶兩人的 X 範圍內
      const allXs=normChn.map(c=>c.node.x);
      for(const pairs of twinGroupList){allXs.push(pairs.reduce((s,p)=>s+p.node.x,0)/pairs.length);}
      const barLx=Math.min(...allXs),barRx=Math.max(...allXs);
      const dropX=Math.max(barLx,Math.min(barRx,midX));
      // 配偶連線中點 → 子女橫桿
      g.appendChild(_el('line',{x1:midX,y1:midY,x2:dropX,y2:dropY,stroke:sc,'stroke-width':'1.8'}));
      // 手足橫桿：只有一位子女（barLx===barRx）時寬度為 0，自然省略
      if(barRx>barLx){
        g.appendChild(_el('line',{x1:barLx,y1:dropY,x2:barRx,y2:dropY,stroke:sc,'stroke-width':'1.8'}));
      }
      // 一般孩子：從橫桿垂直落到子女（橫桿寬度已依子女 X 決定，故為直線不需夾取）
      for(const{node:c,cl}of normChn){const dash=cl.linkType==='adopted'?'7,4':cl.linkType==='foster'?'2,4':null;const la={x1:c.x,y1:dropY,x2:c.x,y2:c.y-SZ,stroke:sc,'stroke-width':'1.8'};if(dash)la['stroke-dasharray']=dash;g.appendChild(_el('line',la));}
      // 多胞胎：依群組倒V（支援 adopted/foster 虛線；若全為領養/寄養則 hub 線也虛線）
      for(const pairs of twinGroupList){
        pairs.sort((a,b)=>a.node.x-b.node.x);
        const gMidX=pairs.reduce((s,p)=>s+p.node.x,0)/pairs.length;
        const hubDropY=dropY+30;
        const allAdopted=pairs.every(p=>p.cl.linkType==='adopted'),allFoster=pairs.every(p=>p.cl.linkType==='foster');
        const hubA={x1:gMidX,y1:dropY,x2:gMidX,y2:hubDropY,stroke:sc,'stroke-width':'1.8'};
        if(allAdopted)hubA['stroke-dasharray']='7,4';else if(allFoster)hubA['stroke-dasharray']='2,4';
        g.appendChild(_el('line',hubA));
        for(const{node:c,cl}of pairs){const dash=cl.linkType==='adopted'?'7,4':cl.linkType==='foster'?'2,4':null;const la={x1:gMidX,y1:hubDropY,x2:c.x,y2:c.y-SZ,stroke:sc,'stroke-width':'1.8'};if(dash)la['stroke-dasharray']=dash;g.appendChild(_el('line',la));}
      }
    }
    g.appendChild(_el('path',{d:dp,fill:'none',stroke:'transparent','stroke-width':'14'}));
    return g;
  }

  function _textEl(o,fe){
    const g=_el('g',{class:'geno-text-obj','data-id':o.id});
    const sel=!fe&&(o.id===_selId||_multiSel.has(o.id)),fs=o.fontSize||12;
    const attrs={x:o.x,y:o.y,'font-size':fs,fill:sel?'#3182ce':'#1a202c','font-family':'sans-serif'};
    if(o.bold)attrs['font-weight']='bold';
    if(o.italic)attrs['font-style']='italic';
    if(o.strikethrough)attrs['text-decoration']='line-through';
    const t=_el('text',attrs);t.textContent=o.text;g.appendChild(t);
    if(sel){const w=o.text.length*(fs*.65)+12;g.appendChild(_el('rect',{x:o.x-3,y:o.y-fs-2,width:w,height:fs+6,fill:'none',stroke:'#3182ce','stroke-width':'1','stroke-dasharray':'3,2'}));}
    return g;
  }

  function _pathEl(o,fe){
    const g=_el('g',{class:'geno-freehand','data-id':o.id});
    const sel=!fe&&(o.id===_selId||_multiSel.has(o.id));
    const isBoundary=o.pathKind==='boundary';
    const attrs={d:o.d,fill:'none',stroke:sel?'#3182ce':(isBoundary?'#a0aec0':'#1a202c'),'stroke-width':isBoundary?'1.6':'1.8','stroke-linecap':'round','stroke-linejoin':'round'};
    if(isBoundary)attrs['stroke-dasharray']='6,4';
    g.appendChild(_el('path',attrs));
    g.appendChild(_el('path',{d:o.d,fill:'none',stroke:'transparent','stroke-width':'14'}));
    return g;
  }

  // ── Render ───────────────────────────────────────────────────────
  function _render(){
    if(!_vp)return;
    while(_vp.firstChild)_vp.removeChild(_vp.firstChild);
    _vp.setAttribute('transform',`translate(${_panX},${_panY}) scale(${_zoom})`);
    const defs=_el('defs');
    const pat=_el('pattern',{id:'gp',x:'0',y:'0',width:String(GRID),height:String(GRID),patternUnits:'userSpaceOnUse'});
    pat.appendChild(_el('circle',{cx:'1',cy:'1',r:'1.3',fill:'#b0bec5',opacity:'0.55'}));
    defs.appendChild(pat);_vp.appendChild(defs);
    _vp.appendChild(_el('rect',{x:'-3000',y:'-3000',width:'6000',height:'6000',fill:'url(#gp)'}));
    {const fam=new Set(_objs.filter(o=>o.type==='link'&&o.coupleId).map(o=>o.coupleId));for(const o of _objs)if(o.type==='link'){if(fam.has(o.id)&&COUPLE_LTYPES.includes(o.linkType)){const cl=_objs.filter(x=>x.type==='link'&&x.coupleId===o.id);const g=_linkElFamily(o,cl,false);if(g)_vp.appendChild(g);}else if(!o.coupleId){const g=_linkEl(o,false);if(g)_vp.appendChild(g);}}}
    for(const o of _objs){
      if(o.type==='node')_vp.appendChild(_nodeEl(o,false));
      else if(o.type==='text')_vp.appendChild(_textEl(o,false));
      else if(o.type==='path')_vp.appendChild(_pathEl(o,false));
    }
    if(_connectLine)_vp.appendChild(_connectLine);
    if(_freehandEl)_vp.appendChild(_freehandEl);
    if(_boxSel){
      const bx=Math.min(_boxSel.x1,_boxSel.x2),by=Math.min(_boxSel.y1,_boxSel.y2),bw=Math.abs(_boxSel.x2-_boxSel.x1),bh=Math.abs(_boxSel.y2-_boxSel.y1);
      _vp.appendChild(_el('rect',{x:bx,y:by,width:bw,height:bh,fill:'rgba(49,130,206,.1)',stroke:'#3182ce','stroke-width':'1','stroke-dasharray':'4,2','pointer-events':'none'}));
    }
  }

  // ── Coords & Hit ─────────────────────────────────────────────────
  const _toSVG=(cx,cy)=>{const r=_svg.getBoundingClientRect();return{x:(cx-r.left-_panX)/_zoom,y:(cy-r.top-_panY)/_zoom};};
  const _hitNode=(x,y)=>[..._objs].reverse().find(o=>o.type==='node'&&Math.abs(x-o.x)<=SZ+8&&Math.abs(y-o.y)<=SZ+8)||null;
  const _hitText=(x,y)=>[..._objs].reverse().find(o=>o.type==='text'&&x>=o.x-5&&x<=o.x+(o.text.length*(o.fontSize||12)*.7+12)&&y>=(o.y-(o.fontSize||12)-4)&&y<=(o.y+6))||null;
  const _hitPath=(x,y)=>[..._objs].reverse().find(o=>{if(o.type!=='path'||!o.bbox)return false;return x>=o.bbox.x-10&&x<=o.bbox.x+o.bbox.w+10&&y>=o.bbox.y-10&&y<=o.bbox.y+o.bbox.h+10;})||null;
  const _hitLink=(x,y)=>[..._objs].reverse().find(o=>{
    if(o.type!=='link')return false;
    const fm=_objs.find(n=>n.id===o.from),to=_objs.find(n=>n.id===o.to);if(!fm||!to)return false;
    const dx=to.x-fm.x,dy=to.y-fm.y,len=Math.hypot(dx,dy)||1;
    const t2=Math.max(0,Math.min(1,((x-fm.x)*dx+(y-fm.y)*dy)/(len*len)));
    return Math.hypot(x-(fm.x+t2*dx),y-(fm.y+t2*dy))<=10;
  })||null;

  // ── Path helpers ─────────────────────────────────────────────────
  const _ptsToD=pts=>(!pts||!pts.length)?'':'M'+pts[0][0]+' '+pts[0][1]+pts.slice(1).map(p=>'L'+p[0]+' '+p[1]).join('');
  function _calcBbox(pts){if(!pts||!pts.length)return{x:0,y:0,w:0,h:0};let lx=Infinity,ly=Infinity,hx=-Infinity,hy=-Infinity;for(const[px,py]of pts){lx=Math.min(lx,px);ly=Math.min(ly,py);hx=Math.max(hx,px);hy=Math.max(hy,py);}return{x:lx,y:ly,w:hx-lx,h:hy-ly};}

  // ── Undo/Redo ────────────────────────────────────────────────────
  const _snap=()=>JSON.parse(JSON.stringify(_objs));
  const _pushUndo=()=>{_undo.push(_snap());if(_undo.length>60)_undo.shift();_redo=[];};
  function undo(){if(!_undo.length)return;_redo.push(_snap());_objs=_undo.pop();_selId=null;_multiSel=new Set();_render();}
  function redo(){if(!_redo.length)return;_undo.push(_snap());_objs=_redo.pop();_selId=null;_multiSel=new Set();_render();}

  // ── Box selection ─────────────────────────────────────────────────
  function _selectInBox(x1,y1,x2,y2){
    const lx=Math.min(x1,x2),rx=Math.max(x1,x2),ty=Math.min(y1,y2),by=Math.max(y1,y2);
    _multiSel=new Set();
    for(const o of _objs){
      if((o.type==='node'||o.type==='text')&&o.x>=lx&&o.x<=rx&&o.y>=ty&&o.y<=by)_multiSel.add(o.id);
      else if(o.type==='path'&&o.bbox){const cx=o.bbox.x+o.bbox.w/2,cy=o.bbox.y+o.bbox.h/2;if(cx>=lx&&cx<=rx&&cy>=ty&&cy<=by)_multiSel.add(o.id);}
    }
    if(_multiSel.size===1){_selId=[..._multiSel][0];_multiSel=new Set();}else{_selId=null;}
  }

  // ── Mouse events ─────────────────────────────────────────────────
  function _onMouseDown(e){
    if(e.button===1){e.preventDefault();_dragging={type:'pan',sx:e.clientX,sy:e.clientY,ox:_panX,oy:_panY};return;}
    if(e.button!==0)return;e.preventDefault();
    const{x,y}=_toSVG(e.clientX,e.clientY);
    const nd=_hitNode(x,y),tx=!nd&&_hitText(x,y),ph=!nd&&!tx&&_hitPath(x,y),lk=!nd&&!tx&&!ph&&_hitLink(x,y);
    const anyHit=nd||tx||ph||lk;
    if(_spaceDown){_dragging={type:'pan',sx:e.clientX,sy:e.clientY,ox:_panX,oy:_panY};return;}
    if(_tool==='select'){
      if(anyHit){
        const hitId=(nd||tx||ph||lk).id;
        if(e.shiftKey){
          if(_multiSel.has(hitId)){_multiSel.delete(hitId);}
          else{if(_selId){_multiSel.add(_selId);_selId=null;}_multiSel.add(hitId);}
          _render();return;
        }
        if(_multiSel.has(hitId)){
          _dragBeforeState=_snap();
          const origObjs=[..._multiSel].map(id=>_objs.find(o=>o.id===id)).filter(Boolean);
          _dragging={type:'multi',sx:x,sy:y,origObjs:JSON.parse(JSON.stringify(origObjs))};
        }else{
          _multiSel=new Set();_selId=hitId;
          const hObj=nd||tx||ph;
          if(hObj){
            _dragBeforeState=_snap();
            if(hObj.type==='path')_dragging={type:'single-path',id:hitId,sx:x,sy:y,origPts:JSON.parse(JSON.stringify(hObj.points))};
            else{
              // 若拖曳伴侶節點，同步帶動其子女
              const _lkChn=[];
              if(hObj.type==='node'){const CTYPE=COUPLE_LTYPES;const cpls=_objs.filter(o=>o.type==='link'&&CTYPE.includes(o.linkType)&&(o.from===hitId||o.to===hitId));for(const cp of cpls){const cks=_objs.filter(o=>o.type==='link'&&o.coupleId===cp.id);for(const ck of cks){const cn=_objs.find(o=>o.id===ck.childId);if(cn&&!_lkChn.find(c=>c.id===cn.id))_lkChn.push({id:cn.id,ox:cn.x,oy:cn.y});}}}
              _dragging={type:'single',id:hitId,sx:x,sy:y,ox:hObj.x,oy:hObj.y,lkChn:_lkChn};
            }
          }else _dragging=null;
        }
        _render();
      }else{
        _selId=null;_multiSel=new Set();
        _boxSel={x1:x,y1:y,x2:x,y2:y};_dragging={type:'box'};_render();
      }
    }else if(_tool.startsWith('place_custom_')){
      const idx=parseInt(_tool.slice(13));
      const cc=configData&&configData.customComponents&&configData.customComponents[idx];
      if(cc){
        _pushUndo();const idMap={},sx=_snapG(x),sy=_snapG(y);
        for(const o of cc.objects)idMap[o.id]=_uid();
        for(const o of cc.objects){
          const copy=JSON.parse(JSON.stringify(o));copy.id=idMap[o.id];
          if(copy.type==='link'){copy.from=idMap[copy.from]||copy.from;copy.to=idMap[copy.to]||copy.to;if(copy.coupleId)copy.coupleId=idMap[copy.coupleId]||copy.coupleId;if(copy.childId)copy.childId=idMap[copy.childId]||copy.childId;if(copy.parentId)copy.parentId=idMap[copy.parentId]||copy.parentId;}
          else if(copy.type==='path'){copy.points=(copy.points||[]).map(([px,py])=>[px+sx,py+sy]);copy.d=_ptsToD(copy.points);copy.bbox=_calcBbox(copy.points);}
          else{copy.x=(copy.x||0)+sx;copy.y=(copy.y||0)+sy;}
          _objs.push(copy);
        }
        _multiSel=new Set(cc.objects.map(o=>idMap[o.id]));_selId=null;_render();
      }
    }else if(_tool.startsWith('place_builtin_')){
      const idx=parseInt(_tool.slice(14));
      const tpl=BUILTIN_TEMPLATES[idx];
      if(tpl){
        _pushUndo();const idMap={},sx=_snapG(x),sy=_snapG(y);
        for(const o of tpl.objects)idMap[o.id]=_uid();
        for(const o of tpl.objects){
          const copy=JSON.parse(JSON.stringify(o));copy.id=idMap[o.id];
          if(copy.type==='link'){copy.from=idMap[copy.from]||copy.from;copy.to=idMap[copy.to]||copy.to;if(copy.coupleId)copy.coupleId=idMap[copy.coupleId]||copy.coupleId;if(copy.childId)copy.childId=idMap[copy.childId]||copy.childId;if(copy.parentId)copy.parentId=idMap[copy.parentId]||copy.parentId;}
          else{copy.x=(copy.x||0)+sx;copy.y=(copy.y||0)+sy;}
          _objs.push(copy);
        }
        _multiSel=new Set(tpl.objects.map(o=>idMap[o.id]));_selId=null;_render();
      }
    }else if(_tool.startsWith('place_')){
      _pushUndo();
      const n={id:_uid(),type:'node',shapeType:_tool.slice(6),x:_snapG(x),y:_snapG(y),label:''};
      _objs.push(n);_selId=n.id;_multiSel=new Set();_render();
    }else if(_tool==='connect'){
      if(nd){
        if(!_connectFrom){_connectFrom=nd.id;_connectLine=_el('line',{x1:nd.x,y1:nd.y,x2:nd.x,y2:nd.y,stroke:'#3182ce','stroke-width':'1.5','stroke-dasharray':'4,3','pointer-events':'none'});}
        else if(nd.id!==_connectFrom){
          const CTYPE=COUPLE_LTYPES;
          if(_linkType==='twin'){
            const hasCplChn=nid=>_objs.some(o=>o.type==='link'&&CTYPE.includes(o.linkType)&&(o.from===nid||o.to===nid)&&_objs.some(c=>c.type==='link'&&c.coupleId===o.id));
            const isPartnerOnly=nid=>{const cpls=_objs.filter(o=>o.type==='link'&&CTYPE.includes(o.linkType)&&(o.from===nid||o.to===nid));return cpls.length>0&&!_objs.some(c=>c.type==='link'&&cpls.some(cp=>c.coupleId===cp.id));};
            if(hasCplChn(_connectFrom)||hasCplChn(nd.id)){
              alert('此節點已是父母，無法標記為多胞胎。\n請點選尚無子女的節點。');
            }else if(isPartnerOnly(_connectFrom)||isPartnerOnly(nd.id)){
              _pushUndo();
              const nl={id:_uid(),type:'link',from:_connectFrom,to:nd.id,linkType:'parent'};
              const fCpl=_objs.filter(o=>o.type==='link'&&CTYPE.includes(o.linkType)&&(o.from===_connectFrom||o.to===_connectFrom));
              const tCpl=_objs.filter(o=>o.type==='link'&&CTYPE.includes(o.linkType)&&(o.from===nd.id||o.to===nd.id));
              if(tCpl.length&&!fCpl.length){nl.coupleId=tCpl[0].id;nl.childId=_connectFrom;nl.parentId=nd.id;}
              else if(fCpl.length&&!tCpl.length){nl.coupleId=fCpl[0].id;nl.childId=nd.id;nl.parentId=_connectFrom;}
              if(nl.coupleId){const exCl=_objs.find(o=>o.type==='link'&&o.coupleId===nl.coupleId&&o.childId===nl.childId);if(exCl){exCl.linkType='parent';delete exCl.twinGroupId;}else{_objs.push(nl);}_autoArrangeCouple(nl.coupleId);}else{_objs.push(nl);}
            }else{
              const clA=_objs.find(o=>o.type==='link'&&o.childId===_connectFrom);
              const clB=_objs.find(o=>o.type==='link'&&o.childId===nd.id);
              if(!clA||!clB||clA.coupleId!==clB.coupleId){
                alert('兩個節點需為同一對父母的孩子，才能標記為多胞胎。');
              }else{
                _pushUndo();
                const tgA=clA.twinGroupId,tgB=clB.twinGroupId;
                if(tgA&&!tgB){clB.twinGroupId=tgA;}
                else if(tgB&&!tgA){clA.twinGroupId=tgB;}
                else if(tgA&&tgB&&tgA!==tgB){for(const o of _objs)if(o.type==='link'&&o.twinGroupId===tgB)o.twinGroupId=tgA;}
                else{const tgId='tg_'+_uid();clA.twinGroupId=tgId;clB.twinGroupId=tgId;}
              }
            }
          }else{
            _pushUndo();
            const nl={id:_uid(),type:'link',from:_connectFrom,to:nd.id,linkType:_linkType};
            if(['parent','adopted','foster'].includes(_linkType)){
              // 親子方向以「垂直位置」判斷（Y 較小＝畫面上方＝父母，Y 較大＝下方＝子女），不受點擊順序或哪一側已成家影響。
              // 若改用「哪一側已成家」當作父母的判斷依據，新增祖父母世代時（祖父尚未成家、父母已成家有子女）會誤判成祖父是父母的孩子。
              const fNode=_objs.find(o=>o.id===_connectFrom);
              const parentId=(fNode.y<=nd.y)?_connectFrom:nd.id;
              const childId=(fNode.y<=nd.y)?nd.id:_connectFrom;
              nl.parentId=parentId;nl.childId=childId;
              const pCpl=_objs.filter(o=>o.type==='link'&&CTYPE.includes(o.linkType)&&(o.from===parentId||o.to===parentId));
              if(pCpl.length)nl.coupleId=pCpl[0].id;
              if(nl.coupleId){
                const exCl=_objs.find(o=>o.type==='link'&&o.coupleId===nl.coupleId&&o.childId===nl.childId);
                if(exCl){exCl.linkType=nl.linkType;}else{_objs.push(nl);}
                _autoArrangeCouple(nl.coupleId);
              }else{_objs.push(nl);}
            }else{
              if(COUPLE_LTYPES.includes(_linkType)){
                const fNode=_objs.find(o=>o.id===_connectFrom);
                if(fNode){const ay=_snapG((fNode.y+nd.y)/2);fNode.y=ay;nd.y=ay;}
              }
              _objs.push(nl);
            }
          }
          _connectFrom=null;_connectLine=null;_render();
        }
      }else{_connectFrom=null;_connectLine=null;_render();}
    }else if(_tool==='text'){
      _pushUndo();
      const n={id:_uid(),type:'text',x:_snapG(x),y:_snapG(y),text:'文字',fontSize:_textFontSize,bold:_textBold,italic:_textItalic,strikethrough:_textStrike};
      _objs.push(n);_selId=n.id;_multiSel=new Set();_render();_startInlineEdit(n.id);
    }else if(_tool==='freehand'||_tool==='boundary'){
      _freehandPts=[[x,y]];
      _freehandEl=_tool==='boundary'
        ? _el('path',{d:`M${x} ${y}`,fill:'none',stroke:'#a0aec0','stroke-width':'1.6','stroke-dasharray':'6,4','stroke-linecap':'round','pointer-events':'none'})
        : _el('path',{d:`M${x} ${y}`,fill:'none',stroke:'#1a202c','stroke-width':'1.8','stroke-linecap':'round','pointer-events':'none'});
    }else if(_tool==='erase'){
      _dragBeforeState=_snap();
      if(anyHit){const tid=(nd||tx||ph||lk).id;_objs=_objs.filter(o=>o.id!==tid&&!(o.type==='link'&&(o.from===tid||o.to===tid)));if(_selId===tid)_selId=null;_multiSel.delete(tid);}
      _dragging={type:'erase',changed:!!anyHit};_render();
    }
  }

  function _onMouseMove(e){
    const{x,y}=_toSVG(e.clientX,e.clientY);
    if(_dragging){
      if(_dragging.type==='single'){
        const o=_objs.find(o=>o.id===_dragging.id);
        if(o){let ddx=x-_dragging.sx,ddy=y-_dragging.sy;if(e.shiftKey){if(Math.abs(ddx)>=Math.abs(ddy))ddy=0;else ddx=0;}o.x=_dragging.ox+ddx;o.y=_dragging.oy+ddy;for(const lc of(_dragging.lkChn||[])){const cn=_objs.find(o=>o.id===lc.id);if(cn){cn.x=lc.ox+ddx;cn.y=lc.oy+ddy;}}_render();}
      }else if(_dragging.type==='single-path'){
        const o=_objs.find(o=>o.id===_dragging.id);
        if(o){const ddx=x-_dragging.sx,ddy=y-_dragging.sy;o.points=_dragging.origPts.map(([px,py])=>[px+ddx,py+ddy]);o.d=_ptsToD(o.points);o.bbox=_calcBbox(o.points);_render();}
      }else if(_dragging.type==='multi'){
        let ddx=x-_dragging.sx,ddy=y-_dragging.sy;
        if(e.shiftKey){if(Math.abs(ddx)>=Math.abs(ddy))ddy=0;else ddx=0;}
        for(const orig of _dragging.origObjs){
          const o=_objs.find(o=>o.id===orig.id);if(!o)continue;
          if(o.type==='path'){o.points=(orig.points||[]).map(([px,py])=>[px+ddx,py+ddy]);o.d=_ptsToD(o.points);o.bbox=_calcBbox(o.points);}
          else{o.x=orig.x+ddx;o.y=orig.y+ddy;}
        }
        _render();
      }else if(_dragging.type==='pan'){
        _panX=_dragging.ox+(e.clientX-_dragging.sx);_panY=_dragging.oy+(e.clientY-_dragging.sy);_render();
      }else if(_dragging.type==='box'&&_boxSel){
        _boxSel.x2=x;_boxSel.y2=y;_render();
      }else if(_dragging.type==='erase'){
        const _n=_hitNode(x,y),_t=!_n&&_hitText(x,y),_p=!_n&&!_t&&_hitPath(x,y),_l=!_n&&!_t&&!_p&&_hitLink(x,y);
        const _h=_n||_t||_p||_l;
        if(_h){const tid=_h.id;_objs=_objs.filter(o=>o.id!==tid&&!(o.type==='link'&&(o.from===tid||o.to===tid)));if(_selId===tid)_selId=null;_multiSel.delete(tid);_dragging.changed=true;_render();}
      }
    }
    if(_connectLine&&_connectFrom){_connectLine.setAttribute('x2',x);_connectLine.setAttribute('y2',y);_render();}
    if((_tool==='freehand'||_tool==='boundary')&&_freehandPts.length){
      _freehandPts.push([x,y]);if(_freehandEl)_freehandEl.setAttribute('d',_ptsToD(_freehandPts));_render();
    }
  }

  function _onMouseUp(){
    if(_dragging){
      if(_dragging.type==='single'&&_dragBeforeState){
        const o=_objs.find(o=>o.id===_dragging.id);
        if(o&&(Math.abs(o.x-_dragging.ox)>2||Math.abs(o.y-_dragging.oy)>2)){_undo.push(_dragBeforeState);if(_undo.length>60)_undo.shift();_redo=[];o.x=_snapG(o.x);o.y=_snapG(o.y);for(const lc of(_dragging.lkChn||[])){const cn=_objs.find(o=>o.id===lc.id);if(cn){cn.x=_snapG(cn.x);cn.y=_snapG(cn.y);}}}
        _dragBeforeState=null;
      }else if(_dragging.type==='single-path'&&_dragBeforeState){
        _undo.push(_dragBeforeState);if(_undo.length>60)_undo.shift();_redo=[];_dragBeforeState=null;
      }else if(_dragging.type==='multi'&&_dragBeforeState){
        _undo.push(_dragBeforeState);if(_undo.length>60)_undo.shift();_redo=[];
        for(const id of _multiSel){const o=_objs.find(o=>o.id===id);if(o&&o.type!=='path'){o.x=_snapG(o.x);o.y=_snapG(o.y);}}
        _dragBeforeState=null;
      }else if(_dragging.type==='box'&&_boxSel){
        _selectInBox(_boxSel.x1,_boxSel.y1,_boxSel.x2,_boxSel.y2);_boxSel=null;
      }else if(_dragging.type==='erase'&&_dragBeforeState){
        if(_dragging.changed){_undo.push(_dragBeforeState);if(_undo.length>60)_undo.shift();_redo=[];}
        _dragBeforeState=null;
      }
    }
    _dragging=null;
    if((_tool==='freehand'||_tool==='boundary')&&_freehandPts.length>2){
      _pushUndo();const pts=_freehandPts;
      const isBoundary=_tool==='boundary';
      const o={id:_uid(),type:'path',points:pts,d:_ptsToD(pts)+(isBoundary?' Z':''),bbox:_calcBbox(pts)};
      if(isBoundary)o.pathKind='boundary';
      _objs.push(o);_selId=o.id;
    }
    _freehandPts=[];_freehandEl=null;_render();
  }

  function _onDblClick(e){
    const{x,y}=_toSVG(e.clientX,e.clientY);
    const tx=_hitText(x,y);if(tx){_selId=tx.id;_multiSel=new Set();_render();_startInlineEdit(tx.id);return;}
    const nd=_hitNode(x,y);if(nd){_selId=nd.id;_multiSel=new Set();_render();editLabel();}
  }

  function _onWheel(e){
    e.preventDefault();const f=e.deltaY<0?1.1:0.9,r=_svg.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
    _panX=mx+(_panX-mx)*f;_panY=my+(_panY-my)*f;_zoom=Math.max(0.1,Math.min(5,_zoom*f));_render();
  }

  function _onKeyDown(e){
    if(!document.getElementById('geno-overlay'))return;
    if(document.activeElement.tagName==='INPUT'||document.activeElement.tagName==='TEXTAREA')return;
    if(e.key===' '){e.preventDefault();_spaceDown=true;if(_svg)_svg.style.cursor='grab';return;}
    if(e.key==='z'&&(e.ctrlKey||e.metaKey)&&!e.shiftKey){e.preventDefault();undo();}
    if((e.key==='y'||(e.key==='z'&&e.shiftKey))&&(e.ctrlKey||e.metaKey)){e.preventDefault();redo();}
    if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteSelected();}
    if(e.key==='Escape'){_connectFrom=null;_connectLine=null;_boxSel=null;_selId=null;_multiSel=new Set();_render();}
  }
  function _onKeyUp(e){if(e.key===' '){_spaceDown=false;if(_svg)_svg.style.cursor='';}}

  // ── Inline text edit ──────────────────────────────────────────────
  function _startInlineEdit(id){
    const o=_objs.find(x=>x.id===id);if(!o||o.type!=='text')return;
    const wrap=document.getElementById('geno-canvas-wrap');if(!wrap)return;
    const r=wrap.getBoundingClientRect(),fs=(o.fontSize||12)*_zoom;
    const inp=document.createElement('input');inp.type='text';inp.value=o.text;
    inp.style.cssText=`position:fixed;left:${o.x*_zoom+_panX+r.left}px;top:${(o.y-o.fontSize)*_zoom+_panY+r.top}px;font-size:${fs}px;border:2px solid #3182ce;outline:none;padding:1px 3px;min-width:80px;z-index:100002;background:#fff;font-family:sans-serif;font-weight:${o.bold?'bold':'normal'};font-style:${o.italic?'italic':'normal'};text-decoration:${o.strikethrough?'line-through':'none'};`;
    document.body.appendChild(inp);inp.focus();inp.select();
    const finish=()=>{const v=inp.value.trim();if(v){_pushUndo();o.text=v;}inp.remove();_render();};
    inp.addEventListener('blur',finish);
    inp.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key==='Escape'){ev.preventDefault();finish();}ev.stopPropagation();});
  }

  // ── Text format ───────────────────────────────────────────────────
  function toggleTextProp(prop){
    const o=_objs.find(x=>x.id===_selId);
    if(o&&o.type==='text'){_pushUndo();o[prop]=!o[prop];}
    else if(prop==='bold')_textBold=!_textBold;
    else if(prop==='italic')_textItalic=!_textItalic;
    else if(prop==='strikethrough')_textStrike=!_textStrike;
    _updateTextBtns();_render();
  }
  function applyFontSize(sz){
    _textFontSize=sz;const o=_objs.find(x=>x.id===_selId);
    if(o&&o.type==='text'){_pushUndo();o.fontSize=sz;_render();}
  }
  function _updateTextBtns(){
    const o=_selId?_objs.find(x=>x.id===_selId):null,u=o&&o.type==='text';
    const bEl=document.getElementById('geno-txt-bold'),iEl=document.getElementById('geno-txt-italic'),sEl=document.getElementById('geno-txt-strike'),fsEl=document.getElementById('geno-txt-size');
    if(bEl)bEl.classList.toggle('active',!!(u?o.bold:_textBold));
    if(iEl)iEl.classList.toggle('active',!!(u?o.italic:_textItalic));
    if(sEl)sEl.classList.toggle('active',!!(u?o.strikethrough:_textStrike));
    if(fsEl)fsEl.value=u?o.fontSize:_textFontSize;
  }

  // ── Actions ──────────────────────────────────────────────────────
  function deleteSelected(){
    const ids=new Set(_multiSel);if(_selId)ids.add(_selId);if(!ids.size)return;
    _pushUndo();_objs=_objs.filter(o=>!ids.has(o.id)&&!(o.type==='link'&&(ids.has(o.from)||ids.has(o.to))));
    _selId=null;_multiSel=new Set();_render();
  }
  function editLabel(){
    const o=_objs.find(x=>x.id===_selId);if(!o)return;
    if(o.type==='text'){_startInlineEdit(o.id);return;}
    const v=prompt('輸入姓名/標籤：',o.label||'');
    if(v!==null){_pushUndo();o.label=v;_render();}
  }

  // ── Auto-arrange ──────────────────────────────────────────────────
  function _autoArrangeCouple(coupleLinkId){
    const cpl=_objs.find(o=>o.id===coupleLinkId);if(!cpl)return;
    const A=_objs.find(o=>o.id===cpl.from),B=_objs.find(o=>o.id===cpl.to);if(!A||!B)return;
    const childLinks=_objs.filter(o=>o.type==='link'&&o.coupleId===coupleLinkId);
    const children=childLinks.map(cl=>_objs.find(o=>o.id===cl.childId)).filter(Boolean);
    if(!children.length)return;
    children.sort((a,b)=>a.x-b.x);
    const n=children.length,SPACING=SZ*3.5,totalW=(n-1)*SPACING;
    const minBarW=Math.max(SZ*2.5,totalW+SZ*2),midX=(A.x+B.x)/2;
    if(Math.abs(B.x-A.x)<minBarW){A.x=_snapG(midX-minBarW/2);B.x=_snapG(midX+minBarW/2);}
    const nAx=A.x,nBx=B.x;
    for(let i=0;i<n;i++){const bpX=n===1?(nAx+nBx)/2:nAx+(nBx-nAx)*(i+1)/(n+1);children[i].x=_snapG(bpX);}
  }
  // 依親子關係計算每個節點的世代深度（0=最頂層祖先），統一調整 Y 座標為 baseY + depth*GEN_GAP，
  // 讓「新增三代」不需使用者手動抓高度；固定間距(120)遠大於配偶→子女倒ㄇ橫桿的垂直偏移(54)，
  // 兩代之間保證留有淨空，順帶避免橫桿與下一代節點/橫桿重疊。
  function _autoArrangeGenerations(){
    const GEN_GAP=120;
    const nodes=_objs.filter(o=>o.type==='node');
    if(!nodes.length)return;
    const childParentKey={};
    for(const o of _objs){
      if(o.type==='link'&&['parent','adopted','foster'].includes(o.linkType)&&o.childId){
        childParentKey[o.childId]=o.coupleId||('single_'+o.parentId);
      }
    }
    const depthCache={};
    function nodeDepth(nodeId,seen){
      if(depthCache[nodeId]!==undefined)return depthCache[nodeId];
      seen=seen||new Set();
      if(seen.has(nodeId)){depthCache[nodeId]=0;return 0;}
      seen.add(nodeId);
      const pk=childParentKey[nodeId];
      if(!pk){depthCache[nodeId]=0;return 0;}
      let parentNodeId=null;
      if(pk.startsWith('single_'))parentNodeId=pk.slice(7);
      else{const cplLink=_objs.find(o=>o.id===pk);parentNodeId=cplLink?cplLink.from:null;}
      const d=parentNodeId?nodeDepth(parentNodeId,seen)+1:0;
      depthCache[nodeId]=d;return d;
    }
    for(const n of nodes)nodeDepth(n.id);
    const minDepth=Math.min(...nodes.map(n=>depthCache[n.id]));
    const baseNodes=nodes.filter(n=>depthCache[n.id]===minDepth);
    const baseY=baseNodes.reduce((s,n)=>s+n.y,0)/baseNodes.length;
    for(const n of nodes){
      const rel=depthCache[n.id]-minDepth;
      n.y=_snapG(baseY+rel*GEN_GAP);
    }
    // 同代夫妻保險：配偶連線兩端強制取平均高度，避免因不同分支路徑算出的深度有落差
    const CTYPE0=COUPLE_LTYPES;
    for(const o of _objs){
      if(o.type==='link'&&CTYPE0.includes(o.linkType)){
        const A=_objs.find(x=>x.id===o.from),B=_objs.find(x=>x.id===o.to);
        if(A&&B){const y=_snapG((A.y+B.y)/2);A.y=y;B.y=y;}
      }
    }
  }
  function autoArrangeAll(){
    _pushUndo();
    _autoArrangeGenerations();
    const CTYPE=COUPLE_LTYPES;
    let n=0;for(const o of _objs)if(o.type==='link'&&CTYPE.includes(o.linkType)){_autoArrangeCouple(o.id);n++;}
    _render();
    const tip=document.createElement('div');tip.textContent=n?`已整理世代間距，並均勻排列 ${n} 個家庭組子女位置`:'未找到配偶連線（需先用「結婚/分居/離婚」連線連結兩個節點，才能美化排列）';
    tip.style.cssText='position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#2d3748;color:#fff;padding:8px 18px;border-radius:8px;font-size:.85rem;z-index:200000;pointer-events:none;opacity:1;transition:opacity .5s';
    document.body.appendChild(tip);setTimeout(()=>{tip.style.opacity='0';setTimeout(()=>tip.remove(),500);},2500);
  }
  function clearSelect(){_connectFrom=null;_connectLine=null;_boxSel=null;_selId=null;_multiSel=new Set();_render();}
  function applyColor(color,event){
    if(!_selId&&_multiSel.size===0)return;_pushUndo();
    const ids=new Set(_multiSel);if(_selId)ids.add(_selId);
    const isStroke=event&&event.shiftKey;
    for(const id of ids){const o=_objs.find(x=>x.id===id);if(!o)continue;if(o.type==='node'){if(isStroke)o.strokeColor=color;else o.fillColor=color;}else{o.strokeColor=color;}}
    _render();
  }
  function applyStrokeColor(color){
    if(!_selId&&_multiSel.size===0)return;_pushUndo();
    const ids=new Set(_multiSel);if(_selId)ids.add(_selId);
    for(const id of ids){const o=_objs.find(x=>x.id===id);if(o)o.strokeColor=color;}
    _render();
  }
  function toggleDisability(){
    if(!_selId&&_multiSel.size===0)return;_pushUndo();
    const ids=new Set(_multiSel);if(_selId)ids.add(_selId);
    const nodes=[..._objs].filter(o=>ids.has(o.id)&&o.type==='node');
    const on=!nodes.every(o=>o.disability);
    for(const o of nodes){if(on)o.disability=true;else delete o.disability;}
    _render();
  }
  function toggleChronicIllness(){
    if(!_selId&&_multiSel.size===0)return;_pushUndo();
    const ids=new Set(_multiSel);if(_selId)ids.add(_selId);
    const nodes=[..._objs].filter(o=>ids.has(o.id)&&o.type==='node');
    const on=!nodes.every(o=>o.chronicIllness);
    for(const o of nodes){if(on)o.chronicIllness=true;else delete o.chronicIllness;}
    _render();
  }
  function clearColor(){
    if(!_selId&&_multiSel.size===0)return;_pushUndo();
    const ids=new Set(_multiSel);if(_selId)ids.add(_selId);
    for(const id of ids){const o=_objs.find(x=>x.id===id);if(o){delete o.fillColor;delete o.strokeColor;}}
    _render();
  }
  function toggleSbSection(key){_sbCollapsed[key]=!_sbCollapsed[key];_renderSidebar();}

  // ── Custom components ─────────────────────────────────────────────
  function saveAsCustom(){
    const ids=new Set(_multiSel);if(_selId)ids.add(_selId);
    if(!ids.size){alert('請先選取一組物件。');return;}
    let cx=0,cy=0,cnt=0;
    for(const o of _objs.filter(o=>ids.has(o.id))){if(o.type==='node'||o.type==='text'){cx+=o.x;cy+=o.y;cnt++;}else if(o.type==='path'&&o.bbox){cx+=o.bbox.x+o.bbox.w/2;cy+=o.bbox.y+o.bbox.h/2;cnt++;}}
    if(!cnt){cx=0;cy=0;}else{cx/=cnt;cy/=cnt;}
    const _svgR=_svg.getBoundingClientRect();
    const anchor={x:_svgR.left+cx*_zoom+_panX,y:_svgR.top+cy*_zoom+_panY};
    _showNamePanel(anchor,name=>{
      const allIds=new Set(ids);
      for(const o of _objs)if(o.type==='link'&&ids.has(o.from)&&ids.has(o.to))allIds.add(o.id);
      const selected=_objs.filter(o=>allIds.has(o.id));
      let lx=Infinity,ly=Infinity,hx=-Infinity,hy=-Infinity;
      for(const o of selected){
        if(o.type==='node'){lx=Math.min(lx,o.x-SZ);ly=Math.min(ly,o.y-SZ);hx=Math.max(hx,o.x+SZ);hy=Math.max(hy,o.y+SZ);}
        else if(o.type==='text'){lx=Math.min(lx,o.x);ly=Math.min(ly,o.y-(o.fontSize||12));hx=Math.max(hx,o.x+o.text.length*8);hy=Math.max(hy,o.y+4);}
        else if(o.type==='path'&&o.bbox){lx=Math.min(lx,o.bbox.x);ly=Math.min(ly,o.bbox.y);hx=Math.max(hx,o.bbox.x+o.bbox.w);hy=Math.max(hy,o.bbox.y+o.bbox.h);}
      }
      if(!isFinite(lx)){lx=0;ly=0;hx=60;hy=60;}
      const norm=JSON.parse(JSON.stringify(selected)).map(o=>{
        if(o.type==='node'){o.x-=lx;o.y-=ly;}
        else if(o.type==='text'){o.x-=lx;o.y-=ly;}
        else if(o.type==='path'){o.points=(o.points||[]).map(([px,py])=>[px-lx,py-ly]);o.d=_ptsToD(o.points);o.bbox=_calcBbox(o.points);}
        return o;
      });
      if(!configData)configData={};if(!configData.customComponents)configData.customComponents=[];
      configData.customComponents.push({name,objects:norm,bbox:{w:hx-lx,h:hy-ly}});
      driveUpdateJsonFile(CONFIG_FILE,configData).catch(()=>{});
      _renderSidebar();
    });
  }
  function _showNamePanel(anchor,cb){
    const old=document.getElementById('geno-name-panel');if(old)old.remove();
    const PW=240;
    const px=Math.min(Math.max((anchor.x||200)-PW/2,8),window.innerWidth-PW-8);
    const py=Math.min((anchor.y||200)+20,window.innerHeight-170);
    const p=document.createElement('div');
    p.id='geno-name-panel';
    p.style.cssText=`position:fixed;left:${px}px;top:${py}px;background:#fff;border:1.5px solid #3182ce;border-radius:10px;padding:14px 16px;z-index:100002;box-shadow:0 6px 24px rgba(0,0,0,0.18);min-width:${PW}px;`;
    p.innerHTML='<div style="font-size:.83rem;font-weight:700;color:#2b6cb0;margin-bottom:10px;">💾 儲存為自訂元件</div>'
      +'<input id="geno-np-inp" type="text" placeholder="輸入元件名稱…" maxlength="30" style="width:100%;box-sizing:border-box;border:1px solid #cbd5e0;border-radius:6px;padding:6px 10px;font-size:.88rem;outline:none;margin-bottom:10px;transition:border .2s;" onfocus="this.style.borderColor=\'#3182ce\'" onblur="this.style.borderColor=\'#cbd5e0\'">'
      +'<div style="display:flex;gap:8px;justify-content:flex-end;">'
      +'<button id="geno-np-cancel" style="font-size:.82rem;padding:5px 12px;border:1px solid #e2e8f0;border-radius:6px;background:#f7fafc;cursor:pointer;color:#4a5568;">取消</button>'
      +'<button id="geno-np-ok" style="font-size:.82rem;padding:5px 14px;border:none;border-radius:6px;background:#3182ce;color:#fff;cursor:pointer;font-weight:700;">確認儲存</button>'
      +'</div>';
    document.body.appendChild(p);
    const inp=document.getElementById('geno-np-inp');inp.focus();
    const confirm=()=>{const v=inp.value.trim();if(!v){inp.style.borderColor='#e53e3e';return;}p.remove();cb(v);};
    document.getElementById('geno-np-cancel').onclick=()=>p.remove();
    document.getElementById('geno-np-ok').onclick=confirm;
    inp.addEventListener('keydown',ev=>{if(ev.key==='Enter')confirm();if(ev.key==='Escape')p.remove();ev.stopPropagation();});
  }
  function deleteCustom(idx){
    if(!configData||!configData.customComponents)return;
    if(!confirm('確定刪除此自訂元件？'))return;
    configData.customComponents.splice(idx,1);
    driveUpdateJsonFile(CONFIG_FILE,configData).catch(()=>{});_renderSidebar();
  }
  function placeCustom(idx){
    _tool='place_custom_'+idx;
    ['select','connect','text','freehand','boundary','erase'].forEach(n=>{const b=document.getElementById('geno-t-'+n);if(b)b.classList.remove('active');});
    document.querySelectorAll('.geno-sb-item').forEach(b=>b.classList.remove('active'));
  }
  function placeBuiltinTemplate(idx){
    _tool='place_builtin_'+idx;
    ['select','connect','text','freehand','boundary','erase'].forEach(n=>{const b=document.getElementById('geno-t-'+n);if(b)b.classList.remove('active');});
    document.querySelectorAll('.geno-sb-item').forEach(b=>b.classList.remove('active'));
  }

  // ── Export PNG ────────────────────────────────────────────────────
  function _exportPng(cb){
    let lx=Infinity,ly=Infinity,hx=-Infinity,hy=-Infinity;
    for(const o of _objs){
      if(o.type==='node'){lx=Math.min(lx,o.x-SZ-15);ly=Math.min(ly,o.y-SZ-20);hx=Math.max(hx,o.x+SZ+15);hy=Math.max(hy,o.y+SZ+20);}
      if(o.type==='text'){lx=Math.min(lx,o.x-5);ly=Math.min(ly,o.y-(o.fontSize||12)-4);hx=Math.max(hx,o.x+(o.text.length*(o.fontSize||12)*.7+12));hy=Math.max(hy,o.y+6);}
      if(o.type==='path'&&o.bbox){lx=Math.min(lx,o.bbox.x-5);ly=Math.min(ly,o.bbox.y-5);hx=Math.max(hx,o.bbox.x+o.bbox.w+5);hy=Math.max(hy,o.bbox.y+o.bbox.h+5);}
      if(o.type==='link'){const fm=_objs.find(x=>x.id===o.from),to=_objs.find(x=>x.id===o.to);
        if(fm){lx=Math.min(lx,fm.x-5);ly=Math.min(ly,fm.y-5);hx=Math.max(hx,fm.x+5);hy=Math.max(hy,fm.y+5);}
        if(to){lx=Math.min(lx,to.x-5);ly=Math.min(ly,to.y-5);hx=Math.max(hx,to.x+5);hy=Math.max(hy,to.y+5);}
      }
    }
    if(!isFinite(lx)){lx=0;ly=0;hx=300;hy=200;}
    const P=28,W=hx-lx+P*2,H=hy-ly+P*2;
    const s2=_el('svg',{xmlns:NS,width:W,height:H,viewBox:`${lx-P} ${ly-P} ${W} ${H}`});s2.style.background='#fff';
    {const fam=new Set(_objs.filter(o=>o.type==='link'&&o.coupleId).map(o=>o.coupleId));for(const o of _objs)if(o.type==='link'){if(fam.has(o.id)&&COUPLE_LTYPES.includes(o.linkType)){const cl=_objs.filter(x=>x.type==='link'&&x.coupleId===o.id);const g=_linkElFamily(o,cl,true);if(g)s2.appendChild(g);}else if(!o.coupleId){const g=_linkEl(o,true);if(g)s2.appendChild(g);}}}
    for(const o of _objs){
      if(o.type==='node')s2.appendChild(_nodeEl(o,true));
      else if(o.type==='text')s2.appendChild(_textEl(o,true));
      else if(o.type==='path')s2.appendChild(_pathEl(o,true));
    }
    const svgStr=new XMLSerializer().serializeToString(s2);
    const blob=new Blob([svgStr],{type:'image/svg+xml;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const img=new Image();
    img.onload=()=>{const sc=2,c=document.createElement('canvas');c.width=W*sc;c.height=H*sc;const ctx=c.getContext('2d');ctx.scale(sc,sc);ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);ctx.drawImage(img,0,0,W,H);URL.revokeObjectURL(url);cb(c.toDataURL('image/png'));};
    img.onerror=()=>{URL.revokeObjectURL(url);cb(null);};img.src=url;
  }

  // ── JSON storage ──────────────────────────────────────────────────
  function _saveJson(){
    try{const c=(typeof casesData!=='undefined')&&casesData&&casesData.find(x=>x.id===_caseId);if(!c)return;if(!c.genogramStore)c.genogramStore={};c.genogramStore[_storeKey]={objs:JSON.parse(JSON.stringify(_objs)),idSeq:_idSeq};}catch(e){}
  }
  function _loadJson(){
    try{const c=(typeof casesData!=='undefined')&&casesData&&casesData.find(x=>x.id===_caseId);if(!c||!c.genogramStore||!c.genogramStore[_storeKey])return;const d=c.genogramStore[_storeKey];_objs=JSON.parse(JSON.stringify(d.objs||[]));if(d.idSeq)_idSeq=Math.max(_idSeq,d.idSeq);}catch(e){}
  }

  // ── v185：草稿備援（獨立機制，不進 todo）───────────────────────────────
  // key 刻意不用 scc_draft_ 前綴，避免被 _migrateLocalStorageDrafts() 掃到、誤產生一筆待辦
  // （家系圖草稿的還原走「重開同一個案/欄位的編輯器時本機偵測詢問」，宿主表單上下文複雜，不適合走 todo）。
  function _genoDraftKey(){
    const email=(typeof currentUser!=='undefined'&&currentUser&&currentUser.email)||'';
    return `scc_geno_draft_${_caseId||''}_${_storeKey||''}_${email}`;
  }

  // ── Sidebar SVG helpers ───────────────────────────────────────────
  function _shapeSvg(t,sz){
    sz=sz||32;const S=sz/2,s=S*.55,ns=NS;
    let inner='';
    if(t==='male')inner=`<rect x="${-s}" y="${-s}" width="${s*2}" height="${s*2}" fill="#fff" stroke="#1a202c" stroke-width="1.6"/>`;
    else if(t==='female')inner=`<circle cx="0" cy="0" r="${s}" fill="#fff" stroke="#1a202c" stroke-width="1.6"/>`;
    else if(t==='pregnant')inner=`<polygon points="0,${-s} ${s*.9},${s*.7} ${-s*.9},${s*.7}" fill="#fff" stroke="#1a202c" stroke-width="1.6"/>`;
    else if(t==='ip_m')inner=`<rect x="${-s}" y="${-s}" width="${s*2}" height="${s*2}" fill="#a0aec0" stroke="#1a202c" stroke-width="1.6"/>`;
    else if(t==='ip_f')inner=`<circle cx="0" cy="0" r="${s}" fill="#a0aec0" stroke="#1a202c" stroke-width="1.6"/>`;
    else if(t==='dead_m'){const r=s*.8;inner=`<rect x="${-s}" y="${-s}" width="${s*2}" height="${s*2}" fill="#e2e8f0" stroke="#1a202c" stroke-width="1.6"/><line x1="${-r}" y1="${-r}" x2="${r}" y2="${r}" stroke="#1a202c" stroke-width="1.4"/><line x1="${r}" y1="${-r}" x2="${-r}" y2="${r}" stroke="#1a202c" stroke-width="1.4"/>`;}
    else if(t==='dead_f'){const r=s*.65;inner=`<circle cx="0" cy="0" r="${s}" fill="#e2e8f0" stroke="#1a202c" stroke-width="1.6"/><line x1="${-r}" y1="${-r}" x2="${r}" y2="${r}" stroke="#1a202c" stroke-width="1.4"/><line x1="${r}" y1="${-r}" x2="${-r}" y2="${r}" stroke="#1a202c" stroke-width="1.4"/>`;}
    else if(t==='unknown')inner=`<polygon points="0,${-s} ${s},0 0,${s} ${-s},0" fill="#fff" stroke="#1a202c" stroke-width="1.6"/>`;
    else if(t==='abort')inner=`<polygon points="0,${-s*.8} ${s*.75},${s*.6} ${-s*.75},${s*.6}" fill="#1a202c"/>`;
    else if(t==='stillbirth'){const ss=s*.5;inner=`<rect x="${-ss}" y="${-ss}" width="${ss*2}" height="${ss*2}" fill="#1a202c"/>`;}
    else inner=`<circle cx="0" cy="0" r="${s}" fill="#fff" stroke="#1a202c" stroke-width="1.6"/>`;
    return `<svg xmlns="${ns}" width="${sz}" height="${sz}" viewBox="${-S} ${-S} ${sz} ${sz}" style="display:block;flex-shrink:0">${inner}</svg>`;
  }

  function _linkSvg(lt,w,h){
    w=w||95;h=h||15;const ns=NS,x1=3,x2=w-3,y=h/2;
    let inner='';
    if(lt==='married'||lt==='bond')inner=`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#1a202c" stroke-width="1.8"/>`;
    else if(lt==='cohabiting')inner=`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#1a202c" stroke-width="1.8" stroke-dasharray="4,3"/>`;
    else if(lt==='separated'||lt==='divorced'){const n=lt==='divorced'?2:1;inner=`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#1a202c" stroke-width="1.8"/><line x1="${x1}" y1="${y}" x2="${x1}" y2="${y+7}" stroke="#1a202c" stroke-width="1.8"/><line x1="${x2}" y1="${y}" x2="${x2}" y2="${y+7}" stroke="#1a202c" stroke-width="1.8"/>`;const mx=(x1+x2)/2;for(let i=0;i<n;i++){const off=n===2?(i===0?-5:5):0;inner+=`<line x1="${mx+off-6}" y1="${y+6}" x2="${mx+off+6}" y2="${y-6}" stroke="#1a202c" stroke-width="1.8"/>`;}}
    else if(lt==='parent'||lt==='sibling')inner=`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#1a202c" stroke-width="1.8"/>`;
    else if(lt==='adopted')inner=`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#1a202c" stroke-width="1.8" stroke-dasharray="7,4"/>`;
    else if(lt==='foster')inner=`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#1a202c" stroke-width="1.8" stroke-dasharray="2,4"/>`;
    else if(lt==='deteriorating'){inner=`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#1a202c" stroke-width="1.8"/>`;const steps=5;for(let i=1;i<steps;i++){const cx=x1+(x2-x1)*i/steps;inner+=`<line x1="${cx-4}" y1="${y+5}" x2="${cx+4}" y2="${y-5}" stroke="#1a202c" stroke-width="1.4"/>`;}}
    else if(lt==='close'){inner=`<line x1="${x1}" y1="${y-4}" x2="${x2}" y2="${y-4}" stroke="#1a202c" stroke-width="1.6"/><line x1="${x1}" y1="${y+4}" x2="${x2}" y2="${y+4}" stroke="#1a202c" stroke-width="1.6"/>`;}
    else if(lt==='ambivalent'){const mx=(x1+x2)/2;inner=`<line x1="${x1}" y1="${y-4}" x2="${x2}" y2="${y-4}" stroke="#1a202c" stroke-width="1.6"/><polyline points="${x1},${y+4} ${(x1+mx)/2},${y+9} ${mx},${y+4} ${(mx+x2)/2},${y-1} ${x2},${y+4}" fill="none" stroke="#1a202c" stroke-width="1.8"/>`;}
    else if(lt==='twin'){const mx=(x1+x2)/2;inner=`<line x1="${x1}" y1="${y}" x2="${mx}" y2="${y}" stroke="#1a202c" stroke-width="1.8"/><line x1="${x2}" y1="${y}" x2="${mx}" y2="${y}" stroke="#1a202c" stroke-width="1.8"/><line x1="${mx}" y1="${y-6}" x2="${mx}" y2="${y+6}" stroke="#1a202c" stroke-width="1.8"/>`;}
    else if(lt==='fused'){for(let i=-1;i<=1;i++)inner+=`<line x1="${x1}" y1="${y+i*4}" x2="${x2}" y2="${y+i*4}" stroke="#1a202c" stroke-width="1.4"/>`;}
    else if(lt==='conflict'){const steps=5,dx=(x2-x1)/steps,pts=[];for(let i=0;i<=steps;i++){const side=(i%2===0?1:-1)*(i>0&&i<steps?5:0);pts.push(`${x1+dx*i},${y+side}`);}inner=`<polyline points="${pts.join(' ')}" fill="none" stroke="#1a202c" stroke-width="1.8"/>`;}
    else if(lt==='cutoff'){const mx=(x1+x2)/2;inner=`<line x1="${x1}" y1="${y}" x2="${mx-5}" y2="${y}" stroke="#1a202c" stroke-width="1.8"/><line x1="${mx+5}" y1="${y}" x2="${x2}" y2="${y}" stroke="#1a202c" stroke-width="1.8"/><line x1="${mx-4}" y1="${y-6}" x2="${mx-4}" y2="${y+6}" stroke="#1a202c" stroke-width="1.8"/><line x1="${mx+4}" y1="${y-6}" x2="${mx+4}" y2="${y+6}" stroke="#1a202c" stroke-width="1.8"/>`;}
    return `<svg xmlns="${ns}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;flex-shrink:0">${inner}</svg>`;
  }

  // ── Sidebar ───────────────────────────────────────────────────────
  function _sbSec(title,key,content){
    const c=_sbCollapsed[key];
    return `<div class="geno-sb-sec" onclick="GenogramEditor.toggleSbSection('${key}')" style="margin-top:5px;">${title}<span style="font-size:.8rem;color:#a0aec0;">${c?'▶':'▼'}</span></div>`+(c?'':content);
  }
  function _renderSidebar(){
    const sb=document.getElementById('geno-sidebar');if(!sb)return;
    const nodes=[{id:'male',name:'男性'},{id:'female',name:'女性'},{id:'pregnant',name:'懷孕'},{id:'unknown',name:'性別不明'},{id:'ip_m',name:'IP個案(男)'},{id:'ip_f',name:'IP個案(女)'},{id:'dead_m',name:'已故男'},{id:'dead_f',name:'已故女'},{id:'abort',name:'流產'},{id:'stillbirth',name:'死胎/死產'}];
    const parentTip='先點父母、再點子女；系統依兩點的垂直位置自動判斷（畫面較上方＝父母，較下方＝子女），與點擊順序、是否已成家無關——新增祖父母世代時，祖父母節點要畫在上方';
    const sl=[{id:'married',name:'婚姻'},{id:'bond',name:'連結'},{id:'cohabiting',name:'同居'},{id:'separated',name:'分居'},{id:'divorced',name:'離婚'},{id:'parent',name:'親子',tip:parentTip},{id:'adopted',name:'領養',tip:'領養：'+parentTip},{id:'foster',name:'寄養',tip:'寄養：'+parentTip},{id:'twin',name:'多胞胎'}];
    const el=[{id:'fused',name:'融合/極度親密'},{id:'close',name:'親密'},{id:'ambivalent',name:'矛盾'},{id:'conflict',name:'衝突'},{id:'cutoff',name:'情感疏離'},{id:'deteriorating',name:'關係惡化'}];
    const customs=(configData&&configData.customComponents)||[];
    let h=_sbSec('人物節點','nodes',
      '<div class="geno-sb-grid">'+nodes.map(n=>`<div class="geno-sb-item" id="geno-sb-n-${n.id}" onclick="GenogramEditor.setShape('${n.id}')" title="${n.name}">${_shapeSvg(n.id,30)}<span>${n.name}</span></div>`).join('')+'</div>');
    h+=_sbSec('結構關係線','structural',
      sl.map(l=>`<div class="geno-sb-item geno-sb-lnk" id="geno-sb-l-${l.id}" onclick="GenogramEditor.setTool('connect');GenogramEditor.setLinkType('${l.id}')" title="${l.tip||l.name}">${_linkSvg(l.id)}<span>${l.name}</span></div>`).join(''));
    h+=_sbSec('情緒關係線','emotional',
      el.map(l=>`<div class="geno-sb-item geno-sb-lnk" id="geno-sb-l-${l.id}" onclick="GenogramEditor.setTool('connect');GenogramEditor.setLinkType('${l.id}')" title="${l.name}">${_linkSvg(l.id)}<span>${l.name}</span></div>`).join(''));
    h+=_sbSec('常用模版','templates',
      '<div class="geno-sb-grid">'+BUILTIN_TEMPLATES.map((tpl,i)=>{
        const vw=tpl.bbox.w,vh=tpl.bbox.h;
        const mini=tpl.objects.filter(o=>o.type==='node').map(o=>`<g transform="translate(${o.x+vw/2},${o.y+SZ+8})">${_shapeSvg(o.shapeType,SZ*1.6).replace(/^<svg[^>]*>/,'').replace(/<[/]svg>$/,'')}</g>`).join('');
        return `<div class="geno-sb-item" onclick="GenogramEditor.placeBuiltinTemplate(${i})" title="點選後在畫布任一處點擊放置：配偶＋${tpl.name}（子女預設男性方形，可選取後於「人物節點」點形狀改變）"><svg xmlns="${NS}" width="30" height="30" viewBox="0 0 ${vw} ${vh}" style="display:block;flex-shrink:0;background:#f7fafc;border-radius:2px;">${mini}</svg><span>${tpl.name}</span></div>`;
      }).join('')+'</div>');
    const customContent=(!customs.length?'<div style="font-size:.72rem;color:#a0aec0;padding:4px 6px;">（尚無自訂元件）</div>':customs.map((cc,i)=>{
      const vw=Math.max((cc.bbox&&cc.bbox.w)||60,10),vh=Math.max((cc.bbox&&cc.bbox.h)||60,10);
      const mini=cc.objects.filter(o=>o.type==='node'||o.type==='path').map(o=>{
        if(o.type==='node')return `<g transform="translate(${o.x},${o.y})">${_shapeSvg(o.shapeType,SZ*2).replace(/^<svg[^>]*>/,'').replace(/<[/]svg>$/,'')}</g>`;
        if(o.type==='path')return `<path d="${o.d}" fill="none" stroke="#1a202c" stroke-width="1.5"/>`;
        return'';
      }).join('');
      return `<div style="display:flex;align-items:center;gap:4px;padding:3px 4px;border:1px solid #e2e8f0;border-radius:4px;margin-bottom:3px;cursor:pointer;" onclick="GenogramEditor.placeCustom(${i})" title="${cc.name}"><svg xmlns="${NS}" width="40" height="40" viewBox="0 0 ${vw} ${vh}" style="flex-shrink:0;background:#f7fafc;border-radius:2px;">${mini}</svg><span style="font-size:.72rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${cc.name}</span><button onclick="event.stopPropagation();GenogramEditor.deleteCustom(${i})" style="font-size:.72rem;padding:1px 4px;border:1px solid #fcc;border-radius:3px;background:#fff;cursor:pointer;color:#e53e3e;" title="刪除">&#215;</button></div>`;
    }).join(''));
    h+=_sbSec('自訂元件','custom',customContent);
    sb.innerHTML=h;
  }

  // ── Build UI ──────────────────────────────────────────────────────
  function _buildUI(){
    const ov=document.createElement('div');ov.id='geno-overlay';ov.classList.toggle('geno-readonly',_readOnly);
    ov.innerHTML=`<div id="geno-header"><span style="font-weight:700;font-size:1.1rem;color:#2b6cb0;">家族圖${_readOnly?'（唯讀檢視）':'繪製'}</span><span id="geno-draft-status" class="geno-edit-only" style="font-size:.74rem;color:#a0aec0;margin-left:8px;"></span><div style="display:flex;gap:6px;align-items:center;"><button class="geno-tb-btn geno-edit-only" onclick="GenogramEditor.undo()" title="Ctrl+Z">↩ 復原</button><button class="geno-tb-btn geno-edit-only" onclick="GenogramEditor.redo()" title="Ctrl+Y">↪ 重做</button><button class="geno-tb-btn" onclick="GenogramEditor.zoomFit()">⊞ 全圖</button><div class="geno-tb-sep"></div><button class="btn btn-secondary btn-sm" onclick="GenogramEditor.exit()">${_readOnly?'關閉':'取消'}</button><button class="btn btn-primary btn-sm geno-edit-only" onclick="GenogramEditor.save()">插入家族圖</button></div></div><div id="geno-toolbar" class="geno-edit-only"><span style="font-size:.76rem;color:#718096;margin-right:2px;">工具：</span><button class="geno-tb-btn active" id="geno-t-select" onclick="GenogramEditor.setTool('select')" title="選取/拖曳；拖曳空白處框選多物件；Space+拖曳平移">↖ 選取/移動</button><button class="geno-tb-btn" id="geno-t-connect" onclick="GenogramEditor.setTool('connect')" title="點兩個節點連線（先在側欄選連線類型）">─ 連線</button><button class="geno-tb-btn" id="geno-t-text" onclick="GenogramEditor.setTool('text')" title="點畫布新增文字；雙擊編輯">T 文字</button><button class="geno-tb-btn" id="geno-t-freehand" onclick="GenogramEditor.setTool('freehand')" title="自由手繪">✏ 手繪</button><button class="geno-tb-btn" id="geno-t-boundary" onclick="GenogramEditor.setTool('boundary')" title="生活圈：拖曳圈出同住/關係緊密的一群人，虛線灰框表示框選範圍（非手繪筆跡）">⭕ 生活圈</button><button class="geno-tb-btn" id="geno-t-erase" onclick="GenogramEditor.setTool('erase')" title="點物件刪除">✕ 橡皮擦</button><div class="geno-tb-sep"></div><span style="font-size:.76rem;color:#718096;margin-right:2px;">文字：</span><button class="geno-tb-btn" id="geno-txt-bold" onclick="GenogramEditor.toggleTextProp('bold')" title="粗體" style="font-weight:700;min-width:26px;">B</button><button class="geno-tb-btn" id="geno-txt-italic" onclick="GenogramEditor.toggleTextProp('italic')" title="斜體" style="font-style:italic;min-width:26px;">I</button><button class="geno-tb-btn" id="geno-txt-strike" onclick="GenogramEditor.toggleTextProp('strikethrough')" title="刪除線" style="text-decoration:line-through;min-width:26px;">S</button><select id="geno-txt-size" class="geno-tb-btn" style="padding:2px 4px;" onchange="GenogramEditor.applyFontSize(+this.value)" title="字級">${[8,9,10,11,12,14,16,18,20,24].map(n=>`<option value="${n}"${n===12?' selected':''}>${n}px</option>`).join('')}</select><span style="font-size:.76rem;color:#718096;margin-left:4px;margin-right:2px;">介面字：</span><select id="geno-lbl-size" class="geno-tb-btn" style="padding:2px 4px;" onchange="GenogramEditor.setNodeLabelFontSize(+this.value)" title="側欄與節點標籤字級">${[9,10,11,12,13,14,16].map(n=>`<option value="${n}"${n===11?' selected':''}>${n}</option>`).join('')}</select><div class="geno-tb-sep"></div><button class="geno-tb-btn active" id="geno-snap-btn" onclick="GenogramEditor.toggleSnap()" title="網格吸附">⊡ 吸附</button><button class="geno-tb-btn" onclick="GenogramEditor.saveAsCustom()" title="將已選取物件存為共用自訂元件">📌 自訂元件</button><button class="geno-tb-btn" onclick="GenogramEditor.deleteSelected()" title="刪除所選（Delete鍵）">🗑 刪除</button><button class="geno-tb-btn" onclick="GenogramEditor.clearSelect()" title="取消選取（Esc）">☐ 取消</button><button class="geno-tb-btn" onclick="GenogramEditor.autoArrangeAll()" title="自動整理世代間距（避免多代擠在一起）並均勻排列所有子女、調整倒ㄇ寬度">✨ 美化</button><div class="geno-tb-sep"></div><span style="font-size:.75rem;color:#718096;">填色：</span>${['#ffffff','#e2e8f0','#fed7d7','#fbd38d','#fefcbf','#c6f6d5','#bee3f8','#e9d8fd','#fed7e8','#2d3748'].map(c=>`<span onclick="GenogramEditor.applyColor('${c}')" onmousedown="event.preventDefault()" title="${c}" style="display:inline-block;width:14px;height:14px;background:${c};border:1.5px solid #a0aec0;border-radius:2px;cursor:pointer;vertical-align:middle;margin:0 1px;flex-shrink:0;"></span>`).join('')}<span style="font-size:.75rem;color:#718096;margin-left:6px;" title="節點外框色、關係線顏色">框線：</span>${['#ffffff','#e2e8f0','#fed7d7','#fbd38d','#fefcbf','#c6f6d5','#bee3f8','#e9d8fd','#fed7e8','#2d3748'].map(c=>`<span onclick="GenogramEditor.applyStrokeColor('${c}')" onmousedown="event.preventDefault()" title="${c}" style="display:inline-block;width:14px;height:14px;background:${c};border:2.5px solid #718096;border-radius:2px;cursor:pointer;vertical-align:middle;margin:0 1px;flex-shrink:0;"></span>`).join('')}<button class="geno-tb-btn" onclick="GenogramEditor.clearColor()" onmousedown="event.preventDefault()" title="清除選取物件的顏色設定">✕色</button><div class="geno-tb-sep"></div><button class="geno-tb-btn" onclick="GenogramEditor.toggleDisability()" title="標記/取消所選節點為「身心障礙」（右上角黑色標記，可與慢性病同時勾選）">♿ 身心障礙</button><button class="geno-tb-btn" onclick="GenogramEditor.toggleChronicIllness()" title="標記/取消所選節點為「慢性病」（右側黑色標記，可與身心障礙同時勾選）">🩺 慢性病</button></div><div id="geno-body"><div id="geno-sidebar" class="geno-edit-only"></div><div id="geno-sb-resize" class="geno-edit-only"></div><div id="geno-canvas-wrap"><svg id="geno-svg" xmlns="${NS}"><g id="geno-vp"></g></svg></div></div>`;
    document.body.appendChild(ov);
    {const s=document.getElementById('geno-lbl-size');if(s)s.value=String(_nodeLabelFontSize);}
    setNodeLabelFontSize(_nodeLabelFontSize);
    _svg=document.getElementById('geno-svg');_vp=document.getElementById('geno-vp');
    _svg.addEventListener('mousedown',_onMouseDown);
    _svg.addEventListener('mousemove',_onMouseMove);
    _svg.addEventListener('mouseup',_onMouseUp);
    _svg.addEventListener('mouseleave',_onMouseUp);
    _svg.addEventListener('dblclick',_onDblClick);
    _svg.addEventListener('wheel',_onWheel,{passive:false});
    document.addEventListener('keydown',_onKeyDown);
    document.addEventListener('keyup',_onKeyUp);
    _renderSidebar();
    {const sbR=document.getElementById('geno-sb-resize'),sbE=document.getElementById('geno-sidebar');if(sbR&&sbE){sbR.style.left=sbE.offsetWidth+'px';let _sd=null;const _sm=e=>{if(!_sd)return;const w=Math.max(120,Math.min(400,_sd.w+(e.clientX-_sd.x)));sbE.style.width=w+'px';sbR.style.left=w+'px';};const _su=()=>{_sd=null;sbR.classList.remove('active');document.removeEventListener('mousemove',_sm);document.removeEventListener('mouseup',_su);};sbR.addEventListener('mousedown',e=>{e.preventDefault();e.stopPropagation();_sd={x:e.clientX,w:sbE.offsetWidth};sbR.classList.add('active');document.addEventListener('mousemove',_sm);document.addEventListener('mouseup',_su);});}}
    requestAnimationFrame(()=>{
      const w=document.getElementById('geno-canvas-wrap');
      if(w){_panX=w.offsetWidth/2;_panY=w.offsetHeight/2;_render();}
    });
  }

  // ── Public API ────────────────────────────────────────────────────
  function open({fieldId,caseId,storeKey,readOnly}){
    if(document.getElementById('geno-overlay'))return;
    _fieldId=fieldId;_caseId=caseId||null;_storeKey=storeKey||fieldId;_readOnly=!!readOnly;
    _objs=[];_selId=null;_multiSel=new Set();_tool='select';_placeShape='male';_linkType='married';
    _zoom=1;_panX=0;_panY=0;_undo=[];_redo=[];_connectFrom=null;_connectLine=null;
    _boxSel=null;_freehandPts=[];_freehandEl=null;_spaceDown=false;
    _textFontSize=12;_textBold=false;_textItalic=false;_textStrike=false;
    // v185：草稿還原偵測——重開同一個案/欄位的編輯器時，若偵測到本機殘留草稿，詢問是否還原
    let _restoredFromDraft=false;
    if(!_readOnly){
      try{
        const raw=localStorage.getItem(_genoDraftKey());
        if(raw){
          const draft=JSON.parse(raw);
          if(draft&&Array.isArray(draft.objs)){
            if(confirm('偵測到此家族圖有尚未存回表單的草稿（可能因先前意外關閉視窗而保留）。\n\n是否要還原草稿內容？\n選擇「取消」則捨棄草稿，改載入表單中目前已存的版本。')){
              _objs=JSON.parse(JSON.stringify(draft.objs));
              if(draft.idSeq)_idSeq=Math.max(_idSeq,draft.idSeq);
              _restoredFromDraft=true;
            }else{
              try{localStorage.removeItem(_genoDraftKey());}catch(e){}
            }
          }
        }
      }catch(e){}
    }
    if(!_restoredFromDraft)_loadJson();
    _buildUI();
    if(!_readOnly){
      _gdSetBaseline('genogram',{objs:_objs,idSeq:_idSeq});
      _gdStartAutosave('genogram',_genoDraftKey(),()=>({objs:_objs,idSeq:_idSeq}),'geno-draft-status');
    }
  }

  function close(){
    _gdStopAutosave('genogram');
    const ov=document.getElementById('geno-overlay');if(ov)ov.remove();
    document.removeEventListener('keydown',_onKeyDown);
    document.removeEventListener('keyup',_onKeyUp);
    _svg=null;_vp=null;
  }

  // v185：頂部「取消/關閉」按鈕改呼叫此函式——唯讀直接關閉；編輯模式有未存回的變更才跳三選離開對話框
  // （存回表單／留草稿離開／捨棄離開，另有「取消」可繼續編輯），沒有變更則直接關閉。
  function exit(){
    if(_readOnly){close();return;}
    const dirty=_gdIsDirty('genogram',{objs:_objs,idSeq:_idSeq});
    if(!dirty){try{localStorage.removeItem(_genoDraftKey());}catch(e){}close();return;}
    _genoExitDialog(
      ()=>{save();},
      ()=>{
        try{
          const json=JSON.stringify({objs:_objs,idSeq:_idSeq});
          if(json.length<=200000)localStorage.setItem(_genoDraftKey(),json);
        }catch(e){}
        close();
      },
      ()=>{try{localStorage.removeItem(_genoDraftKey());}catch(e){}close();}
    );
  }

  function save(){
    if(_readOnly){close();return;}
    if(!_objs.length){try{localStorage.removeItem(_genoDraftKey());}catch(e){}close();return;}
    _exportPng(dataUrl=>{
      if(!dataUrl){alert('匯出圖片失敗，請重試。');return;}
      _showSizePanel(dataUrl,w=>{
        const editor=document.getElementById(_fieldId);
        if(editor){
          const img=document.createElement('img');img.src=dataUrl;img.alt='家族圖';
          img.style.cssText='width:'+w+';height:auto;display:block;margin:6px 0;border:1px solid #e2e8f0;border-radius:4px;cursor:pointer;';
          img.title='雙擊重新編輯家族圖';
          img.setAttribute('data-geno-key',_storeKey);img.setAttribute('data-geno-cid',_caseId||'');
          img.setAttribute('data-geno-field',_fieldId);
          const old=editor.querySelector('[data-geno-key="'+_storeKey+'"]');
          if(old)old.replaceWith(img);else editor.appendChild(img);
        }
        _saveJson();
        try{localStorage.removeItem(_genoDraftKey());}catch(e){}
        close();
      });
    });
  }
  function _showSizePanel(dataUrl,cb){
    const p=document.createElement('div');
    p.id='geno-size-panel';
    p.style.cssText='position:fixed;inset:0;z-index:100005;background:rgba(15,23,42,0.5);display:flex;align-items:center;justify-content:center;';
    p.innerHTML='<div style="background:#fff;border-radius:14px;padding:26px;width:380px;box-shadow:0 10px 48px rgba(0,0,0,0.28);">'
      +'<div style="font-weight:700;font-size:1.05rem;color:#2b6cb0;margin-bottom:14px;">插入家族圖前，設定顯示大小</div>'
      +'<div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:14px;background:#f7fafc;display:flex;align-items:center;justify-content:center;min-height:80px;padding:8px;">'
      +'<img id="geno-sp-prev" src="'+dataUrl+'" style="max-width:100%;height:auto;border-radius:4px;" alt="預覽"/></div>'
      +'<label style="font-size:.84rem;color:#4a5568;display:block;margin-bottom:6px;">顯示寬度：<span id="geno-sp-val" style="font-weight:700;color:#2b6cb0;">100%</span></label>'
      +'<input type="range" id="geno-sp-sl" min="15" max="100" value="100" style="width:100%;accent-color:#3182ce;cursor:pointer;margin-bottom:16px;">'
      +'<div style="display:flex;gap:8px;margin-bottom:16px;">'
      +'<button onclick="document.getElementById(\'geno-sp-sl\').value=33;document.getElementById(\'geno-sp-sl\').dispatchEvent(new Event(\'input\'))" style="flex:1;font-size:.8rem;padding:5px;border:1px solid #e2e8f0;border-radius:6px;background:#f7fafc;cursor:pointer;">小 (33%)</button>'
      +'<button onclick="document.getElementById(\'geno-sp-sl\').value=60;document.getElementById(\'geno-sp-sl\').dispatchEvent(new Event(\'input\'))" style="flex:1;font-size:.8rem;padding:5px;border:1px solid #e2e8f0;border-radius:6px;background:#f7fafc;cursor:pointer;">中 (60%)</button>'
      +'<button onclick="document.getElementById(\'geno-sp-sl\').value=100;document.getElementById(\'geno-sp-sl\').dispatchEvent(new Event(\'input\'))" style="flex:1;font-size:.8rem;padding:5px;border:1px solid #e2e8f0;border-radius:6px;background:#f7fafc;cursor:pointer;">大 (100%)</button>'
      +'</div>'
      +'<div style="display:flex;gap:10px;justify-content:flex-end;">'
      +'<button id="geno-sp-cancel" style="font-size:.88rem;padding:8px 18px;border:1px solid #e2e8f0;border-radius:8px;background:#f7fafc;cursor:pointer;color:#4a5568;">取消</button>'
      +'<button id="geno-sp-ok" style="font-size:.88rem;padding:8px 22px;border:none;border-radius:8px;background:#3182ce;color:#fff;cursor:pointer;font-weight:700;">插入家族圖</button>'
      +'</div></div>';
    document.body.appendChild(p);
    const sl=document.getElementById('geno-sp-sl'),val=document.getElementById('geno-sp-val'),prev=document.getElementById('geno-sp-prev');
    sl.addEventListener('input',()=>{val.textContent=sl.value+'%';prev.style.width=sl.value+'%';});
    document.getElementById('geno-sp-cancel').onclick=()=>p.remove();
    document.getElementById('geno-sp-ok').onclick=()=>{p.remove();cb(sl.value+'%');};
  }

  function setTool(t){
    _tool=t;_connectFrom=null;_connectLine=null;
    ['select','connect','text','freehand','boundary','erase'].forEach(n=>{const b=document.getElementById('geno-t-'+n);if(b)b.classList.toggle('active',n===t);});
    if(!t.startsWith('place_'))document.querySelectorAll('.geno-sb-item').forEach(b=>b.classList.remove('active'));
    const cursors={select:'default',connect:'crosshair',text:'text',freehand:'crosshair',boundary:'crosshair',erase:'cell'};
    if(_svg)_svg.style.cursor=cursors[t]||'default';
    _render();
  }

  function setShape(s){
    if(_selId){
      const o=_objs.find(x=>x.id===_selId);
      if(o&&o.type==='node'){_pushUndo();o.shapeType=s;_render();return;}
    }
    _placeShape=s;_tool='place_'+s;
    ['select','connect','text','freehand','boundary','erase'].forEach(n=>{const b=document.getElementById('geno-t-'+n);if(b)b.classList.remove('active');});
    document.querySelectorAll('.geno-sb-item').forEach(b=>b.classList.remove('active'));
    const btn=document.getElementById('geno-sb-n-'+s);if(btn)btn.classList.add('active');
    if(_svg)_svg.style.cursor='copy';
  }

  function setLinkType(t){
    _linkType=t;
    document.querySelectorAll('.geno-sb-lnk').forEach(b=>b.classList.remove('active'));
    const btn=document.getElementById('geno-sb-l-'+t);if(btn)btn.classList.add('active');
  }

  function setNodeLabelFontSize(size){
    _nodeLabelFontSize=size;localStorage.setItem('genoLblFz',size);
    const r=size/11;
    let st=document.getElementById('geno-sb-fz-style');
    if(!st){st=document.createElement('style');st.id='geno-sb-fz-style';document.head.appendChild(st);}
    st.textContent=`.geno-sb-sec{font-size:${(0.78*r).toFixed(3)}rem!important}.geno-sb-item{font-size:${(0.72*r).toFixed(3)}rem!important}.geno-sb-lnk span{font-size:${(0.72*r).toFixed(3)}rem!important}`;
    _render();
  }

  function toggleSnap(){_snapEnabled=!_snapEnabled;const b=document.getElementById('geno-snap-btn');if(b)b.classList.toggle('active',_snapEnabled);}

  function zoomFit(){
    if(!_objs.length){_zoom=1;_panX=0;_panY=0;_render();return;}
    let lx=Infinity,ly=Infinity,hx=-Infinity,hy=-Infinity;
    for(const o of _objs){
      if(o.type==='node'){lx=Math.min(lx,o.x-SZ);ly=Math.min(ly,o.y-SZ);hx=Math.max(hx,o.x+SZ);hy=Math.max(hy,o.y+SZ);}
      if(o.type==='text'){lx=Math.min(lx,o.x);ly=Math.min(ly,o.y-14);hx=Math.max(hx,o.x+o.text.length*8);hy=Math.max(hy,o.y);}
      if(o.type==='path'&&o.bbox){lx=Math.min(lx,o.bbox.x);ly=Math.min(ly,o.bbox.y);hx=Math.max(hx,o.bbox.x+o.bbox.w);hy=Math.max(hy,o.bbox.y+o.bbox.h);}
    }
    if(!isFinite(lx))return;
    const wrap=document.getElementById('geno-canvas-wrap');if(!wrap)return;
    const W=wrap.offsetWidth,H=wrap.offsetHeight,cW=hx-lx+80,cH=hy-ly+80;
    _zoom=Math.min(W/cW,H/cH,3);_panX=(W-cW*_zoom)/2-lx*_zoom+40*_zoom;_panY=(H-cH*_zoom)/2-ly*_zoom+40*_zoom;_render();
  }

  return{open,close,save,exit,undo,redo,setTool,setShape,setLinkType,toggleTextProp,applyFontSize,setNodeLabelFontSize,toggleSnap,zoomFit,deleteSelected,editLabel,saveAsCustom,deleteCustom,placeCustom,placeBuiltinTemplate,applyColor,applyStrokeColor,clearColor,clearSelect,autoArrangeAll,toggleSbSection,toggleDisability,toggleChronicIllness};
})();

function openGenogramEditor(fieldId,caseId,storeKey){
  GenogramEditor.open({fieldId,caseId:caseId||null,storeKey:storeKey||fieldId,readOnly:!!_detailReadOnly});
}
