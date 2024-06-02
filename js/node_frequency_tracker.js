//
// Track the most frequently used nodes and inject them to the right-click context menu.
// This is an injection to ComfyUI's litegraph.js.
// Don't want this feature? Simply delete this file.
//

const originalAdd = LGraph.prototype.add;

LGraph.prototype.add = function (node, skip_compute_order) {
    originalAdd.apply(this, arguments);
};

//From: https://github.com/jagenjo/litegraph.js/blob/0555a2f2a3df5d4657593c6d45eb192359888195/src/litegraph.js#L11182
const originalShowConnectionMenu = LGraphCanvas.prototype.showConnectionMenu;
LGraphCanvas.prototype.showConnectionMenu = function(optPass) { // addNodeMenu for connection
    var optPass = optPass || {};
    var opts = Object.assign({   nodeFrom: null  // input
                                ,slotFrom: null // input
                                ,nodeTo: null   // output
                                ,slotTo: null   // output
                                ,e: null
                            }
                            ,optPass
                        );
    var that = this;
    
    var isFrom = opts.nodeFrom && opts.slotFrom;
    var isTo = !isFrom && opts.nodeTo && opts.slotTo;
    
    if (!isFrom && !isTo){
        console.warn("No data passed to showConnectionMenu");
        return false;
    }
    
    var nodeX = isFrom ? opts.nodeFrom : opts.nodeTo;
    var slotX = isFrom ? opts.slotFrom : opts.slotTo;
    
    var iSlotConn = false;
    switch (typeof slotX){
        case "string":
            iSlotConn = isFrom ? nodeX.findOutputSlot(slotX,false) : nodeX.findInputSlot(slotX,false);
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
            console.warn("Cant get slot information "+slotX);
            return false;
    }
        
    var options = ["Add Node",null];
    
    if (that.allow_searchbox){
        options.push("Search");
        options.push(null);
    }
    
    // get defaults nodes for this slottype
    var fromSlotType = slotX.type==LiteGraph.EVENT?"_event_":slotX.type;
    var slotTypesDefault = isFrom ? LiteGraph.slot_types_default_out : LiteGraph.slot_types_default_in;
    if(slotTypesDefault && slotTypesDefault[fromSlotType]){
        if(typeof slotTypesDefault[fromSlotType] == "object" || typeof slotTypesDefault[fromSlotType] == "array"){
            for(var typeX in slotTypesDefault[fromSlotType]){
                options.push(slotTypesDefault[fromSlotType][typeX]);
            }
        }else{
            options.push(slotTypesDefault[fromSlotType]);
        }
    }
    
    // build menu
    var menu = new LiteGraph.ContextMenu(options, {
        event: opts.e,
        title: (slotX && slotX.name!="" ? (slotX.name + (fromSlotType?" | ":"")) : "")+(slotX && fromSlotType ? fromSlotType : ""),
        callback: inner_clicked
    });
    
    // callback
    function inner_clicked(v,options,e) {
        //console.log("Process showConnectionMenu selection");
        switch (v) {
            case "Add Node":
                LGraphCanvas.onMenuAdd(null, null, e, menu, function(node){
                    if (isFrom){
                        opts.nodeFrom.connectByType( iSlotConn, node, fromSlotType );
                    }else{
                        opts.nodeTo.connectByTypeOutput( iSlotConn, node, fromSlotType );
                    }
                });
                break;
            case "Search":
                if(isFrom){
                    that.showSearchBox(e,{node_from: opts.nodeFrom, slot_from: slotX, type_filter_in: fromSlotType});
                }else{
                    that.showSearchBox(e,{node_to: opts.nodeTo, slot_from: slotX, type_filter_out: fromSlotType});
                }
                break;
            default:
                // check for defaults nodes for this slottype
                var nodeCreated = that.createDefaultNodeForSlot(Object.assign(opts,{ position: [opts.e.canvasX, opts.e.canvasY]
                                                                                    ,nodeType: v
                                                                                }));
                if (nodeCreated){
                    // new node created
                    //console.log("node "+v+" created")
                }else{
                    // failed or v is not in defaults
                }
                break;
        }
    }   
    
    return false;
};