var Corona = {}

class Proxy {
  constructor(broker, objid) {
    this.broker = broker;
    this.objid = objid;
  }

  on(evt, handler) {
    this.broker.subscribe(this.objid, evt, handler);
    return this;
  }
}

function __handleTimeout(broker, reqId) {
		let req = broker.__requests[reqId];
		if (req) {
    req.reject(new Error('timeout'))
    delete broker.__requests[reqId];
		}
}

/**
 * class: Broker(socket)
 *
 */
class Broker {
  constructor(socket) {
    this.socket = socket;
    this.__requests = {};
    this.__events = {};
    this.__reqId = 0;
    this.onconnected = this.noop;
    let self = this;
    socket.on('connect', function () {
      self.onconnected();
    }).on('event', (objid, eventName, args) => {
      // TODO: use pubsub to do event routing
      let objevts = self.__events[objid];
      if (!objevts) {
        return console.log('no such object proxy')
      } else {
        objevts = objevts[eventName];
        if (!objevts) {
          return
        }
        objevts.forEach(function (h) {
          return h.apply(null, args);
        });
      }
    }).on('rpc:result', (reqId, result) => {
      let req = self.__requests[reqId];
      if (req) {
        req.resolve(result);
        clearTimeout(req.timeout);
        delete self.__requests[reqId];
      } else {
        console.log('req doesnt exist')
      }
    }).on('rpc:error', (reqId, error) => {
      let req = self.__requests[reqId];
      if (req) {
        req.reject(error);
        clearTimeout(req.timeout);
        delete self.__requests[reqId];
      } else {
        console.log('req doesnt exist')
      }
    }).on('meta:methods', (methods) => {
      methods.forEach(m => {
        this[m] = function (...args) {
          this.invoke(m, args);
        }.bind(this)
      })
    });
  }

  noop() { }

  proxy(objid) {
    return new Proxy(this, objid);
  }

  invoke(method, args, timeout) {
    let reqId = this.__reqId++, self = this;
    if (!timeout) {
      timeout = 5000;
    }
    console.log('invoke', method)
    this.socket.emit('rpc:invoke', method, reqId, args);
    let timer = setTimeout(__handleTimeout, timeout, this, reqId);
    return new Promise((resolve, reject) => {
      self.__requests[reqId] = {
        resolve: resolve,
        reject: reject,
        timeout: timer
      }
    });
  }

  subscribe(objid, evt, handler) {
    this.socket.emit('subscribe', objid, evt);
    let objevents = this.__events[objid];
    if (!objevents) {
      objevents = this.__events[objid] = {};
    }
    if (!objevents[evt]) {
      objevents[evt] = [];
    }
    objevents[evt].push(handler);

    return this;
  }
}

Corona.Broker = Broker;
Corona.Client = {
  connect: function(address, callback){
    this.socket = io.connect(address);
    this.controller = new Broker(this.socket);
    this.socket.on('initialized', () => {
      if(!this.initialized){
        this.initialized = true;
        callback(this.controller);
      }
    });
  }
}
