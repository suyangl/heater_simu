import {useEffect,useRef} from 'react';
import {useThree} from '@react-three/fiber';
import {Html} from '@react-three/drei';
import * as THREE from 'three';
import type {Project} from './s1';
import {clampPosition,ProbeReading,ProbeSettings,Sample} from './probe';
import {useLanguage} from './Language';
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
  const {t}=useLanguage(),position=clampPosition(settings,p.room);
  return <div className="probe-panel">
    <div className="row"><b>{t('probe.title')}</b><small>{t('probe.drag')}</small></div>
    <div className="probe-inputs">
      <label>{t('probe.posture')}<select value={settings.posture} onChange={e=>onChange({...settings,posture:e.target.value as ProbeSettings['posture']})}>
        {(['standing','sitting','lying'] as const).map(v=><option key={v} value={v}>{t(`probe.${v}`)}</option>)}
      </select></label>
      {(['x','y'] as const).map((axis,i)=><label key={axis}>{axis.toUpperCase()} (m)<input type="number" min="0" max={i?p.room.width:p.room.length} step=".05"
        value={Number(position[axis].toFixed(2))} onChange={e=>onChange({...settings,...clampPosition({...position,[axis]:Number(e.target.value)},p.room)})}/></label>)}
    </div>
    <ProbeReadout reading={reading} lying={settings.posture==='lying'} t={t}/>
    <p>{t('probe.rule')}</p>
  </div>;
}
export function ProbeFigure({p,settings,reading,onChange,onDragging}:{p:Project;settings:ProbeSettings;reading:ProbeReading;
  onChange:(s:ProbeSettings)=>void;onDragging:(v:boolean)=>void}) {
  const {t}=useLanguage(),{camera,gl}=useThree();
  const drag=useRef<{dx:number;dy:number}|null>(null);
  const {x,y}=clampPosition(settings,p.room),lying=settings.posture==='lying',sitting=settings.posture==='sitting';
  useEffect(()=>()=>onDragging(false),[onDragging]);
  function floor(clientX:number,clientY:number) {
    const rect=gl.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((clientX-rect.left)/rect.width*2-1,1-(clientY-rect.top)/rect.height*2),camera);
    const hit=ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),new THREE.Vector3());
    return hit?{x:hit.x+p.room.length/2,y:hit.z+p.room.width/2}:null;
  }
  return <Html position={[x,lying?reading.heights.body:0,y]} zIndexRange={[20,0]}>
    <div className="probe-marker" data-posture={settings.posture} style={{transform:`translate(${lying?-60:-31}px, ${lying?'-50%':'-100%'})`}}
      onPointerDown={e=>{
        if(e.button!==0)return;const point=floor(e.clientX,e.clientY);if(!point)return;
        e.stopPropagation();e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
        drag.current={dx:x-point.x,dy:y-point.y};onDragging(true);
      }}
      onPointerMove={e=>{
        if(!drag.current)return;e.stopPropagation();const point=floor(e.clientX,e.clientY);
        if(point)onChange({...settings,...clampPosition({x:point.x+drag.current.dx,y:point.y+drag.current.dy},p.room)});
      }}
      onPointerUp={e=>{if(!drag.current)return;e.stopPropagation();drag.current=null;onDragging(false);e.currentTarget.releasePointerCapture(e.pointerId);}}
      onPointerCancel={()=>{drag.current=null;onDragging(false);}}
      onLostPointerCapture={()=>{drag.current=null;onDragging(false);}}>
      <svg className="probe-glyph" width={lying?120:62} height={lying?54:sitting?95:115}
        viewBox={lying?'0 0 140 60':'0 0 72 120'} role="img" aria-label={t('probe.title')}>
        <g stroke="#203b46" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d={lying?'M26 35 L82 35 M40 35 L65 19 M82 35 L113 23 L133 23 M82 35 L110 43 L132 43':
            sitting?'M36 34 L36 69 L62 69 L62 104 M36 44 L57 60 L66 60 M36 69 L22 85 L30 110':
              'M36 31 L36 76 M36 43 L14 62 M36 43 L58 62 M36 76 L20 116 M36 76 L52 116'}/>
          <circle cx={lying?14:36} cy={lying?34:18} r="12" fill="#d9f4ec" stroke="#087f75" strokeWidth="3"/>
        </g>
        <g fill="#203b46"><circle cx={lying?11:32} cy={lying?32:16} r="1.6"/><circle cx={lying?18:40} cy={lying?32:16} r="1.6"/></g>
        <path d={lying?'M11 37 Q14 41 18 37':'M32 22 Q36 26 40 22'} stroke="#087f75" strokeWidth="2" fill="none" strokeLinecap="round"/>
      </svg>
      <ProbeReadout reading={reading} lying={lying} t={t}/>
    </div>
  </Html>;
}
