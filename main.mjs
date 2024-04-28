import rdf from '@zazuko/env-node'
import SHACLValidator from 'rdf-validate-shacl'
import { toSparql } from 'clownface-shacl-path'
import { createRequire } from "module";

const FILE = 'simple3';
const VERSION = '8';

const require = createRequire(import.meta.url);


var config = null;
var sample_data = null;

var fs = require('fs');

var data = fs.readFileSync('extracted_config.json', 'utf-8');
config = JSON.parse(data);


const diagramTypeId =  config.types[0].object._id; // TODO
const diagramId = config.types[0].object.diagramId


const shapes = await rdf.dataset().import(rdf.fromFile('./data/' + FILE + '.ttl'))
const validator = new SHACLValidator(shapes, { factory: rdf })

const { sh } = validator.ns
const schema = rdf.namespace('http://schema.org/')

const schema_str = (schema.a.value).substring(0, schema.a.value.length-1);
const sh_str = (sh.a.value).substring(0, sh.a.value.length-1);

var objects = []
var links = []
var processed = {}
var idx = 0;

function get_id() {
    idx = idx + 1;
    let ret = 10000 + idx;
    return '111111111111' + ret.toString();
}

function get_without_prefix(predicate) {
    if (predicate.startsWith(schema_str)) {
        return predicate.substring(schema_str.length);
    } else if (predicate.startsWith(sh_str)) {
        return predicate.substring(sh_str.length);
    } else {
        console.log(predicate);
        console.log(schema_str);
        throw "Unknown prefix";
    }
}

function is_simple(predicate) {
    // console.log(sh.datatype);
    // console.log(validator.ns.rdf.type);
     //console.log(predicate);
    return [sh.datatype.value, 
            sh.nodeKind.value,
            sh.name.value, 
            sh.maxCount.value, 
            sh.minCount.value,
            sh.lessThan.value,
            sh.lessThanOrEquals.value,
            sh.equals.value,
            sh.disjoint.value,
            sh.maxExclusive.value,
            sh.minExclusive.value,
            sh.maxInclusive.value,
            sh.minInclusive.value,
            sh.minLength.value,
            sh.maxLength.value,
            sh.pattern.value,
            sh.uniqueLang.value,
            sh.severity.value,
            sh.class.value, // TODO check
            sh.hasValue.value, // TODO check
            sh.flags.value,
        ].includes(predicate.value);
}

function convertable_to_compartment(predicate) {
    return is_simple(predicate) || predicate.value == sh.in.value || predicate.value == sh.languageIn.value;
}

function get_simple_compartment(quad) {
    return new Compartment(quad.predicate.value, quad.object.value);
}

function process_object(quad, parent) {
    switch (quad.predicate.value) {
        case sh.property.value:
            if (processed[quad.object.value]) {
                return processed[quad.object.value];
            } else {
                return new PropertyShape(quad.object);
            }
        case sh.or.value:
        case sh.and.value:
        case sh.xone.value:
        case sh.not.value:
                return process_logical_el(parent, quad.object, quad.predicate.value);
        default:
            console.log(quad);
            throw "Unexpected SHACL construction while process link to SHACL object"
    }
}

function get_all(node) {
    // console.log(validator.$shapes.node(node_pointer));
    //console.log(node);
    var node_pointer = validator.$shapes.node(node);
    console.log(node_pointer.term);

    if (node_pointer.value == undefined) {
        throw "undefined in get_all";
    }

    //console.log(validator.ns.rdf.nil);
    
    if (node_pointer.value == validator.ns.rdf.nil.value) {
        return [];
    }
    //console.log(node_pointer.out(validator.ns.rdf.rest).terms.length);
    if (node_pointer.out(validator.ns.rdf.first).terms.length == 0) {
        return [node_pointer];
    }
  
    return [node_pointer.out(validator.ns.rdf.first)].concat(get_all(node_pointer.out(validator.ns.rdf.rest).term));
    

}

function get_in_str(in_obj) {
    var ss = "\n";

    get_all(in_obj).forEach((obj) => {
       ss = ss + "\t" + obj + "\n"; 
    });
    return ss;
}

// TODO combine into one method

function process_in(parent, in_obj) {
    parent.compartments.push(new Compartment(sh.in.value, get_in_str(in_obj)));
}

function process_languageIn(parent, in_obj) {
    parent.compartments.push(new Compartment(sh.languageIn.value, get_in_str(in_obj)));
}

