from itertools import combinations
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_serializer, model_validator

Wall = Literal['N', 'S', 'E', 'W']
U_VALUES = {'A': (.15, .8), 'B': (.25, 1.1), 'C': (.35, 1.4),
            'D': (.6, 2), 'E': (1, 2.8), 'F': (1.5, 3.5), 'G': (2.2, 5)}
ACH = dict(zip('ABCDEFG', (.3, .4, .5, .6, .7, .9, 1.2)))


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)

    @model_serializer(mode='wrap')
    def serialize(self, handler):
        data = handler(self)
        for key in ('kind', 'name', 'exterior_walls', 'openings'):
            if data.get(key) is None:
                data.pop(key, None)
        return data


class Room(Model):
    length: float = Field(4, ge=2, le=8)
    width: float = Field(3.5, ge=2, le=8)
    height: float = Field(2.5, ge=2, le=4)


class Window(Model):
    offset: float = Field(1.2, ge=0)
    width: float = Field(1.2, ge=.2)
    height: float = Field(1.35, ge=.2)
    sill: float = Field(.9, ge=0)


class Opening(Window):
    type: Literal['window', 'door'] = 'window'
    wall: Wall = 'N'
    u_value: float = Field(1.8, gt=0, le=7)

    @model_validator(mode='after')
    def door_sill(self):
        if self.type == 'door' and self.sill != 0:
            raise ValueError('门的离地高度 sill 必须为 0')
        return self


class Box(Model):
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    z: float = Field(0, ge=0)
    l: float = Field(ge=.08)
    w: float = Field(ge=.08)
    h: float = Field(ge=.08)
    kind: Literal['床', '桌', '椅', '柜', '沙发', '书架', '自定义'] | None = None
    name: str | None = Field(None, max_length=60)

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
        Box(x=2.7, y=.3, l=1, w=.6, h=.75)], max_length=15)
    exterior_walls: list[Wall] | None = Field(None, min_length=1, max_length=4)
    openings: list[Opening] | None = Field(None, max_length=24)

    @property
    def legacy(self):
        return self.exterior_walls is None and self.openings is None

    @property
    def wall_set(self):
        return self.exterior_walls if self.exterior_walls is not None else [self.exterior_wall]

    def opening_patches(self):
        openings = self.openings if self.openings is not None else [Opening(**self.window.model_dump(), wall=self.exterior_wall)]
        return [('window' if self.legacy else f'{o.type}_{i}', o) for i, o in enumerate(openings)]

    def loss_groups(self, active=None):
        groups = {'exterior_walls': list(self.wall_set), 'windows': [], 'exterior_doors': []}
        for patch, opening in self.opening_patches():
            if opening.wall in self.wall_set:
                groups['windows' if opening.type == 'window' else 'exterior_doors'].append(patch)
        return {group: [p for p in patches if active is None or p in active] for group, patches in groups.items()}

    def loss_patches(self, active=None):
        return {p for patches in self.loss_groups(active).values() for p in patches}

    def thermal(self):
        if not self.legacy:
            r = self.room
            area = sum((r.length if wall in ('N', 'S') else r.width)*r.height for wall in self.wall_set)
            exterior = [o for _, o in self.opening_patches() if o.wall in self.wall_set]
            opaque = area-sum(o.width*o.height for o in exterior)
            if opaque <= 0:
                raise ValueError('需要非零不透明外墙面积')
            infiltration = .34*ACH[self.dpe]*r.length*r.width*r.height
            wall_u, window_u = U_VALUES[self.dpe]
            ua = wall_u*opaque+infiltration+sum(o.width*o.height*(window_u if o.type == 'window' else o.u_value) for o in exterior)
            demand = ua*max(0, self.heater.setpoint_c-self.outdoor_temp)
            effective = min(self.heater.power_w, demand)
            return {'wall_h_eff': wall_u+infiltration/opaque, 'ua_total': ua,
                    'rated_power_w': self.heater.power_w, 'effective_power_w': effective,
                    'duty_cycle': effective/self.heater.power_w, 'insufficient_power': demand > self.heater.power_w}
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
        r = self.room
        if len(set(self.wall_set)) != len(self.wall_set):
            raise ValueError('外墙列表不能重复')
        openings = self.opening_patches()
        for _, win in openings:
            along = r.length if win.wall in ('N', 'S') else r.width
            if win.offset+win.width > along or win.sill+win.height > r.height:
                raise ValueError('窗户超出墙面' if self.legacy else '门窗超出墙面')
            if win.type == 'window' and win.wall not in self.wall_set:
                raise ValueError('窗户只能位于外墙')
        for (_, a), (_, b) in combinations(openings, 2):
            if a.wall == b.wall and min(a.offset+a.width,b.offset+b.width)>max(a.offset,b.offset)+1e-8 and min(a.sill+a.height,b.sill+b.height)>max(a.sill,b.sill)+1e-8:
                raise ValueError('同一墙面的门窗重叠')
        self.thermal()
        boxes = [*self.furniture, self.heater.box(r)]
        for box in boxes:
            if any(hi > size+1e-8 for (_, hi), size in zip(box.bounds(), (r.length, r.width, r.height))):
                raise ValueError('家具或暖器超出房间')
        for a, b in combinations(boxes, 2):
            if all(min(ah, bh)-max(al, bl) > 1e-8 for (al, ah), (bl, bh) in zip(a.bounds(), b.bounds())):
                raise ValueError('家具或暖器重叠')
        for _, win in openings:
            for box in boxes:
                bounds = box.bounds()
                axis, side = (1, r.width) if win.wall == 'N' else (1, 0) if win.wall == 'S' else (0, r.length) if win.wall == 'E' else (0, 0)
                if min(abs(bounds[axis][0]-side), abs(bounds[axis][1]-side)) < 1e-8:
                    lo, hi = bounds[1-axis]
                    if min(hi, win.offset+win.width) > max(lo, win.offset) and min(bounds[2][1], win.sill+win.height) > max(bounds[2][0], win.sill):
                        raise ValueError('家具或暖器遮挡窗户' if self.legacy else '家具或暖器遮挡门窗')
        return self
