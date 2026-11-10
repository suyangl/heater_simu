KINDS = dict(zip(('bed', 'table', 'chair', 'wardrobe', 'sofa', 'bookcase', 'custom'),
                 ('床', '桌', '椅', '柜', '沙发', '书架', '自定义')))


def solver_project(data):
    if not isinstance(data, dict) or 'furniture' not in data:
        return data
    return {**data, 'furniture': [
        {**box, 'kind': KINDS.get(box['kind'], box['kind'])} if isinstance(box, dict) and 'kind' in box else box
        for box in data.get('furniture', [])
    ]} if isinstance(data.get('furniture', []), list) else data


def user_project(data):
    reverse = {value: key for key, value in KINDS.items()}
    return {**data, 'furniture': [
        {**box, 'kind': reverse.get(box['kind'], box['kind'])} if box.get('kind') else box
        for box in data.get('furniture', [])
    ]}