function process_ignoredProperties(parent,ip_obj) {
    parent.compartments.push(new Compartment(sh.ignoredProperties.value, get_in_str(ip_obj)))
}

function process_logical_el(parent, logical_obj, logical_type) {
    var non_simple_found = false;


    console.log("process_logical_el");
    console.log(parent);
    console.log(logical_obj);
    console.log(logical_type);

     console.log("ALL LOGICAL ELEMENTS");
     var lol = get_all(logical_obj).terms
     console.log("ALL LOGICAL ELEMENTS lol");
     console.log(lol);
     console.log("ALL LOGICAL ELEMENTS starpterms");
    get_all(logical_obj).forEach((o) => {
        console.log(o.term);

        console.log("-----");
        
        validator.$shapes.dataset.match(o.term, null, null, null)._quads.forEach((quad) => {
        console.log(quad);
        });

        console.log("-----");
        
        validator.$shapes.dataset.match(null, null,o.term, null)._quads.forEach((quad) => {
        console.log(quad);
        });

        console.log("-----");


    });

     console.log("ALL LOGICAL ELEMENTS OUT");



    get_all(logical_obj).forEach((obj) => {
        console.log(obj.value);
        if (validator.$shapes.dataset.match(obj.term, null, null, null)._quads.size > 1) {
            non_simple_found = true;
        }
        validator.$shapes.dataset.match(obj.term, null, null, null)._quads.forEach((quad) => {
             console.log("LOGICAL EL LOOP");
             console.log(quad);
            // console.log(quad.predicate);
            
            if (!convertable_to_compartment(quad.predicate)) {
                non_simple_found = true;
            }
        });
    });

    console.log("non_simple_found: " + non_simple_found);

    if (non_simple_found) {
        var el = new LogicalEl(logical_type);
        objects.push(el);
        get_all(logical_obj).forEach((obj) => {
            var quads = validator.$shapes.dataset.match(obj.term, null, null, null)._quads;
            // console.log("quads.length");
            // console.log(quads.size);
            if (quads.size == 0) {
                throw "Something is wrong";
            }
            
            if (quads.size == 1) {
                quads.forEach((quad) => {
                    links.push([el, process_object(quad, el)]);
                });
         
            } else {
                console.log("HERE");
                console.log(obj.term);
                //console.log(obj.has(validator.ns.rdf.type, sh.NodeShape).terms.length);
                if (obj.has(validator.ns.rdf.type, sh.NodeShape).terms.length > 0) {
                    if (processed[obj.value]) {
                        links.push([el, processed[obj.value]]);
                    } else {
                        var nodeshape = new NodeShape(obj.term);
                        links.push([el, nodeshape]);
                    }
                   // objects.push(nodeshape);
                } else {
                    // Assume it is property
                    if (processed[obj.value]) {
                        links.push([el, processed[obj.value]]);
                    } else {
                        var propertyshape = new PropertyShape(obj.term);
                        links.push([el, propertyshape]);
                        // objects.push(propertyshape);
                    }
                }
            }
        });
        links.push([parent, el]);  
        return el; // TODO do we need return ? 
        
    } else {
        var ss = "";
        get_all(logical_obj).forEach((obj) => {
            validator.$shapes.dataset.match(obj.term, null, null, null)._quads.forEach((quad) => {
            if (is_simple(quad.predicate)) {
                ss = ss + "\t" + quad.predicate.value + " " + quad.object.value + "\n"; 
            } else if (quad.predicate.value == sh.in.value || quad.predicate.value == sh.languageIn.value) {
                ss = ss + "\t" + quad.predicate.value + " " + get_in_str(quad.object) + "\n"; 
            } else {
                throw "Unexpected SHACL construction inside logical element"
            }
            });
        });

        parent.compartments.push(new Compartment(logical_type, ss));
    }
}

class Compartment {
    constructor(type, value) {
        this.type = type;
        this.value = value;
    }

    toString() {
        return "[" + this.type + ": " + this.value + "]";
    }

    toJSON(boxName) {
        return get_compartment_JSON("sh:" + get_without_prefix(this.type), this.value, boxName);
    }
}

