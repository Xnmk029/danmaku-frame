(() => {
 'use strict';
 const aliases=[
  ['claude',/claude|anthropic|\b(?:opus|sonnet|haiku)(?=\b|\d)|克劳德/i],
  ['openai',/openai|chatgpt|\bgpt(?:\b|[-\d])|\bo[134](?:\b|[-\s])/i],
  ['gemini',/gemini|双子座/i],['deepseek',/deepseek|深度求索/i],
  ['qwen',/qwen|通义|千问/i],['zhipu',/\bglm(?:\b|[-\d])|zhipu|智谱|清言/i],
  ['grok',/grok/i],['llama',/llama/i],['mistral',/mistral|mixtral/i],
  ['minimax',/minimax|海螺|hailuo/i],['moonshot',/moonshot|\bkimi\b|月之暗面/i],
  ['doubao',/doubao|豆包|seedance|seedream|\bseed[-\s]/i],
  ['xiaomimimo',/xiaomi|\bmimo\b|小米/i],['stepfun',/stepfun|阶跃|\bstep[-\d]/i],
  ['flux',/\bflux\b/i],['kling',/kling|可灵/i],['sora',/\bsora\b/i],
 ];
 const layouts={
  A:{icon:{x:1468,y:450,size:60},label:{x:1724,y:1008,w:136},rails:[{x:1473,y:530,w:126,h:475,stroke:23},{x:1746,y:460,w:100,h:530,stroke:21}]},
  B:{icon:{x:1624,y:416,size:52},label:{x:1724,y:1008,w:136},rails:[{x:1648,y:644,w:68,h:322,stroke:14},{x:1782,y:460,w:62,h:498,stroke:14}]},
  C:{icon:{x:1170,y:182,size:68},label:{x:1112,y:444,w:160},rails:[{x:284,y:310,w:176,h:642,stroke:32},{x:1002,y:279,w:136,h:699,stroke:27}]},
 };
 // The same tall, rounded stroke construction as the original O / 8 artwork.
 // Keep a real vector skeleton instead of stretching a system font.
 function digitPath(d,r){
  const p=new Path2D(),M=(x,y)=>p.moveTo(r.x+x*r.w,r.y+y*r.h),L=(x,y)=>p.lineTo(r.x+x*r.w,r.y+y*r.h),C=(a,b,c,d,e,f)=>p.bezierCurveTo(r.x+a*r.w,r.y+b*r.h,r.x+c*r.w,r.y+d*r.h,r.x+e*r.w,r.y+f*r.h);
  switch(d){
   case '0':M(.5,0);C(1,0,1,.04,1,.12);L(1,.88);C(1,.97,.8,1,.5,1);C(.2,1,0,.97,0,.88);L(0,.12);C(0,.03,.2,0,.5,0);break;
   case '1':M(.08,.13);C(.23,.12,.42,.05,.55,0);L(.55,1);break;
   case '2':M(0,.12);C(0,-.04,1,-.04,1,.12);L(1,.28);C(1,.42,0,.59,0,.76);L(0,1);L(1,1);break;
   case '3':M(0,0);C(.76,-.03,1,.03,1,.17);L(1,.32);C(1,.44,.68,.49,.15,.5);C(.7,.51,1,.56,1,.68);L(1,.84);C(1,.98,.77,1.03,0,1);break;
   case '4':M(.85,0);L(0,.65);C(.12,.66,.8,.66,1,.66);M(.85,.28);L(.85,1);break;
   case '5':M(1,0);L(0,0);L(0,.4);C(.54,.39,1,.43,1,.57);L(1,.84);C(1,.98,.74,1.04,0,1);break;
   case '6':M(1,0);C(.23,-.03,0,.04,0,.19);L(0,.87);C(0,1.04,1,1.04,1,.87);L(1,.65);C(1,.47,.26,.47,0,.58);break;
   case '7':M(0,0);L(1,0);C(1,.18,.07,.8,.07,1);break;
   case '8':M(.5,0);C(0,0,0,.03,0,.16);L(0,.34);C(0,.44,1,.53,1,.63);L(1,.86);C(1,1,0,1,0,.86);L(0,.63);C(0,.53,1,.44,1,.34);L(1,.16);C(1,.03,1,0,.5,0);break;
   case '9':M(0,1);C(.77,1.03,1,.96,1,.81);L(1,.13);C(1,-.04,0,-.04,0,.13);L(0,.35);C(0,.53,.74,.53,1,.42);break;
  }
  return p;
 }
 function resolve(text,icons=[]){
  const raw=String(text||'').trim().slice(0,80),available=new Map(icons.map(i=>[i.id,i]));
  let icon=null;
  for(const [id,pattern]of aliases)if(available.has(id)&&pattern.test(raw)){icon=available.get(id);break;}
  if(!icon){
   const normalized=raw.toLowerCase();
   const matches=icons.filter(i=>[i.id,i.name].some(name=>{
    const n=String(name).toLowerCase();return normalized===n||normalized.startsWith(n+' ')||normalized.startsWith(n+'-')||normalized.startsWith(n+'/');
   })).sort((a,b)=>b.id.length-a.id.length);
   icon=matches[0]||null;
  }
  let versionText=raw;
  if(icon){for(const name of [icon.name,icon.id].sort((a,b)=>b.length-a.length)){
   if(raw.toLowerCase().startsWith(name.toLowerCase())&&/^[\s/:-]/.test(raw.slice(name.length))){versionText=raw.slice(name.length);break;}
  }}
  const found=versionText.match(/(?<!\d)\d{1,4}(?!\d)(?:\.\d{1,3}|-\d{1,2}(?=$|[-\s])){0,3}/);
  const version=found?found[0].replaceAll('-','.'):'—';
  return {text:raw,icon:icon?.id||null,brand:icon?.name||'',version};
 }
 function install(engine,getModel){
  const images=new Map(),descriptors=new Map();
  const description=scene=>{
   const text=String(getModel(scene)||'').trim().slice(0,80);
   if(descriptors.get(scene)?.text!==text)descriptors.set(scene,resolve(text,globalThis.PhaseModelIcons||[]));
   return descriptors.get(scene);
  };
  engine.modelMarkKey=scene=>{const m=description(scene);return m.text+'|'+engine.theme(scene).bg;};
  engine.modelGlyphs=(scene,ctx)=>{
   const m=description(scene);if(!m.text||m.version==='—')return;
   const groups=m.version.split('.'),rails=layouts[scene].rails;
   const parts=groups.length>1?[groups[0],groups.slice(1).join('')]:m.version.length>1?[m.version.slice(0,Math.ceil(m.version.length/2)),m.version.slice(Math.ceil(m.version.length/2))]:[m.version,''];
   ctx.save();ctx.strokeStyle='white';ctx.fillStyle='white';ctx.lineCap='round';ctx.lineJoin='round';
   for(let side=0;side<2;side++){
    const chars=[...parts[side]],rail=rails[side],gap=rail.stroke*.7;
    for(const [i,ch]of chars.entries()){
     const w=(rail.w-gap*Math.max(0,chars.length-1))/Math.max(1,chars.length),r={...rail,x:rail.x+i*(w+gap),w,y:rail.y+(i%2)*24,h:rail.h-(i%2)*24};
     ctx.lineWidth=Math.min(rail.stroke,w*.23);ctx.stroke(digitPath(ch,r));
    }
   }
   if(groups.length>1){const r=rails[1];ctx.fillRect(r.x-r.stroke-9,r.y+r.h-9,9,9);}
   ctx.restore();
  };
  engine.drawModelMark=(ctx,scene,theme)=>{
   const m=description(scene),r=layouts[scene];
   ctx.save();
   if(m.icon){
    if(!images.has(m.icon)){const image=new Image();image.src='/public/frame/assets/model-marks/'+m.icon+'.svg';images.set(m.icon,image);}
    const image=images.get(m.icon);
    if(image.complete&&image.naturalWidth){ctx.imageSmoothingEnabled=false;ctx.drawImage(image,r.icon.x,r.icon.y,r.icon.size,r.icon.size);}
   }else{
    ctx.strokeStyle=theme.line;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(r.icon.x+16,r.icon.y+32);ctx.lineTo(r.icon.x+48,r.icon.y+32);ctx.moveTo(r.icon.x+32,r.icon.y+16);ctx.lineTo(r.icon.x+32,r.icon.y+48);ctx.stroke();
   }
   ctx.restore();
  };
  engine.drawModelCaption=(ctx,scene,theme)=>{
   const m=description(scene),r=layouts[scene].label;if(!m.text)return;
   ctx.save();ctx.textAlign='left';ctx.font='14px Consolas,"Microsoft YaHei",monospace';ctx.fillStyle=theme.muted;
   let text=m.text;while(text.length&&ctx.measureText(text).width>r.w)text=text.slice(0,-1);
   if(text!==m.text){while(text.length&&ctx.measureText(text+'…').width>r.w)text=text.slice(0,-1);text+='…';}
   ctx.fillText(text,r.x,r.y);ctx.restore();
  };
  return {description,layouts};
 }
 globalThis.PhaseModelMark={resolve,install,layouts};
})();
