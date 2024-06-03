//
// This file is here for my own conveniency, like a pre-print, later would be sumit to a proper repository.
// Don't want this functionality? simple delete this file
//
import { app } from "../../scripts/app.js";
import { ComfyWidgets } from "../../scripts/widgets.js";

// hack: unregister the original Comfy.SlotDefaults
app.extensions = app.extensions.filter(item => item.name !== 'Comfy.SlotDefaults');

app.registerExtension({
	name: "Comfy.SlotDefaults",
	decalyFactor: 0.9,
	suggestionsNumber: null,
	init() {
		LiteGraph.search_filter_enabled = true;
		LiteGraph.middle_click_slot_add_default_node = true;
		this.suggestionsNumber = app.ui.settings.addSetting({
			id: "Comfy.NodeSuggestions.number",
			name: "Number of nodes suggestions",
			type: "slider",
			attrs: {
				min: 1,
				max: 100,
				step: 1,
			},
			defaultValue: 5,
		});
		var that = this;
		LGraph.prototype.onNodeAdded = function (node) {
			//TODO: The default "middle button click to add the first option in default list" conflicts with ComfyUI-Custom-Scripts's "🐍 Middle click slot to add"
			if (this._nodes_in_order.length == 0) {
				// Hack: it's a refresh, creating nodes as initialization, not actually adding any nodes manually. For more details: https://github.com/jagenjo/litegraph.js/issues/482#issuecomment-2144323089
				return;
			}
			let slot_types_default_in_trace = that.loadTraceFromLocalStorage("Comfy.SlotDefaults.slot_types_default_in_trace");
			let slot_types_default_out_trace = that.loadTraceFromLocalStorage("Comfy.SlotDefaults.slot_types_default_out_trace");

			node.inputs?.map((input) => {
				slot_types_default_out_trace = that.updateTrace(slot_types_default_out_trace, input.type, node.type);
				localStorage.setItem("Comfy.SlotDefaults.slot_types_default_out_trace", JSON.stringify(slot_types_default_out_trace));
				LiteGraph.slot_types_default_out = that.computeDefaultListFromTrace(slot_types_default_out_trace, that.slot_types_default_out, that.suggestionsNumber.value);
			});
			node.outputs?.map((output) => {
				slot_types_default_in_trace = that.updateTrace(slot_types_default_in_trace, output.type, node.type);
				localStorage.setItem("Comfy.SlotDefaults.slot_types_default_in_trace", JSON.stringify(slot_types_default_in_trace));
				LiteGraph.slot_types_default_in = that.computeDefaultListFromTrace(slot_types_default_in_trace, that.slot_types_default_in, that.suggestionsNumber.value);
			});
		}
	},

	async updateLGraph() {
		// Read from localStorage + current this.slot_types_default
		let slot_types_default_in_trace = this.loadTraceFromLocalStorage("Comfy.SlotDefaults.slot_types_default_in_trace");
		LiteGraph.slot_types_default_in = this.computeDefaultListFromTrace(slot_types_default_in_trace, this.slot_types_default_in, this.suggestionsNumber.value);
		let slot_types_default_out_trace = this.loadTraceFromLocalStorage("Comfy.SlotDefaults.slot_types_default_out_trace");
		LiteGraph.slot_types_default_out = this.computeDefaultListFromTrace(slot_types_default_out_trace, this.slot_types_default_out, this.suggestionsNumber.value);
	},

	loadTraceFromLocalStorage(key) {
		let trace = localStorage.getItem(key);
		if (trace) {
			try {
				trace = JSON.parse(trace);
			} catch (e) {
				console.error("Error parsing JSON from localStorage:", e);
				trace = {};  // Default to an empty object if parsing fails
			}
		} else {
			trace = {};
		}
		return trace;
	},

	updateTrace(trace, inputType, nodeType) {
		// decay old traces and add 1 new trace
		if (trace[inputType]) {
			for (let key in trace[inputType]) {
				if (trace[inputType].hasOwnProperty(key)) {
					trace[inputType][key] *= this.decalyFactor;
				}
			}
		} else {
			trace[inputType] = {};
		}
		if (trace[inputType][nodeType]) {
			trace[inputType][nodeType] += 1;
		} else {
			trace[inputType][nodeType] = 1;
		}
		return trace;
	},

	computeDefaultListFromTrace(trace, original_default_list, optionNumber) {
		let default_list = {};
		let number = parseInt(optionNumber, 10); // base 10
		const allKeys = new Set([...Object.keys(trace), ...Object.keys(original_default_list)]);

		allKeys.forEach(key => {
			let items = trace[key] ? Object.entries(trace[key]) : [];
			items.sort((a, b) => b[1] - a[1]);
			default_list[key] = items.map(item => item[0]).slice(0, number);
			this.extendList(default_list[key], original_default_list[key] || [], number);
		});

		return default_list;
	},

	extendList(currentList, defaults, maxLength) {
		// Iterate over defaults and add unique items until currentList reaches maxLength
		for (let item of defaults) {
			if (currentList.length >= maxLength) {
				break;
			}
			if (!currentList.includes(item)) {
				currentList.push(item);
			}
		}
	},

	// I leave the beforeRegisterNodeDef function almost untouched, so, without any memory, the system will behave exactly the same as the current behavior.
	slot_types_default_out: {},
	slot_types_default_in: {},
	async beforeRegisterNodeDef(nodeType, nodeData, app) {
		var nodeId = nodeData.name;
		var inputs = [];
		inputs = nodeData["input"]["required"]; //only show required inputs to reduce the mess also not logical to create node with optional inputs
		for (const inputKey in inputs) {
			var input = (inputs[inputKey]);
			if (typeof input[0] !== "string") continue;

			var type = input[0]
			if (type in ComfyWidgets) {
				var customProperties = input[1]
				if (!(customProperties?.forceInput)) continue; //ignore widgets that don't force input
			}

			if (!(type in this.slot_types_default_out)) {
				this.slot_types_default_out[type] = ["Reroute"];
			}
			if (this.slot_types_default_out[type].includes(nodeId)) continue;
			this.slot_types_default_out[type].push(nodeId);

			// Input types have to be stored as lower case
			// Store each node that can handle this input type
			const lowerType = type.toLocaleLowerCase();
			if (!(lowerType in LiteGraph.registered_slot_in_types)) {
				LiteGraph.registered_slot_in_types[lowerType] = { nodes: [] };
			}
			LiteGraph.registered_slot_in_types[lowerType].nodes.push(nodeType.comfyClass);
		}

		var outputs = nodeData["output"];
		for (const key in outputs) {
			var type = outputs[key];
			if (!(type in this.slot_types_default_in)) {
				this.slot_types_default_in[type] = ["Reroute"];// ["Reroute", "Primitive"];  primitive doesn't always work :'()
			}

			this.slot_types_default_in[type].push(nodeId);

			// Store each node that can handle this output type
			if (!(type in LiteGraph.registered_slot_out_types)) {
				LiteGraph.registered_slot_out_types[type] = { nodes: [] };
			}
			LiteGraph.registered_slot_out_types[type].nodes.push(nodeType.comfyClass);

			if (!LiteGraph.slot_types_out.includes(type)) {
				LiteGraph.slot_types_out.push(type);
			}
		}
	},
	async setup() { //TODO: check is this a right callback? 
		// only modification: instead of calling this update each time before register a node def, do it here once.
		this.updateLGraph();
	},
});
