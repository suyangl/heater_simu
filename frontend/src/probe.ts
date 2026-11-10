import type {Project} from './s1';
import {decode} from './ResultLayers';

export type Posture='standing'|'sitting'|'lying';
export type ProbeSettings={posture:Posture;x:number;y:number};
export type TemperatureField={grid:{nx:number;ny:number;nz:number;origin:number[];spacing:number[]};T:{data:string}};
export type Sample={value:number|null;nearest:boolean};
type Room=Project['room'];
const clamp=(v:number,max:number)=>Math.max(0,Math.min(max,v));
export const clampPosition=(p:{x:number;y:number},room:Room)=>({
  x:clamp(Number.isFinite(p.x)?p.x:room.length/2,room.length),
  y:clamp(Number.isFinite(p.y)?p.y:room.width/2,room.width)
});
export function restoreProbe(raw:string|null,room:Room):ProbeSettings {
  let value:Partial<ProbeSettings>={};
  try {const parsed=JSON.parse(raw??'null');if(parsed&&typeof parsed==='object')value=parsed;}catch {}
  return {posture:['standing','sitting','lying'].includes(value.posture??'')?value.posture!:'standing',
    ...clampPosition({x:value.x??room.length/2,y:value.y??room.width/2},room)};
}
export function postureHeights(settings:ProbeSettings,p:Pick<Project,'room'|'furniture'>) {
  const pos=clampPosition(settings,p.room);
  const support=settings.posture==='lying'?Math.max(0,...p.furniture
    .filter(b=>pos.x>=b.x&&pos.x<=b.x+b.l&&pos.y>=b.y&&pos.y<=b.y+b.w)
    .map(b=>b.z+b.h)):0;
  return {head:clamp(settings.posture==='standing'?1.6:1.1,p.room.height),
    ankle:clamp(.1,p.room.height),body:clamp(support+.4,p.room.height)};
}
export function makeSampler(field:TemperatureField|null,boxes:Project['furniture']=[]) {
  const missing:Sample={value:null,nearest:false};
  if(!field)return (_x:number,_y:number,_z:number)=>missing;
  const {nx,ny,nz,origin,spacing}=field.grid,dims=[nx,ny,nz];
  let values:Float32Array;
  try {values=decode(field.T.data) as Float32Array;}catch {return (_x:number,_y:number,_z:number)=>missing;}
  if(dims.some(n=>!Number.isInteger(n)||n<1)||origin.length!==3||spacing.length!==3||
    origin.some(v=>!Number.isFinite(v))||spacing.some(v=>!Number.isFinite(v)||v<=0)||values.length!==nx*ny*nz)
    return (_x:number,_y:number,_z:number)=>missing;
  const inside=(x:number,y:number,z:number)=>boxes.some(b=>x>=b.x&&x<=b.x+b.l&&y>=b.y&&y<=b.y+b.w&&z>=b.z&&z<=b.z+b.h);
  const valid=new Uint8Array(values.length);
  for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const index=i+nx*(j+ny*k);
    valid[index]=Number.isFinite(values[index])&&!inside(origin[0]+i*spacing[0],origin[1]+j*spacing[1],origin[2]+k*spacing[2])?1:0;
  }
  function nearest(x:number,y:number,z:number):Sample {
    let distance=Infinity,value:number|null=null;
    for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      const index=i+nx*(j+ny*k);if(!valid[index])continue;
      const d=(origin[0]+i*spacing[0]-x)**2+(origin[1]+j*spacing[1]-y)**2+(origin[2]+k*spacing[2]-z)**2;
      if(d<distance){distance=d;value=values[index];}
    }
    return {value,nearest:value!==null};
  }
  return (x:number,y:number,z:number):Sample=>{
    if(![x,y,z].every(Number.isFinite))return missing;
    const q=[x,y,z].map((v,a)=>(v-origin[a])/spacing[a]);
    if(q.some((v,a)=>v<0||v>dims[a]-1)||inside(x,y,z))return nearest(x,y,z);
    const low=q.map(Math.floor),high=low.map((v,a)=>Math.min(v+1,dims[a]-1)),f=q.map((v,a)=>v-low[a]);
    let value=0;
    for(let k=0;k<2;k++)for(let j=0;j<2;j++)for(let i=0;i<2;i++){
      const weight=(i?f[0]:1-f[0])*(j?f[1]:1-f[1])*(k?f[2]:1-f[2]);
      if(weight===0)continue;
      const index=(i?high[0]:low[0])+nx*((j?high[1]:low[1])+ny*(k?high[2]:low[2]));
      if(!valid[index])return nearest(x,y,z);
      value+=weight*values[index];
    }
    return {value,nearest:false};
  };
}
export function readProbe(sample:ReturnType<typeof makeSampler>,p:Project,settings:ProbeSettings) {
  const {x,y}=clampPosition(settings,p.room),heights=postureHeights(settings,p);
  const head=sample(x,y,heights.head),ankle=sample(x,y,heights.ankle),body=sample(x,y,heights.body);
  const delta=head.value!==null&&ankle.value!==null?head.value-ankle.value:null;
  const mean=settings.posture==='lying'?body.value:
    head.value!==null&&ankle.value!==null?(head.value+ankle.value)/2:null;
  const comfort=mean===null?'unavailable':mean<p.heater.setpoint_c-1?'cool':mean>p.heater.setpoint_c+1?'warm':'comfortable';
  return {head,ankle,body,delta,comfort,warning:settings.posture!=='lying'&&delta!==null&&Math.abs(delta)>3,heights} as const;
}
export type ProbeReading=ReturnType<typeof readProbe>;
