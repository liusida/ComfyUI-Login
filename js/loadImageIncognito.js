import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";
import {ComfyWidgets} from "../../scripts/widgets.js";

let globalKey, globalIv;

// Function to dynamically load a script
function loadScript(url, callback) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.src = url;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

const cryptoJsLoaded = loadScript("https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.js").then(() => {
    // Generate a random 32-byte key for AES-256
    globalKey = CryptoJS.lib.WordArray.random(32); // 32 bytes = 256 bits
    // Generate a random 16-byte IV
    globalIv = CryptoJS.lib.WordArray.random(16); // 16 bytes = 128 bits
});

// Function to generate a random filename
function generateRandomFilename(extension) {
    const array = new Uint8Array(3);
    crypto.getRandomValues(array);
    const randomString = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${randomString}.${extension}`;
}

// Adds an upload button to the nodes
app.registerExtension({
	name: "Comfy.Login.LoadImageIncognito",
	async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData?.input?.required?.image?.[1]?.image_upload_encrypted === true) {
			nodeData.input.required.upload = ["IMAGEUPLOAD_ENCRYPTED"];
		}
	},
});

ComfyWidgets.IMAGEUPLOAD_ENCRYPTED = (node, inputName, inputData, app) => {
    const imageWidget = node.widgets.find((w) => w.name === (inputData[1]?.widget ?? "image"));
    
    imageWidget.disabled = true;

    let uploadWidget;

    const url_lock_icon = "/extensions/ComfyUI-Login/lock_icon.png";

    async function encryptFile(file, key, iv) {
        // Read the file as an ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();
    
        // Convert ArrayBuffer to WordArray for CryptoJS
        const wordArray = CryptoJS.lib.WordArray.create(arrayBuffer);
    
        // Encrypt the file data
        const encrypted = CryptoJS.AES.encrypt(wordArray, key, { iv: iv });
    
        // Convert encrypted data to WordArray
        const encryptedWordArray = encrypted.ciphertext;
    
        // Convert WordArray to Uint8Array
        const encryptedArrayBuffer = new Uint8Array(encryptedWordArray.sigBytes);
        for (let i = 0; i < encryptedWordArray.sigBytes; i++) {
            encryptedArrayBuffer[i] = (encryptedWordArray.words[Math.floor(i / 4)] >>> (24 - (i % 4) * 8)) & 0xff;
        }
    
        // Create a new Blob from the encrypted data
        return new Blob([encryptedArrayBuffer], { type: file.type });
    }

    async function decryptFile(encryptedArrayBuffer, key, iv) {
        // Convert ArrayBuffer to WordArray
        const wordArray = CryptoJS.lib.WordArray.create(encryptedArrayBuffer);
    
        // Decrypt the data
        const decrypted = CryptoJS.AES.decrypt({ ciphertext: wordArray }, key, { iv: iv });
    
        // Convert decrypted WordArray to Uint8Array
        const decryptedArrayBuffer = new Uint8Array(decrypted.sigBytes);
        for (let i = 0; i < decrypted.sigBytes; i++) {
            decryptedArrayBuffer[i] = (decrypted.words[Math.floor(i / 4)] >>> (24 - (i % 4) * 8)) & 0xff;
        }
    
        // Create a new Blob from the decrypted data
        return new Blob([decryptedArrayBuffer], { type: 'image/jpeg' }); // Adjust the MIME type as needed
    }
            
    async function showImage(name) {
        const img = new Image();
        img.onload = () => {
            node.imgs = [img];
            app.graph.setDirtyCanvas(true);
        };
    
        img.onerror = () => {
            // Show lock icon if the image can't be loaded (decryption failed)
            img.src = url_lock_icon;
        };
    
        let folder_separator = name.lastIndexOf("/");
        let subfolder = "";
        if (folder_separator > -1) {
            subfolder = name.substring(0, folder_separator);
            name = name.substring(folder_separator + 1);
        }
    
        try {
            // Fetch the encrypted image data
            const response = await fetch(api.apiURL(`/view?filename=${encodeURIComponent(name)}&type=input&subfolder=${subfolder}${app.getPreviewFormatParam()}${app.getRandParam()}`));
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            const encryptedArrayBuffer = await response.arrayBuffer(); // Get the response as ArrayBuffer
    
            await cryptoJsLoaded;
            // Decrypt the encrypted image data
            const decryptedBlob = await decryptFile(encryptedArrayBuffer, globalKey, globalIv);
    
            // Create a Blob URL and set it as the src of the image
            const url = URL.createObjectURL(decryptedBlob);
            img.src = url;
    
            node.setSizeForImage?.();
        } catch (error) {
            console.error('Error decrypting or displaying image:', error);
            // Show lock icon if decryption or fetching fails
            img.src = url_lock_icon;
        }
    }
            
    async function uploadFile(file, updateNode, pasted = false) {
        try {
            // Encrypt the file
            await cryptoJsLoaded;
            const encryptedFile = await encryptFile(file, globalKey, globalIv);
    
            // Wrap the encrypted file in FormData
            const extension = file.name.split('.').pop();
            const randomFilename = generateRandomFilename(extension);

            const body = new FormData();
            body.append("image", encryptedFile, randomFilename);
            body.append("subfolder", "incognito");
    
            // Upload the encrypted file
            const resp = await api.fetchApi("/upload/image", {
                method: "POST",
                body,
            });
    
            if (resp.status === 200) {
                const data = await resp.json();
                // Add the file to the dropdown list and update the widget value
                let path = data.name;
                if (data.subfolder) path = data.subfolder + "/" + path;
    
                if (!imageWidget.options.values.includes(path)) {
                    imageWidget.options.values.push(path);
                }
    
                if (updateNode) {
                    showImage(path);
                    imageWidget.value = path;
                }
            } else {
                alert(resp.status + " - " + resp.statusText);
            }
        } catch (error) {
            alert(error);
        }
    }

    var default_value = imageWidget.value;
    Object.defineProperty(imageWidget, "value", {
        set : function(value) {
            this._real_value = value;
        },

        get : function() {
            let value = "";
            if (this._real_value) {
                value = this._real_value;
            } else {
                return default_value;
            }

            if (value.filename) {
                let real_value = value;
                value = "";
                if (real_value.subfolder) {
                    value = real_value.subfolder + "/";
                }

                value += real_value.filename;

                if(real_value.type && real_value.type !== "input")
                    value += ` [${real_value.type}]`;
            }
            return value;
        }
    });

    // Add our own callback to the combo widget to render an image when it changes
    const cb = node.callback;
    imageWidget.callback = function () {
        showImage(imageWidget.value);
        if (cb) {
            return cb.apply(this, arguments);
        }
    };

    // On load if we have a value then render the image
    // The value isnt set immediately so we need to wait a moment
    // No change callbacks seem to be fired on initial setting of the value
    // requestAnimationFrame(() => {
    //     if (imageWidget.value) {
    //         showImage(imageWidget.value);
    //     }
    // });

    const fileInput = document.createElement("input");
    Object.assign(fileInput, {
        type: "file",
        accept: "image/jpeg,image/png,image/webp",
        style: "display: none",
        onchange: async () => {
            if (fileInput.files.length) {
                await uploadFile(fileInput.files[0], true);
            }
        },
    });
    document.body.append(fileInput);

    // Create the button widget for selecting the files
    uploadWidget = node.addWidget("button", inputName, "image", () => {
        fileInput.click();
    });
    uploadWidget.label = "choose file to upload";
    uploadWidget.serialize = false;

    // Add handler to check if an image is being dragged over our node
    node.onDragOver = function (e) {
        if (e.dataTransfer && e.dataTransfer.items) {
            const image = [...e.dataTransfer.items].find((f) => f.kind === "file");
            return !!image;
        }

        return false;
    };

    // On drop upload files
    node.onDragDrop = function (e) {
        console.log("onDragDrop called");
        let handled = false;
        for (const file of e.dataTransfer.files) {
            if (file.type.startsWith("image/")) {
                uploadFile(file, !handled); // Dont await these, any order is fine, only update on first one
                handled = true;
            }
        }

        return handled;
    };

    node.pasteFile = function(file) {
        if (file.type.startsWith("image/")) {
            const is_pasted = (file.name === "image.png") &&
                              (file.lastModified - Date.now() < 2000);
            uploadFile(file, true, is_pasted);
            return true;
        }
        return false;
    }

    return { widget: uploadWidget };
};

api.queuePrompt = async function (number, { output, workflow }) {
    const body = {
        client_id: this.clientId,
        prompt: output,
        extra_data: { extra_pnginfo: { workflow, secret_for_private_image: [ globalKey, globalIv ] } },
    };

    if (number === -1) {
        body.front = true;
    } else if (number != 0) {
        body.number = number;
    }

    const res = await this.fetchApi("/prompt", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    if (res.status !== 200) {
        throw {
            response: await res.json(),
        };
    }

    return await res.json();
};