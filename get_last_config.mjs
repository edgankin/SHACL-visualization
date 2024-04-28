import { createRequire } from "module";

const FILE = 'dump.json';

const require = createRequire(import.meta.url);

var fs = require('fs');

var data_to_parse = fs.readFileSync(FILE, 'utf-8');
var data = JSON.parse(data_to_parse);

var extraced_config = {}

extraced_config.tool = data.tool
extraced_config.types = [data.types[data.types.length -1]]
extraced_config.presentations = [data.presentations[data.types.length -1]]

console.log(extraced_config)

fs.writeFile('extracted_config.json', JSON.stringify(extraced_config, null, "\t"), (err) => {
    if (err) throw err;
})