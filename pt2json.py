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

def export_model(folder):
    model = {}
    data = torch.load(f'{folder}/npa.pth', map_location='cpu')
    for k, v in data.items():
        # print(k)
        v = v.numpy()
        if k not in ['eps0', 'N0', 'alpha']:
            if v.ndim == 4:
                v = v[:,:,0,0]
            if k == 'model.0.weight':
                # print("here !", v.shape)
                # interleaved -> concatenated perception components
                h, p = v.shape
                k = "w1.weight"
                pass

                # v = v.reshape(h, p//4, 4).swapaxes(1,2).reshape(h, p)
            if k == 'model.0.bias':
                k = "w1.bias"
            if k == 'model.2.weight':
                # transpose w2 to simplify fused nca update accumulation
                # v[:16], v[16:] = v[2:], v[:2] # move position update to the end
                v = np.concatenate([v[2:], v[:2]], axis=0)
                # print("here 2!", v.shape)
                k += '.T'
                v = v.T
                k = "w2.weight.T"
            if v.shape[-1] % 4 != 0:  # pad last dim
                pad = 4-v.shape[-1]%4
                # print(f'Padding {k} from {v.shape} to ', end='')
                v = np.pad(v, [(0,0)]*(v.ndim-1) + [(0,pad)])
                # print(v.shape)
            model[k] = np2json(v)
        else:
            model[k] = v.item()
    return model

if __name__ == '__main__':
    models = {}
    demo = "texture_demo"
    for folder in sorted(glob(f'{demo}/models/*')):
        name = folder.split('/')[-1]
        print(name)
        models[name] = export_model(folder)
    if len(models) > 0:
        with open(f'{demo}/models.json', 'w') as f:
            json.dump(models, f)

    

