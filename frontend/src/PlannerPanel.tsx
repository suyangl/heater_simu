import {useEffect,useMemo,useState} from 'react';
import {useLanguage} from './Language';
import {Assumptions,Measure,PLANNER_STORAGE,PlannerInput,applyMeasures,evaluatePlanner,restorePlanner} from './planner';
import './planner.css';
export function PlannerPanel({input,onApply}:{input:PlannerInput;onApply:(state:ReturnType<typeof applyMeasures>)=>void}) {
  const {t,language}=useLanguage();
  const [preferences,setPreferences]=useState(()=>{try{return restorePlanner(localStorage.getItem(PLANNER_STORAGE));}catch{return restorePlanner(null);}});
  const [storageError,setStorageError]=useState(false),[applied,setApplied]=useState(false);
  useEffect(()=>{try{localStorage.setItem(PLANNER_STORAGE,JSON.stringify(preferences));setStorageError(false);}catch{setStorageError(true);}},[preferences]);
  const evaluated=useMemo(()=>{
    try{
      return {...evaluatePlanner(input,preferences),error:null};
    }catch(error){return {data:null,selected:[],combined:null,planError:null,error:error instanceof Error?error.message:'planner.unavailable'};}
  },[input,preferences]);
  const fmt=(value:number|null|undefined,digits=1)=>value===null||value===undefined||!Number.isFinite(value)?'—':
    new Intl.NumberFormat(language==='zh'?'zh-CN':'en-GB',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value);
  const title=(m:Measure)=>t('planner.measure.'+m.kind,{n:m.amount,target:m.kind==='tariff'?
    input.settings.profiles.find(p=>p.id===m.target)?.name||t('billing.unnamed',{n:input.settings.profiles.findIndex(p=>p.id===m.target)+1}):
    m.kind==='position'?t(({under_window:'窗下',beside_window:'外墙窗旁',opposite_wall:'对面内墙',interior_corner:'内墙角落'} as Record<string,string>)[m.target!]??m.target!):m.target});
  const apply=(state:ReturnType<typeof applyMeasures>)=>{onApply(state);setPreferences(p=>({...p,selected:[]}));setApplied(true);};
  const selected=evaluated.selected,combined=evaluated.combined;
  return <section className="planner" aria-label={t('planner.title')}>
    <div className="row"><h2>{t('planner.title')}</h2><span className="billing-badge">{t('planner.local')}</span></div>
    <p>{t('planner.note')}</p>
    <div className="billing-fields">{(['emission','curtains','film','draught'] as const).map(key=><label key={key}>{t('planner.assumption.'+key)}
      <input type="number" min={key==='emission'?0:.01} max={key==='emission'?undefined:1} step=".001" value={preferences.assumptions[key]} onChange={e=>setPreferences(p=>({...p,assumptions:{...p.assumptions,[key]:Number(e.target.value)} as Assumptions}))}/></label>)}</div>
    <p className="hint">{t('planner.factorNote')} <a href="https://base-empreinte.ademe.fr/" target="_blank" rel="noreferrer">{t('planner.ademe')}</a></p>
    {storageError&&<p className="billing-warning">{t('billing.storageError')}</p>}
    {applied&&<p className="planner-applied" role="status">{t('planner.applied')}</p>}
    {evaluated.error&&<p className="error" role="alert">{t(evaluated.error)}</p>}
    <button disabled={!preferences.selected.length} onClick={()=>{setPreferences(p=>({...p,selected:[]}));setApplied(false);}}>{t('planner.clearSelection')}</button>
    {evaluated.data&&<>
      {evaluated.planError&&<div className="planner-plan" role="alert">{t(evaluated.planError)}</div>}
      {combined&&
      <div className="planner-plan"><div className="row"><h3>{t('planner.myPlan',{n:selected.length})}</h3>
        <button disabled={!selected.length} onClick={()=>apply(combined.scenario)}>{t('planner.applyPlan')}</button></div>
        <p>{t('planner.combinedNote')}</p>
        <div className="billing-kpis">{[
          ['planner.savedEuros',fmt(combined.euros,2),'€'],['planner.savedEnergy',fmt(combined.kwh),'kWh'],
          ['planner.co2',fmt(combined.co2),'kgCO₂e'],['planner.comfort',fmt(combined.comfortPp),'pp'],
          ['planner.investment',fmt(combined.investment,2),'€'],['planner.payback',fmt(combined.payback),t('planner.seasons')],
        ].map(([label,value,unit])=><div key={label}><span>{t(label)}</span><strong>{value}<small> {unit}</small></strong></div>)}</div>
        <p>{t('planner.baseline',{kwh:fmt(evaluated.data.baseline.consumption.kwh),cost:fmt(evaluated.data.baseline.bill.total,2),ua:fmt(evaluated.data.baseline.ua,2)})}</p>
        {combined.comfortPp!==null&&combined.comfortPp<0&&<p className="billing-warning">{t('planner.comfortWarning')}</p>}
      </div>}
      <h3>{t('planner.ranking.'+evaluated.data.ranking)}</h3>
      <p className="hint">{t('planner.selectionNote')}</p>
      <div className="billing-scroll"><table className="planner-table"><thead><tr>
        {['choose','measure','savedEuros','savedEnergy','co2','comfort','investment','payback','action'].map(key=><th key={key}>{t('planner.'+key)}</th>)}
      </tr></thead><tbody>{evaluated.data.candidates.map(c=><tr key={c.measure.id} data-measure={c.measure.id}>
        <td><input type="checkbox" checked={selected.some(m=>m.id===c.measure.id)} aria-label={t('planner.selectMeasure',{measure:title(c.measure)})} onChange={e=>{
          setApplied(false);setPreferences(p=>({...p,selected:e.target.checked?[...selected.filter(m=>m.group!==c.measure.group).map(m=>m.id),c.measure.id]:selected.filter(m=>m.id!==c.measure.id).map(m=>m.id)}));
        }}/></td>
        <td><b>{title(c.measure)}</b><small>{t('planner.category.'+c.measure.category)}</small><p>{c.explanation[language]}</p>
          {(c.measure.kind==='setpoint'||c.measure.kind==='shorten'||c.measure.kind==='eco')&&<small className="planner-caution">{t('planner.lowerTarget')}</small>}
          {c.comfortPp!==null&&c.comfortPp<0&&<small className="planner-caution">{t('planner.comfortWarning')}</small>}</td>
        <td>{fmt(c.euros,2)} €</td><td>{fmt(c.kwh)} kWh</td><td>{fmt(c.co2)} kg</td><td>{fmt(c.comfortPp)} pp</td>
        <td><input type="number" min="0" step="1" value={preferences.costs[c.measure.id]??''} aria-label={t('planner.investmentFor',{measure:title(c.measure)})} onChange={e=>setPreferences(p=>({...p,costs:{...p.costs,[c.measure.id]:e.target.value===''?null:Math.max(0,Number(e.target.value))}}))}/></td>
        <td>{fmt(c.payback)} {t('planner.seasons')}</td><td><button onClick={()=>apply(c.apply())}>{t('planner.apply')}</button></td>
      </tr>)}</tbody></table></div>
      {evaluated.data.positionTip&&<p className="planner-tip">{t('planner.positionTip')}</p>}
    </>}
    <p className="planner-tip">{t('planner.qualitative')}</p>
    <p>{t('planner.funding')} <a href="https://www.maprimerenov.gouv.fr" target="_blank" rel="noreferrer">{t('planner.mpr')}</a>{' · '}
      <a href="https://www.ecologie.gouv.fr/politiques-publiques/dispositif-certificats-deconomies-denergie" target="_blank" rel="noreferrer">{t('planner.cee')}</a></p>
  </section>;
}
