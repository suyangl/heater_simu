from itertools import combinations
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Wall = Literal['N', 'S', 'E', 'W']
U_VALUES = {'A': (.15, .8), 'B': (.25, 1.1), 'C': (.35, 1.4),
            'D': (.6, 2), 'E': (1, 2.8), 'F': (1.5, 3.5), 'G': (2.2, 5)}
ACH = dict(zip('ABCDEFG', (.3, .4, .5, .6, .7, .9, 1.2)))


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Room(Model):
    length: float = Field(4, ge=2, le=8)
    width: float = Field(3.5, ge=2, le=8)
    height: float = Field(2.5, ge=2, le=4)


class Window(Model):
    offset: float = Field(1.2, ge=0)
    width: float = Field(1.2, ge=.2)
    height: float = Field(1.35, ge=.2)
    sill: float = Field(.9, ge=0)


class Box(Model):
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    z: float = Field(0, ge=0)
    l: float = Field(ge=.08)
    w: float = Field(ge=.08)
    h: float = Field(ge=.08)

    def bounds(self):
        return ((self.x, self.x+self.l), (self.y, self.y+self.w), (self.z, self.z+self.h))


class Heater(Model):
    power_w: float = Field(1500, gt=0, le=2500)
    setpoint_c: float = Field(19, ge=5, le=30)
    wall: Wall = 'N'
    offset: float = Field(1.3, ge=0)
    z: float = Field(.15, ge=0)
    length: float = Field(.8, ge=.2, le=2)
    depth: float = Field(.1, ge=.08, le=.5)
    height: float = Field(.5, ge=.2, le=1.5)

    def box(self, room):
        x, y, l, w = self.offset, 0., self.length, self.depth
        if self.wall == 'N':
            y = room.width-w
        elif self.wall in ('E', 'W'):
            x, y, l, w = 0., self.offset, self.depth, self.length
            if self.wall == 'E':
                x = room.length-l
        return Box(x=x, y=y, z=self.z, l=l, w=w, h=self.height)


class Project(Model):
    room: Room = Field(default_factory=Room)
    exterior_wall: Wall = 'N'
    window: Window = Field(default_factory=Window)
    dpe: Literal['A', 'B', 'C', 'D', 'E', 'F', 'G'] = 'F'
    outdoor_temp: float = Field(5, ge=-30, le=35)
    heater: Heater = Field(default_factory=Heater)
    furniture: list[Box] = Field(default_factory=lambda: [
        Box(x=.2, y=.3, l=1.9, w=1.4, h=.55),
        Box(x=2.7, y=.3, l=1, w=.6, h=.75)], max_length=5)

    def thermal(self):
        r = self.room
        area = (r.length if self.exterior_wall in ('N', 'S') else r.width)*r.height
        window_area = self.window.width*self.window.height
        opaque = area-window_area
        if opaque <= 0:
            raise ValueError('需要非零不透明外墙面积')
        wall_u, window_u = U_VALUES[self.dpe]
        infiltration = .34*ACH[self.dpe]*r.length*r.width*r.height
        ua = wall_u*opaque+window_u*window_area+infiltration
        demand = ua*max(0, self.heater.setpoint_c-self.outdoor_temp)
        effective = min(self.heater.power_w, demand)
        return {'wall_h_eff': wall_u+infiltration/opaque, 'ua_total': ua,
                'rated_power_w': self.heater.power_w, 'effective_power_w': effective,
                'duty_cycle': effective/self.heater.power_w,
                'insufficient_power': demand > self.heater.power_w}

    @model_validator(mode='after')
    def geometry(self):
        r, win = self.room, self.window
        along = r.length if self.exterior_wall in ('N', 'S') else r.width
        if win.offset+win.width > along or win.sill+win.height > r.height:
            raise ValueError('窗户超出墙面')
        self.thermal()
        boxes = [*self.furniture, self.heater.box(r)]
        for box in boxes:
            if any(hi > size+1e-8 for (_, hi), size in zip(box.bounds(), (r.length, r.width, r.height))):
                raise ValueError('家具或暖器超出房间')
        for a, b in combinations(boxes, 2):
            if all(min(ah, bh)-max(al, bl) > 1e-8 for (al, ah), (bl, bh) in zip(a.bounds(), b.bounds())):
                raise ValueError('家具或暖器重叠')
        # Solid boxes cannot cover the window surface.
        for box in boxes:
            bounds = box.bounds()
            axis, side = (1, r.width) if self.exterior_wall == 'N' else (1, 0) if self.exterior_wall == 'S' else (0, r.length) if self.exterior_wall == 'E' else (0, 0)
            if min(abs(bounds[axis][0]-side), abs(bounds[axis][1]-side)) < 1e-8:
                lo, hi = bounds[1-axis]
                if min(hi, win.offset+win.width) > max(lo, win.offset) and min(bounds[2][1], win.sill+win.height) > max(bounds[2][0], win.sill):
                    raise ValueError('家具或暖器遮挡窗户')
        return self