function get_compartment_JSON(name, value, boxName) {
    var comp_type = get_by_name(get_by_name(config.types[0].boxTypes, boxName).compartmentTypes, name).object

    return {
        _id: get_id(),
        projectId: "e37eAFfnFzoM7sKaZ", // TODO
        diagramId: comp_type.diagramId,
        elementId: comp_type.elementId,
        diagramTypeId: comp_type.diagramTypeId,
        elementTypeId: comp_type.elementTypeId,
        versionId: "HnfDuP7yoEdrduBT6",
        compartmentTypeId: comp_type._id,
        input: value,
        value: comp_type.prefix + value,
        index: comp_type.index,
        isObjectRepresentation: false,
        type: comp_type.inputType.inputType,
        styleId: comp_type.styles[0].id,
        style: comp_type.styles[0].style, 
        valueLC: (comp_type.prefix + value).toLowerCase(),
        compartmentTypeName: name,
        toolName: "Viziquer", // TODO
        toolId: "w8C38K9hR2cB4pafL" // TODO
    }

}

class Predicate {
    constructor(value) {
        this.value = value;
        this.id = get_id();
    }

    toString() {
        return "PREDICATE: " + this.value + "| id: " + this.id + "\n";
    }

    toJSON() {
        var box = get_empy_box("Relation", "Default", this.id);
        box.compartments.push(get_compartment_JSON("Name", this.value, "Predicate"))
        return box;
    }
}

class NodeShape {
    constructor(shape) {
        this.id = get_id();


        console.log("PROCESS SHAPE!");
        console.log(shape.value);
        console.log(shape);
        console.log(validator.$shapes.dataset.match(shape, null, null, null)._quads);

        this.name = get_without_prefix(shape.value);
        console.log(this.name);
        this.compartments = [];

        processed[shape.value] = this;

        validator.$shapes.dataset.match(shape, null, null, null)._quads.forEach((quad) => {
            console.log(quad);
            console.log(quad.predicate);
            
            if (is_simple(quad.predicate)) {
                this.compartments.push(get_simple_compartment(quad));
            } else {
                switch(quad.predicate.value) {
                    case sh.property.value:
                        // console.log("quad.object.value");
                        // console.log(quad.object.value);
                        // throw "remove me";
                        if (!processed[quad.object.value]) {
                            var prop_obj = new PropertyShape(quad.object);
                            links.push([this, prop_obj]);
                           // objects.push(prop_obj);
                        }
                        break;
                    case sh.targetClass.value:
                        var target_obj = new Class(quad.object.value);
                        links.push([target_obj, this]);
                        objects.push(target_obj);
                        break;
                    case sh.targetNode.value:
                        var target_obj = new Object(quad.object.value);
                        links.push([this, target_obj]);
                        objects.push(target_obj);
                        break;
                    case sh.targetSubjectsOf.value:
                        var pred_obj = new Predicate(quad.object.value);
                        links.push([pred_obj, this]); // TODO\
                        objects.push(pred_obj);
                        break;
                    case sh.targetObjectsOf.value:
                        var pred_obj = new Predicate(quad.object.value);
                        links.push([this, pred_obj]); // TODO
                        objects.push(pred_obj);
                        break;
                    case sh.target.value:
                        break; // TODO
                    case sh.ignored.value:
                        this.ignored = true;
                        break;
                    case sh.deactivated.value:
                        this.deactivated = true;
                        break;
                    case sh.closed.value:
                        this.closed = true;
                        break;
                    case sh.in.value:
                        process_in(this, quad.object);
                        break;
                    case sh.languageIn.value:
                        process_languageIn(this, quad.object);
                        break;
                    case sh.ignoredProperties.value:
                        process_ignoredProperties(this, quad.object);
                        break;   
                    case sh.or.value:
                    case sh.and.value:
                    case sh.xone.value:
                    case sh.not.value:
                        process_logical_el(this, quad.object, quad.predicate.value);           
                        break;
                    case sh.node.value:
                        if (processed[quad.object.value]) {
                            links.push([this, processed[quad.object.value]]);
                        } else {
                            // TODO check it is node shape
                            links.push([this, new NodeShape(quad.object)]);
                        } 
                    case validator.ns.rdf.type.value:
                        break;    
                    default:
                        console.log(quad);
                        throw "Unexpected SHACL construction inside Node Shape"; 
            }
        }
        });

        objects.push(this);
    }

    toString() {
        var ss =  "NodeShape: " + this.name + "| id: " + this.id + "\n";
        ss = ss + "Compartments: [ \n";
        this.compartments.forEach((comp) => {
            ss = ss + "\t" + comp.toString() +  "\n";
        });
        ss = ss + "]\n";
        return ss;
    }

