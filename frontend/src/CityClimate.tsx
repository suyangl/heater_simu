import {useMemo,useState} from 'react';
import {Climate} from './billing';
import {City,MonthlyClimate,cityName,createCityClimateClient} from './cityClimate';
import {useLanguage} from './Language';

export function CityClimate({climate,onApply}:{climate:Climate;onApply:(data:MonthlyClimate,city:City)=>void}) {
  const {t,language}=useLanguage(),client=useMemo(()=>createCityClimateClient(),[]);
  const [query,setQuery]=useState(''),[cities,setCities]=useState<City[]>([]),[selected,setSelected]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(false),[searched,setSearched]=useState(false);
  async function search() {
    if(busy||query.trim().length<2)return;
    setBusy(true);setError(false);setSelected('');setCities([]);setSearched(false);
    try{setCities(await client.search(query,language));setSearched(true);}catch{setError(true);}finally{setBusy(false);}
  }
  async function apply() {
    if(busy)return;
    const city=cities.find(c=>String(c.id)===selected);if(!city)return;
    setBusy(true);setError(false);
    try{onApply(await client.load(city),city);}catch{setError(true);}finally{setBusy(false);}
  }
  return <div className="city-climate">
    <p>{t('climate.note')}</p>
    <form className="billing-fields" onSubmit={e=>{e.preventDefault();void search();}}>
      <label>{t('climate.city')}<input type="search" value={query} disabled={busy} onChange={e=>{
        setQuery(e.target.value);setCities([]);setSelected('');setSearched(false);setError(false);
      }}/></label>
      <button type="submit" disabled={busy||query.trim().length<2}>{t('climate.search')}</button>
    </form>
    {!!cities.length&&<div className="billing-fields"><label>{t('climate.result')}<select value={selected} disabled={busy} onChange={e=>setSelected(e.target.value)}>
      <option value="">{t('climate.choose')}</option>{cities.map(city=><option key={city.id} value={city.id}>{cityName(city)}</option>)}
    </select></label><button disabled={busy||!selected} onClick={()=>void apply()}>{t('climate.apply')}</button></div>}
    <div aria-live="polite">{busy&&<p>{t('climate.loading')}</p>}{searched&&!cities.length&&!busy&&<p>{t('climate.empty')}</p>}
      {error&&<p role="alert" className="billing-warning">{t('climate.failed')}</p>}
      {climate.source&&<p className="climate-source">{t('climate.source',{city:climate.source.city,start:climate.source.startYear,end:climate.source.endYear})}{climate.source.edited&&' '+t('climate.edited')}</p>}
    </div>
    <p className="hint"><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">{t('climate.attribution')}</a>{' · '}
      <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>{' · '}
      <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a></p>
  </div>;
}
