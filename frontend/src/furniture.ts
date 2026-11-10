import type {Project} from './s1';
export const furnitureDefaults:Record<string,number[]>={bed:[1.9,1.4,.55],table:[1,.6,.75],chair:[.45,.45,.85],wardrobe:[1,.6,1.8],sofa:[1.8,.8,.8],bookcase:[.8,.3,1.8],custom:[.5,.5,.5]};
export const kindLabel:Record<string,string>={bed:'床',table:'桌',chair:'椅',wardrobe:'柜',sofa:'沙发',bookcase:'书架',custom:'自定义'};
export function migrateKind(kind?:string):string {
  return kind&&kind in furnitureDefaults?kind:Object.keys(kindLabel).find(key=>kindLabel[key]===kind)??'custom';
}
export function migrateProject(project:Project):Project {
  return {...project,furniture:project.furniture.map(box=>({...box,kind:migrateKind(box.kind)}))};
}
