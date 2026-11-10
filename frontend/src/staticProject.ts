import {matchPreset,predict,Project,Table} from './s1';
import {migrateProject} from './furniture';

export const STATIC_PROJECT_STORAGE='heatsimu.static.project.v1';
export function chooseStaticTemplate(table:Table) {
  const options=Object.entries(table.presets).flatMap(([template,positions])=>Object.entries(positions).map(([position,project])=>({
    template,position,project:migrateProject(structuredClone(project)),
    count:table.cases.filter(c=>c.template===template&&c.position===position).length
  }))).filter(option=>option.count>0).sort((a,b)=>b.count-a.count);
  return options.find(option=>predict(option.project,table).field)??null;
}
export function restoreStaticProject(raw:string|null):Project|null {
  try {
    const saved=JSON.parse(raw??'null');
    if(saved?.version!==1)return null;
    const p=saved.project as Project,wall=(v:unknown)=>['N','S','E','W'].includes(String(v));
    if(!p||!Array.isArray(p.furniture)||!wall(p.exterior_wall)||!['A','B','C','D','E','F','G'].includes(p.dpe))return null;
    const numbers=[p.room?.length,p.room?.width,p.room?.height,p.outdoor_temp,p.heater?.power_w,p.heater?.setpoint_c,
      p.heater?.offset,p.heater?.z,p.heater?.length,p.heater?.depth,p.heater?.height,
      p.window?.offset,p.window?.width,p.window?.height,p.window?.sill,
      ...p.furniture.flatMap(b=>[b.x,b.y,b.z,b.l,b.w,b.h])];
    if(!numbers.every(n=>typeof n==='number'&&Number.isFinite(n))||!wall(p.heater.wall)||
      ![p.room.length,p.room.width,p.room.height].every(n=>n>0))return null;
    if(p.exterior_walls&&!p.exterior_walls.every(wall))return null;
    if(p.openings&&!p.openings.every(o=>wall(o.wall)&&['window','door'].includes(o.type)&&
      [o.offset,o.width,o.height,o.sill].every(n=>typeof n==='number'&&Number.isFinite(n))))return null;
    return p;
  }catch{return null;}
}
export function staticProjectTemplate(project:Project,table:Table) {
  return matchPreset(project,table)??{template:'',position:'under_window'};
}