    toJSON() {
        var style = "Default";
        if (this.closed) {
            style = "Closed";
        }
        var box = get_empy_box("NodeShape", style, this.id);
        box.compartments.push(get_compartment_JSON("Name", this.name, "NodeShape"))

        if (this.closed) {
            box.compartments.push(get_compartment_JSON("Closed", "true", "NodeShape"))
        }

        this.compartments.forEach((comp) => {
            box.compartments.push(comp.toJSON("NodeShape"));
        });

    
        return box;
    }

}

// TODO implement
function process_path(path_obj) {
    console.log("process_path");
    console.log(path_obj);
    console.log(toSparql(validator.$shapes.node(path_obj)).toString(({ prologue: false })));

    return toSparql(validator.$shapes.node(path_obj));
}

class PropertyShape {
    constructor(property) {
        this.id = get_id();

        console.log("PROCESS PROPERTY!");
        console.log(property.term);
        console.log(property.value);

        //console.log(validator.$shapes.dataset.match(property.term, null, null, null)._quads);

        //this.name = get_without_prefix(property.value);
        this.compartments = [];

        processed[property.value] = this;

        validator.$shapes.dataset.match(property, null, null, null)._quads.forEach((quad) => {
           // console.log(quad);
            if (is_simple(quad.predicate)) {
                console.log("SIMPLE!!!");
                this.compartments.push(get_simple_compartment(quad));
            } else {
                switch(quad.predicate.value) {
                    case sh.path.value: // TODO non trivial path
                        this.path = process_path(quad.object);
                        break;
                    case sh.in.value:
                        process_in(this, quad.object);
                        break;
                    case sh.languageIn.value:
                        process_languageIn(this, quad.object);
                        break;    
                    case sh.or.value:
                    case sh.and.value:
                    case sh.xone.value:
                    case sh.not.value: 
                        process_logical_el(this, quad.object, quad.predicate.value); 
                        break;
                    case sh.node.value:     
                        if (processed[quad.object.value]) {
                            links.push([this, processed[quad.object.value]]);
                        } else {
                            // TODO check it is node shape
                            links.push([this, new NodeShape(quad.object)]);
                        }        
                        break; 
                    case validator.ns.rdf.type.value:
                        break;
                    default:
                        console.log(quad);
                        throw "Unexpected SHACL construction in property"; 
            }
        }
        });

        objects.push(this);
        
    }

    toString() {
        var ss =  "PropertyShape: " + this.path.toString(({ prologue: false }))  + "| id: " + this.id  + "\n";
        ss = ss + "Compartments: [ \n";
        this.compartments.forEach((comp) => {
            ss = ss + "\t" + comp.toString() +  "\n";
        });
        ss = ss + "]\n";
        return ss;
    }

    toJSON() {
        var box = get_empy_box("PropertyShape", "Default", this.id);
        box.compartments.push(get_compartment_JSON("Path", this.path.toString(({ prologue: false })), "PropertyShape"))

        this.compartments.forEach((comp) => {
            box.compartments.push(comp.toJSON("PropertyShape"));
        });

        return box;
    }
}

class Object {
    constructor(name) {
        this.name = name;
        this.id = get_id();
    }

    toString() {
        return "Object: " + this.name + "| id: " + this.id;
    }

    toJSON() {
        var box = get_empy_box("Object", "Default", this.id);
        box.compartments.push(get_compartment_JSON("Name", this.name, "Object"))
        return box;
    }
}

class Class {
    constructor(name) {
        this.name = name;
        this.id = get_id();
    }

    toString() {
        return "Class: " + this.name + "| id: " + this.id;
    }

    toJSON() {
        var box = get_empy_box("Class", "Default", this.id);
        box.compartments.push(get_compartment_JSON("Name", get_without_prefix(this.name), "Class"))
        return box;
    }
}

// TODO compartmets possible
class LogicalEl {
    constructor(type) {
        this.type = type;
        this.id = get_id();
    }

    toString() {
        return "LogicalEl: " + this.type + "| id: " + this.id;
    }

    toJSON() {
        var box = get_empy_box("LogicalElement", "Default", this.id);
        box.compartments.push(get_compartment_JSON("TYPE",get_without_prefix(this.value).toUpperCase(), "LogicalElement"))
        return box;
    }
}

