import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { Edges, GizmoHelper, GizmoViewport, Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Colorbar, FieldSurface, FlowLines, Layers, defaultLayers, RoomOutline, speedLegendVisible, turbo, VisualFields } from './ResultLayers';
import { predict, prepare, Table, Box, Project, Wall, Opening, openingsOf, exteriorOf } from './s1';
import { capacityText, progressText, Runtime, settlementWarning } from './runStatus';
import {LanguageProvider,useLanguage} from './Language';
import {formatError,translateWarning} from './i18n';
import {furnitureDefaults,kindLabel,migrateKind,migrateProject} from './furniture';
import {BillingPanel} from './BillingPanel';
import {PlanEditor} from './PlanEditor';
import {Selection,commit,historyOf,undo,redo} from './plan';
import {clampPosition,makeSampler,readProbe,restoreProbe,ProbeReading,ProbeSettings} from './probe';
import {ProbeFigure,ProbePanel} from './ProbeFigure';
import {deployment} from './deployment';
import {chooseStaticTemplate,restoreStaticProject,staticProjectTemplate,STATIC_PROJECT_STORAGE} from './staticProject';
import {deriveS1Surfaces} from './s1Surfaces';
import './style.css';
import './runStatus.css';

type Result = VisualFields & {grid:{nx:number;ny:number;nz:number;origin:number[];spacing:number[]};T:{data:string;min:number;max:number;mean:number};kpi:{room_average_c:number;heat_loss_w:number;heat_loss_groups_w?:Record<string,number>;energy_balance_error:number;solve_wall_time_s:number;cell_count:number;rated_power_w:number;cfd_heater_power_w:number;analytic_effective_power_w:number;thermostat_iterations:number;duty_cycle:number;insufficient_power:boolean;not_settled?:boolean}};
const initial:Project = {room:{length:4,width:3.5,height:2.5},exterior_wall:'N',window:{offset:1.2,width:1.2,height:1.35,sill:.9},dpe:'F',outdoor_temp:5,heater:{power_w:1500,setpoint_c:19,wall:'N',offset:1.3,z:.15,length:.8,depth:.1,height:.5},furniture:[{x:.2,y:.3,z:0,l:1.9,w:1.4,h:.55},{x:2.7,y:.3,z:0,l:1,w:.6,h:.75}]};



