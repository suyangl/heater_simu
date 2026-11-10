import base64
import math
import struct

import pytest

from trainer.build_s1 import build, decode, interpolate, normalized_field, quantize, validate
from trainer.dataset import write_json
from trainer.doe import cases, load_definition
from app.models import Project


def result(project):
    return {'grid':{'nx':2,'ny':2,'nz':2,'origin':[0,0,0],'spacing':[8,8,8]},
            'T':{'data':base64.b64encode(struct.pack('<8f',*([19]*8))).decode(),'min':19,'max':19},
            'kpi':{'room_average_c':19,'energy_balance_error':.01,'insufficient_power':False,
                   'cfd_heater_power_w':project.thermal()['ua_total']*14*.5,
                   'air_density_min':1.18,'air_density_max':1.22}}


def test_quantization_mask_and_round_trip():
    values=[.5,1,1.1234,2,float('nan')]
    decoded=decode(quantize(values))
    assert decoded[:4]==pytest.approx(values[:4],abs=2/65534)
    assert math.isnan(decoded[-1])
    assert decode(quantize([1,1]))==[1,1]
    with pytest.raises(ValueError,match='finite'):
        quantize([float('nan')])


def test_partial_accepted_only_and_holdout_no_leakage(tmp_path):
    plan=cases();definition=load_definition()
    write_json(tmp_path/'manifest.json',{'definition':definition,'cases':plan})
    for case,status in [(plan[0],'accepted'),(plan[1],'rejected'),(plan[-1],'accepted')]:
        path=tmp_path/'cases'/case['id'];path.mkdir(parents=True)
        write_json(path/'metadata.json',{**case,'status':status})
        write_json(path/'result.json',result(Project.model_validate(case['project'])))
    artifact=build(tmp_path)
    assert len(artifact['availability'])==64
    assert sum(r['available'] for r in artifact['availability'])==1
    assert len(artifact['cases'])==1
    row=artifact['cases'][0]
    assert row['k']==pytest.approx(.5)
    assert artifact['validation']['holdout']['accepted']==1
    assert artifact['validation']['train']['scored']==0
    assert len(decode(row['theta']))==24*20*12
    assert all(abs(v-1)<1e-5 for v in decode(row['theta']) if math.isfinite(v))


def test_empty_snapshot_and_invalid_result_excluded(tmp_path):
    assert build(tmp_path)['cases']==[]
    case=cases()[0];path=tmp_path/'cases'/case['id'];path.mkdir(parents=True)
    write_json(path/'metadata.json',{**case,'status':'accepted'})
    write_json(path/'result.json',{})
    assert build(tmp_path)['cases']==[]


def test_u_interpolation_and_extrapolation():
    rows=[{'template':'t','position':'p','wall_u':u,'k':k,'theta':quantize([theta])}
          for u,k,theta in [(0.15,.5,1),(.35,.7,1.2)]]
    theta,k,bracketed=interpolate(rows,'t','p',.25)
    assert theta==pytest.approx([1.1]) and k==pytest.approx(.6) and bracketed
    theta,k,bracketed=interpolate(rows,'t','p',2.2)
    assert theta==pytest.approx([1.2]) and k==.7 and not bracketed
    assert interpolate(rows,'unknown','p',.25) is None


def test_invalid_temperature_grid_rejected():
    p=Project();r=result(p);r['grid']['nx']=3
    with pytest.raises(ValueError,match='length'):
        normalized_field(r,p)


def test_validation_theta_rmse_uses_dataset_delta_and_reports_cfd_mean_error():
    rows=[{'id':d,'split':'train','template':'t','position':'p','wall_u':u,'k':.5,
           'mean_c':mean,'theta':quantize([1,1])} for d,u,mean in [('A',.15,18.8),('C',.35,19.2)]]
    report=validate(rows,load_definition())['train']
    assert report['field_rmse_c']==0
    assert report['raw_cfd_field_rmse_c']==pytest.approx(.2)
    assert report['mean_temperature_mae_c']==pytest.approx(.2)
    assert report['mean_power_relative_error']==0
