import hashlib
import torch
import folder_paths
import os
import node_helpers
from PIL import Image, ImageOps, ImageSequence, ImageFile
import numpy as np
import hmac
import logging
import io
from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad
from nodes import LoadImage

REMOVE_IMAGE_SECRET = "For_privacy!Arbitrary_secret_phrase_here."

class LoadImageWithPrivacy(LoadImage):
    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        return {
            "required": {
                "image": (sorted(files), {"image_upload_encrypted": True}),
            },
            "hidden": {
                "extra_pnginfo": "EXTRA_PNGINFO"
            }
        }

    CATEGORY = "image"
    RETURN_TYPES = ("IMAGE", "MASK", "IMAGE_PATH", "SIGNATURE")
    FUNCTION = "load_image"

    def load_image(self, image, extra_pnginfo):
        key_word_array, iv_word_array = extra_pnginfo['secret_for_private_image']
        
        # Get the image path
        image_path = folder_paths.get_annotated_filepath(image)

        # Read the encrypted image file
        with open(image_path, 'rb') as f:
            encrypted_data = f.read()

        # Decrypt the data
        try:
            decrypted_data = decrypt_image_data(encrypted_data, key_word_array, iv_word_array)
        except ValueError as e:
            raise ValueError(f"Sorry, you don't have the correct key for this encrypted file: {str(e)}.")

        # Convert decrypted data to an image
        img = Image.open(io.BytesIO(decrypted_data))
        
        output_images = []
        output_masks = []
        w, h = None, None

        excluded_formats = ['MPO']

        for i in ImageSequence.Iterator(img):
            i = node_helpers.pillow(ImageOps.exif_transpose, i)

            if i.mode == 'I':
                i = i.point(lambda i: i * (1 / 255))
            image = i.convert("RGB")

            if len(output_images) == 0:
                w = image.size[0]
                h = image.size[1]

            if image.size[0] != w or image.size[1] != h:
                continue

            image = np.array(image).astype(np.float32) / 255.0
            image = torch.from_numpy(image)[None,]
            if 'A' in i.getbands():
                mask = np.array(i.getchannel('A')).astype(np.float32) / 255.0
                mask = 1. - torch.from_numpy(mask)
            else:
                mask = torch.zeros((64,64), dtype=torch.float32, device="cpu")
            output_images.append(image)
            output_masks.append(mask.unsqueeze(0))

        if len(output_images) > 1 and img.format not in excluded_formats:
            output_image = torch.cat(output_images, dim=0)
            output_mask = torch.cat(output_masks, dim=0)
        else:
            output_image = output_images[0]
            output_mask = output_masks[0]

        signature = hmac.new(REMOVE_IMAGE_SECRET.encode('utf-8'), msg=image_path.encode('utf-8'), digestmod=hashlib.sha256).hexdigest()

        del img

        return (output_image, output_mask, image_path, signature)
    
    @classmethod
    def VALIDATE_INPUTS(s, image):
        if not folder_paths.exists_annotated_filepath(image):
            return "Invalid image file or file doesn't exist: {}".format(image)

        return True

class RemoveImageForPrivacy:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image_path": ("IMAGE_PATH", {"forceInput": True}),
                "signature": ("SIGNATURE", {"forceInput": True}),
            }
        }
    
    CATEGORY = "image"
    OUTPUT_NODE = True

    RETURN_TYPES = ()
    FUNCTION = "remove_image"
    def remove_image(self, image_path, signature):
        calculated_signature = hmac.new(REMOVE_IMAGE_SECRET.encode('utf-8'), msg=image_path.encode('utf-8'), digestmod=hashlib.sha256).hexdigest()
        if hmac.compare_digest(calculated_signature, signature):
            os.remove(image_path)
            logging.info(f"{image_path} removed.")
            #TODO: Is there a way to refresh the "Load Image With Privacy" node via js? I am not familiar with js.
            
        return {}

def word_array_to_bytes(word_array):
    words = word_array['words']
    sig_bytes = word_array['sigBytes']
    byte_array = bytearray()
    
    for i in range(sig_bytes):
        byte = (words[i // 4] >> (24 - (i % 4) * 8)) & 0xFF
        byte_array.append(byte)
    
    return bytes(byte_array)

def decrypt_image_data(encrypted_data, key_word_array, iv_word_array):
    key = word_array_to_bytes(key_word_array)
    iv = word_array_to_bytes(iv_word_array)
    cipher = AES.new(key, AES.MODE_CBC, iv)
    decrypted_data = unpad(cipher.decrypt(encrypted_data), AES.block_size)
    return decrypted_data

