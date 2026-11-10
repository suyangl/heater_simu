import type {Box,Project} from './s1';
import type {Surface} from './ResultLayers';
import {makeSampler,TemperatureField} from './probe';
import {heaterBox} from './plan';

function encode(values:number[],integer=false) {
  const bytes=new Uint8Array(values.length*4),view=new DataView(bytes.buffer);
  values.forEach((value,i)=>integer?view.setUint32(i*4,value,true):view.setFloat32(i*4,value,true));
  return btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
}
export function deriveS1Surfaces(p:Project,field:TemperatureField|null):Surface[] {
  if(!field)return [];
  const sample=makeSampler(field,[...p.furniture,heaterBox(p)]),spacing=field.grid.spacing;
  const roomNames=[['W','E'],['S','N'],['floor','ceiling']];
  function boxSurface(box:Box,name?:string):Surface[] {
    const surfaces:Surface[]=[],positions:number[]=[],indices:number[]=[],temperatures:number[]=[];
    const minimum=[box.x,box.y,box.z],size=[box.l,box.w,box.h];
    for(let axis=0;axis<3;axis++)for(let side=0;side<2;side++){
      const points:number[]=[],triangles:number[]=[],values:number[]=[],u=(axis+1)%3,v=(axis+2)%3;
      const nu=Math.max(1,Math.min(24,Math.ceil(size[u]/spacing[u]))),nv=Math.max(1,Math.min(24,Math.ceil(size[v]/spacing[v])));
      for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++){
        const point=[...minimum];point[axis]+=side*size[axis];point[u]+=i*size[u]/nu;point[v]+=j*size[v]/nv;
        points.push(...point);
        const air=[...point],direction=(side?1:-1)*(name?1:-1);
        air[axis]+=direction*spacing[axis]/2;
        values.push(sample(...air as [number,number,number]).value??NaN);
      }
      for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){
        const a=i+(nu+1)*j,b=a+1,c=b+nu+1,d=a+nu+1;
        if([a,b,c,d].every(k=>Number.isFinite(values[k])))triangles.push(a,b,c,a,c,d);
      }
      if(name){
        const offset=temperatures.length;positions.push(...points);temperatures.push(...values);indices.push(...triangles.map(i=>i+offset));
      }else if(triangles.length)surfaces.push({name:roomNames[axis][side],positions:encode(points),indices:encode(triangles,true),T:encode(values),speed:encode(values.map(()=>0))});
    }
    if(name&&indices.length)surfaces.push({name,positions:encode(positions),indices:encode(indices,true),T:encode(temperatures),speed:encode(temperatures.map(()=>0))});
    return surfaces;
  }
  const {length:l,width:w,height:h}=p.room;
  const surfaces=boxSurface({x:0,y:0,z:0,l,w,h});
  if(p.furniture.length){
    p.furniture.forEach((box,i)=>surfaces.push(...boxSurface(box,'furniture-'+i)));
  }
  surfaces.push(...boxSurface(heaterBox(p),'heater'));
  return surfaces;
}
