import {useEffect,useRef} from 'react';
import {useThree} from '@react-three/fiber';
import type {ThreeEvent} from '@react-three/fiber';
import {Html} from '@react-three/drei';
import * as THREE from 'three';
import type {Project} from './s1';
import {clampPosition,lyingHeadOffset,probePose,ProbeReading,ProbeSettings,Sample} from './probe';
import {LyingFigure,SittingFigure} from './ProbePostures';
import {useLanguage} from './Language';
import {NumberInput} from './NumberInput';
import './probe.css';

function temperature(sample:Sample) {
  return sample.value===null?'—':`${sample.nearest?'≈ ':''}${sample.value.toFixed(1)} °C`;
}
export function ProbeReadout({reading,lying,t}:{reading:ProbeReading;lying:boolean;t:ReturnType<typeof useLanguage>['t']}) {
  return <div className="probe-readout" aria-live="polite">
    {lying?<div>{t('probe.body')}: <b>{temperature(reading.body)}</b></div>:<>
      <div>{t('probe.head')}: <b>{temperature(reading.head)}</b></div>
      <div>{t('probe.ankle')}: <b>{temperature(reading.ankle)}</b></div>
      <div>{t('probe.delta')}: <b>{reading.delta===null?'—':`${reading.delta.toFixed(1)} °C`}</b></div>
    </>}
    <strong className={reading.comfort}>{t(`probe.${reading.comfort}`)}</strong>
    {reading.warning&&<div className="probe-warning">{t('probe.stratification')}</div>}
  </div>;
}
export function ProbePanel({p,settings,reading,onChange}:{p:Project;settings:ProbeSettings;reading:ProbeReading;onChange:(s:ProbeSettings)=>void}) {
  const {t}=useLanguage(),position=probePose(settings,p);
  return <div className="probe-panel">
    <div className="row"><b>{t('probe.title')}</b><small>{t('probe.drag')}</small></div>
    <div className="probe-inputs">
      <label>{t('probe.posture')}<select value={settings.posture} onChange={e=>onChange({...settings,posture:e.target.value as ProbeSettings['posture']})}>
        {(['standing','sitting','lying'] as const).map(v=><option key={v} value={v}>{t(`probe.${v}`)}</option>)}
      </select></label>
      {(['x','y'] as const).map((axis,i)=><label key={axis}>{axis.toUpperCase()} (m)<NumberInput min={0} max={i?p.room.width:p.room.length} step=".05"
        value={Number(position[axis].toFixed(2))} onValueChange={value=>onChange({...settings,...clampPosition({...position,[axis]:value},p.room)})}/></label>)}
    </div>
    <ProbeReadout reading={reading} lying={settings.posture==='lying'} t={t}/>
    <p>{t('probe.rule')}</p>
  </div>;
}
export function ProbeFigure({p,settings,reading,onChange,onDragging,t}:{p:Project;settings:ProbeSettings;reading:ProbeReading;
  onChange:(s:ProbeSettings)=>void;onDragging:(v:boolean)=>void;t:ReturnType<typeof useLanguage>['t']}) {
  const {camera,gl,controls}=useThree();
  const orbit=controls as unknown as {enabled:boolean}|null;
  const drag=useRef<{dx:number;dy:number}|null>(null);
  const pose=probePose(settings,p),{x,y}=pose,lying=settings.posture==='lying',sitting=settings.posture==='sitting';
  useEffect(()=>()=>{if(orbit)orbit.enabled=true;onDragging(false);},[onDragging,orbit]);
  function dragging(value:boolean){if(orbit)orbit.enabled=!value;onDragging(value);}
  function floor(clientX:number,clientY:number) {
    const rect=gl.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((clientX-rect.left)/rect.width*2-1,1-(clientY-rect.top)/rect.height*2),camera);
    const hit=ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),new THREE.Vector3());
    return hit?{x:hit.x+p.room.length/2,y:hit.z+p.room.width/2}:null;
  }
  type Pointer={button:number;clientX:number;clientY:number;pointerId:number;stopPropagation:()=>void};
  type Capture={setPointerCapture:(id:number)=>void;releasePointerCapture:(id:number)=>void};
  function begin(e:Pointer,target:Capture){
    if(e.button!==0)return;const point=floor(e.clientX,e.clientY);if(!point)return;
    e.stopPropagation();target.setPointerCapture(e.pointerId);drag.current={dx:x-point.x,dy:y-point.y};dragging(true);
  }
  function move(e:Pointer){
    if(!drag.current)return;e.stopPropagation();const point=floor(e.clientX,e.clientY);
    if(point)onChange({...settings,...clampPosition({x:point.x+drag.current.dx,y:point.y+drag.current.dy},p.room)});
  }
  function cancel(){drag.current=null;dragging(false);}
  function end(e:Pointer,target:Capture){
    if(!drag.current)return;e.stopPropagation();cancel();target.releasePointerCapture(e.pointerId);
  }
  const events={onPointerDown:(e:ThreeEvent<PointerEvent>)=>begin(e,e.target as unknown as Capture),
    onPointerMove:move,onPointerUp:(e:ThreeEvent<PointerEvent>)=>end(e,e.target as unknown as Capture),onPointerCancel:cancel};
  return <>
    {lying&&<LyingFigure pose={pose} events={events}/>}
    {sitting&&<SittingFigure pose={pose} events={events}/>}
    <Html position={[lying?x+Math.cos(pose.yaw)*pose.length*lyingHeadOffset:x,
      lying?pose.support+.12:sitting?reading.heights.head+.15:0,
      lying?y-Math.sin(pose.yaw)*pose.length*lyingHeadOffset:y]} zIndexRange={[20,0]} style={{pointerEvents:'none'}}>
    <div className="probe-marker" data-posture={settings.posture} style={{transform:lying?'translate(24px,-100%)':sitting?'translate(24px,-50%)':'translate(-31px,-100%)'}}
      onPointerDown={e=>{e.preventDefault();begin(e,e.currentTarget);}} onPointerMove={move}
      onPointerUp={e=>end(e,e.currentTarget)} onPointerCancel={cancel} onLostPointerCapture={cancel}>
      {!lying&&!sitting&&<svg className="probe-glyph" width="62" height="115" viewBox="0 0 72 120" role="img" aria-label={t('probe.title')}>
        <g stroke="#000" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M36 31 L36 76 M36 43 L14 62 M36 43 L58 62 M36 76 L20 116 M36 76 L52 116"/>
          <circle cx="36" cy="18" r="12" fill="#F5C9A0" stroke="#000" strokeWidth="5"/>
        </g>
        <g fill="#000"><circle cx="32" cy="16" r="1.6"/><circle cx="40" cy="16" r="1.6"/></g>
        <path d="M32 22 Q36 26 40 22" stroke="#000" strokeWidth="2" fill="none" strokeLinecap="round"/>
      </svg>}
      <ProbeReadout reading={reading} lying={lying} t={t}/>
    </div>
  </Html></>;
}
