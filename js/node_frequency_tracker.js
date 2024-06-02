//
// Track the most frequently used nodes and inject them to the right-click context menu.
// This is an injection to ComfyUI's litegraph.js.
// Don't want this feature? Simply delete this file.
//

const originalAdd = LGraph.prototype.add;

LGraph.prototype.add = function (node, skip_compute_order) {
    originalAdd.apply(this, arguments);
    if (!skip_compute_order) {
        // Everytime created a node, update the frequency
        var selectionFrequency = JSON.parse(localStorage.getItem("nodeSelectionFrequency") || "{}");
        let key = generateNodeKey(node);

        if (!selectionFrequency[key]) {
            selectionFrequency[key] = 0;
        }
        selectionFrequency[key] += 1;
        localStorage.setItem("nodeSelectionFrequency", JSON.stringify(selectionFrequency));
    }
};

//From: https://github.com/jagenjo/litegraph.js/blob/0555a2f2a3df5d4657593c6d45eb192359888195/src/litegraph.js#L11182
const originalShowConnectionMenu = LGraphCanvas.prototype.showConnectionMenu;
LGraphCanvas.prototype.showConnectionMenu = function (optPass) { // addNodeMenu for connection
    var optPass = optPass || {};
    var opts = Object.assign({
        nodeFrom: null  // input
        , slotFrom: null // input
        , nodeTo: null   // output
        , slotTo: null   // output
        , e: null
    }
        , optPass
    );
    var that = this;

    var isFrom = opts.nodeFrom && opts.slotFrom;
    var isTo = !isFrom && opts.nodeTo && opts.slotTo;

    if (!isFrom && !isTo) {
        console.warn("No data passed to showConnectionMenu");
        return false;
    }

    var nodeX = isFrom ? opts.nodeFrom : opts.nodeTo;
    var slotX = isFrom ? opts.slotFrom : opts.slotTo;

    var iSlotConn = false;
    switch (typeof slotX) {
        case "string":
            iSlotConn = isFrom ? nodeX.findOutputSlot(slotX, false) : nodeX.findInputSlot(slotX, false);
            slotX = isFrom ? nodeX.outputs[slotX] : nodeX.inputs[slotX];
            break;
        case "object":
            // ok slotX
            iSlotConn = isFrom ? nodeX.findOutputSlot(slotX.name) : nodeX.findInputSlot(slotX.name);
            break;
        case "number":
            iSlotConn = slotX;
            slotX = isFrom ? nodeX.outputs[slotX] : nodeX.inputs[slotX];
            break;
        default:
            // bad ?
            //iSlotConn = 0;
            console.warn("Cant get slot information " + slotX);
            return false;
    }

    var options = ["Add Node", null];

    if (that.allow_searchbox) {
        options.push("Search");
        options.push(null);
    }

    // get defaults nodes for this slottype
    var fromSlotType = slotX.type == LiteGraph.EVENT ? "_event_" : slotX.type;

    var topFrequentNodes = findTopFrequentNodes(isFrom, fromSlotType, 3);  // Get top 3 frequent nodes
    if (topFrequentNodes.length) {
        topFrequentNodes.forEach(nodeType => {
            options.push(nodeType);
        });
        options.push(null);
    }

    var slotTypesDefault = isFrom ? LiteGraph.slot_types_default_out : LiteGraph.slot_types_default_in;
    if (slotTypesDefault && slotTypesDefault[fromSlotType]) {
        if (typeof slotTypesDefault[fromSlotType] == "object" || typeof slotTypesDefault[fromSlotType] == "array") {
            for (var typeX in slotTypesDefault[fromSlotType]) {
                options.push(slotTypesDefault[fromSlotType][typeX]);
            }
        } else {
            options.push(slotTypesDefault[fromSlotType]);
        }
    }

    // build menu
    var menu = new LiteGraph.ContextMenu(options, {
        event: opts.e,
        title: (slotX && slotX.name != "" ? (slotX.name + (fromSlotType ? " | " : "")) : "") + (slotX && fromSlotType ? fromSlotType : ""),
        callback: inner_clicked
    });

    // callback
    function inner_clicked(v, options, e) {
        //console.log("Process showConnectionMenu selection");
        switch (v) {
            case "Add Node":
                LGraphCanvas.onMenuAdd(null, null, e, menu, function (node) {
                    if (isFrom) {
                        opts.nodeFrom.connectByType(iSlotConn, node, fromSlotType);
                    } else {
                        opts.nodeTo.connectByTypeOutput(iSlotConn, node, fromSlotType);
                    }
                });
                break;
            case "Search":
                if (isFrom) {
                    that.showSearchBox(e, { node_from: opts.nodeFrom, slot_from: slotX, type_filter_in: fromSlotType });
                } else {
                    that.showSearchBox(e, { node_to: opts.nodeTo, slot_from: slotX, type_filter_out: fromSlotType });
                }
                break;
            default:
                // check for defaults nodes for this slottype
                var nodeCreated = that.createDefaultNodeForSlot(Object.assign(opts, {
                    position: [opts.e.canvasX, opts.e.canvasY]
                    , nodeType: v
                }));
                if (nodeCreated) {
                    // new node created
                    //console.log("node "+v+" created")
                } else {
                    // failed or v is not in defaults
                }
                break;
        }
    }

    return false;
};

