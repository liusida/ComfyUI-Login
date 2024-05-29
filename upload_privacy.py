import torch
import folder_paths
import os
import node_helpers
from PIL import Image, ImageOps, ImageSequence, ImageFile
import numpy as np
import logging
import io
from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad
from nodes import LoadImage

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

class LoadImageIncognito:
    @classmethod
    def INPUT_TYPES(cls):

        base_input_dir = folder_paths.get_input_directory()
        incognito_dir = os.path.join(base_input_dir, 'incognito')
        if not os.path.exists(incognito_dir):
            os.makedirs(incognito_dir)
        files = [os.path.join('incognito', f) for f in os.listdir(incognito_dir) if os.path.isfile(os.path.join(incognito_dir, f))]

        return {
            "required": {
                "image": (files, {"image_upload_encrypted": True}),
                "auto_delete": ("BOOLEAN", {"default": True}),
            },
            "hidden": {
                "extra_pnginfo": "EXTRA_PNGINFO"
            }
        }

    CATEGORY = "image"
    RETURN_TYPES = ("IMAGE", "MASK")
    FUNCTION = "load_image"

    def load_image(self, image, auto_delete, extra_pnginfo):
        # Get the image path
        image_path = folder_paths.get_annotated_filepath(image)

        # Read the encrypted image file
        with open(image_path, 'rb') as f:
            encrypted_data = f.read()

        # Decrypt the data
        try:
            if extra_pnginfo:
                key_word_array, iv_word_array = extra_pnginfo['secret_for_private_image']
                decrypted_data = decrypt_image_data(encrypted_data, key_word_array, iv_word_array)
            else:
                logging.warn("No extra_pnginfo. Falling back to unencrypted image.")
                decrypted_data = encrypted_data
        except ValueError as e:
            raise ValueError(f"Sorry, you don't have the correct key for this encrypted file: {str(e)}.")

        if auto_delete:
            # Remove the file if it is decrypted correctly
            os.remove(image_path)
            logging.info(f"{image_path} removed.")

        # Convert decrypted data to an image
        img = node_helpers.pillow(Image.open, io.BytesIO(decrypted_data)) 
        
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

        del img

        return (output_image, output_mask)
    
    @classmethod
    def VALIDATE_INPUTS(s, image):
        return True
