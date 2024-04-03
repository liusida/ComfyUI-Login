import { app } from "../../scripts/app.js";

app.registerExtension({
	name: "Comfy.Password",
	init() {},
	async setup() {
		await new Promise(resolve => setTimeout(resolve, 500)); // Delay for 0.5 second before appending the Logout button to the menu, ensuring it is added last.

		const menu = document.querySelector(".comfy-menu");

		const logoutButton = document.createElement("button");
		logoutButton.textContent = "Logout";
		logoutButton.onclick = () => {
			localStorage.clear(); // If you use localStorage
			sessionStorage.clear(); // If you use sessionStorage
			window.location.href = "/logout"; 
		}
		menu.append(logoutButton);
	},
});
