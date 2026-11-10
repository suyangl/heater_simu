import {Box,Opening,Project,Wall,exteriorOf,openingsOf} from './s1';
import {furnitureDefaults} from './furniture';
export type Selection='room'|'heater'|`furniture-${number}`|`opening-${number}`;
export type Point={x:number;y:number};
export const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(Math.max(min,max),n));
export const snap=(n:number,step=.05)=>step>0?Number((Math.round(n/step)*step).toFixed(8)):n;
export const wallLength=(p:Project,w:Wall)=>w==='N'||w==='S'?p.room.length:p.room.width;
export const along=(point:Point,wall:Wall)=>wall==='N'||wall==='S'?point.x:point.y;
export function heaterBox(p:Project):Box {
  const h=p.heater;
  return {x:h.wall==='E'?p.room.length-h.depth:h.wall==='W'?0:h.offset,
    y:h.wall==='N'?p.room.width-h.depth:h.wall==='S'?0:h.offset,z:h.z,
    l:h.wall==='N'||h.wall==='S'?h.length:h.depth,w:h.wall==='N'||h.wall==='S'?h.depth:h.length,h:h.height};
}
export function fitBox(p:Project,b:Box):Box {
  const l=clamp(b.l,.08,p.room.length),w=clamp(b.w,.08,p.room.width);
  return {...b,l,w,x:clamp(b.x,0,p.room.length-l),y:clamp(b.y,0,p.room.width-w)};
}
export function moveBox(p:Project,index:number,x:number,y:number,step=.05):Project {
  return {...p,furniture:p.furniture.map((b,i)=>i===index?fitBox(p,{...b,x:snap(x,step),y:snap(y,step)}):b)};
}
export function resizeBox(p:Project,index:number,corner:string,point:Point,step=.05):Project {
  const b=p.furniture[index],east=corner.includes('e'),north=corner.includes('n');
  const x=clamp(snap(point.x,step),east?b.x+.08:0,east?p.room.length:b.x+b.l-.08);
  const y=clamp(snap(point.y,step),north?b.y+.08:0,north?p.room.width:b.y+b.w-.08);
  const next={...b,x:east?b.x:x,y:north?b.y:y,l:Math.max(.08,Number((east?x-b.x:b.x+b.l-x).toFixed(8))),w:Math.max(.08,Number((north?y-b.y:b.y+b.w-y).toFixed(8)))};
  return {...p,furniture:p.furniture.map((v,i)=>i===index?next:v)};
}
export function rotateBox(p:Project,index:number):Project {
  return {...p,furniture:p.furniture.map((b,i)=>i===index?fitBox(p,{...b,l:b.w,w:b.l}):b)};
}
export function updateOpening(p:Project,index:number,o:Opening):Project {
  if(p.openings)return {...p,openings:p.openings.map((v,i)=>i===index?o:v)};
  return {...p,window:{...p.window,offset:o.offset,width:o.width,height:o.height,sill:o.sill}};
}
export function dragOpening(p:Project,index:number,delta:number,mode:'move'|'start'|'end'='move',step=.05):Project {
  const o=openingsOf(p)[index],limit=wallLength(p,o.wall);
  if(mode==='move')return updateOpening(p,index,{...o,offset:clamp(snap(o.offset+delta,step),0,limit-o.width)});
  if(mode==='end')return updateOpening(p,index,{...o,width:clamp(snap(o.offset+o.width+delta,step)-o.offset,.2,limit-o.offset)});
  const end=o.offset+o.width,offset=clamp(snap(o.offset+delta,step),0,end-.2);
  return updateOpening(p,index,{...o,offset,width:Math.max(.2,Number((end-offset).toFixed(8)))});
}
export function placeHeater(p:Project,point:Point,step=.05,grab=p.heater.length/2):Project {
  const distances:[Wall,number][]=[['N',Math.abs(point.y-p.room.width)],['S',Math.abs(point.y)],['E',Math.abs(point.x-p.room.length)],['W',Math.abs(point.x)]];
  const wall=distances.sort((a,b)=>a[1]-b[1])[0][0];
  return {...p,heater:{...p.heater,wall,offset:clamp(snap(along(point,wall)-grab,step),0,wallLength(p,wall)-p.heater.length)}};
}
export function resizeRoom(p:Project,length:number,width:number,step=.05):Project {
  return {...p,room:{...p.room,length:clamp(snap(length,step),2,8),width:clamp(snap(width,step),2,8)}};
}
export function overlaps(a:Box,b:Box):boolean {
  return Math.min(a.x+a.l,b.x+b.l)-Math.max(a.x,b.x)>1e-8&&
    Math.min(a.y+a.w,b.y+b.w)-Math.max(a.y,b.y)>1e-8&&Math.min(a.z+a.h,b.z+b.h)-Math.max(a.z,b.z)>1e-8;
}
export function addFurniture(p:Project,kind:string,source?:Box):Project {
  if(p.furniture.length>=15)return p;
  const [l,w,h]=furnitureDefaults[kind]??furnitureDefaults.custom;
  let box=fitBox(p,source?{...source,x:source.x+.2,y:source.y+.2}:{kind,x:.2,y:.2,z:0,l,w,h});
  const occupied=[...p.furniture,heaterBox(p)];
  if(occupied.some(b=>overlaps(b,box))){
    search:for(let y=.1;y<=p.room.width-box.w;y+=.25)for(let x=.1;x<=p.room.length-box.l;x+=.25){
      const next={...box,x:snap(x),y:snap(y)};
      if(!occupied.some(b=>overlaps(b,next))){box=next;break search;}
    }
  }
  return {...p,furniture:[...p.furniture,box]};
}
export function removeSelected(p:Project,id:Selection):Project {
  if(id.startsWith('furniture-'))return {...p,furniture:p.furniture.filter((_,i)=>i!==Number(id.split('-')[1]))};
  if(id.startsWith('opening-'))return {...p,openings:openingsOf(p).filter((_,i)=>i!==Number(id.split('-')[1]))};
  return p;
}
export type History={past:Project[];present:Project;future:Project[]};
export const historyOf=(p:Project):History=>({past:[],present:structuredClone(p),future:[]});
export function commit(h:History,p:Project):History {
  return JSON.stringify(h.present)===JSON.stringify(p)?h:{past:[...h.past,h.present].slice(-100),present:structuredClone(p),future:[]};
}
export const undo=(h:History):History=>h.past.length?{past:h.past.slice(0,-1),present:h.past.at(-1)!,future:[h.present,...h.future]}:h;
export const redo=(h:History):History=>h.future.length?{past:[...h.past,h.present],present:h.future[0],future:h.future.slice(1)}:h;
export type Issue={targets:Selection[];message:string;warning?:boolean;params?:Record<string,string|number>};
export function validatePlan(p:Project):Issue[] {
  const issues:Issue[]=[],r=p.room,exterior=exteriorOf(p),openings=openingsOf(p);
  const issue=(targets:Selection[],message:string,warning=false)=>issues.push({targets,message,warning});
  const range=(target:Selection,field:string,n:number,min:number,max=Infinity)=>{
    if(!Number.isFinite(n)||n<min||n>max)issues.push({targets:[target],message:'plan.range',params:{field,min,max:max===Infinity?'∞':max}});
  };
  range('room','room.length',r.length,2,8);range('room','room.width',r.width,2,8);range('room','room.height',r.height,2,4);
  range('room','outdoor_temp',p.outdoor_temp,-30,35);
  if(!'ABCDEFG'.includes(p.dpe)||p.dpe.length!==1)issue(['room'],'plan.invalid');
  if(exterior.length<1||exterior.length>4||new Set(exterior).size!==exterior.length||exterior.some(w=>!['N','S','E','W'].includes(w)))issue(['room'],'plan.exterior');
  if(p.furniture.length>15||openings.length>24)issue(['room'],'plan.limits');
  const h=p.heater;
  for(const [field,value,min,max] of [['length',h.length,.2,2],['depth',h.depth,.08,.5],['height',h.height,.2,1.5],['z',h.z,0,Infinity],['offset',h.offset,0,Infinity],['power_w',h.power_w,Number.MIN_VALUE,2500],['setpoint_c',h.setpoint_c,5,30]] as [string,number,number,number][])range('heater','heater.'+field,value,min,max);
  if(!['N','S','E','W'].includes(h.wall))issue(['heater'],'plan.invalid');
  const boxes:[Selection,Box][]=[...p.furniture.map((b,i)=>[`furniture-${i}` as Selection,b] as [Selection,Box]),['heater',heaterBox(p)]];
  for(const [id,b] of boxes){
    if(id!=='heater'){
      for(const k of ['x','y','z'] as const)range(id,id+'.'+k,b[k],0);
      for(const k of ['l','w','h'] as const)range(id,id+'.'+k,b[k],.08);
      if((b.name?.length??0)>60)issue([id],'plan.nameLimit');
    }
    if(b.x<0||b.y<0||b.z<0||b.x+b.l>r.length+1e-8||b.y+b.w>r.width+1e-8||b.z+b.h>r.height+1e-8)issue([id],'家具或暖器超出房间');
  }
  boxes.forEach(([id,a],i)=>boxes.slice(i+1).forEach(([other,b])=>{if(overlaps(a,b))issue([id,other],'家具或暖器重叠');}));
  openings.forEach((o,i)=>{
    const id:Selection=`opening-${i}`;
    range(id,id+'.offset',o.offset,0);range(id,id+'.width',o.width,.2);range(id,id+'.height',o.height,.2);range(id,id+'.sill',o.sill,0);
    if(o.u_value!==undefined)range(id,id+'.u_value',o.u_value,Number.MIN_VALUE,7);
    if(!['window','door'].includes(o.type)||!['N','S','E','W'].includes(o.wall))issue([id],'plan.invalid');
    if(o.type==='door'&&o.sill!==0)issue([id],'门的离地高度 sill 必须为 0');
    if(o.offset+o.width>wallLength(p,o.wall)||o.sill+o.height>r.height)issue([id],'门窗超出墙面');
    if(o.type==='window'&&!exterior.includes(o.wall))issue([id],'窗户只能位于外墙');
    openings.slice(i+1).forEach((a,j)=>{
      if(o.wall===a.wall&&Math.min(o.offset+o.width,a.offset+a.width)>Math.max(o.offset,a.offset)+1e-8&&Math.min(o.sill+o.height,a.sill+a.height)>Math.max(o.sill,a.sill)+1e-8)issue([id,`opening-${i+j+1}`],'同一墙面的门窗重叠');
    });
    for(const [bid,b] of boxes){
      const horizontal=o.wall==='N'||o.wall==='S',lo=horizontal?b.y:b.x,hi=lo+(horizontal?b.w:b.l),side=o.wall==='N'?r.width:o.wall==='E'?r.length:0;
      const offset=horizontal?b.x:b.y,end=offset+(horizontal?b.l:b.w);
      if(Math.min(Math.abs(lo-side),Math.abs(hi-side))<1e-8&&Math.min(end,o.offset+o.width)>Math.max(offset,o.offset)&&Math.min(b.z+b.h,o.sill+o.height)>Math.max(b.z,o.sill))issue([id,bid],'家具或暖器遮挡门窗');
    }
  });
  const opaque=exterior.reduce((sum,w)=>sum+wallLength(p,w)*r.height,0)-openings.filter(o=>exterior.includes(o.wall)).reduce((sum,o)=>sum+o.width*o.height,0);
  if(opaque<=0)issue(['room'],'需要非零不透明外墙面积');
  const heater=heaterBox(p),front={...heater};
  if(h.wall==='N'){front.y-=.3;front.w+=.3;}if(h.wall==='S')front.w+=.3;
  if(h.wall==='E'){front.x-=.3;front.l+=.3;}if(h.wall==='W')front.l+=.3;
  p.furniture.forEach((b,i)=>{if(overlaps(b,front)&&!overlaps(b,heater))issue([`furniture-${i}`,'heater'],'plan.clearance',true);});
  return issues;
}
