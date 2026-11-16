import type {Box,Project} from './s1';
import {exteriorOf,openingsOf,ua} from './s1';

type Ridge={mean:number[];std:number[];coef:number[];intercept:number};
export type HybridModel={version:string;grid:{nx:number;ny:number;nz:number};field:Ridge;power:Ridge;
  u_values:Record<string,[number,number]>;ach:Record<string,number>};
const DEFAULT_U:Record<string,[number,number]>={A:[.15,.8],B:[.25,1.1],C:[.35,1.4],D:[.6,2],E:[1,2.8],F:[1.5,3.5],G:[2.2,5]};
const DEFAULT_ACH:Record<string,number>={A:.3,B:.4,C:.5,D:.6,E:.7,F:.9,G:1.2};
export function validHybrid(value:unknown):value is HybridModel {
  const m=value as HybridModel;
  const ridge=(r:Ridge,n:number)=>!!r&&[r.mean,r.std,r.coef].every(a=>Array.isArray(a)&&a.length===n&&a.every(Number.isFinite))&&r.std.every(v=>v>0)&&Number.isFinite(r.intercept);
  return !!m&&m.version==='hybrid-v1'&&m.grid?.nx===24&&m.grid.ny===20&&m.grid.nz===12&&ridge(m.field,28)&&ridge(m.power,10)&&
    Object.keys(DEFAULT_U).every(d=>m.u_values?.[d]?.length===2&&m.u_values[d].every(v=>Number.isFinite(v)&&v>0)&&Number.isFinite(m.ach?.[d])&&m.ach[d]>0);
}
export function heaterBox(p:Project):Box {
  const h=p.heater,r=p.room;
  return h.wall==='N'||h.wall==='S'?{x:h.offset,y:h.wall==='N'?r.width-h.depth:0,z:h.z,l:h.length,w:h.depth,h:h.height}:
    {x:h.wall==='E'?r.length-h.depth:0,y:h.offset,z:h.z,l:h.depth,w:h.length,h:h.height};
}
const distance=(a:number[],b:number[])=>Math.hypot(...a.map((v,i)=>v-b[i]));
export function hybridContext(p:Project) {
  const r=p.room,b=heaterBox(p),center=[b.x+b.l/2,b.y+b.w/2,b.z+b.h/2];
  const openings=openingsOf(p),walls=exteriorOf(p),floor=r.length*r.width,volume=floor*r.height;
  const windows=openings.filter(o=>o.type==='window').map(o=>{
    const along=o.offset+o.width/2,z=o.sill+o.height/2;
    return {center:({N:[along,r.width,z],S:[along,0,z],E:[r.length,along,z],W:[0,along,z]})[o.wall],sill:o.sill};
  });
  const [wallU,windowU]=DEFAULT_U[p.dpe];
  const opaque=walls.reduce((s,w)=>s+(w==='N'||w==='S'?r.length:r.width)*r.height,0)-openings.filter(o=>walls.includes(o.wall)).reduce((s,o)=>s+o.width*o.height,0);
  const c=[wallU,windowU,DEFAULT_ACH[p.dpe],openings.filter(o=>o.type==='window').reduce((s,o)=>s+o.width*o.height,0)/floor,
    windows.length?Math.min(...windows.map(w=>distance(center,w.center))):0,volume,opaque/floor,
    p.furniture.reduce((s,b)=>s+b.l*b.w*b.h,0)/volume,r.height,r.length/r.width];
  return {center,windows,c};
}
export function intersects(start:number[],end:number[],box:Box) {
  let low=0,high=1;
  const bounds=[[box.x,box.x+box.l],[box.y,box.y+box.w],[box.z,box.z+box.h]];
  for(let i=0;i<3;i++){
    const a=start[i],delta=end[i]-a,[lo,hi]=bounds[i];
    if(Math.abs(delta)<1e-12){if(a<lo||a>hi)return false;}
    else {
      const near=Math.min((lo-a)/delta,(hi-a)/delta),far=Math.max((lo-a)/delta,(hi-a)/delta);
      low=Math.max(low,near);high=Math.min(high,far);if(low>high)return false;
    }
  }
  return high>1e-8&&low<1-1e-8;
}
export function hybridFeatures(p:Project,point:number[],prepared=hybridContext(p)) {
  const {center,windows,c}=prepared,[x,y,height]=point,z=height/p.room.height;
  const d=distance(point,center),near=Math.exp(-d/.5),far=Math.exp(-d/1.5);
  const plume=Math.exp(-Math.hypot(x-center[0],y-center[1])/.5)*z*Number(height>center[2]);
  const distances=windows.map(w=>({d:distance(point,w.center),sill:w.sill}));
  const window=distances.length?Math.exp(-Math.min(...distances.map(w=>w.d))/.5):0;
  const down=Math.max(0,...distances.filter(w=>height<w.sill).map(w=>Math.exp(-w.d/.5)));
  const walls={N:p.room.width-y,S:y,E:p.room.length-x,W:x};
  const exterior=Math.exp(-Math.min(...exteriorOf(p).map(w=>walls[w]))/.5);
  const shadow=Number(p.furniture.some(b=>intersects(center,point,b)));
  return [z,z*z,near,far,plume,window,down,exterior,shadow,...c,
    z*c[0],z*z*c[0],plume*c[0],window*c[1],down*c[2],exterior*c[0],shadow*near,z*c[2],near*c[5]];
}
export const regress=(model:Ridge,x:number[])=>model.intercept+x.reduce((s,v,i)=>s+(v-model.mean[i])/model.std[i]*model.coef[i],0);
export function predictHybrid(p:Project,model:HybridModel) {
  if(!validHybrid(model))return null;
  const rise=p.heater.setpoint_c-p.outdoor_temp;
  const analytic=ua(p,{axes:{templates:[],positions:[],u_values:model.u_values,ach:model.ach}});
  if(!(rise>0)||!(analytic>0)||!Number.isFinite(analytic)||!(p.heater.power_w>0))return null;
  const prepared=hybridContext(p),q=Math.exp(regress(model.power,prepared.c))*analytic*rise;
  if(!Number.isFinite(q))return null;
  const {nx,ny,nz}=model.grid,r=p.room,spacing=[r.length/nx,r.width/ny,r.height/nz],origin=spacing.map(v=>v/2);
  const bytes=new Uint8Array(nx*ny*nz*4),view=new DataView(bytes.buffer),boxes=[...p.furniture,heaterBox(p)];
  let min=Infinity,max=-Infinity,total=0,count=0;
  for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const point=[origin[0]+i*spacing[0],origin[1]+j*spacing[1],origin[2]+k*spacing[2]];
    const inside=boxes.some(b=>point[0]>=b.x&&point[0]<=b.x+b.l&&point[1]>=b.y&&point[1]<=b.y+b.w&&point[2]>=b.z&&point[2]<=b.z+b.h);
    const value=inside?NaN:p.outdoor_temp+rise*(1+regress(model.field,hybridFeatures(p,point,prepared)));
    view.setFloat32(4*(i+nx*(j+ny*k)),value,true);
    if(Number.isFinite(value)){min=Math.min(min,value);max=Math.max(max,value);total+=value;count++;}
  }
  if(!count)return null;
  return {source:'hybrid' as const,grid:{nx,ny,nz,origin,spacing},
    T:{data:btoa(String.fromCharCode(...bytes)),min,max,mean:total/count},
    kpi:{room_average_c:total/count,heat_loss_w:q,energy_balance_error:NaN,solve_wall_time_s:0,cell_count:0,
      rated_power_w:p.heater.power_w,cfd_heater_power_w:q,analytic_effective_power_w:analytic*rise,
      thermostat_iterations:0,duty_cycle:Math.min(1,q/p.heater.power_w),insufficient_power:q>p.heater.power_w}};
}
