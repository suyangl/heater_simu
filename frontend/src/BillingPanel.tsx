import {useEffect,useMemo,useState} from 'react';
import {BILLING_STORAGE,CAPACITY,Colour,Inertia,Price,Profile,TariffKind,TariffPeriod,calibratedUA,compareTariffs,newProfile,restoreSettings,simulateSeason} from './billing';
import {Project,Table} from './s1';
import {analyticBreakdown,analyticUA} from './envelope';
import {PlannerPanel} from './PlannerPanel';
import {useLanguage} from './Language';
import './billing.css';

const COLOURS:Colour[]=['blue','white','red'];
const PERIOD_COLOUR:Record<TariffPeriod,string>={base:'#087f75',hp:'#98540b',hc:'#225ca8',custom:'#7550a0',
  blue_hp:'#17458b',blue_hc:'#5a87b8',white_hp:'#63676a',white_hc:'#9ba5ad',red_hp:'#af243b',red_hc:'#df7181'};
const priceValue=(value:string):Price=>value.trim()===''?null:Number(value);
function PriceInput({label,value,onChange}:{label:string;value:Price;onChange:(v:Price)=>void}) {
  return <label>{label}<input type="number" min="0" step="0.001" value={value??''} onChange={e=>onChange(priceValue(e.target.value))}/></label>;
}
export function BillingPanel({project,table,result,source,onProjectChange}:{project:Project;table:Table|null;onProjectChange:(p:Project)=>void;
  result:{kpi:{heat_loss_w:number;not_settled?:boolean}}|null;source:'CFD'|'S1'|'analytic'}) {
  const {t,language}=useLanguage();
  const [settings,setSettings]=useState(()=>{
    try{return restoreSettings(localStorage.getItem(BILLING_STORAGE),project.heater.setpoint_c);}
    catch{return restoreSettings(null,project.heater.setpoint_c);}
  });
  const [storageError,setStorageError]=useState(false),[fillPrice,setFillPrice]=useState<Price>(null),[chart,setChart]=useState('kwh');
  useEffect(()=>{try{localStorage.setItem(BILLING_STORAGE,JSON.stringify(settings));setStorageError(false);}catch{setStorageError(true);}},[settings]);
  const profile=settings.profiles.find(p=>p.id===settings.active)!;
  const nameOf=(p:Profile)=>p.name||t('billing.unnamed',{n:settings.profiles.indexOf(p)+1});
  const update=(patch:Partial<Profile>)=>setSettings(s=>({...s,profiles:s.profiles.map(p=>p.id===s.active?{...p,...patch}:p)}));
  const analytic=analyticUA(project,table);
  const rawUA=calibratedUA(result?.kpi.heat_loss_w,project.heater.setpoint_c,project.outdoor_temp,analytic);
  const effective=rawUA*analyticUA(project,table,settings.envelope)/analytic;
  const plannerInput=useMemo(()=>({project,settings,calibratedUA:rawUA,analytic:analyticBreakdown(project,table),table}),[project,settings,rawUA,table]);
  const calibrated=!!result&&Number.isFinite(result.kpi.heat_loss_w)&&result.kpi.heat_loss_w>0&&project.heater.setpoint_c>project.outdoor_temp;
  const comfort=settings.followProject?project.heater.setpoint_c:settings.schedule.comfort;
  const simulated=useMemo(()=>{
    const start=performance.now();
    try{return {data:simulateSeason({ua:effective,area:project.room.length*project.room.width,ratedPower:project.heater.power_w,
      inertia:settings.inertia,capacityPerArea:settings.capacityPerArea??undefined,climate:settings.climate,schedule:{...settings.schedule,comfort}}),
      elapsed:performance.now()-start,error:null};}
    catch(error){return {data:null,elapsed:performance.now()-start,error:error instanceof Error?error.message:'billing.invalidModel'};}
  },[effective,project.room.length,project.room.width,project.heater.power_w,settings.inertia,settings.capacityPerArea,settings.climate,settings.schedule,comfort]);
  const comparison=useMemo(()=>simulated.data?compareTariffs(simulated.data,settings.profiles,project.heater.power_w):[],
    [simulated.data,settings.profiles,project.heater.power_w]);
  const bill=comparison.find(r=>r.id===settings.active);
  const fmt=(v:number|null|undefined,digits=1)=>v===null||v===undefined||!Number.isFinite(v)?'—':
    new Intl.NumberFormat(language==='zh'?'zh-CN':'en-GB',{maximumFractionDigits:digits,minimumFractionDigits:digits}).format(v);
  const monthName=(m:number)=>t('billing.month',{month:m});
  const periodName=(p:TariffPeriod)=>t('billing.period.'+p);
  const tempoChanged=bill&&COLOURS.some(c=>bill.split[c].days!==profile.days[c]);
  const monthlyMax=Math.max(1,...(bill?.monthly.map(m=>chart==='kwh'?m.kwh:m.total??0)??[]));
  const powerMax=Math.max(1,...(bill?.typical.map(h=>h.power)??[]));
  return <><section className="billing" aria-label={t('billing.title')} data-rc-ms={simulated.elapsed.toFixed(3)}>
    <div className="row"><h2>{t('billing.title')}</h2><span className="billing-badge">{t('billing.local')}</span></div>
    <p>{t('billing.model',{ua:fmt(effective,2),source:t('billing.source.'+(calibrated?source:'analytic')),capacity:fmt((settings.capacityPerArea??CAPACITY[settings.inertia])/1000,0)})}</p>
    <p className="hint">{t('billing.assumptions')}</p>
    {settings.envelope&&<p className="billing-warning">{t('planner.appliedModifiers',{window:fmt(settings.envelope.windowFactor,3),ach:fmt(settings.envelope.achFactor,3)})}{' '}
      <button onClick={()=>setSettings(s=>({...s,envelope:undefined}))}>{t('planner.resetModifiers')}</button></p>}
    {result?.kpi.not_settled&&<p className="billing-warning">{t('billing.unsettled')}</p>}
    {storageError&&<p role="alert" className="billing-warning">{t('billing.storageError')}</p>}
    <div className="billing-editor">
      <div className="billing-fields">
        <label>{t('billing.profile')}<select value={settings.active} onChange={e=>setSettings(s=>({...s,active:e.target.value}))}>{settings.profiles.map(p=><option key={p.id} value={p.id}>{nameOf(p)}</option>)}</select></label>
        <label>{t('billing.name')}<input type="text" maxLength={60} value={profile.name} placeholder={nameOf(profile)} onChange={e=>update({name:e.target.value})}/></label>
        <label>{t('billing.tariff')}<select value={profile.kind} onChange={e=>update({kind:e.target.value as TariffKind})}>{(['base','hphc','tempo','custom'] as const).map(kind=><option key={kind} value={kind}>{t('billing.kind.'+kind)}</option>)}</select></label>
        <PriceInput label={t('billing.subscription')} value={profile.subscription} onChange={subscription=>update({subscription})}/>
        <PriceInput label={t('billing.kva')} value={profile.kva} onChange={kva=>update({kva})}/>
      </div>
      <div className="billing-actions"><button onClick={()=>{const p=newProfile(crypto.randomUUID(),'');setSettings(s=>({...s,profiles:[...s.profiles,p],active:p.id}));}}>{t('billing.add')}</button>
        <button disabled={settings.profiles.length===1} onClick={()=>setSettings(s=>({...s,profiles:s.profiles.filter(p=>p.id!==s.active),active:s.profiles.find(p=>p.id!==s.active)!.id}))}>{t('billing.delete')}</button></div>
      <div className="billing-fields">
        {profile.kind==='base'&&<PriceInput label={t('billing.basePrice')} value={profile.base} onChange={base=>update({base})}/>}
        {profile.kind==='hphc'&&(['hp','hc'] as const).map(period=><PriceInput key={period} label={t('billing.price',{period:periodName(period)})} value={profile[period]} onChange={value=>update({[period]:value})}/>)}
        {profile.kind==='tempo'&&COLOURS.map(colour=><div key={colour} className="billing-colour"><b>{t('billing.colour.'+colour)}</b>
          {(['hp','hc'] as const).map(period=><PriceInput key={period} label={t('billing.price',{period:periodName(period)})} value={profile.tempo[colour][period]} onChange={value=>update({tempo:{...profile.tempo,[colour]:{...profile.tempo[colour],[period]:value}}})}/>)}
          <label>{t('billing.requestedDays')}<input type="number" min="0" step="1" value={profile.days[colour]} onChange={e=>update({days:{...profile.days,[colour]:Number(e.target.value)}})}/></label></div>)}
      </div>
      {(profile.kind==='hphc'||profile.kind==='tempo')&&<div className="billing-periods"><p>{t('billing.hcPeriods')}</p>
        {profile.periods.map((period,i)=><div className="billing-actions" key={i}>
          <label>{t('billing.start',{n:i+1})}<input type="time" step="3600" value={period.start} onChange={e=>update({periods:profile.periods.map((p,j)=>j===i?{...p,start:e.target.value}:p)})}/></label>
          <label>{t('billing.end',{n:i+1})}<input type="time" step="3600" value={period.end} onChange={e=>update({periods:profile.periods.map((p,j)=>j===i?{...p,end:e.target.value}:p)})}/></label>
          <button onClick={()=>update({periods:profile.periods.filter((_,j)=>j!==i)})}>{t('billing.removePeriod')}</button></div>)}
        <button disabled={profile.periods.length>=2} onClick={()=>update({periods:[...profile.periods,{start:'12:00',end:'14:00'}]})}>{t('billing.addPeriod')}</button></div>}
      {profile.kind==='custom'&&<details><summary>{t('billing.customGrid')}</summary>
        <div className="billing-actions"><PriceInput label={t('billing.fillRate')} value={fillPrice} onChange={setFillPrice}/><button disabled={fillPrice===null||fillPrice<0} onClick={()=>update({grid:Array.from({length:7},()=>Array<Price>(24).fill(fillPrice))})}>{t('billing.fillGrid')}</button></div>
        <div className="billing-scroll"><table className="billing-grid"><thead><tr><th>{t('billing.dayHour')}</th>{Array.from({length:24},(_,h)=><th key={h}>{h}:00</th>)}</tr></thead>
          <tbody>{profile.grid.map((row,d)=><tr key={d}><th>{t('billing.day.'+d)}</th>{row.map((value,h)=><td key={h}><input aria-label={t('billing.gridCell',{day:t('billing.day.'+d),hour:h})} type="number" min="0" step=".001" value={value??''} onChange={e=>update({grid:profile.grid.map((r,day)=>day===d?r.map((v,hour)=>hour===h?priceValue(e.target.value):v):r)})}/></td>)}</tr>)}</tbody></table></div>
      </details>}
      <p className="hint">{t('billing.manualPrices')}</p>
    </div>
    {simulated.error&&<p className="error" role="alert">{t(simulated.error)}</p>}
    {bill&&simulated.data&&<>
      {bill.error&&<p className="billing-warning" role="status">{t(bill.error)}</p>}
      {bill.kvaWarning&&<p className="billing-warning" role="alert">{t('billing.kvaWarning')}</p>}
      <div className="billing-kpis">
        {[
          ['billing.energy',fmt(bill.kwh),'kWh'],['billing.energyCost',fmt(bill.energy,2),'€'],
          ['billing.subscriptionCost',fmt(bill.subscription,2),'€'],['billing.total',fmt(bill.total,2),'€'],
          ['billing.averagePower',fmt(simulated.data.averagePower,0),'W'],['billing.perArea',fmt(bill.perArea,2),'€/m²'],
          ['billing.comfortRate',fmt(simulated.data.comfortRate),'%'],
        ].map(([label,value,unit])=><div key={label}><span>{t(label)}</span><strong>{value}<small> {unit}</small></strong></div>)}
      </div>
      <p className="hint">{t('billing.comfortNote')}</p>
      <div className="billing-charts">
        <div><div className="row"><h3>{t('billing.monthly')}</h3><label>{t('billing.chartUnit')}<select value={chart} onChange={e=>setChart(e.target.value)}><option value="kwh">kWh</option><option value="eur">€</option></select></label></div>
          {chart==='eur'&&bill.total===null?<p>{t('billing.missingPrices')}</p>:<svg viewBox="0 0 480 190" role="img" aria-label={t('billing.monthly')}>
            <text x="4" y="14">{fmt(monthlyMax,0)} {chart==='kwh'?'kWh':'€'}</text><path d="M40 25V155H470" fill="none" stroke="#a8bec8"/>
            {bill.monthly.map((m,i)=>{const width=420/bill.monthly.length,x=45+i*width,height=(chart==='kwh'?m.kwh:m.total!)/monthlyMax*120;
              return <g key={m.month}><rect x={x+width*.15} y={155-height} width={width*.65} height={height} fill="#087f75"><title>{monthName(m.month)}: {fmt(m.kwh)} kWh / {fmt(m.total,2)} €</title></rect><text textAnchor="middle" x={x+width*.47} y="178">{monthName(m.month)}</text></g>;})}
          </svg>}
          <p className="hint">{t('billing.monthlyNote')}</p>
        </div>
        <div><h3>{t('billing.typical')}</h3><svg viewBox="0 0 480 190" role="img" aria-label={t('billing.typical')}>
          <text x="4" y="14">{fmt(powerMax,0)} W</text><path d="M40 25V155H470" fill="none" stroke="#a8bec8"/>
          {bill.typical.map((h,i)=>{const x=40+i*430/24,y=155-h.power/powerMax*120,next=155-(bill.typical[i+1]?.power??h.power)/powerMax*120;
            return <path key={i} d={`M${x} ${y}H${x+430/24}V${next}`} fill="none" strokeWidth="3" stroke={PERIOD_COLOUR[h.period]}><title>{t('billing.hour',{hour:h.hour})}: {fmt(h.power,0)} W · {periodName(h.period)} · {fmt(h.price,3)} €/kWh</title></path>;})}
          {[0,6,12,18,24].map(h=><text key={h} textAnchor="middle" x={40+h*430/24} y="178">{h}:00</text>)}
        </svg><div className="billing-legend">{[...new Set(bill.typical.map(h=>h.period))].map(period=><span key={period}><i style={{background:PERIOD_COLOUR[period]}}/>{periodName(period)}</span>)}</div><p className="hint">{t('billing.typicalNote')}</p></div>
      </div>
      {profile.kind==='tempo'&&<div className="billing-tempo"><h3>{t('billing.tempoSplit')}</h3>{COLOURS.map(c=><p key={c}>{t('billing.split',{colour:t('billing.colour.'+c),days:bill.split[c].days,kwh:fmt(bill.split[c].kwh),cost:fmt(bill.split[c].energy,2)})}</p>)}<p className="hint">{t('billing.tempoNote')}</p>{tempoChanged&&<p className="billing-warning">{t('billing.normalizedTempo')}</p>}</div>}
      <h3>{t('billing.comparison')}</h3>
      <div className="billing-scroll"><table className="billing-comparison"><thead><tr><th>{t('billing.profile')}</th><th>{t('billing.tariff')}</th><th>{t('billing.total')}</th></tr></thead>
        <tbody>{comparison.map((r,i)=><tr key={r.id} className={r.cheapest?'billing-cheapest':''}><td><button onClick={()=>setSettings(s=>({...s,active:r.id}))}>{nameOf(settings.profiles[i])}</button></td><td>{t('billing.kind.'+settings.profiles[i].kind)}</td><td>{fmt(r.total,2)} € {r.cheapest&&<b>{t('billing.cheapest')}</b>}</td></tr>)}</tbody></table></div>
    </>}
    <details className="billing-assumptions"><summary>{t('billing.climateSchedule')}</summary>
      <h3>{t('billing.climate')}</h3><p>{t('billing.climateNote')}</p>
      <div className="billing-month-inputs">{settings.climate.months.map((m,i)=><div key={m.month}>
        <label className="billing-checkbox"><input type="checkbox" checked={m.enabled} onChange={e=>setSettings(s=>({...s,climate:{...s.climate,months:s.climate.months.map((v,j)=>j===i?{...v,enabled:e.target.checked}:v)}}))}/>{monthName(m.month)}</label>
        <label>{t('billing.outdoorMean')}<input type="number" step=".1" value={m.mean} onChange={e=>setSettings(s=>({...s,climate:{...s.climate,months:s.climate.months.map((v,j)=>j===i?{...v,mean:Number(e.target.value)}:v)}}))}/></label>
      </div>)}</div>
      <div className="billing-fields"><label>{t('billing.amplitude')}<input type="number" min="0" step=".1" value={settings.climate.amplitude} onChange={e=>setSettings(s=>({...s,climate:{...s.climate,amplitude:Number(e.target.value)}}))}/></label>
        <label>{t('billing.inertia')}<select value={settings.inertia} onChange={e=>setSettings(s=>({...s,inertia:e.target.value as Inertia,capacityPerArea:null}))}>{(['light','medium','heavy'] as const).map(v=><option key={v} value={v}>{t('billing.inertia.'+v)}</option>)}</select></label>
        <label>{t('billing.capacity')}<input type="number" min="1" step="1000" value={settings.capacityPerArea??CAPACITY[settings.inertia]} onChange={e=>setSettings(s=>({...s,capacityPerArea:priceValue(e.target.value)}))}/></label>
        <label>{t('billing.comfort')}<input type="number" step=".5" value={comfort} onChange={e=>setSettings(s=>({...s,followProject:false,schedule:{...s.schedule,comfort:Number(e.target.value)}}))}/></label>
        <label>{t('billing.eco')}<input type="number" step=".5" value={settings.schedule.eco} onChange={e=>setSettings(s=>({...s,schedule:{...s.schedule,eco:Number(e.target.value)}}))}/></label>
      </div>
      <label className="billing-checkbox"><input type="checkbox" checked={settings.followProject} onChange={e=>setSettings(s=>({...s,followProject:e.target.checked}))}/>{t('billing.followProject')}</label>
      <p>{t('billing.scheduleNote')}</p>
      {(['weekdays','weekends'] as const).map(pattern=><fieldset className="billing-pattern" key={pattern}><legend>{t('billing.'+pattern)}</legend>
        {settings.schedule[pattern].map((checked,h)=><label key={h} className={checked?'is-comfort':''}><span>{h}:00</span><input type="checkbox" checked={checked} aria-label={t('billing.scheduleHour',{day:t('billing.'+pattern),hour:h})} onChange={e=>setSettings(s=>({...s,schedule:{...s.schedule,[pattern]:s.schedule[pattern].map((v,j)=>j===h?e.target.checked:v)}}))}/></label>)}
      </fieldset>)}
    </details>
  </section><PlannerPanel input={plannerInput} onApply={state=>{
    setSettings(state.settings);
    if(JSON.stringify(state.project)!==JSON.stringify(project))onProjectChange(state.project);
  }}/></>;
}
