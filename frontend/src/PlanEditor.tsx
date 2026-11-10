import {PointerEvent as ReactPointerEvent,useEffect,useRef,useState} from 'react';
import {Project,Wall,openingsOf,exteriorOf} from './s1';
import {useLanguage} from './Language';
import {formatError} from './i18n';
import {furnitureDefaults,kindLabel,migrateKind} from './furniture';
import {Point,Selection,addFurniture,along,dragOpening,heaterBox,moveBox,placeHeater,removeSelected,resizeBox,resizeRoom,rotateBox,validatePlan} from './plan';
import './plan.css';
type Drag={id:Selection;mode:string;point:Point;start:Project;latest:Project;grab:number};
type Props={project:Project;selected:Selection|null;disabled:boolean;canUndo:boolean;canRedo:boolean;
  onSelect:(id:Selection|null)=>void;onPreview:(p:Project|null)=>void;onCommit:(p:Project)=>void;onUndo:()=>void;onRedo:()=>void};
export function PlanEditor({project:p,selected,disabled,canUndo,canRedo,onSelect,onPreview,onCommit,onUndo,onRedo}:Props){
  const {t,language}=useLanguage(),[snapping,setSnapping]=useState(true),[kind,setKind]=useState('bed'),[dragging,setDragging]=useState(false);
  const svg=useRef<SVGSVGElement>(null),group=useRef<SVGGElement>(null),drag=useRef<Drag|null>(null);
  const issues=validatePlan(p),base=dragging&&drag.current?drag.current.start.room:p.room;
  const L=Number.isFinite(base.length)?Math.max(2,base.length):4,W=Number.isFinite(base.width)?Math.max(2,base.width):3.5;
  const index=selected?Number(selected.split('-')[1]):-1,isBox=selected?.startsWith('furniture-')&&!!p.furniture[index];
  const label=(id:Selection)=>{
    if(id==='room')return t('房间');if(id==='heater')return t('对流式暖器');
    const i=Number(id.split('-')[1]);
    return id.startsWith('furniture-')?(p.furniture[i]?.name||t(kindLabel[migrateKind(p.furniture[i]?.kind)]))+' '+(i+1):
      t(openingsOf(p)[i]?.type==='door'?'门':'窗户')+' '+(i+1);
  };
  const point=(e:{clientX:number;clientY:number}):Point=>{
    const pt=new DOMPoint(e.clientX,e.clientY).matrixTransform(group.current!.getScreenCTM()!.inverse());
    return {x:pt.x,y:pt.y};
  };
  const start=(e:ReactPointerEvent,id:Selection,mode='move')=>{
    if(disabled||e.button!==0)return;
    e.stopPropagation();e.preventDefault();svg.current!.focus();onSelect(id);
    const pt=point(e);drag.current={id,mode,point:pt,start:p,latest:p,grab:along(pt,p.heater.wall)-p.heater.offset};
    setDragging(true);svg.current!.setPointerCapture(e.pointerId);
  };
  const move=(e:ReactPointerEvent)=>{
    const d=drag.current;if(!d)return;
    const pt=point(e),step=snapping&&!e.altKey ? .05 : 0,dx=pt.x-d.point.x,dy=pt.y-d.point.y;
    const i=Number(d.id.split('-')[1]);let next=d.start;
    if(d.id==='room')next=resizeRoom(d.start,d.mode==='north'?d.start.room.length:pt.x,d.mode==='east'?d.start.room.width:pt.y,step);
    else if(d.id==='heater')next=placeHeater(d.start,pt,step,d.grab);
    else if(d.id.startsWith('furniture-')){
      const b=d.start.furniture[i];
      next=d.mode==='move'?moveBox(d.start,i,b.x+dx,b.y+dy,step):resizeBox(d.start,i,d.mode,pt,step);
    }else {
      const o=openingsOf(d.start)[i];
      next=dragOpening(d.start,i,along(pt,o.wall)-along(d.point,o.wall),d.mode as 'move'|'start'|'end',step);
    }
    d.latest=next;onPreview(next);
  };
  const finish=(cancel=false)=>{
    const d=drag.current;if(!d)return;drag.current=null;setDragging(false);onPreview(null);
    if(!cancel)onCommit(d.latest);
  };
  const remove=()=>{if(selected){onCommit(removeSelected(p,selected));onSelect(null);}};
  useEffect(()=>{
    const handler=(e:KeyboardEvent)=>{
      if(disabled||(e.target instanceof Element&&e.target.closest('input,select,textarea,[contenteditable=true]')))return;
      if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){
        e.preventDefault();if(e.key.toLowerCase()==='y'||e.shiftKey)onRedo();else onUndo();
      }
    };
    window.addEventListener('keydown',handler);return ()=>window.removeEventListener('keydown',handler);
  },[disabled,onUndo,onRedo]);
  const style=(id:Selection)=>issues.some(i=>i.targets.includes(id)&&!i.warning)?'plan-invalid':
    issues.some(i=>i.targets.includes(id)&&i.warning)?'plan-warning':selected===id?'plan-selected':'';
  const openingShape=(wall:Wall,offset:number,width:number)=>{
    if(wall==='N'||wall==='S')return {x:offset,y:wall==='N'?p.room.width-.04:-.04,width,height:.08};
    return {x:wall==='E'?p.room.length-.04:-.04,y:offset,width:.08,height:width};
  };
  const handle=(x:number,y:number,id:Selection,mode:string)=><rect key={mode} data-handle={id+'-'+mode} className="plan-handle" x={x-.065} y={y-.065} width=".13" height=".13" onPointerDown={e=>start(e,id,mode)}/>;
  return <section className="plan-editor" aria-label={t('plan.title')}>
    <div className="row"><h2>{t('plan.title')}</h2><span>{p.room.length.toFixed(2)} × {p.room.width.toFixed(2)} m</span></div>
    <p>{t('plan.help')}</p>
    <div className="plan-toolbar">
      <button disabled={disabled||!canUndo} onClick={onUndo}>{t('plan.undo')}</button>
      <button disabled={disabled||!canRedo} onClick={onRedo}>{t('plan.redo')}</button>
      <label><input type="checkbox" checked={snapping} onChange={e=>setSnapping(e.target.checked)}/>{t('plan.snap')}</label>
      <label>{t('类型')}<select value={kind} disabled={disabled} onChange={e=>setKind(e.target.value)}>{Object.keys(furnitureDefaults).map(k=><option value={k} key={k}>{t(kindLabel[k])}</option>)}</select></label>
      <button disabled={disabled||p.furniture.length>=15} onClick={()=>{onCommit(addFurniture(p,kind));onSelect(`furniture-${p.furniture.length}`);}}>{t('plan.add')}</button>
      <button disabled={disabled||!isBox} onClick={()=>onCommit(rotateBox(p,index))}>{t('plan.rotate')}</button>
      <button disabled={disabled||!isBox||p.furniture.length>=15} onClick={()=>{onCommit(addFurniture(p,migrateKind(p.furniture[index].kind),p.furniture[index]));onSelect(`furniture-${p.furniture.length}`);}}>{t('plan.duplicate')}</button>
      <button disabled={disabled||!selected||['room','heater'].includes(selected)} onClick={remove}>{t('plan.delete')}</button>
    </div>
    <svg ref={svg} className="plan-canvas" role="application" aria-label={t('plan.canvas')} tabIndex={0} viewBox={`-.55 -.55 ${L+1.1} ${W+1.1}`}
      onPointerMove={move} onPointerUp={()=>finish()} onPointerCancel={()=>finish(true)} onLostPointerCapture={()=>finish(true)}
      onPointerDown={()=>onSelect(null)} onKeyDown={e=>{
        if(disabled)return;
        if(e.key==='Escape'){finish(true);return;}
        if(e.key==='Delete'||e.key==='Backspace'){if(selected){e.preventDefault();remove();}return;}
        if(!selected||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
        e.preventDefault();const dx=e.key==='ArrowLeft'?-.05:e.key==='ArrowRight'?.05:0,dy=e.key==='ArrowDown'?-.05:e.key==='ArrowUp'?.05:0;
        if(isBox)onCommit(moveBox(p,index,p.furniture[index].x+dx,p.furniture[index].y+dy,.05));
        else if(selected.startsWith('opening-')){const o=openingsOf(p)[index];if(o)onCommit(dragOpening(p,index,o.wall==='N'||o.wall==='S'?dx:dy));}
        else if(selected==='heater'){
          const h=heaterBox(p),pt={x:h.x+h.l/2+dx,y:h.y+h.w/2+dy};onCommit(placeHeater(p,pt));
        }
      }}>
      <defs><pattern id="metre-grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M 1 0 H 0 V 1" fill="none" stroke="#d2e1e5" strokeWidth=".012"/></pattern></defs>
      <g ref={group} transform={`translate(0,${W}) scale(1,-1)`}>
        <rect data-object="room" className={style('room')} width={Math.max(.01,p.room.length)} height={Math.max(.01,p.room.width)} fill="url(#metre-grid)" stroke="#526c79" strokeWidth=".035" onPointerDown={e=>{e.stopPropagation();onSelect('room');}}/>
        {(['N','S','E','W'] as Wall[]).map(w=>{
          const n=w==='N',s=w==='S',e=w==='E';
          return <line key={w} x1={n||s?0:e?p.room.length:0} y1={n?p.room.width:0} x2={n||s?p.room.length:e?p.room.length:0} y2={s?0:p.room.width} stroke={exteriorOf(p).includes(w)?'#254b58':'#a7bdc6'} strokeWidth=".045" pointerEvents="none"/>;
        })}
        <rect data-room-edge="east" x={p.room.length-.04} y={.15} width=".08" height={Math.max(.01,p.room.width-.3)} fill="transparent" cursor="ew-resize" onPointerDown={e=>start(e,'room','east')}/>
        <rect data-room-edge="north" x={.15} y={p.room.width-.04} width={Math.max(.01,p.room.length-.3)} height=".08" fill="transparent" cursor="ns-resize" onPointerDown={e=>start(e,'room','north')}/>
        {p.furniture.map((b,i)=>{
          const id:Selection=`furniture-${i}`;
          return <g key={id}><rect data-object={id} className={style(id)} x={b.x} y={b.y} width={Math.max(.01,b.l)} height={Math.max(.01,b.w)} fill="#d2e8e2" stroke="#2e7568" strokeWidth=".025" onPointerDown={e=>start(e,id)}/>
            <text x={0} y={0} transform={`translate(${b.x+.06},${b.y+b.w/2}) scale(1,-1)`} fontSize=".12" pointerEvents="none">{label(id)}</text>
            {selected===id&&[['sw',b.x,b.y],['se',b.x+b.l,b.y],['nw',b.x,b.y+b.w],['ne',b.x+b.l,b.y+b.w]].map(([c,x,y])=>handle(Number(x),Number(y),id,String(c)))}</g>;
        })}
        {openingsOf(p).map((o,i)=>{
          const id:Selection=`opening-${i}`,shape=openingShape(o.wall,o.offset,o.width),end=openingShape(o.wall,o.offset+o.width,0);
          return <g key={id}><rect data-object={id} {...shape} className={style(id)} fill={o.type==='window'?'#58b8d6':exteriorOf(p).includes(o.wall)?'#bc893d':'#977eb8'} stroke="#274b59" strokeWidth=".02" onPointerDown={e=>start(e,id)}/>
            {selected===id&&<>{handle(shape.x,shape.y,id,'start')}{handle(end.x,end.y,id,'end')}</>}</g>;
        })}
        {(()=>{const b=heaterBox(p);return <rect data-object="heater" className={style('heater')} x={b.x} y={b.y} width={Math.max(.01,b.l)} height={Math.max(.01,b.w)} fill="#ed9854" stroke="#8c4d1c" strokeWidth=".025" onPointerDown={e=>start(e,'heater')}/>;})()}
        {handle(p.room.length,p.room.width,'room','corner')}
        <text transform={`translate(${p.room.length/2},-.25) scale(1,-1)`} textAnchor="middle" fontSize=".13" fill="#274b59">{t('plan.x')}</text>
        <text transform={`translate(${p.room.length/2},${p.room.width+.25}) scale(1,-1)`} textAnchor="middle" fontSize=".13" fill="#274b59">{t('plan.north')}</text>
      </g>
    </svg>
    <p className="plan-selection" role="status">{selected?t('plan.selected',{name:label(selected)}):t('plan.noSelection')}</p>
    <ul className="plan-issues" aria-live="polite">{issues.map((i,n)=><li key={n} className={i.warning?'plan-warning-text':'plan-error-text'}>
      <button onClick={()=>onSelect(i.targets[0])}>{i.targets.map(label).join(' / ')}</button>{' · '}{i.message.startsWith('plan.')?t(i.message,i.params):formatError(i.message,language)}
    </li>)}</ul>
  </section>;
}
