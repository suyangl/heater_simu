import {describe,it,expect} from 'vitest';
import {defaultLayers,speedLegendVisible} from './ResultLayers';
describe('default layers',()=>{
  it('shows the temperature field immediately in the static demo only',()=>{
    expect(defaultLayers(true).slice).toBe(true);
    expect(defaultLayers(false).slice).toBe(false);
  });
  it('starts with the slice off while retaining the other layer defaults',()=>{
    expect(defaultLayers()).toEqual({walls:true,colors:true,streamlines:true,iso:true,slice:false});
  });
  it('allows enabling and disabling the slice without changing subsequent defaults',()=>{
    const layers=defaultLayers();
    layers.slice=true;expect(layers.slice).toBe(true);
    expect(defaultLayers().slice).toBe(false);
    layers.slice=false;expect(layers.slice).toBe(false);
  });
});
describe('speed legend visibility',()=>{
  it('shows an enabled legend when either speed layer is enabled',()=>{
    for(const layers of [{streamlines:true,iso:true},{streamlines:true,iso:false},{streamlines:false,iso:true}])
      expect(speedLegendVisible(true,layers)).toBe(true);
  });
  it('hides when explicitly disabled or when both speed layers are off',()=>{
    expect(speedLegendVisible(true,{streamlines:false,iso:false})).toBe(false);
    for(const streamlines of [false,true])for(const iso of [false,true])
      expect(speedLegendVisible(false,{streamlines,iso})).toBe(false);
  });
});
