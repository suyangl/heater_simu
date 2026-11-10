import {Project,Table,ua} from './s1';
export type Envelope = {windowFactor:number;achFactor:number};
export const DEFAULT_AXES:Table['axes']={templates:[],positions:[],u_values:{A:[.15,.8],B:[.25,1.1],C:[.35,1.4],D:[.6,2],E:[1,2.8],F:[1.5,3.5],G:[2.2,5]},ach:{A:.3,B:.4,C:.5,D:.6,E:.7,F:.9,G:1.2}};
export const UNMODIFIED:Envelope={windowFactor:1,achFactor:1};
function axesFor(table:Table|null,envelope:Envelope,wall=1) {
  const base=table?.axes??DEFAULT_AXES;
  return {...base,u_values:Object.fromEntries(Object.entries({...DEFAULT_AXES.u_values,...base.u_values}).map(([dpe,[u,w]])=>[dpe,[u*wall,w*envelope.windowFactor] as [number,number]])),
    ach:Object.fromEntries(Object.entries({...DEFAULT_AXES.ach,...base.ach}).map(([dpe,value])=>[dpe,value*envelope.achFactor]))};
}
export function analyticUA(project:Project,table:Table|null,envelope:Envelope=UNMODIFIED) {
  return ua(project,{axes:axesFor(table,envelope)});
}
export function analyticBreakdown(project:Project,table:Table|null) {
  const total=analyticUA(project,table);
  const windows=total-analyticUA(project,table,{windowFactor:0,achFactor:1});
  const infiltration=total-analyticUA(project,table,{windowFactor:1,achFactor:0});
  const doors=ua(project,{axes:axesFor(table,{windowFactor:0,achFactor:0},0)});
  return {total,windows,infiltration,doors,opaque:total-windows-infiltration-doors};
}
