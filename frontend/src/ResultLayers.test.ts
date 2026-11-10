import {describe,it,expect} from 'vitest';
import {speedLegendVisible} from './ResultLayers';
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
