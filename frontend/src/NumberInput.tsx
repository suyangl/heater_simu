import {InputHTMLAttributes,useEffect,useRef,useState} from 'react';

type Attributes=Omit<InputHTMLAttributes<HTMLInputElement>,'type'|'value'|'onChange'|'min'|'max'> & {min?:number;max?:number};
type Props=Attributes&({value:number;optional?:false;onValueChange:(value:number)=>void}|
  {value:number|null;optional:true;onValueChange:(value:number|null)=>void});
const display=(value:number|null)=>value===null||!Number.isFinite(value)?'':String(value);
function parse(draft:string,min?:number,max?:number) {
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(draft))return null;
  const value=Number(draft);
  return Number.isFinite(value)&&(min===undefined||value>=min)&&(max===undefined||value<=max)?value:null;
}
export function NumberInput(props:Props) {
  const {value,onValueChange,optional,min,max,step=1,onBlur,onKeyDown,...attributes}=props;
  const [draft,setDraft]=useState(()=>display(value)),committed=useRef(value);
  useEffect(()=>{
    if(value!==committed.current){committed.current=value;setDraft(display(value));}
  },[value]);
  const commit=(next:number)=>{committed.current=next;if(next!==value)onValueChange(next);};
  return <input {...attributes} type="text" inputMode="decimal" lang="en" data-numeric=""
    role="spinbutton" aria-valuenow={value??undefined} aria-valuemin={min} aria-valuemax={max}
    value={draft} onChange={e=>{
      const text=e.target.value.replace(/,/g,'.').replace(/^([+-]?)0+(?=\d)/,'$1');
      setDraft(text);
      if(text===''&&props.optional){committed.current=null;if(value!==null)props.onValueChange(null);}
      else {const next=parse(text,min,max);if(next!==null)commit(next);}
    }} onBlur={e=>{setDraft(display(value));onBlur?.(e);}} onKeyDown={e=>{
      onKeyDown?.(e);
      if(e.defaultPrevented||!['ArrowUp','ArrowDown'].includes(e.key))return;
      e.preventDefault();
      const increment=Number(step);if(!Number.isFinite(increment)||increment<=0)return;
      const next=Number(((parse(draft,min,max)??value??0)+(e.key==='ArrowUp'?increment:-increment)).toPrecision(12));
      const bounded=Math.max(min??-Infinity,Math.min(max??Infinity,next));
      if(Number.isFinite(bounded)){setDraft(display(bounded));commit(bounded);}
    }}/>;
}
