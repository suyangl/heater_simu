import {describe,it,expect,vi} from 'vitest';
import {createDeployment} from './deployment';

describe('static deployment gating',()=>{
  it('allows bundled example flow layers without enabling solver or API access',()=>{
    const mode=createDeployment(true);
    for(const layer of ['streamlines','iso','speedLegend'])expect(mode.showLayer(layer,true)).toBe(true);
    expect(mode.canSimulate).toBe(false);expect(mode.canPoll('example')).toBe(false);
  });
  it('omits the redundant solver empty-state notice only in static mode',()=>{
    expect(createDeployment(true).showSolverEmptyState).toBe(false);
    expect(createDeployment(false).showSolverEmptyState).toBe(true);
  });
  it('loads only the bundled S1 artifact, ignores job links, and hides CFD actions/layers',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response('{"presets":{}}')),mode=createDeployment(true,fetcher);
    expect(await mode.loadArtifact()).toEqual({presets:{}});
    expect(fetcher.mock.calls.map(c=>c[0])).toEqual(['/surrogate/s1-v1.json']);
    expect(mode.jobFromSearch('?job=existing-cfd-job')).toBeNull();
    expect(mode.jobFromSearch('')).toBeNull();
    expect(mode.canPoll('existing-cfd-job')).toBe(false);
    expect(mode.canPoll(null)).toBe(false);
    expect(mode.canSimulate).toBe(false);
    for(const layer of ['streamlines','iso','speedLegend'])expect(mode.showLayer(layer)).toBe(false);
    for(const layer of ['walls','colors','slice','person'])expect(mode.showLayer(layer)).toBe(true);
  });
  it('blocks all API paths before fetch, including absolute URLs',async()=>{
    const fetcher=vi.fn(),mode=createDeployment(true,fetcher);
    for(const path of ['/api','/api/surrogate/artifact','/api/jobs/123','/api/jobs/123/result','/api/simulate','https://example.com/api/jobs']){
      await expect(mode.request(path)).rejects.toThrow('unavailable in the static demo');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reports a missing bundled artifact without attempting an API fallback',async()=>{
    const fetcher=vi.fn().mockRejectedValue(new Error('missing artifact'));
    await expect(createDeployment(true,fetcher).loadArtifact()).rejects.toThrow('missing artifact');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps local Docker API loading, job links, polling and simulation enabled',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response('{"version":1}')),mode=createDeployment(false,fetcher);
    expect(await mode.loadArtifact()).toEqual({version:1});
    expect(fetcher.mock.calls[0][0]).toBe('/api/surrogate/artifact');
    expect(mode.jobFromSearch('?job=abc')).toBe('abc');
    expect(mode.jobFromSearch('')).toBeNull();
    expect(mode.canPoll('abc')).toBe(true);
    expect(mode.canPoll(null)).toBe(false);
    expect(mode.canSimulate).toBe(true);
    expect(mode.showLayer('streamlines')).toBe(true);
  });
  it('retains the local artifact fallback and structured API errors',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response('{"detail":"offline"}',{status:503}))
      .mockResolvedValueOnce(new Response('{"version":1}'));
    expect(await createDeployment(false,fetcher).loadArtifact()).toEqual({version:1});
    expect(fetcher.mock.calls.map(c=>c[0])).toEqual(['/api/surrogate/artifact','/surrogate/s1-v1.json']);
    await expect(createDeployment(false,vi.fn().mockResolvedValue(new Response('{"detail":"invalid"}',{status:400})))
      .request('/api/simulate')).rejects.toMatchObject({detail:'invalid'});
  });
});
