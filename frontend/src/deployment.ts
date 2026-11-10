/// <reference types="vite/client" />
import {ApiError} from './i18n';

export function createDeployment(staticMode:boolean,fetcher:typeof fetch=fetch) {
  async function request(url:string,init?:RequestInit) {
    if(staticMode&&/^\/api(?:\/|$)/.test(new URL(url,'https://heatsimu.invalid').pathname))
      throw new Error('API requests are unavailable in the static demo');
    const res=await fetcher(url,init),data=await res.json();
    if(!res.ok)throw new ApiError(data.detail);
    return data;
  }
  async function loadArtifact() {
    if(staticMode)return request('/surrogate/s1-v1.json');
    return request('/api/surrogate/artifact').catch(()=>request('/surrogate/s1-v1.json'));
  }
  return {staticMode,request,loadArtifact,canSimulate:!staticMode,
    jobFromSearch:(search:string)=>staticMode?null:new URLSearchParams(search).get('job'),
    canPoll:(jobId:string|null)=>!staticMode&&!!jobId,
    showLayer:(layer:string)=>!staticMode||!['streamlines','iso','speedLegend'].includes(layer)};
}
export const deployment=createDeployment(import.meta.env.MODE==='static'||import.meta.env.VITE_STATIC==='1');
