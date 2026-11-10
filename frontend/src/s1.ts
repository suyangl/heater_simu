export type Box = { x:number; y:number; z:number; l:number; w:number; h:number };
export type Wall = 'N'|'S'|'E'|'W';
export type Project = {room:{length:number;width:number;height:number};exterior_wall:Wall;window:{offset:number;width:number;height:number;sill:number};dpe:string;outdoor_temp:number;heater:{power_w:number;setpoint_c:number;wall:Wall;offset:number;z:number;length:number;depth:number;height:number};furniture:Box[]};
type Entry = {id:string;template:string;position:string;dpe:string;wall_u:number;k:number;theta:{min:number;scale:number;data:string}};
export type Table = {version:string;grid:{nx:number;ny:number;nz:number};tolerance_m:number;axes:{templates:string[];positions:string[];u_values:Record<string,[number,number]>;ach:Record<string,number>};presets:Record<string,Record<string,Project>>;cases:Entry[];availability:{available:boolean}[];validation?:unknown};
const cache = new WeakMap<Entry,Float32Array>();
function unpack(row:Entry) {
  let values=cache.get(row);
  if(values)return values;
  const bytes=Uint8Array.from(atob(row.theta.data),c=>c.charCodeAt(0)),view=new DataView(bytes.buffer);
  values=new Float32Array(bytes.length/2);
  for(let i=0;i<values.length;i++){const q=view.getUint16(i*2,true);values[i]=q===65535?NaN:row.theta.min+q*row.theta.scale;}
  cache.set(row,values);return values;
}
export function prepare(table:Table) {for(const row of table.cases)unpack(row);return table;}
export function ua(p:Project,table:Table) {
  const [wall,window]=table.axes.u_values[p.dpe]??[NaN,NaN],r=p.room;
  const area=(p.exterior_wall==='N'||p.exterior_wall==='S'?r.length:r.width)*r.height-p.window.width*p.window.height;
  return area>0?wall*area+window*p.window.width*p.window.height+.34*table.axes.ach[p.dpe]*r.length*r.width*r.height:NaN;
}
function close(a:unknown,b:unknown,tolerance:number):boolean {
  if(typeof a==='number'&&typeof b==='number')return Number.isFinite(a)&&Math.abs(a-b)<=tolerance;
  if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>close(v,b[i],tolerance));
  if(a&&b&&typeof a==='object'&&typeof b==='object')return Object.entries(a).every(([k,v])=>close(v,(b as Record<string,unknown>)[k],tolerance));
  return a===b;
}
function geometry(p:Project) {
  const {power_w:_,setpoint_c:__,...heater}=p.heater;
  return {room:p.room,exterior_wall:p.exterior_wall,window:p.window,heater,
    furniture:[...p.furniture].sort((a,b)=>a.x-b.x||a.y-b.y||a.z-b.z)};
}
export type Prediction = ReturnType<typeof predict>;
export function predict(p:Project,table:Table) {
  const started=performance.now();
  const unavailable=(reason:string)=>({confidence:'低' as const,reason,field:null,elapsed_ms:performance.now()-started,extrapolated:false});
  let match:{template:string;position:string}|undefined;
  for(const [template,positions] of Object.entries(table.presets))for(const [position,prototype] of Object.entries(positions)) {
    if(close(geometry(prototype),geometry(p),table.tolerance_m))match={template,position};
  }
  if(!match)return unavailable('房间、家具、窗户或暖器位置不匹配模板；无可用预估，请精算');
  const rise=p.heater.setpoint_c-p.outdoor_temp,analytic=ua(p,table);
  if(!(rise>0)||!Number.isFinite(analytic)||!(p.heater.power_w>0))return unavailable('仅支持有效的供热工况（设定温度高于室外）；请精算');
  const group=table.cases.filter(r=>r.template===match!.template&&r.position===match!.position).sort((a,b)=>a.wall_u-b.wall_u);
  if(!group.length)return unavailable('此模板 / 暖器位置尚无 accepted 数据；无可用预估，请精算');
  const u=table.axes.u_values[p.dpe][0],lower=group.filter(r=>r.wall_u<=u).at(-1)??group[0],upper=group.find(r=>r.wall_u>=u)??group.at(-1)!;
  const fraction=upper.wall_u===lower.wall_u?0:(u-lower.wall_u)/(upper.wall_u-lower.wall_u);
  const a=unpack(lower),b=unpack(upper),values=new Float32Array(a.length),view=new DataView(values.buffer);
  if(a.length!==table.grid.nx*table.grid.ny*table.grid.nz||b.length!==a.length)return unavailable('预估数据网格无效，请精算');
  let minimum=Infinity,maximum=-Infinity,total=0,count=0;
  for(let i=0;i<a.length;i++) {
    const t=p.outdoor_temp+rise*(a[i]+(b[i]-a[i])*fraction);
    view.setFloat32(i*4,t,true);
    if(Number.isFinite(t)){minimum=Math.min(minimum,t);maximum=Math.max(maximum,t);total+=t;count++;}
  }
  if(!count)return unavailable('预估数据无有效空气点，请精算');
  const q=(lower.k+(upper.k-lower.k)*fraction)*analytic*rise;
  const extrapolated=u<group[0].wall_u||u>group.at(-1)!.wall_u;
  const {nx,ny,nz}=table.grid,r=p.room;
  const field={source:'s1' as const,grid:{nx,ny,nz,origin:[r.length/nx/2,r.width/ny/2,r.height/nz/2],spacing:[r.length/nx,r.width/ny,r.height/nz]},
      T:{data:btoa(String.fromCharCode(...new Uint8Array(values.buffer))),min:minimum,max:maximum,mean:total/count},
      kpi:{room_average_c:total/count,heat_loss_w:q,energy_balance_error:NaN,solve_wall_time_s:0,cell_count:0,
        rated_power_w:p.heater.power_w,cfd_heater_power_w:q,analytic_effective_power_w:analytic*rise,thermostat_iterations:0,
        duty_cycle:Math.min(1,q/p.heater.power_w),insufficient_power:q>p.heater.power_w}};
  return {confidence:extrapolated?'中' as const:'高' as const,extrapolated,field,
    reason:extrapolated?'最近 DPE 邻居外推 · 部分数据表，建议精算校核':'模板匹配 · DPE 精确节点或 U 值区间内插值 · 实验性预估',
    elapsed_ms:performance.now()-started};
}
