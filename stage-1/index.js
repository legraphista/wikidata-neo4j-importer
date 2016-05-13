'use strict';
const helper = require('./helpers');
const ETA = require('../helper').ETA;

const config = require('../config.json');

const makeItemBuffer = (lineReader) => {

    let line;

    const itemBuffer = [];

    while (itemBuffer.length < config.bucket && (line = lineReader.next())) {
        line = line
            .toString()
            .trim()
            .slice(0, -1);


        // if it's the start or end of the the 72 GB of array, we ignore it
        if (line.length < 2) continue;

        const json = JSON.parse(line);
        const item = helper.extractNodeData(json);

        itemBuffer.push(item);
    }

    return itemBuffer;
};

/**
 * here we add all the nodes in the DB (item and property)
 * @param {Driver} neo4j
 * @param {LineByLine} lineReader
 * @param {function(Error)} callback
 */
const stage1 = function(neo4j, lineReader, callback) {

    let lines = lineReader.skip;

    console.log('Starting node creation...');
    let session = neo4j.session();
    const eta = new ETA(lineReader.total);

    var _done = function (e) {
        _done = _doWork = () => null;
        session.close();
        callback(e);
    };

    let buffer = makeItemBuffer(lineReader);

    var _doWork = function() {
        // if there is no buffer we wait
        if (!buffer) {
            return setImmediate(_doWork);
        }
        if (!buffer.length) return _done();

        console.log('Imported', lines, 'lines');
        console.log((((lines / lineReader.total) * 100000) | 0) / 1000 + '%', 'done!', ' -> ', 'Remaining', eta.pretty(lines));

        lines += buffer.length;

        session
            .run(`
                    UNWIND {buffer} AS item WITH item
                    WHERE item.type = {item}
                    WITH item
                    MERGE (n:Item {id: item.id})
                        ON CREATE SET 
                            n = item
                    RETURN null
                    
                UNION
                
                    UNWIND {buffer} AS item WITH item
                    WHERE item.type = {prop}
                    WITH item
                    MERGE (n:Property {id: item.id})
                        ON CREATE SET 
                            n = item
                    RETURN null

            `, { buffer, item: helper.type.item, prop: helper.type.prop })
            .then(setTimeout(_doWork, 1000))
            .catch(_done);
        buffer = null;

        // after we sand that buffer, we make another one while we wait
        // because node is not truly async, we make buffer on set immediate in order for the
        // transaction to do it's magic
        setImmediate(() => {
            console.log('making buffer');
            buffer = makeItemBuffer(lineReader);
        });
    };

    for(let i = 0; i < (config.concurrency || 4); i++){
        setTimeout(_doWork, (Math.random() + i) * 500);
    }
};


module.exports = stage1;