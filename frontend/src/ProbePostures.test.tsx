import {describe,it,expect} from 'vitest';
import {SittingFigure} from './ProbePostures';
import {probePose,postureHeights,readProbe,sittingHeadRadius} from './probe';
import type {Project} from './s1';

describe('seated figure ceiling clearance',()=>{
  it('keeps rendered and sampled head/ankle points aligned on normal, tall and ceiling-height supports',()=>{
    for(const support of [0,.5,2.2,2.5]){
      const project={room:{length:4,width:3,height:2.5},heater:{setpoint_c:20},
        furniture:support?[{x:1,y:1,z:0,l:2,w:1,h:support}]:[]} as Project;
      const settings={posture:'sitting' as const,x:2,y:1.4},pose=probePose(settings,project);
      const figure=SittingFigure({pose,events:{onPointerDown:()=>{},onPointerMove:()=>{},onPointerUp:()=>{},onPointerCancel:()=>{}}});
      const inner=figure.props.children,head=inner.props.children[2];
      const headHeight=figure.props.position[1]+figure.props.scale*(inner.props.position[1]+head.props.position[1]);
      const heights=postureHeights(settings,project);
      expect(headHeight).toBeCloseTo(heights.head);
      expect(headHeight+sittingHeadRadius*figure.props.scale).toBeLessThanOrEqual(project.room.height);
      expect(pose.sittingScale).toBeGreaterThanOrEqual(0);
      expect(pose.sittingScale).toBeLessThanOrEqual(1);
      if(support<=.5)expect(pose.sittingScale).toBe(1);
      const leg=inner.props.children[1][0].props.children[1];
      const ankle=leg.props.b;
      const drawnAnkleHeight=figure.props.position[1]+figure.props.scale*(inner.props.position[1]+ankle[1]);
      const drawnAnkleX=pose.x+Math.cos(pose.yaw)*ankle[0]*pose.sittingScale+Math.sin(pose.yaw)*ankle[2]*pose.sittingScale;
      const drawnAnkleY=pose.y-Math.sin(pose.yaw)*ankle[0]*pose.sittingScale+Math.cos(pose.yaw)*ankle[2]*pose.sittingScale;
      expect(drawnAnkleHeight).toBeCloseTo(heights.ankle);
      expect(drawnAnkleX).toBeGreaterThanOrEqual(0);expect(drawnAnkleX).toBeLessThanOrEqual(project.room.length);
      expect(drawnAnkleY).toBeGreaterThanOrEqual(0);expect(drawnAnkleY).toBeLessThanOrEqual(project.room.width);
      const calls:number[][]=[];
      readProbe((x,y,z)=>{calls.push([x,y,z]);return {value:20,nearest:false};},project,settings);
      expect(calls[0][2]).toBeCloseTo(headHeight);
      expect(calls[1][0]).toBeCloseTo(pose.x+Math.sin(pose.yaw)*.36*pose.sittingScale);
      expect(calls[1][1]).toBeCloseTo(pose.y+Math.cos(pose.yaw)*.36*pose.sittingScale);
      expect(calls[1][2]).toBeCloseTo(drawnAnkleHeight);
    }
  });
});
