import {useEffect,useId,useMemo,useState} from 'react';
import {Climate} from './billing';
import {City,MonthlyClimate,cityName,createCityClimateClient} from './cityClimate';
import {Language} from './i18n';
import {useLanguage} from './Language';

export function CityClimate({climate,onApply}:{climate:Climate;onApply:(data:MonthlyClimate,city:City)=>void}) {
  const {t,language}=useLanguage(),client=useMemo(()=>createCityClimateClient(),[]),id=useId(),listId=id+'-cities';
  const [query,setQuery]=useState(climate.source?.city??''),[cities,setCities]=useState<City[]>([]);
  const [search,setSearch]=useState<{query:string;language:Language}|null>(null),[open,setOpen]=useState(false),[active,setActive]=useState(-1);
  const [searching,setSearching]=useState(false),[applying,setApplying]=useState(false),[error,setError]=useState(false),[searched,setSearched]=useState(false);
  useEffect(()=>{
    if(!search||search.query.trim().length<2){setSearching(false);return;}
    let current=true;
    const timer=window.setTimeout(()=>{
      setSearching(true);
      void client.search(search.query,search.language).then(results=>{
        if(current){setCities(results);setActive(results.length?0:-1);setSearched(true);setOpen(true);}
      }).catch(()=>{if(current)setError(true);}).finally(()=>{if(current)setSearching(false);});
    },300);
    return ()=>{current=false;window.clearTimeout(timer);};
  },[search,client]);
  useEffect(()=>{
    if(open&&active>=0)document.getElementById(listId+'-'+active)?.scrollIntoView?.({block:'nearest'});
  },[active,open,listId,cities]);
  async function apply(city:City) {
    if(applying)return;
    setSearch(null);setOpen(false);setCities([]);setQuery(cityName(city));setApplying(true);setError(false);setSearched(false);
    try{onApply(await client.load(city),city);}catch{setError(true);}finally{setApplying(false);}
  }
  const expanded=open&&cities.length>0;
  return <div className="city-climate">
    <p>{t('climate.note')}</p>
    <div className="city-combobox">
      <label htmlFor={id}>{t('climate.city')}</label>
      <input id={id} type="text" role="combobox" autoComplete="off" aria-autocomplete="list"
        aria-expanded={expanded} aria-controls={listId} aria-activedescendant={expanded&&active>=0?listId+'-'+active:undefined}
        aria-busy={searching||applying} placeholder={t('climate.placeholder')} value={query} disabled={applying}
        onFocus={()=>{if(cities.length)setOpen(true);}}
        onBlur={()=>{setOpen(false);setSearch(null);}}
        onChange={e=>{
          setQuery(e.target.value);setSearch({query:e.target.value,language});setCities([]);setActive(-1);
          setSearched(false);setError(false);setSearching(false);setOpen(true);
        }} onKeyDown={e=>{
          if(e.key==='Escape'){e.preventDefault();setOpen(false);setSearch(null);}
          else if(['ArrowDown','ArrowUp'].includes(e.key)&&cities.length){
            e.preventDefault();setOpen(true);
            setActive(i=>(i+(e.key==='ArrowDown'?1:cities.length-1)+cities.length)%cities.length);
          }else if(e.key==='Enter'&&expanded&&active>=0){e.preventDefault();void apply(cities[active]);}
        }}/>
      {expanded&&<ul id={listId} role="listbox" aria-label={t('climate.result')}>{cities.map((city,i)=><li
        key={city.id} id={listId+'-'+i} role="option" aria-selected={i===active}
        onMouseEnter={()=>setActive(i)} onMouseDown={e=>e.preventDefault()} onClick={()=>void apply(city)}>{cityName(city)}</li>)}</ul>}
    </div>
    <div aria-live="polite">{(searching||applying)&&<p>{t('climate.loading')}</p>}{searched&&!cities.length&&!searching&&!applying&&<p>{t('climate.empty')}</p>}
      {error&&<p role="alert" className="billing-warning">{t('climate.failed')}</p>}
      {climate.source&&<p className="climate-source">{t('climate.source',{city:climate.source.city,start:climate.source.startYear,end:climate.source.endYear})}{climate.source.edited&&' '+t('climate.edited')}</p>}
    </div>
    <p className="hint"><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">{t('climate.attribution')}</a>{' · '}
      <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>{' · '}
      <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a></p>
  </div>;
}
