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
            
            v = v[None, ...]
            if k not in models:
                models[k] = v
            else:
                models[k] = np.concatenate([models[k], v], axis=0)
        else:
            models[k] = v.item()

if __name__ == '__main__':
    models = {}
    demo = "growing_demo"
    for folder in sorted(glob(f'{demo}/models/*')):
        name = folder.split('/')[-1]
        print(name)
        if name not in [
        # "bubbly_0101",
        # "rings",
        # "clouds",
        # "tree",
        # "stars",
        # "hearts",
        # "goo",
        # "squares",
        # "triangles",
        # "polka-dotted_0121",
        # "grid_0040",
        # "banded_0037"

        # "0",
        # "1",
        # "2",
        # "3",
        # "4",
        # "5",
        # "6",
        # "7",
        # "8",
        # "9",

        "shocked_face_with_exploding_head",
        "disguised_face",
        "smiling_face_with_open_mouth_and_smiling_eyes",
        "grinning_face_with_smiling_eyes",
        "smiling_face_with_heart_shaped_eyes",
        "smiling_face_with_sunglasses",
        "overheated_face",
        "thumbs_up_sign",
        "clown_face",
        "freezing_face",
        "grinning_face_with_one_large_and_one_small_eye",
        "eye",
        ]:
            continue
        export_model(folder, models)

    for k in models:
        if k not in ['eps0', 'N0', 'alpha']:
            print(models[k].shape)
            models[k] = np2json(models[k])
    

    print(models.keys())
    if len(models) > 0:
        with open(f'{demo}/models_faces.json', 'w') as f:
            json.dump(models, f)

    

