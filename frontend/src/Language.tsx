import {createContext,useContext,useEffect,useState,ReactNode} from 'react';
import {initialLanguage,Language,Params,translate} from './i18n';
const Context=createContext<{language:Language;setLanguage:(v:Language)=>void;t:(key:string,params?:Params)=>string}|null>(null);
export function LanguageProvider({children}:{children:ReactNode}){
  const [language,setLanguage]=useState<Language>(()=>{let stored=null;try{stored=localStorage.getItem('heatsimu.language');}catch{}return initialLanguage(stored,navigator.language);});
  useEffect(()=>{document.documentElement.lang=language==='zh'?'zh-CN':'en';document.title=translate('HeatSimu · 房间热环境实验室',language);try{localStorage.setItem('heatsimu.language',language);}catch{}},[language]);
  return <Context.Provider value={{language,setLanguage,t:(key,params)=>translate(key,language,params)}}>{children}</Context.Provider>;
}
export function useLanguage(){const value=useContext(Context);if(!value)throw Error('LanguageProvider required');return value;}
