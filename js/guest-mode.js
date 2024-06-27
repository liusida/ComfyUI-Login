import { app } from "../../scripts/app.js";

app.registerExtension({
	name: "Comfy.Login.GuestMode",
	init() {},
	async setup() {
        try {
            const response = await fetch("/guest_mode");
            if (response.ok) {
                const data = await response.json();
                if (data.guestMode) {
                    console.log("guestMode");

                    // Select the div with class 'comfy-menu'
                    const comfyMenu = document.querySelector('.comfy-menu');

                    // Check if the div exists
                    if (comfyMenu) {
                        // Select all child elements of the div
                        const childElements = comfyMenu.querySelectorAll('*');

                        // Iterate over all child elements
                        childElements.forEach(element => {
                            // If the element does not have the class 'comfy-queue-btn', remove it
                            if (!element.classList.contains('comfy-queue-btn')) {
                                element.remove();
                            }
                        });
                    }
                    
                }
            }
        } catch (error) {
            console.error("Error fetching guest mode:", error);
        }
    }
});