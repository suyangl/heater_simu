import {useLoader} from '@react-three/fiber';
import type {ThreeEvent} from '@react-three/fiber';
import {Billboard} from '@react-three/drei';
import * as THREE from 'three';
import {probePose} from './probe';

type Point=[number,number,number];
type Events={onPointerDown:(e:ThreeEvent<PointerEvent>)=>void;onPointerMove:(e:ThreeEvent<PointerEvent>)=>void;
  onPointerUp:(e:ThreeEvent<PointerEvent>)=>void;onPointerCancel:()=>void};
const lyingImage='data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80" viewBox="0 0 200 80">
<rect x="8" y="12" width="40" height="56" rx="9" fill="#fffdf4" stroke="#9bbcb5" stroke-width="2"/>
<g fill="none" stroke="#203b46" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
<path d="M49 40 H108 M59 40 L65 29 H103 M59 40 L65 51 H103 M108 35 H179 M108 45 H179"/>
</g><circle cx="33" cy="40" r="15" fill="#d9f4ec" stroke="#087f75" stroke-width="3"/>
<g fill="#203b46"><circle cx="29" cy="35" r="1.8"/><circle cx="38" cy="35" r="1.8"/></g>
<path d="M28 44 Q33 50 39 44" fill="none" stroke="#087f75" stroke-width="2" stroke-linecap="round"/></svg>`);
function Limb({a,b}:{a:Point;b:Point}) {
  const from=new THREE.Vector3(...a),to=new THREE.Vector3(...b),direction=to.clone().sub(from);
  const quaternion=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.clone().normalize());
  return <mesh position={from.add(to).multiplyScalar(.5)} quaternion={quaternion}>
    <cylinderGeometry args={[.028,.028,direction.length(),10]}/><meshBasicMaterial color="#203b46"/>
  </mesh>;
}
export function LyingFigure({pose,events}:{pose:ReturnType<typeof probePose>;events:Events}) {
  const texture=useLoader(THREE.TextureLoader,lyingImage);texture.colorSpace=THREE.SRGBColorSpace;
  return <group position={[pose.x,pose.support+.018,pose.y]} rotation={[0,pose.yaw,0]}>
    <mesh rotation={[-Math.PI/2,0,0]} {...events}>
      <planeGeometry args={[pose.length,pose.width]}/>
      <meshBasicMaterial map={texture} transparent side={THREE.DoubleSide} depthWrite={false} toneMapped={false}/>
    </mesh>
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
      <mesh><sphereGeometry args={[.14,24,16]}/><meshBasicMaterial color="#d9f4ec"/></mesh>
      <mesh scale={1.06}><sphereGeometry args={[.14,24,16]}/><meshBasicMaterial color="#087f75" side={THREE.BackSide}/></mesh>
      {[-1,1].map(side=><mesh key={side} position={[side*.046,.025,.13]}><sphereGeometry args={[.012,8,8]}/><meshBasicMaterial color="#203b46"/></mesh>)}
      <mesh position={[0,-.025,.136]} rotation={[0,0,Math.PI]}><torusGeometry args={[.042,.007,8,20,Math.PI]}/><meshBasicMaterial color="#087f75"/></mesh>
    </Billboard>
  </group>;
}
