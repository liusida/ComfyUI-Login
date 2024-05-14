from .upload_privacy import *
from .password import *

NODE_CLASS_MAPPINGS = {
    "LoadImageWithPrivacy": LoadImageWithPrivacy,
    "RemoveImage": RemoveImage,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoadImageWithPrivacy": "Load Image With Privacy",
    "RemoveImage": "Remove Image",
}
