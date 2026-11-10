import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

export type Surface = {positions:string;indices:string;T:string;speed:string;name?:string;level_c?:number};
type Streamlines = {positions:string;indices:string;offsets:string;speed:string;T:string;line_count:number};
export type VisualFields = {U?:{data:string;min:number;max:number};surfaces?:Surface[];streamlines?:Streamlines;isosurface?:Surface|null;temperature_range?:number[]};
export type Layers = {walls:boolean;colors:boolean;streamlines:boolean;iso:boolean;slice:boolean};
export const defaultLayers=(staticMode=false):Layers=>({walls:true,colors:true,streamlines:true,iso:true,slice:staticMode});
export const speedLegendVisible=(enabled:boolean,layers:Pick<Layers,'streamlines'|'iso'>)=>enabled&&(layers.streamlines||layers.iso);
export const gradient = 'linear-gradient(to top,#30123b,#466be3,#28b8c4,#88ef66,#e8de3e,#f66b19,#7a0403)';
const stops = ['#30123b','#466be3','#28b8c4','#88ef66','#e8de3e','#f66b19','#7a0403'].map(c=>new THREE.Color(c));

export function turbo(value:number, min:number, max:number, color=new THREE.Color()) {
  const t=Math.max(0,Math.min(1,(value-min)/(max-min||1)))*(stops.length-1);
  const i=Math.min(stops.length-2,Math.floor(t));
  return color.copy(stops[i]).lerp(stops[i+1],t-i);
}

export function decode(data:string, uint=false) {
  const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
  const view=new DataView(bytes.buffer);
  const values=uint?new Uint32Array(bytes.length/4):new Float32Array(bytes.length/4);
  for(let i=0;i<values.length;i++) values[i]=uint?view.getUint32(i*4,true):view.getFloat32(i*4,true);
  return values;
}

function positions(data:string) {
  const values=decode(data);
  for(let i=0;i<values.length;i+=3) [values[i+1],values[i+2]]=[values[i+2],values[i+1]];
  return values;
}

function colors(values:Float32Array|Uint32Array, range:number[]) {
  const result=new Float32Array(values.length*3), color=new THREE.Color();
  values.forEach((v,i)=>{turbo(v,range[0],range[1],color);color.toArray(result,i*3);});
  return result;
}

export function FieldSurface({surface,range,speed=false,colored=true,opacity=1}:{surface:Surface;range:number[];speed?:boolean;colored?:boolean;opacity?:number}) {
  const geometry=useMemo(()=>{
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(positions(surface.positions),3));
    g.setIndex(new THREE.BufferAttribute(decode(surface.indices,true),1));
    g.setAttribute('color',new THREE.BufferAttribute(colors(decode(speed?surface.speed:surface.T),range),3));
    g.computeVertexNormals();return g;
  },[surface,range[0],range[1],speed]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  return <mesh geometry={geometry} renderOrder={speed?2:0}><meshBasicMaterial key={colored?'field':'plain'} vertexColors={colored} color={colored?'white':'#c2c7d0'} side={THREE.DoubleSide} transparent={opacity<1} opacity={opacity} depthWrite={opacity===1} toneMapped={false}/></mesh>;
}

export function FlowLines({lines,range}:{lines:Streamlines;range:number[]}) {
  const geometry=useMemo(()=>{
    const points=positions(lines.positions), speeds=decode(lines.speed), indices=decode(lines.indices,true), offsets=decode(lines.offsets,true);
    const p:number[]=[],c:number[]=[],color=new THREE.Color();
    for(let line=0;line<offsets.length-1;line++) for(let k=offsets[line];k<offsets[line+1]-1;k++) for(const i of [indices[k],indices[k+1]]) {
      p.push(points[i*3],points[i*3+1],points[i*3+2]);
      turbo(speeds[i],range[0],range[1],color);c.push(color.r,color.g,color.b);
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));return g;
  },[lines,range[0],range[1]]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  return <lineSegments geometry={geometry} renderOrder={3}><lineBasicMaterial vertexColors transparent opacity={.9} depthWrite={false} toneMapped={false}/></lineSegments>;
}

export function RoomOutline({size}:{size:number[]}) {
  const geometry=useMemo(()=>{
    const p:number[]=[];
    for(let i=0;i<8;i++) for(const bit of [1,2,4]) if(!(i&bit)) for(const j of [i,i|bit]) p.push(j&1?size[0]:0,j&2?size[2]:0,j&4?size[1]:0);
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));return g;
  },[size[0],size[1],size[2]]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  return <lineSegments geometry={geometry} ref={line=>line?.computeLineDistances()} renderOrder={4}><lineDashedMaterial color="#4b606a" dashSize={.09} gapSize={.06} transparent opacity={.9} toneMapped={false}/></lineSegments>;
}

export function Colorbar({title,range}:{title:string;range:number[]}) {
  return <div className="colorbar"><strong>{title}</strong><div className="colorbar-scale"><div className="colorbar-ramp" style={{background:gradient}}/>{Array.from({length:21},(_,i)=><span className={i%4===0?'major':'minor'} key={i} style={{top:`${i*5}%`}}>{i%4===0&&<b>{(range[1]-(range[1]-range[0])*i/20).toFixed(title.includes('m/s')?3:1)}</b>}</span>)}</div></div>;
}
