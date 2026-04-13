import json
import base64
from glob import glob
import numpy as np
import torch


def np2json(a):
    a = np.ascontiguousarray(a)
    shape = a.shape
    data = base64.b64encode(a.tobytes()).decode('ascii')
    return dict(shape=shape, dtype=a.dtype.name, data64=data)


def export_model(folder, models):
    data = torch.load(f'{folder}/model.pth', map_location='cpu')
    for k, v in data.items():
        v = v.numpy()
        if k not in ['eps0', 'N0', 'alpha']:
            # W_hidden and W_out: repeat each value 4x for RGBA
            if k in ['model.W_hidden', 'model.W_out']:
                name = k.split('.')[-1]  # "W_hidden" or "W_out"
                v = np.repeat(v, 4, axis=-1)  # [k_in, k*4]
                v = v[None, ...]  # add batch dim
                if name not in models:
                    models[name] = v
                else:
                    models[name] = np.concatenate([models[name], v], axis=0)
                continue
            if k == 'model.mlp.0.weight':
                k = 'w1.weight'
            elif k == 'model.mlp.0.bias':
                k = 'w1.bias'
            elif k == 'model.mlp.2.weight':
                k = 'w2.weight'
            elif k == 'model.mlp.2.bias':
                k = 'w2.bias'
            if v.shape[-1] % 4 != 0:  # pad last dim
                pad = 4 - v.shape[-1] % 4
                v = np.pad(v, [(0, 0)] * (v.ndim - 1) + [(0, pad)])
            v = v[None, ...]  # add batch dim
            if k not in models:
                models[k] = v
            else:
                models[k] = np.concatenate([models[k], v], axis=0)
        else:
            models[k] = v.item()


if __name__ == '__main__':
    models = {}
    for folder in sorted(glob('growing_demo/models/*')):
        name = folder.split('/')[-1]
        print(name)
        export_model(folder, models)

    for k in models:
        if k not in ['eps0', 'N0', 'alpha']:
            print(k, models[k].shape)
            models[k] = np2json(models[k])

    if len(models) > 0:
        with open('growing_demo/models_all.json', 'w') as f:
            json.dump(models, f)
