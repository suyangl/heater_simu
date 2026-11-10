import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { Edges, Grid, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import './style.css';

type Box = { x:number; y:number; z:number; l:number; w:number; h:number };
type Wall = 'N'|'S'|'E'|'W';
type Project = { room:{length:number;width:number;height:number}; exterior_wall:Wall; window:{offset:number;width:number;height:number;sill:number}; dpe:string; outdoor_temp:number; heater:{power_w:number;setpoint_c:number;wall:Wall;offset:number;z:number;length:number;depth:number;height:number}; furniture:Box[] };
type Result = {grid:{nx:number;ny:number;nz:number;origin:number[];spacing:number[]};T:{data:string;min:number;max:number;mean:number};kpi:{room_average_c:number;heat_loss_w:number;energy_balance_error:number;solve_wall_time_s:number;cell_count:number;rated_power_w:number;cfd_heater_power_w:number;analytic_effective_power_w:number;thermostat_iterations:number;duty_cycle:number;insufficient_power:boolean}};
const initial:Project = {room:{length:4,width:3.5,height:2.5},exterior_wall:'N',window:{offset:1.2,width:1.2,height:1.35,sill:.9},dpe:'F',outdoor_temp:5,heater:{power_w:1500,setpoint_c:19,wall:'N',offset:1.3,z:.15,length:.8,depth:.1,height:.5},furniture:[{x:.2,y:.3,z:0,l:1.9,w:1.4,h:.55},{x:2.7,y:.3,z:0,l:1,w:.6,h:.75}]};
const wallNames:Record<Wall,string> = {N:'北墙 N',S:'南墙 S',E:'东墙 E',W:'西墙 W'};
function wallBox(p:Project,wall:Wall,offset:number,z:number,length:number,depth:number,height:number):Box {
  if(wall==='N'||wall==='S') return {x:offset,y:wall==='N'?p.room.width-depth:0,z,l:length,w:depth,h:height};
  return {x:wall==='E'?p.room.length-depth:0,y:offset,z,l:depth,w:length,h:height};
}
function Solid({b,color,opacity=1}:{b:Box;color:string;opacity?:number}) {
  return <mesh position={[b.x+b.l/2,b.z+b.h/2,b.y+b.w/2]}><boxGeometry args={[b.l,b.h,b.w]}/><meshStandardMaterial color={color} transparent={opacity<1} opacity={opacity} depthWrite={opacity===1}/><Edges color={color}/></mesh>;
}
function Slice({result,height,vertical}:{result:Result;height:number;vertical:boolean}) {
  const geometry = useMemo(()=>{
    const {nx,ny,nz,spacing:s,origin:o} = result.grid;
    const bytes = Uint8Array.from(atob(result.T.data),c=>c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const values = new Float32Array(bytes.length/4);
    for(let i=0;i<values.length;i++) values[i]=view.getFloat32(i*4,true);
    const pos:number[]=[],colors:number[]=[];
    const sample = (i:number,j:number,k:number)=>values[i+nx*(j+ny*k)];
    const layer = Math.max(0,Math.min(nz-1,Math.round((height-o[2])/s[2])));
    const row = Math.floor(ny/2);
    const color = new THREE.Color();
    for(let a=0;a<nx-1;a++) for(let b=0;b<(vertical?nz:ny)-1;b++) {
      const corners = [[a,b],[a+1,b],[a+1,b+1],[a,b+1]];
      const temps=corners.map(([i,j])=>vertical?sample(i,row,j):sample(i,j,layer));
      if(temps.some(t=>!Number.isFinite(t))) continue;
      for(const v of [0,1,2,0,2,3]) {
        const [i,j]=corners[v];
        pos.push(o[0]+i*s[0],vertical?o[2]+j*s[2]:height,vertical?o[1]+row*s[1]:o[1]+j*s[1]);
        const fraction=Math.min(1,Math.max(0,(temps[v]-result.T.min)/(result.T.max-result.T.min||1)));
        color.setHSL((1-fraction)*.66,.9,.55);
        colors.push(color.r,color.g,color.b);
      }
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    g.computeVertexNormals();
    return g;
  },[result,height,vertical]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  return <mesh geometry={geometry}><meshBasicMaterial vertexColors side={THREE.DoubleSide} transparent opacity={.92}/></mesh>;
}
function Scene({p,result,height,vertical}:{p:Project;result:Result|null;height:number;vertical:boolean}) {
  const r=p.room;
  return <Canvas camera={{position:[7,6,8],fov:43}}><color attach="background" args={['#101e2d']}/><ambientLight intensity={1.5}/><directionalLight position={[3,8,3]} intensity={2}/>
    <group position={[-r.length/2,0,-r.width/2]}>
      <Solid b={{x:0,y:0,z:-.05,l:r.length,w:r.width,h:.05}} color="#4b6178"/>
      <Solid b={{x:0,y:r.width,z:0,l:r.length,w:.015,h:r.height}} color="#91a9bd" opacity={.12}/>
      <Solid b={{x:0,y:0,z:0,l:.015,w:r.width,h:r.height}} color="#91a9bd" opacity={.12}/>
      <Solid b={{x:r.length,y:0,z:0,l:.015,w:r.width,h:r.height}} color="#91a9bd" opacity={.07}/>
      <Solid b={{x:0,y:0,z:0,l:r.length,w:.015,h:r.height}} color="#91a9bd" opacity={.05}/>
      {p.furniture.map((b,i)=><Solid key={i} b={b} color={['#a28b72','#6e9c9a','#9c85b1'][i%3]}/>)}
      <Solid b={wallBox(p,p.heater.wall,p.heater.offset,p.heater.z,p.heater.length,p.heater.depth,p.heater.height)} color="#ff9859"/>
      <Solid b={wallBox(p,p.exterior_wall,p.window.offset,p.window.sill,p.window.width,.025,p.window.height)} color="#75d7ee" opacity={.5}/>
      {result&&<Slice result={result} height={height} vertical={vertical}/>}
    </group>
    <Grid position={[0,-.08,0]} args={[18,18]} cellSize={.5} cellColor="#26394c" sectionColor="#385169" fadeDistance={25}/><OrbitControls makeDefault target={[0,r.height/3,0]} minDistance={3} maxDistance={18}/>
  </Canvas>;
}
function NumberInput({label,value,onChange,step=.1}:{label:string;value:number;onChange:(v:number)=>void;step?:number}) {
  return <label>{label}<input type="number" value={value} step={step} onChange={e=>onChange(Number(e.target.value))}/></label>;
}
async function request(url:string,init?:RequestInit) {
  const res=await fetch(url,init); const data=await res.json();
  if(!res.ok) throw Error(typeof data.detail==='string'?data.detail:JSON.stringify(data.detail));
  return data;
}
function App() {
  const [p,setP]=useState<Project>(initial),[result,setResult]=useState<Result|null>(null),[jobId,setJobId]=useState<string|null>(null);
  const [status,setStatus]=useState('就绪'),[progress,setProgress]=useState(0),[error,setError]=useState(''),[log,setLog]=useState('');
  const [height,setHeight]=useState(1.1),[vertical,setVertical]=useState(false),[busy,setBusy]=useState(false);
  function change(next:Project) {setP(next);setResult(null);setError('');window.history.replaceState(null,'',window.location.pathname);}
  useEffect(()=>{
    const id=new URLSearchParams(window.location.search).get('job');
    if(id)void request('/api/jobs/'+encodeURIComponent(id)).then(job=>{setP(job.project);setJobId(id);setBusy(!['done','failed'].includes(job.status));}).catch(e=>setError(String(e)));
  },[]);
  useEffect(()=>{
    if(!jobId)return;
    let active=true;
    const poll=async()=>{try{
      const job=await request('/api/jobs/'+jobId); if(!active)return;
      const names:Record<string,string>={queued:'排队中',meshing:'生成网格',solving:'求解温度场',postprocessing:'重采样',done:'模拟完成',failed:'模拟失败'};
      setStatus(names[job.status]||job.status);setProgress(job.progress);setLog(job.log_tail||'');
      if(job.status==='done'){const data=await request('/api/jobs/'+jobId+'/result');if(active){setResult(data);setBusy(false);setJobId(null);}}
      if(job.status==='failed'){setError(job.error);setBusy(false);setJobId(null);}
    }catch(e){if(active){setError(String(e));setBusy(false);setJobId(null);}}};
    void poll(); const timer=setInterval(poll,2000);return ()=>{active=false;clearInterval(timer);};
  },[jobId]);
  async function simulate(){setBusy(true);setError('');setResult(null);setStatus('提交中');try{const j=await request('/api/simulate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});window.history.replaceState(null,'','?job='+j.job_id);setJobId(j.job_id);}catch(e){setError(String(e));setBusy(false);}}
  const wallSelect=(value:Wall,onChange:(v:Wall)=>void)=><select value={value} onChange={e=>onChange(e.target.value as Wall)}>{Object.entries(wallNames).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>;
  return <><header><div className="brand">Heat<span>Simu</span><small>房间热环境实验室</small></div><div className="tag">M0 · OpenFOAM v2406 · 本地计算</div></header>
    <main><aside><div className="intro"><span className="eyebrow">01 / 场景设置</span><h2>让温暖，看得见。</h2><p>编辑房间与家具，探索自然对流下的温度分布。</p></div><fieldset disabled={busy}>
      <section><h3>房间 <small>m</small></h3><div className="fields">{(['length','width','height'] as const).map((k,i)=><NumberInput key={k} label={['长','宽','高'][i]} value={p.room[k]} onChange={v=>change({...p,room:{...p.room,[k]:v}})}/>)}</div></section>
      <section><h3>围护与气候</h3><div className="fields"><label>唯一外墙{wallSelect(p.exterior_wall,v=>change({...p,exterior_wall:v}))}</label><label>DPE 等级<select value={p.dpe} onChange={e=>change({...p,dpe:e.target.value})}>{'ABCDEFG'.split('').map(v=><option key={v}>{v}</option>)}</select></label><NumberInput label="室外 °C" value={p.outdoor_temp} onChange={v=>change({...p,outdoor_temp:v})}/></div><p className="hint">其余墙面、地板、天花板绝热；DPE 换气损失合并到外墙。</p></section>
      <section><h3>窗户 <small>m · 位于外墙</small></h3><div className="fields">{(['offset','width','height','sill'] as const).map((k,i)=><NumberInput key={k} label={['沿墙偏移','宽度','高度','窗台高度'][i]} value={p.window[k]} onChange={v=>change({...p,window:{...p.window,[k]:v}})}/>)}</div></section>
      <section><h3>对流式暖器</h3><div className="fields"><NumberInput label="额定功率 W" value={p.heater.power_w} step={50} onChange={v=>change({...p,heater:{...p.heater,power_w:v}})}/><NumberInput label="恒温设定 °C" value={p.heater.setpoint_c} onChange={v=>change({...p,heater:{...p.heater,setpoint_c:v}})}/><label>所在墙{wallSelect(p.heater.wall,v=>change({...p,heater:{...p.heater,wall:v}}))}</label><NumberInput label="沿墙偏移 m" value={p.heater.offset} onChange={v=>change({...p,heater:{...p.heater,offset:v}})}/><NumberInput label="离地高度 m" value={p.heater.z} onChange={v=>change({...p,heater:{...p.heater,z:v}})}/></div><p className="hint">CFD 恒温器调节平均功率；解析 UA 仅作初值。M0 不含辐射。</p></section>
      <section><h3>家具 <small>{p.furniture.length} / 5 · m</small></h3>{p.furniture.map((box,i)=><div className="furniture" key={i}><div className="row"><b>方块 {i+1}</b><button className="remove" onClick={()=>change({...p,furniture:p.furniture.filter((_,j)=>j!==i)})}>移除</button></div><div className="fields">{(['x','y','z','l','w','h'] as const).map((k,j)=><NumberInput key={k} label={['X','Y','Z','长','宽','高'][j]} value={box[k]} onChange={v=>change({...p,furniture:p.furniture.map((b,n)=>n===i?{...b,[k]:v}:b)})}/>)}</div></div>)}<div className="presets">{[['床',1.9,1.4,.55],['书桌',1,.6,.75],['衣柜',1,.6,1.8]].map(([name,l,w,h])=><button key={name} disabled={p.furniture.length>=5} onClick={()=>change({...p,furniture:[...p.furniture,{x:.2,y:1.9,z:0,l:Number(l),w:Number(w),h:Number(h)}]})}>+ {name}</button>)}</div></section>
      </fieldset><button className="run" disabled={busy} onClick={()=>void simulate()}>{busy?'计算中…':'▶ 开始模拟'}</button><p className="hint">估算结果，不构成 DPE 或能源审计。</p></aside>
      <article><div className="view"><Scene p={p} result={result} height={height} vertical={vertical}/><div className="view-title"><span className="eyebrow">02 / 三维热环境</span><h2>{result?'稳态温度场':'房间实时预览'}</h2><p>拖动旋转 · 滚轮缩放 · 坐标：X 长 / Y 宽 / Z 高</p></div><div className="view-badge"><i/>{result?'OpenFOAM 精算结果':'几何预览 · 尚未求解'}</div>{result&&<div className="legend"><span>温度 °C</span><div/><span>{result.T.min.toFixed(1)}<b>{result.T.max.toFixed(1)}</b></span></div>}</div>
      <div className="results"><div className="row"><h3>模拟状态 <span className="status">{status}</span></h3><small>单任务 · 2 核限额</small></div><progress max={1} value={progress}/>{error&&<div className="error">{error}</div>}
      {result?<><div className="kpis"><div><span>房间平均</span><strong>{result.kpi.room_average_c.toFixed(1)}<small> °C</small></strong></div><div><span>最低 / 最高</span><strong>{result.T.min.toFixed(1)} / {result.T.max.toFixed(1)}<small> °C</small></strong></div><div><span>热平衡误差</span><strong>{(result.kpi.energy_balance_error*100).toFixed(1)}<small> %</small></strong></div><div><span>求解耗时 / 网格</span><strong>{result.kpi.solve_wall_time_s.toFixed(0)}<small> s / {(result.kpi.cell_count/1000).toFixed(0)}k</small></strong></div></div><div className="slice-controls"><label>切片高度 {height.toFixed(2)} m <input type="range" min="0.05" max={p.room.height-.05} step="0.05" value={height} onChange={e=>setHeight(Number(e.target.value))}/></label><label><input type="checkbox" checked={vertical} onChange={e=>setVertical(e.target.checked)}/> 竖直切片（房间中线）</label></div></>:<p className="empty">提交后依次进行网格生成、浮力流动求解与温度重采样。约需数分钟。</p>}
      {result&&<><div className="kpis"><div><span>额定 / CFD 恒温功率</span><strong>{result.kpi.rated_power_w.toFixed(0)} / {result.kpi.cfd_heater_power_w.toFixed(0)}<small> W</small></strong></div><div><span>解析估计 / 调节次数</span><strong>{result.kpi.analytic_effective_power_w.toFixed(0)}<small> W / {result.kpi.thermostat_iterations} 次</small></strong></div><div><span>恒温占空比</span><strong>{(result.kpi.duty_cycle*100).toFixed(1)}<small> %</small></strong></div><div><span>供暖能力</span><strong>{result.kpi.insufficient_power?'功率不足':'功率充足'}</strong></div></div><p className="hint">M0 不含辐射；CFD 功率仅对应当前对流模型，解析估计用于 RC 初值。</p></>}
      {log&&<details><summary>求解日志</summary><pre>{log}</pre></details>}</div></article></main></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