// class IgnoredProps {
//     constructor() {
//         this.id = get_id();
//     }

//     toString() {
//         return "IgnoredProps\n";
//     }
// }

function get_empty_diagram() {
    return {
        _id: get_id(),
        name: FILE + '_v' + VERSION,
        projectId: "e37eAFfnFzoM7sKaZ", // TODO 
        versionId: "HnfDuP7yoEdrduBT6",
        isLayoutComputationNeededOnLoad: 1,
        style: {
            fillPriority: "color",
            fill: "#ffffff",
            fillLinearGradientStartPointX: 0.5,
            fillLinearGradientStartPointY: 0,
            fillLinearGradientEndPointX: 0.5,
            fillLinearGradientEndPointY: 1,
            fillLinearGradientColorStops: [
                0,
                "white",
                1,
                "black"
            ],
            fillRadialGradientStartPointX: 0.5,
            fillRadialGradientStartPointY: 0.5,
            fillRadialGradientEndPointX: 0.5,
            fillRadialGradientEndPointY: 0.5,
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius: 1,
            fillRadialGradientColorStops: [
                0,
                "white",
                1,
                "black"
            ]
        },
        diagramTypeId: diagramTypeId,
        editorType: "ajooEditor",
        createdAt: "2024-04-11T04:17:43.004Z",
        createdBy: "c3TBoLRFSdGzyXsJ9",
        imageUrl: "http://placehold.it/770x347",
        edit: {
            action: "new",
            time: "2024-04-11T04:17:43.004Z",
            userId: "c3TBoLRFSdGzyXsJ9"
        },
        parentDiagrams: [],
        allowedGroups: [],
        seenCount: 1,
        diagramTypeName: config.types[0].object.name,
        toolName: "Viziquer", // TODO
        toolId: "w8C38K9hR2cB4pafL", // TODO
        elements: []
        }
}

function getLinkJSON(link) {
    var element_obj = get_by_name(config.types[0].lineTypes, "Connection");
    var style_obj = get_by_name(element_obj.object.styles, "Default");
    return {
        _id: get_id(),
        startElement: link[0].id,
        endElement: link[1].id,
        diagramId: diagramId, // TODO
        diagramTypeId: diagramTypeId,
        elementTypeId:  element_obj.object._id,
        style: {
            "elementStyle": {
                "stroke": "rgb(65,113,156)",
                "strokeWidth": 1,
                "shadowColor": "red",
                "shadowBlur": 0,
                "shadowOpacity": 1,
                "shadowOffsetX": 0,
                "shadowOffsetY": 0,
                "tension": 0,
                "opacity": 1,
                "dash": []
            },
            "startShapeStyle": {
                "fill": "rgb(65,113,156)",
                "fillPriority": "color",
                "stroke": "rgb(65,113,156)",
                "strokeWidth": 1,
                "shadowColor": "red",
                "shadowBlur": 0,
                "shadowOpacity": 1,
                "shadowOffsetX": 0,
                "shadowOffsetY": 0,
                "tension": 0,
                "opacity": 1,
                "dash": [],
                "radius": 7,
                "shape": "None"
            },
            "endShapeStyle": {
                "fill": "rgb(65,113,156)",
                "fillPriority": "color",
                "stroke": "rgb(65,113,156)",
                "strokeWidth": 1,
                "shadowColor": "red",
                "shadowBlur": 0,
                "shadowOpacity": 1,
                "shadowOffsetX": 0,
                "shadowOffsetY": 0,
                "tension": 0,
                "opacity": 1,
                "dash": [],
                "radius": 12,
                "shape": "Triangle"
            },
            "lineType": "Orthogonal"
        },
        styleId: style_obj.id,
        type: "Line",
        points: [
            345,
            538,
            345,
            601,
            380,
            601,
            380,
            663
        ],
        projectId: "e37eAFfnFzoM7sKaZ", // TODO
        versionId: "HnfDuP7yoEdrduBT6",
        elementTypeName: "Connection",
        toolName: "Viziquer",
        toolId: "w8C38K9hR2cB4pafL",
        compartments: []
    };
}

//elementTypeId
//style
//styleId
//elementTypeName