function wallBox(p:Project,wall:Wall,offset:number,z:number,length:number,depth:number,height:number):Box {
  if(wall==='N'||wall==='S') return {x:offset,y:wall==='N'?p.room.width-depth:0,z,l:length,w:depth,h:height};
  return {x:wall==='E'?p.room.length-depth:0,y:offset,z,l:depth,w:length,h:height};
}
function Solid({b,color,opacity=1}:{b:Box;color:string;opacity?:number}) {
  const {t}=useLanguage();
  const [hover,setHover]=useState(false);
  return <mesh onPointerOver={()=>setHover(true)} onPointerOut={()=>setHover(false)} position={[b.x+b.l/2,b.z+b.h/2,b.y+b.w/2]}><boxGeometry args={[b.l,b.h,b.w]}/><meshStandardMaterial color={color} transparent={opacity<1} opacity={opacity} depthWrite={opacity===1}/>{opacity>0&&<Edges color={color}/>} {hover&&(b.name||b.kind)&&<Html center style={{pointerEvents:'none',whiteSpace:'nowrap',background:'#fff',color:'#203b46',border:'1px solid #b6c9d0',padding:'4px'}}>{b.name||t(kindLabel[migrateKind(b.kind)])}</Html>}</mesh>;
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
        const range=result.temperature_range??[result.T.min,result.T.max];
        turbo(temps[v],range[0],range[1],color);
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
  return <mesh geometry={geometry}><meshBasicMaterial vertexColors side={THREE.DoubleSide} transparent opacity={.65} depthWrite={false} toneMapped={false}/></mesh>;
}
function Scene({p,result,height,vertical,layers,probe,probeReading,person,onProbeChange}:{p:Project;result:Result|null;height:number;vertical:boolean;layers:Layers;probe:ProbeSettings;probeReading:ProbeReading;person:boolean;onProbeChange:(s:ProbeSettings)=>void}) {
  const r=p.room;
  const [probeDragging,setProbeDragging]=useState(false);
  const temperature=result?.temperature_range??[result?.T.min??0,result?.T.max??1];
  const speed=[0,result?.U?.max??1];
  const hasSurfaces=!!result?.surfaces?.length;
  return <Canvas camera={{position:[6,4.8,-6],fov:40}}><color attach="background" args={['#ffffff']}/><ambientLight intensity={1.5}/><directionalLight position={[3,8,3]} intensity={2}/>
    <group position={[-r.length/2,0,-r.width/2]}>
      {!hasSurfaces&&<>{layers.walls&&<>
      <Solid b={{x:0,y:0,z:-.05,l:r.length,w:r.width,h:.05}} color="#e3ecef"/>
      <Solid b={{x:0,y:r.width,z:0,l:r.length,w:.015,h:r.height}} color="#91a9bd" opacity={.12}/>
      <Solid b={{x:0,y:0,z:0,l:.015,w:r.width,h:r.height}} color="#91a9bd" opacity={.12}/>
      <Solid b={{x:r.length,y:0,z:0,l:.015,w:r.width,h:r.height}} color="#91a9bd" opacity={.07}/>
      <Solid b={{x:0,y:0,z:0,l:r.length,w:.015,h:r.height}} color="#91a9bd" opacity={.05}/>
      </>}
      {p.furniture.map((b,i)=><Solid key={i} b={b} color={['#a28b72','#6e9c9a','#9c85b1'][i%3]}/>)}
      <Solid b={wallBox(p,p.heater.wall,p.heater.offset,p.heater.z,p.heater.length,p.heater.depth,p.heater.height)} color="#ff9859"/>
      </>}
      {layers.walls&&openingsOf(p).map((o,i)=><Solid key={`opening-${i}`} b={wallBox(p,o.wall,o.offset,o.sill,o.width,.025,o.height)} color={o.type==='window'?'#75d7ee':exteriorOf(p).includes(o.wall)?'#e9bd70':'#b49be4'} opacity={.65}/>)}
      {hasSurfaces&&p.furniture.filter(b=>b.name||b.kind).map((b,i)=><Solid key={`label-${i}`} b={b} color="white" opacity={0}/>)}
      {hasSurfaces&&result!.surfaces!.map(surface=>{
        if(surface.name?.startsWith('window')||surface.name?.startsWith('door'))return null;
        const solid=surface.name?.startsWith('furniture')||surface.name==='heater';
        if(!solid&&!layers.walls)return null;
        const opacity=solid?1:surface.name==='floor'?.3:surface.name==='window'?.3:surface.name==='ceiling'?.06:.16;
        return <FieldSurface key={surface.name} surface={surface} range={temperature} colored={layers.colors} opacity={opacity}/>;
      })}
      {result?.isosurface&&layers.iso&&<FieldSurface surface={result.isosurface} range={speed} speed opacity={.55}/>}
      {result?.streamlines&&layers.streamlines&&<FlowLines lines={result.streamlines} range={speed}/>}
      {result&&layers.slice&&<Slice result={result} height={height} vertical={vertical}/>}
      {result&&person&&<ProbeFigure p={p} settings={probe} reading={probeReading} onChange={onProbeChange} onDragging={setProbeDragging}/>}
      <RoomOutline size={[r.length,r.width,r.height]}/>
    </group>
    <OrbitControls enabled={!probeDragging} makeDefault target={[0,r.height/2,0]} minDistance={3} maxDistance={18}/>
    <GizmoHelper alignment="bottom-left" margin={[65,65]}><GizmoViewport axisColors={['#c94d4d','#225ea8','#19835b']} labels={['X','Z','Y']} labelColor="white"/></GizmoHelper>
  </Canvas>;
}
function NumberInput({label,value,onChange,step=.1}:{label:string;value:number;onChange:(v:number)=>void;step?:number}) {
  return <label>{label}<input type="number" value={value} step={step} onChange={e=>onChange(Number(e.target.value))}/></label>;
}
const {request}=deployment;
function App() {
  const {t,language,setLanguage}=useLanguage();
  const wallNames:Record<Wall,string> = {N:t("北墙 N"),S:t("南墙 S"),E:t("东墙 E"),W:t("西墙 W")};
  const templateNames:Record<string,string> = {bedroom_small:t("小卧室 · 3.5 × 3"),bedroom:t("卧室 · 4 × 3.5"),living:t("客厅 · 5 × 4"),study:t("书房 · 3 × 2.5")};
  const positionNames:Record<string,string> = {under_window:t("窗下"),beside_window:t("外墙窗旁"),opposite_wall:t("对面内墙"),interior_corner:t("内墙角落")};
  const [restoredProject]=useState(()=>{try{return deployment.staticMode?restoreStaticProject(localStorage.getItem(STATIC_PROJECT_STORAGE)):null;}catch{return null;}});
  const [staticReady,setStaticReady]=useState(!deployment.staticMode||!!restoredProject),startupEdited=useRef(false);
  const [history,setHistory]=useState(()=>historyOf(restoredProject??initial)),[draft,setDraft]=useState<Project|null>(null),[selection,setSelection]=useState<Selection|null>(null);
  const p=draft??history.present;
  const [cfdResult,setResult]=useState<Result|null>(null),[jobId,setJobId]=useState<string|null>(null);
  const [table,setTable]=useState<Table|null>(null),[tableError,setTableError]=useState(''),[template,setTemplate]=useState(''),[position,setPosition]=useState('under_window');
  const [status,setStatus]=useState(t("就绪")),[progress,setProgress]=useState(0),[error,setError]=useState<unknown>(null),[log,setLog]=useState('');
  const [timing,setTiming]=useState<Runtime|null>(null),[warning,setWarning]=useState('');
  const [height,setHeight]=useState(1.1),[vertical,setVertical]=useState(false),[busy,setBusy]=useState(false);
  const [layers,setLayers]=useState<Layers>(()=>defaultLayers(deployment.staticMode));
  const [speedLegend,setSpeedLegend]=useState(true),[person,setPerson]=useState(true);
  const [probe,setProbe]=useState(()=>{try{return restoreProbe(localStorage.getItem('heatsimu.probe.v1'),initial.room);}catch{return restoreProbe(null,initial.room);}});
  useEffect(()=>{try{localStorage.setItem('heatsimu.probe.v1',JSON.stringify(probe));}catch{}},[probe]);
  useEffect(()=>{setProbe(s=>({...s,...clampPosition(s,p.room)}));},[p.room.length,p.room.width]);
  const staticTemplate=useMemo(()=>deployment.staticMode&&table?chooseStaticTemplate(table):null,[table]);
  useEffect(()=>{if(deployment.staticMode&&staticReady){try{localStorage.setItem(STATIC_PROJECT_STORAGE,JSON.stringify({version:1,project:history.present}));}catch{}}},[history.present,staticReady]);
  const prediction=useMemo(()=>table?predict(history.present,table,language):null,[history.present,table,language]);
  const s1Result=useMemo(()=>prediction?.field?{...prediction.field,surfaces:deriveS1Surfaces(history.present,prediction.field)}:null,[prediction,history.present]);
  const committedResult:Result|null=cfdResult??s1Result;
  const result:Result|null=draft?null:committedResult;
  const isPrediction=!draft&&!cfdResult&&!!prediction?.field;
  const sample=useMemo(()=>makeSampler(result,p.furniture),[result,p.furniture]);
  const probeReading=useMemo(()=>readProbe(sample,p,probe),[sample,p,probe]);
  useEffect(()=>{void deployment.loadArtifact().then(data=>{
    const prepared=prepare(data);setTable(prepared);
    if(deployment.staticMode){
      if(!startupEdited.current){
        const selected=restoredProject?null:chooseStaticTemplate(prepared),project=restoredProject??selected?.project;
        if(project){
          if(!restoredProject)setHistory(historyOf(project));
          const match=staticProjectTemplate(project,prepared);setTemplate(match.template);setPosition(match.position);
        }
      }
      setStaticReady(true);
    }
  }).catch(()=>setTableError(t(deployment.staticMode?"static.tableUnavailable":"预估表尚不可用，请精算")));},[]);
  function invalidate() {setResult(null);setJobId(null);setProgress(0);setLog('');setStatus(t("输入已更新"));setError('');setTiming(null);setWarning('');window.history.replaceState(null,'',window.location.pathname);}
  function change(next:Project) {if(JSON.stringify(next)===JSON.stringify(history.present))return;startupEdited.current=true;setHistory(h=>commit(h,next));invalidate();}
  function travel(direction:'undo'|'redo') {if(direction==='undo'?!history.past.length:!history.future.length)return;setDraft(null);setHistory(h=>direction==='undo'?undo(h):redo(h));invalidate();}
  function selectPlan(id:Selection|null) {
    setSelection(id);
    if(id)document.querySelector<HTMLElement>('[data-plan-card="'+id+'"]')?.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  function loadStaticTemplate() {
    if(!staticTemplate)return;
    setDraft(null);change(structuredClone(staticTemplate.project));setTemplate(staticTemplate.template);setPosition(staticTemplate.position);
  }
  function loadPreset(id:string,pos:string) {
    if(!id){setTemplate('');return;}
    if(!table?.presets[id]?.[pos])return;
    const next=migrateProject(structuredClone(table.presets[id][pos]));
    next.dpe=p.dpe;next.outdoor_temp=p.outdoor_temp;
    next.heater.power_w=p.heater.power_w;next.heater.setpoint_c=p.heater.setpoint_c;
    setTemplate(id);setPosition(pos);change(next);
  }
  useEffect(()=>{
    const id=deployment.jobFromSearch(window.location.search);
    if(id){setBusy(true);void request('/api/jobs/'+encodeURIComponent(id)).then(job=>{setHistory(historyOf(migrateProject(job.project)));setJobId(id);setBusy(!['done','failed'].includes(job.status));}).catch(e=>{setError(e);setBusy(false);});}
  },[]);
  useEffect(()=>{
    if(!deployment.canPoll(jobId))return;
    let active=true;
    const poll=async()=>{try{
      const job=await request('/api/jobs/'+jobId); if(!active)return;
      const names:Record<string,string>={queued:t("排队中"),meshing:t("生成网格"),solving:t("求解温度场"),postprocessing:t("重采样"),done:t("模拟完成"),failed:t("模拟失败")};
      setStatus(names[job.status]||job.status);setProgress(job.progress);setLog(job.log_tail||'');
      setTiming(job.runtime??null);
      if(job.status==='done'){const data=await request('/api/jobs/'+jobId+'/result');if(active){setWarning(settlementWarning(data));setResult(data.field_available===false?null:data);if(data.kpi?.not_settled)setStatus(t("未稳定 · 请勿作为已收敛结果"));setBusy(false);setJobId(null);}}
      if(job.status==='failed'){setError(job.error);setBusy(false);setJobId(null);}
    }catch(e){if(active){setError(e);setBusy(false);setJobId(null);}}};
    void poll(); const timer=setInterval(poll,2000);return ()=>{active=false;clearInterval(timer);};
  },[jobId]);
  async function simulate(){if(!deployment.canSimulate)return;setBusy(true);setError('');setWarning('');setTiming(null);setProgress(0);setResult(null);setStatus(t("提交中"));try{const j=await request('/api/simulate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});window.history.replaceState(null,'','?job='+j.job_id);setJobId(j.job_id);}catch(e){setError(e);setBusy(false);}}
  const wallSelect=(value:Wall,onChange:(v:Wall)=>void)=><select value={value} onChange={e=>onChange(e.target.value as Wall)}>{Object.entries(wallNames).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>;
  return <><header><div className="brand">Heat<span>Simu</span><small>{t("房间热环境实验室")}</small></div><div className="header-tools"><div className="tag">{t(deployment.staticMode?"static.title":"M1 · S1 即时预估 / OpenFOAM 精算")}</div><div className="language-switch" role="group" aria-label={t("语言")}><button aria-pressed={language==='zh'} onClick={()=>setLanguage('zh')}>{t('中文')}</button><button aria-pressed={language==='en'} onClick={()=>setLanguage('en')}>{t('EN')}</button></div></div></header>
    <main><aside><div className="intro"><span className="eyebrow">{t("01 / 场景设置")}</span><h2>{t("让温暖，看得见。")}</h2><p>{t("编辑房间与家具，探索自然对流下的温度分布。")}</p></div><fieldset disabled={busy}>
      <section><h3>{t("S1 场景预设")}</h3><label>{t("载入房间模板（替换几何）")}<select aria-label={t("房间模板")} value={template} onChange={e=>loadPreset(e.target.value,position)}><option value="">{t("自定义房间")}</option>{table?.axes.templates.map(id=><option key={id} value={id}>{templateNames[id]??id}</option>)}</select></label><label className="hint">{t("暖器预设位置")}<select aria-label={t("暖器预设位置")} value={position} disabled={!template} onChange={e=>loadPreset(template,e.target.value)}>{(table?.axes.positions??['under_window']).map(id=><option key={id} value={id}>{positionNames[id]??id}</option>)}</select></label><p className="hint">{t("部分表：")}{table?.cases.length??0} / {table?.availability.length??64}{t("个训练节点。B/D/F 留作独立验证，不进入查表。")}</p></section>
      <section data-plan-card="room" className={selection==='room'?'plan-linked':''} onPointerDown={()=>setSelection('room')}><h3>{t("房间")}<small>m</small></h3><div className="fields">{(['length','width','height'] as const).map((k,i)=><NumberInput key={k} label={[t("长"),t("宽"),t("高")][i]} value={p.room[k]} onChange={v=>change({...p,room:{...p.room,[k]:v}})}/>)}</div></section>
      <section><h3>{t("围护与气候")}</h3><div className="fields">{(Object.keys(wallNames) as Wall[]).map(w=><label key={w}><input type="checkbox" checked={exteriorOf(p).includes(w)} onChange={e=>change({...p,exterior_walls:e.target.checked?[...exteriorOf(p),w]:exteriorOf(p).filter(v=>v!==w)})}/>{wallNames[w]}{' '}{t("外墙")}</label>)}<label>{t("DPE 等级")}<select value={p.dpe} onChange={e=>change({...p,dpe:e.target.value})}>{'ABCDEFG'.split('').map(v=><option key={v}>{v}</option>)}</select></label><NumberInput label={t("室外 °C")} value={p.outdoor_temp} onChange={v=>change({...p,outdoor_temp:v})}/></div><p className="hint">{t("未选墙面为已供暖邻室，绝热；换气损失按外墙不透明总面积分摊。")}</p></section>
      <section><h3>{t("门窗")}<small>{openingsOf(p).length} / 24 · m</small></h3>{openingsOf(p).map((o,i)=><div data-plan-card={`opening-${i}`} onPointerDown={()=>setSelection(`opening-${i}`)} className={`furniture ${selection===`opening-${i}`?'plan-linked':''}`} key={i}><div className="row"><b>{o.type==='window'?t("窗户"):t("门")} {i+1}</b><button className="remove" onClick={()=>change({...p,openings:openingsOf(p).filter((_,j)=>j!==i)})}>{t("移除")}</button></div><div className="fields"><label>{t("类型")}<select value={o.type} onChange={e=>change({...p,openings:openingsOf(p).map((a,j)=>j===i?{...a,type:e.target.value as Opening['type'],sill:e.target.value==='door'?0:.9}:a)})}><option value="window">{t("窗户")}</option><option value="door">{t("门")}</option></select></label><label>{t("所在墙")}{wallSelect(o.wall,v=>change({...p,openings:openingsOf(p).map((a,j)=>j===i?{...a,wall:v}:a)}))}</label>{(['offset','width','height','sill'] as const).map((k,j)=><NumberInput key={k} label={[t("沿墙偏移"),t("宽度"),t("高度"),t("窗台高度")][j]} value={o[k]} onChange={v=>change({...p,openings:openingsOf(p).map((a,n)=>n===i?{...a,[k]:o.type==='door'&&k==='sill'?0:v}:a)})}/>)}{o.type==='door'&&exteriorOf(p).includes(o.wall)&&<NumberInput label={t("外门 U W/(m²·K)")} value={o.u_value??1.8} onChange={v=>change({...p,openings:openingsOf(p).map((a,j)=>j===i?{...a,u_value:v}:a)})}/>}</div><p className="hint">{o.type==='window'?t("仅限外墙；青色"):exteriorOf(p).includes(o.wall)?t("外门：金色，默认 U=1.8，可编辑"):t("内门：紫色，已供暖邻室，绝热")}</p></div>)}<div className="presets">{(['window','door'] as const).map(type=><button key={type} disabled={openingsOf(p).length>=24} onClick={()=>change({...p,openings:[...openingsOf(p),{type,wall:exteriorOf(p)[0]??'N',offset:0,width:type==='door'?.8:1,height:type==='door'?2:1,sill:type==='door'?0:1,u_value:1.8}]})}>+ {type==='window'?t("窗户"):t("门")}</button>)}</div></section>
      <section data-plan-card="heater" className={selection==='heater'?'plan-linked':''} onPointerDown={()=>setSelection('heater')}><h3>{t("对流式暖器")}</h3><div className="fields"><NumberInput label={t("额定功率 W")} value={p.heater.power_w} step={50} onChange={v=>change({...p,heater:{...p.heater,power_w:v}})}/><NumberInput label={t("恒温设定 °C")} value={p.heater.setpoint_c} onChange={v=>change({...p,heater:{...p.heater,setpoint_c:v}})}/><label>{t("所在墙")}{wallSelect(p.heater.wall,v=>change({...p,heater:{...p.heater,wall:v}}))}</label><NumberInput label={t("沿墙偏移 m")} value={p.heater.offset} onChange={v=>change({...p,heater:{...p.heater,offset:v}})}/><NumberInput label={t("离地高度 m")} value={p.heater.z} onChange={v=>change({...p,heater:{...p.heater,z:v}})}/></div><p className="hint">{t(deployment.staticMode?"static.physics":"CFD 恒温器调节平均功率；解析 UA 仅作初值。M0 不含辐射。")}</p></section>
      <section><h3>{t("家具")}<small>{p.furniture.length} / 15 · m</small></h3>{p.furniture.map((box,i)=><div data-plan-card={`furniture-${i}`} onPointerDown={()=>setSelection(`furniture-${i}`)} className={`furniture ${selection===`furniture-${i}`?'plan-linked':''}`} key={i}><div className="row"><b>{box.name||(box.kind&&t(kindLabel[migrateKind(box.kind)]))||t("方块 {v0}",{v0:i+1})}</b><button className="remove" onClick={()=>change({...p,furniture:p.furniture.filter((_,j)=>j!==i)})}>{t("移除")}</button></div><label>{t("名称")}<input type="text" value={box.name??''} maxLength={60} onChange={e=>change({...p,furniture:p.furniture.map((b,n)=>n===i?{...b,name:e.target.value}:b)})}/></label><label>{t("类型")}<select value={migrateKind(box.kind)} onChange={e=>{const kind=e.target.value,[l,w,h]=furnitureDefaults[kind];change({...p,furniture:p.furniture.map((b,n)=>n===i?{...b,kind,l,w,h}:b)});}}>{Object.keys(furnitureDefaults).map(k=><option key={k} value={k}>{t(kindLabel[k])}</option>)}</select></label><div className="fields">{(['x','y','z','l','w','h'] as const).map((k,j)=><NumberInput key={k} label={['X','Y','Z',t("长"),t("宽"),t("高")][j]} value={box[k]} onChange={v=>change({...p,furniture:p.furniture.map((b,n)=>n===i?{...b,[k]:v}:b)})}/>)}</div></div>)}<div className="presets">{Object.entries(furnitureDefaults).map(([kind,[l,w,h]])=><button key={kind} disabled={p.furniture.length>=15} onClick={()=>change({...p,furniture:[...p.furniture,{kind,name:'',x:.2,y:1.9,z:0,l,w,h}]})}>+ {t(kindLabel[kind])}</button>)}</div></section>
      </fieldset>{!deployment.staticMode&&<><button className="run" disabled={busy} onClick={()=>void simulate()}>{busy?t("OpenFOAM 精算中…"):t("▶ OpenFOAM 精算")}</button><p className="hint">{t("精算通常需 10+ 分钟；不会自动提交。低置信度或功率不足时建议精算。")}</p></>}</aside>
      <article>{deployment.staticMode&&<div className="static-notice" role="note">{t("static.notice")} <a href="https://github.com/suyangl/heater_simu#readme" target="_blank" rel="noopener noreferrer">{t("static.readme")}</a></div>}<PlanEditor project={p} selected={selection} disabled={busy} canUndo={!!history.past.length} canRedo={!!history.future.length} onSelect={selectPlan} onPreview={setDraft} onCommit={next=>{setDraft(null);change(next);}} onUndo={()=>travel('undo')} onRedo={()=>travel('redo')}/><div className={result&&person?'view probe-view':'view'}><Scene p={p} result={result} height={height} vertical={vertical} layers={layers} probe={probe} probeReading={probeReading} person={person} onProbeChange={setProbe}/><div className="view-title"><span className="eyebrow">{t("02 / 三维热环境")}</span><h2>{result?t("平均温度与自然对流"):t("房间实时预览")}</h2><p>{t("拖动旋转 · 滚轮缩放 · 坐标：X 长 / Y 宽 / Z 高")}</p></div><div className="view-badge"><i/>{cfdResult?(cfdResult.kpi.not_settled?t("OpenFOAM · 未稳定"):t("OpenFOAM 精算")):isPrediction?t("预估 · 置信度 {v0}",{v0:prediction?.confidence}):t(deployment.staticMode?"static.localRequired":"无可用预估，请精算")}</div>
      <div className="layer-controls">{([['walls',t("墙面"),true],['colors',t(isPrediction?"s1.approxSurfaces":"表面着色"),!!result?.surfaces?.length],['streamlines',t("流线"),!!result?.streamlines?.line_count],['iso',t("等温面"),!!result?.isosurface],['slice',t("温度切片"),!!result]] as const).filter(([key])=>deployment.showLayer(key)).map(([key,label,available])=><label key={key}><input type="checkbox" checked={layers[key]} disabled={!available} onChange={e=>setLayers({...layers,[key]:e.target.checked})}/>{label}</label>)}{deployment.showLayer("speedLegend")&&<label><input type="checkbox" checked={speedLegend} disabled={!result?.U} onChange={e=>setSpeedLegend(e.target.checked)}/>{t('风速色标')}</label>}<label><input type="checkbox" checked={person} disabled={!result} onChange={e=>setPerson(e.target.checked)}/>{t("probe.person")}</label>{result?.isosurface&&<small>{result.isosurface.level_c?.toFixed(1)}{t("°C 等温面 · 按风速着色")}</small>}</div>
      {result&&<div className="colorbars"><Colorbar title={t("温度 °C")} range={result.temperature_range??[result.T.min,result.T.max]}/>{result.U&&speedLegendVisible(speedLegend,layers)&&<Colorbar title={t("风速 m/s")} range={[0,result.U.max]}/>}</div>}</div>
      {result&&person&&<ProbePanel p={p} settings={probe} reading={probeReading} onChange={setProbe}/>}
      <div className="results">{!deployment.staticMode&&<><div className="row"><h3>{t("模拟状态")}<span className="status">{t(status)}</span></h3><small>{t("单任务 · 2 核限额")}</small></div><progress max={1} value={progress}/></>}{!!error&&<div className="error">{formatError(error,language)}</div>}
      {timing&&<p className="hint runtime">{progressText(timing,language)}</p>}{warning&&<div className="settlement-warning" role="alert">{t("未稳定 / not_settled：")}{translateWarning(warning,language)}</div>}
      {!cfdResult&&<p className="prediction-status" data-inference-ms={prediction?.elapsed_ms.toFixed(3)}>{deployment.staticMode&&prediction&&!prediction.field?t("static.localRequired"):prediction?t("预估 · 置信度 {v0} · {v1} · {v2} ms",{v0:prediction.confidence,v1:prediction.reason,v2:prediction.elapsed_ms.toFixed(2)}):t(tableError)||t("载入预估表…")}{isPrediction&&<>{t(deployment.staticMode?"static.validation":"。尚未完成数据集验证，不替代精算。")}{t("s1.surfaceCaveat")}</>}{deployment.staticMode&&prediction&&!prediction.field&&staticTemplate&&<> <button onClick={loadStaticTemplate}>{t("static.loadTemplate")}</button></>}</p>}
      {result?<><div className="kpis"><div><span>{t("房间平均")}</span><strong>{result.kpi.room_average_c.toFixed(1)}<small> °C</small></strong></div><div><span>{t("最低 / 最高")}</span><strong>{result.T.min.toFixed(1)} / {result.T.max.toFixed(1)}<small> °C</small></strong></div><div><span>{isPrediction?t("热平衡"):t("热平衡误差")}</span><strong>{isPrediction?t("未精算"):`${(result.kpi.energy_balance_error*100).toFixed(1)} %`}</strong></div><div><span>{isPrediction?t("浏览器推断"):t("求解耗时 / 网格")}</span><strong>{isPrediction?`${prediction?.elapsed_ms.toFixed(2)} ms`:`${result.kpi.solve_wall_time_s.toFixed(0)} s / ${(result.kpi.cell_count/1000).toFixed(0)}k`}</strong></div></div><div className="slice-controls"><label>{t("切片高度")}{' '}{height.toFixed(2)} m <input type="range" min="0.05" max={p.room.height-.05} step="0.05" disabled={!layers.slice} value={height} onChange={e=>setHeight(Number(e.target.value))}/></label><label><input type="checkbox" disabled={!layers.slice} checked={vertical} onChange={e=>setVertical(e.target.checked)}/>{t("竖直切片（房间中线）")}</label></div></>:deployment.showSolverEmptyState&&<p className="empty">{t("无可用预估，请精算。精算需数分钟；不会自动提交。")}</p>}
      {result&&<><div className="kpis"><div><span>{isPrediction?t("额定 / 预估所需功率"):t("额定 / CFD 恒温功率")}</span><strong>{result.kpi.rated_power_w.toFixed(0)} / {result.kpi.cfd_heater_power_w.toFixed(0)}<small> W</small></strong></div><div><span>{isPrediction?t("解析 UA 功率"):t("解析估计 / 调节次数")}</span><strong>{result.kpi.analytic_effective_power_w.toFixed(0)}<small> W{!isPrediction&&t(" / {v0} 次",{v0:result.kpi.thermostat_iterations})}</small></strong></div><div><span>{t("恒温占空比")}</span><strong>{(result.kpi.duty_cycle*100).toFixed(1)}<small> %</small></strong></div><div><span>{t("供暖能力")}</span><strong>{capacityText(result.kpi.insufficient_power,warning,language)}</strong></div></div><p className="hint">{isPrediction?t(deployment.staticMode?"static.physics":"S1 仅为无辐射对流模型预估。功率不足时显示的是目标温度场，不代表实际可达到温度；建议精算。"):t("M0 不含辐射；CFD 功率仅对应当前对流模型，解析估计用于 RC 初值。")}</p></>}
      {cfdResult?.kpi.heat_loss_groups_w&&<p className="hint">{t("散热分项：")}{Object.entries(cfdResult.kpi.heat_loss_groups_w).map(([group,w])=>t("{v0} {v1} W",{v0:t(({exterior_walls:'外墙',windows:'窗户',exterior_doors:'外门'} as Record<string,string>)[group]??group),v1:w.toFixed(1)})).join(' · ')}{t("（内门绝热）")}</p>}
      {log&&<details><summary>{t("求解日志")}</summary><pre>{log}</pre></details>}</div>
      <BillingPanel project={history.present} table={table} result={committedResult} source={cfdResult?'CFD':prediction?.field?'S1':'analytic'} onProjectChange={change}/></article></main></>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><App/></LanguageProvider>);