const originalCreateDefaultNodeForSlot = LGraphCanvas.prototype.createDefaultNodeForSlot;
LGraphCanvas.prototype.createDefaultNodeForSlot = function (optPass) {
    let ret = originalCreateDefaultNodeForSlot.apply(this, arguments);
    if (!ret) {
        // if the original creation failed, let's try again:

        var optPass = optPass || {};
        var opts = Object.assign({
            nodeFrom: null // input
            , slotFrom: null // input
            , nodeTo: null   // output
            , slotTo: null   // output
            , position: []	// pass the event coords
            , nodeType: null	// choose a nodetype to add, AUTO to set at first good
            , posAdd: [0, 0]	// adjust x,y
            , posSizeFix: [0, 0] // alpha, adjust the position x,y based on the new node size w,h
        }
            , optPass
        );
        var that = this;

        var isFrom = opts.nodeFrom && opts.slotFrom !== null;
        var isTo = !isFrom && opts.nodeTo && opts.slotTo !== null;

        if (!isFrom && !isTo) {
            console.warn("No data passed to createDefaultNodeForSlot " + opts.nodeFrom + " " + opts.slotFrom + " " + opts.nodeTo + " " + opts.slotTo);
            return false;
        }
        if (!opts.nodeType) {
            console.warn("No type to createDefaultNodeForSlot");
            return false;
        }

        var nodeX = isFrom ? opts.nodeFrom : opts.nodeTo;
        var slotX = isFrom ? opts.slotFrom : opts.slotTo;

        var iSlotConn = false;
        switch (typeof slotX) {
            case "string":
                iSlotConn = isFrom ? nodeX.findOutputSlot(slotX, false) : nodeX.findInputSlot(slotX, false);
                slotX = isFrom ? nodeX.outputs[slotX] : nodeX.inputs[slotX];
                break;
            case "object":
                // ok slotX
                iSlotConn = isFrom ? nodeX.findOutputSlot(slotX.name) : nodeX.findInputSlot(slotX.name);
                break;
            case "number":
                iSlotConn = slotX;
                slotX = isFrom ? nodeX.outputs[slotX] : nodeX.inputs[slotX];
                break;
            case "undefined":
            default:
                // bad ?
                //iSlotConn = 0;
                console.warn("Cant get slot information " + slotX);
                return false;
        }

        if (slotX === false || iSlotConn === false) {
            console.warn("createDefaultNodeForSlot bad slotX " + slotX + " " + iSlotConn);
        }

        // check for defaults nodes for this slottype
        var fromSlotType = slotX.type == LiteGraph.EVENT ? "_event_" : slotX.type;
        var slotTypesDefault = isFrom ? LiteGraph.slot_types_default_out : LiteGraph.slot_types_default_in;
        if (slotTypesDefault && slotTypesDefault[fromSlotType]) {
            if (slotX.link !== null) {
                // is connected
            } else {
                // is not not connected
            }

            nodeNewType = optPass.nodeType; // I've changed this line!

            if (nodeNewType) {
                var nodeNewOpts = false;
                if (typeof nodeNewType == "object" && nodeNewType.node) {
                    nodeNewOpts = nodeNewType;
                    nodeNewType = nodeNewType.node;
                }

                //that.graph.beforeChange();

                var newNode = LiteGraph.createNode(nodeNewType);
                if (newNode) {
                    // if is object pass options
                    if (nodeNewOpts) {
                        if (nodeNewOpts.properties) {
                            for (var i in nodeNewOpts.properties) {
                                newNode.addProperty(i, nodeNewOpts.properties[i]);
                            }
                        }
                        if (nodeNewOpts.inputs) {
                            newNode.inputs = [];
                            for (var i in nodeNewOpts.inputs) {
                                newNode.addOutput(
                                    nodeNewOpts.inputs[i][0],
                                    nodeNewOpts.inputs[i][1]
                                );
                            }
                        }
                        if (nodeNewOpts.outputs) {
                            newNode.outputs = [];
                            for (var i in nodeNewOpts.outputs) {
                                newNode.addOutput(
                                    nodeNewOpts.outputs[i][0],
                                    nodeNewOpts.outputs[i][1]
                                );
                            }
                        }
                        if (nodeNewOpts.title) {
                            newNode.title = nodeNewOpts.title;
                        }
                        if (nodeNewOpts.json) {
                            newNode.configure(nodeNewOpts.json);
                        }

                    }

                    // add the node
                    that.graph.add(newNode);
                    newNode.pos = [opts.position[0] + opts.posAdd[0] + (opts.posSizeFix[0] ? opts.posSizeFix[0] * newNode.size[0] : 0)
                        , opts.position[1] + opts.posAdd[1] + (opts.posSizeFix[1] ? opts.posSizeFix[1] * newNode.size[1] : 0)]; //that.last_click_position; //[e.canvasX+30, e.canvasX+5];*/

                    //that.graph.afterChange();

                    // connect the two!
                    if (isFrom) {
                        opts.nodeFrom.connectByType(iSlotConn, newNode, fromSlotType);
                    } else {
                        opts.nodeTo.connectByTypeOutput(iSlotConn, newNode, fromSlotType);
                    }

                    // if connecting in between
                    if (isFrom && isTo) {
                        // TODO
                    }

                    return true;

                } else {
                    console.log("failed creating " + nodeNewType);
                }
            }
        }
        return false;



    }
};

function generateNodeKey(node) {
    let type = node.type;
    let inputs = node.inputs ? node.inputs.map(input => `[${input.type}]`).join(",") : "";
    let outputs = node.outputs ? node.outputs.map(output => `[${output.type}]`).join(",") : "";
    return `${type}|${inputs}|${outputs}`;
}

function findTopFrequentNodes(isFrom, fromSlotType, topN = 3) {
    var selectionFrequency = JSON.parse(localStorage.getItem("nodeSelectionFrequency") || "{}");
    let candidates = [];

    for (let key in selectionFrequency) {
        let [type, inputs, outputs] = key.split("|");
        if (isFrom ? inputs.includes(`[${fromSlotType}]`) : outputs.includes(`[${fromSlotType}]`)) {
            candidates.push({ type: type, frequency: selectionFrequency[key] });
        }
    }

    // Sort candidates by frequency in descending order
    candidates.sort((a, b) => b.frequency - a.frequency);

    // Return the types of the top N candidates
    return candidates.slice(0, topN).map(c => c.type);
}

// To reset the tracker, use localStorage.removeItem('nodeSelectionFrequency');