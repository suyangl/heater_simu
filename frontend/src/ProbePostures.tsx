import {useEffect,useMemo,useRef,useState} from 'react';
import {useFrame} from '@react-three/fiber';
import type {ThreeEvent} from '@react-three/fiber';
import {Billboard,RoundedBox} from '@react-three/drei';
import * as THREE from 'three';
import {breathingScale,probePose} from './probe';

type Point=[number,number,number];
type Events={onPointerDown:(e:ThreeEvent<PointerEvent>)=>void;onPointerMove:(e:ThreeEvent<PointerEvent>)=>void;
  onPointerUp:(e:ThreeEvent<PointerEvent>)=>void;onPointerCancel:()=>void};
function Limb({a,b,radius=.028,lit=false}:{a:Point;b:Point;radius?:number;lit?:boolean}) {
  const from=new THREE.Vector3(...a),to=new THREE.Vector3(...b),direction=to.clone().sub(from);
  const quaternion=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.clone().normalize());
  return <mesh position={from.add(to).multiplyScalar(.5)} quaternion={quaternion}>
    <capsuleGeometry args={[radius,Math.max(.001,direction.length()-radius*2),4,10]}/>{lit?<meshStandardMaterial color="#000" roughness={.8}/>:<meshBasicMaterial color="#000"/>}
  </mesh>;
}
export function LyingFigure({pose,events}:{pose:ReturnType<typeof probePose>;events:Events}) {
  const torso=useRef<THREE.Group>(null),[reduced,setReduced]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const shadow=useMemo(()=>{
    const data=new Uint8Array(128*64*4);
    for(let y=0;y<64;y++)for(let x=0;x<128;x++){
      const d=((x-63.5)/56)**2+((y-31.5)/23)**2;
      data[(y*128+x)*4+3]=Math.round(70*Math.max(0,Math.exp(-3*d)-.012));
    }
    const texture=new THREE.DataTexture(data,128,64);texture.needsUpdate=true;return texture;
  },[]);
  useEffect(()=>()=>shadow.dispose(),[shadow]);
  useEffect(()=>{
    const query=window.matchMedia('(prefers-reduced-motion: reduce)'),change=()=>setReduced(query.matches);
    query.addEventListener('change',change);return ()=>query.removeEventListener('change',change);
  },[]);
  useFrame(({clock})=>{
    if(!torso.current)return;
    const scale=breathingScale(clock.elapsedTime,reduced);
    torso.current.scale.set(1,scale,1+(scale-1)*.6);
  });
  const scale=pose.length/1.7;
  return <group position={[pose.x,pose.support+.02,pose.y]} rotation={[0,pose.yaw,0]} scale={scale} {...events}>
    <mesh position={[0,-.014,0]} rotation={[-Math.PI/2,0,0]}>
      <planeGeometry args={[1.85,.65]}/><meshBasicMaterial map={shadow} transparent depthWrite={false}/>
    </mesh>
    <RoundedBox position={[-.63,.045,0]} args={[.46,.09,.42]} radius={.04} smoothness={4}>
      <meshStandardMaterial color="#fffdf4" roughness={1}/>
    </RoundedBox>
    <Billboard position={[-.63,.23,0]}>
      <mesh><sphereGeometry args={[.15,24,16]}/><meshStandardMaterial color="#F5C9A0" roughness={.85}/></mesh>
      <mesh scale={(.15+.07)/.15}><sphereGeometry args={[.15,24,16]}/><meshBasicMaterial color="#000" side={THREE.BackSide}/></mesh>
      {[-1,1].map(side=><mesh key={side} position={[side*.046,.025,.145]}><sphereGeometry args={[.012,8,8]}/><meshBasicMaterial color="#000"/></mesh>)}
      <mesh position={[0,-.025,.147]} rotation={[0,0,Math.PI]}><torusGeometry args={[.042,.007,8,20,Math.PI]}/><meshBasicMaterial color="#000"/></mesh>
    </Billboard>
    <Limb a={[-.5,.13,0]} b={[-.43,.12,0]} lit/>
    <group ref={torso} position={[0,.12,0]}><Limb a={[-.44,0,0]} b={[.1,0,0]} radius={.075} lit/></group>
    {[-1,1].map(side=><group key={side}>
      <Limb a={[-.4,.11,side*.075]} b={[-.31,.075,side*.15]} radius={.035} lit/>
      <Limb a={[-.31,.075,side*.15]} b={[.07,.075,side*.15]} radius={.035} lit/>
      <Limb a={[.09,.08,side*.065]} b={[.85,.055,side*.065]} radius={.035} lit/>
    </group>)}
  </group>;
}
export function SittingFigure({pose,events}:{pose:ReturnType<typeof probePose>;events:Events}) {
  const seat=pose.seat,head=seat+.68,knee=pose.support?seat:seat+.28,ankle=Math.max(.1,seat-.48);
  return <group position={[pose.x,0,pose.y]} rotation={[0,pose.yaw,0]} {...events}>
    <Limb a={[0,seat,0]} b={[0,seat+.55,0]}/>
    {[-1,1].map(side=><group key={side}>
      <Limb a={[side*.085,seat,0]} b={[side*.085,knee,.36]}/>
      <Limb a={[side*.085,knee,.36]} b={[side*.085,ankle,.36]}/>
      <Limb a={[side*.085,ankle,.36]} b={[side*.085,ankle,.47]}/>
      <Limb a={[side*.12,seat+.46,0]} b={[side*.17,(seat+.46+knee)/2,.16]}/>
      <Limb a={[side*.17,(seat+.46+knee)/2,.16]} b={[side*.12,knee+.045,.31]}/>
    </group>)}
    <Billboard position={[0,head,0]}>
      <mesh><sphereGeometry args={[.14,24,16]}/><meshBasicMaterial color="#F5C9A0"/></mesh>
      <mesh scale={(.14+.056)/.14}><sphereGeometry args={[.14,24,16]}/><meshBasicMaterial color="#000" side={THREE.BackSide}/></mesh>
      {[-1,1].map(side=><mesh key={side} position={[side*.046,.025,.13]}><sphereGeometry args={[.012,8,8]}/><meshBasicMaterial color="#000"/></mesh>)}
      <mesh position={[0,-.025,.136]} rotation={[0,0,Math.PI]}><torusGeometry args={[.042,.007,8,20,Math.PI]}/><meshBasicMaterial color="#000"/></mesh>
    </Billboard>
  </group>;
}
