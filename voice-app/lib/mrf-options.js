'use strict';
function localMrfOptions(config){return {address:config.host,port:config.port,secret:config.secret,listenAddress:'127.0.0.1',advertisedAddress:'127.0.0.1',listenPort:0};}
module.exports={localMrfOptions};
