import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';

export class PhaseTelemetry extends EventEmitter {
  constructor({root, python = process.env.PHASE_TELEMETRY_PYTHON, spawnImpl = spawn} = {}) {
    super();
    this.root = root;
    this.file = path.join(root, 'data', 'telemetry-config.json');
    this.script = path.join(root, 'scripts', 'phase-telemetry.py');
    const bundled = path.join(process.env.USERPROFILE || '', '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe');
    this.python = python || (fs.existsSync(bundled) ? bundled : 'python');
    this.spawnImpl = spawnImpl;
    this.config = {heartEnabled:false,device:'instinct',audioEnabled:true};
    try {this.config={...this.config,...JSON.parse(fs.readFileSync(this.file,'utf8'))};} catch {}
    this.processes = {};
    this.latest = {heart:{type:'heart.status',status:'disabled'},audio:{type:'audio.status',status:'disabled'},spectrum:null};
    this.started = false;
  }
  read() {
    const heart=this.latest.heart?.bpm&&Date.now()-this.latest.heart.at>8000
      ? {...this.latest.heart,bpm:null,status:'stale'} : this.latest.heart;
    const spectrum=this.latest.spectrum&&Date.now()-this.latest.spectrum.at>2500?null:this.latest.spectrum;
    return {ok:true,config:{...this.config},heart,audio:this.latest.audio,spectrum};
  }
  start() {this.started=true;this.reconcile();}
  reconcile() {
    for (const [key,enabled] of [['audio',this.config.audioEnabled],['heart',this.config.heartEnabled]]) {
      if (enabled && !this.processes[key]) this.launch(key);
      if (!enabled && this.processes[key]) {this.processes[key].kill();delete this.processes[key];}
      if (!enabled) this.update({type:key+'.status',status:'disabled'});
    }
  }
  launch(key) {
    const args=[this.script,key,...(key==='heart'?['--device',this.config.device]:[])];
    let child;
    try {child=this.spawnImpl(this.python,args,{cwd:this.root,windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'}});}
    catch(e){this.update({type:key+'.status',status:'error',message:e.message});return;}
    this.processes[key]=child;
    let pending='';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data',chunk=>{pending+=chunk;let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);try{this.update(JSON.parse(line));}catch{}}if(pending.length>65536)pending='';});
    child.on('error',error=>this.update({type:key+'.status',status:'error',message:error.message}));
    child.on('exit',()=>{if(this.processes[key]!==child)return;delete this.processes[key];this.update({type:key+'.status',status:'disconnected'});if(this.started&&this.config[key+'Enabled']){const timer=setTimeout(()=>this.reconcile(),5000);timer.unref?.();}});
  }
  update(event) {
    if(event.type==='heart.rate') {if(!Number.isInteger(event.bpm)||event.bpm<25||event.bpm>240)return;this.latest.heart={...event,status:'connected'};}
    else if(event.type==='heart.status') {this.latest.heart={...this.latest.heart,...event,bpm:event.status==='connected'?this.latest.heart.bpm:null};}
    else if(event.type==='audio.status') this.latest.audio=event;
    else if(event.type==='audio.spectrum') {if(!Array.isArray(event.bands)||event.bands.length!==24||event.bands.some(n=>typeof n!=='number'||n<0||n>1))return;this.latest.spectrum=event;}
    else return;
    this.emit('event',event);
  }
  configure(body) {
    const next={...this.config};
    for(const key of ['heartEnabled','audioEnabled'])if(key in body){if(typeof body[key]!=='boolean')throw new Error('开关必须为布尔值');next[key]=body[key];}
    if('device'in body){if(typeof body.device!=='string'||!body.device.trim()||body.device.length>100)throw new Error('无效设备');next.device=body.device.trim();}
    const changed=next.heartEnabled!==this.config.heartEnabled||next.device!==this.config.device;
    fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(next,null,2));fs.renameSync(this.file+'.tmp',this.file);
    this.config=next;
    if(changed&&this.processes.heart){this.processes.heart.kill();delete this.processes.heart;}
    if(this.started)this.reconcile();
    return this.read();
  }
  scan() {return new Promise((resolve,reject)=>{
    const child=this.spawnImpl(this.python,[this.script,'scan'],{cwd:this.root,windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
    let output='',error='';const timer=setTimeout(()=>{child.kill();reject(new Error('蓝牙扫描超时'));},15000);
    child.stdout?.on('data',chunk=>output+=chunk.toString());child.stderr?.on('data',chunk=>error+=chunk.toString().slice(0,1000));
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('exit',code=>{clearTimeout(timer);try{const data=JSON.parse(output.trim().split(/\r?\n/).at(-1));if(code!==0||data.type!=='telemetry.scan')throw new Error(error||data.message||'扫描失败');resolve({ok:true,devices:data.devices});}catch(e){reject(e);}});
  });}
  stop() {this.started=false;for(const child of Object.values(this.processes))child.kill();this.processes={};}
}