// function get_box_desc(boxTypeName, style) {
//     var element_obj = get_by_name(config.types.boxTypes, boxTypeName)
//     elementTypeId = element_obj.object._id
//     elementTypeName = boxTypeName
//     var style_obj = get_by_name(element_obj.object.styles, style)
//     style = {elementStyle: style_obj.elementStyle }
//     styleId = style_obj.id
// }

function get_by_name(arr, name) {
    console.log("get_by_name");
    console.log(arr);
    console.log(name);
    var ret = null;
    arr.forEach((obj) => {
        // console.log(obj.object.name == name);
         console.log(obj.name);
         console.log(name);
        if (obj.name == name) {
            ret = obj;
        }
        
        if (obj.object) {
            console.log(obj.object.name);
            console.log(obj.object.name.length);
            console.log(name.length);
            console.log(obj.object.name == name);
            if (obj.object.name == name) {
                ret = obj;
            }
        }
    });
    console.log("ret:");
    console.log(ret);
    return ret;
}

function get_empy_box(boxTypeName, style, id) {
    console.log(config.types[0].boxTypes);
    var element_obj = get_by_name(config.types[0].boxTypes, boxTypeName)
    console.log(element_obj);
    var style_obj = get_by_name(element_obj.object.styles, style)
    return {
        _id: id,
        diagramId: diagramId,
        diagramTypeId: diagramTypeId,
        type: "Box",
        elementTypeId: element_obj.object._id,
        elementTypeName: boxTypeName,
        style: {elementStyle: style_obj.elementStyle },
        styleId: style_obj.id,
        location: {x: 333, y: 195, width: 130, height: 83},
        projectId: "e37eAFfnFzoM7sKaZ",
        versionId: "HnfDuP7yoEdrduBT6",
        toolName: "Viziquer",
        toolId: "w8C38K9hR2cB4pafL",
        compartments: []
    }
}
async function main() {

   // console.log(shapes);

    console.log(validator);
    console.log('----------------------------------');
   // console.log(validator.shapesGraph.shapeNodesWithConstraints);

   // validator.shapesGraph.shapesWithTarget.forEach(kek => console.log(kek.constraints[0].shapeNodePointer))
  
//    console.log(validator.$shapes.has(rdf.type, sh.NodeShape).terms);
//    console.log('-----+++++++++++++++++++++++++++++');
    console.log(validator.$shapes.dataset._quads);

//    var shapeNodes = validator.$shapes.has(rdf.type, sh.NodeShape);

//    console.log(shapeNodes);

validator.$shapes.has(rdf.type, sh.NodeShape).toArray().forEach((shape) => {
    console.log(shape.term);
});
console.log('-----+++++++++++++++++++++++++++++');
    validator.$shapes.has(rdf.type, sh.NodeShape).toArray().forEach((shape) => {
        if (shape.value.startsWith('http://schema.org')) {
            console.log(shape.term);
            var shape_obj = new NodeShape(shape.term);
            //objects.push(shape_obj);
        }
        
   });
    // console.log(score.out(sh.targetClass).term);
        // console.log(score.out().toString());
        // console.log(validator.$shapes._context.dataset);

    console.log('++++++++++++++++++++++++++++++++++++++++++++++++++++++++');
    console.log('++++++++++++++++++++++++++++++++++++++++++++++++++++++++');
    console.log('++++++++++++++++++++++++FINISH++++++++++++++++++++++++++');
    console.log('++++++++++++++++++++++++++++++++++++++++++++++++++++++++');
    console.log('++++++++++++++++++++++++++++++++++++++++++++++++++++++++');

    objects.forEach((obj) => {
        console.log(obj.toString());
    });
    console.log('++++++++++++++++++++++++++++++++++++++++++++++++++++++++');
    links.forEach((link) => {
        console.log(link[0].id + " --> " + link[1].id);
    });
    
    data = fs.readFileSync('sample_data.json', 'utf-8');
    
    sample_data = JSON.parse(data);
    
    var diagram_obj = get_empty_diagram();

    objects.forEach((obj) => {
        // if (obj.toJSON() == null) {
        //     console.log(obj);
        //     throw "LOL"
        // }
        diagram_obj.elements.push(obj.toJSON());
    });

    links.forEach((link) => {
        diagram_obj.elements.push(getLinkJSON(link));
    })

    fs.writeFile('diagram_' + FILE + '_v' + VERSION + '.json', JSON.stringify({diagrams : [diagram_obj], project : sample_data.project}, null, "\t"), (err) => {
        if (err) throw err;
    })

}

main();
