import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {ProbeReadout} from './ProbeFigure';
import {translate} from './i18n';
import {ProbeReading} from './probe';

const reading={head:{value:19,nearest:false},ankle:{value:18.5,nearest:false},body:{value:19,nearest:false},
  delta:.5,comfort:'comfortable',warning:false} as ProbeReading;
describe('probe tooltip translations',()=>{
  it('uses the supplied current UI translator for head, ankle, comfort, lying and warning text',()=>{
    const t=(key:string)=>translate(key,'zh');
    const html=renderToStaticMarkup(<ProbeReadout reading={reading} lying={false} t={t}/>);
    for(const label of ['头部','脚踝','舒适'])expect(html).toContain(label);
    for(const label of ['Head','Ankle','Comfortable'])expect(html).not.toContain(label);
    const lying=renderToStaticMarkup(<ProbeReadout reading={{...reading,warning:true}} lying t={t}/>);
    expect(lying).toContain('身体');expect(lying).toContain('有冷风感');
    const english=renderToStaticMarkup(<ProbeReadout reading={reading} lying={false} t={key=>translate(key,'en')}/>);
    expect(english).toContain('Head');expect(english).toContain('Comfortable');
  });
});
