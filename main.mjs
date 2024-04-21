import rdf from '@zazuko/env-node'
import SHACLValidator from 'rdf-validate-shacl'
import { toSparql } from 'clownface-shacl-path'


const shapes = await rdf.dataset().import(rdf.fromFile('./data/simple3.ttl'))
const validator = new SHACLValidator(shapes, { factory: rdf })

const { sh } = validator.ns
const schema = rdf.namespace('http://schema.org/')

var objects = []
var links = []
var processed = {}
var idx = 0;

function get_id() {
    idx = idx + 1;
    return idx;
}

function get_without_prefix(predicate) {
    return predicate.substring(schema.length);
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
        case sh.property:
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
    //console.log(node_pointer);

    if (node_pointer.value == undefined) {
        throw "undefined";
    }

    //console.log(validator.ns.rdf.nil);
    
    if (node_pointer.value == validator.ns.rdf.nil.value) {
        return [];
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

function process_in(parent, in_obj) {
    parent.compartments.push(new Compartment(sh.in.value, get_in_str(in_obj)));
}

function process_languageIn(parent, in_obj) {
    parent.compartments.push(new Compartment(sh.languageIn.value, get_in_str(in_obj)));
}

function process_logical_el(parent, logical_obj, logical_type) {
    var non_simple_found = false;


    console.log("process_logical_el");
    console.log(parent);
    console.log(logical_obj);
    console.log(logical_type);

     console.log("ALL LOGICAL ELEMENTS");
     console.log(get_all(logical_obj));
     console.log("ALL LOGICAL ELEMENTS OUT");

    get_all(logical_obj).forEach((obj) => {
        console.log(obj.value);
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
            validator.$shapes.dataset.match(obj.term, null, null, null)._quads.forEach((quad) => {
                links.push([el, process_object(quad, el)]);
            });
            
            links.push([parent, el]);    
        });

        return el;
        
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
}

class Predicate {
    constructor(value) {
        this.value = value;
    }

    toString() {
        return "PREDICATE: " + this.value;
    }
}

class NodeShape {
    constructor(shape) {
        this.id = get_id();


        console.log("PROCESS SHAPE!");
        //console.log(shape._context);
        //console.log(validator.$shapes.dataset.match(shape.value, null, null, null));

        this.name = get_without_prefix(shape.value);
        console.log(this.name);
        this.compartments = [];

        processed[shape.value] = this;

        validator.$shapes.dataset.match(shape.value, null, null, null)._quads.forEach((quad) => {
            console.log(quad);
            console.log(quad.predicate);
            
            if (is_simple(quad.predicate)) {
                this.compartments.push(get_simple_compartment(quad));
            } else {
                switch(quad.predicate.value) {
                    case sh.property.value:
                        if (!processed[quad.object.value]) {
                            var prop_obj = new PropertyShape(validator.$shapes.node(quad.object));
                            links.push([this, prop_obj]);
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
                    case sh.closed.value:
                        this.closed = true;
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
                    case validator.ns.rdf.type.value:
                        break;    
                    default:
                        console.log(quad);
                        throw "Unexpected SHACL construction inside Node Shape"; 
            }
        }
        });
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

        console.log(validator.$shapes.dataset.match(property.term, null, null, null)._quads);

        //this.name = get_without_prefix(property.value);
        this.compartments = [];

        processed[property.value] = this;

        validator.$shapes.dataset.match(property.term, null, null, null)._quads.forEach((quad) => {
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
}

class Object {
    constructor(name) {
        this.name = name;
        this.id = get_id();
    }

    toString() {
        return "Object: " + this.name + "| id: " + this.id;
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
}

class IgnoredProps {
    constructor() {
        this.id = get_id();
    }

    toString() {
        return "IgnoredProps\n";
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
            var shape_obj = new NodeShape(shape);
            objects.push(shape_obj);
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
}

main();