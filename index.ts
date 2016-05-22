import * as io from 'socket.io-client';
const MAX_SAFE_INTEGER = 9007199254740990
/**
 * 
 */
export class BlankProxy {
  constructor(protected broker: Broker, protected objid: string) {

  }

  /**
   * binding a handler to a remote model event;
   */
  on(evt: string, handler: (...args) => any): this {
    this.broker.subscribe(this.objid, evt, handler);
    return this;
  }
}

/**
 * sync remote model data on server
 */
export class Proxy extends BlankProxy {

}

/**
 * define a struct for a pending request to server controller;  
 */
interface RequestSpec {
  resolve: Function;
  reject: Function;
  timeout: number;
}

/**
 * class: Broker(socket)
 * acts as a client endpoint for remote controller on server 
 */
export class Broker {
  private __requests: { [id: number]: RequestSpec } = {};
  private __events: any = {};
  private __reqId: number = 0;
  public onconnected: Function = this.noop;

  constructor(private socket: SocketIOClient.Socket) {
    let self = this;
    socket.on('connect', () => this.onconnected())
      .on('event', (objid, eventName, args) => {
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
        let req = this.__requests[reqId];
        if (req) {
          req.resolve(result);
          clearTimeout(req.timeout);
          delete self.__requests[reqId];
        } else {
          console.log('req doesnt exist')
        }
      }).on('rpc:error', (reqId, error) => {
        let req = this.__requests[reqId];
        if (req) {
          req.reject(error);
          clearTimeout(req.timeout);
          delete this.__requests[reqId];
        } else {
          console.log('req doesnt exist')
        }
      }).on('meta:methods', (methods) => {
        console.log('server exposed:', methods)
        methods.forEach(m => {
          this[m] = function (...args) {
            this.invoke(m, args);
          }.bind(this)
        })
      });
  }

  noop() { }

  /**
   * create a local proxy to sync with remote model
   */
  proxy(objid) {
    return new Proxy(this, objid);
  }

  /**
   * send a "synchronic" request to remote controller and wait for a response
   */
  invoke(method, args, timeout) {
    let reqId = this.__reqId++, self = this;
    if(reqId >= MAX_SAFE_INTEGER){
      this.__reqId = 0;
    }
    if (!timeout) {
      timeout = 5000;
    }
    console.log('invoke', method)
    this.socket.emit('rpc:invoke', method, reqId, args);
    let timer = setTimeout(this.__handleTimeout, timeout, this, reqId);
    return new Promise((resolve, reject) => {
      self.__requests[reqId] = {
        resolve: resolve,
        reject: reject,
        timeout: timer
      }
    });
  }

  /**
   * subscribe specific event from a remote model
   */
  subscribe(objid: string, evt: string, handler: (...any) => any): this {
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

  /**
   * handle request timeout error; 
   */
  __handleTimeout(broker: Broker, reqId: number) {
    let req = broker.__requests[reqId];
    if (req) {
      req.reject(new Error('timeout'))
      delete broker.__requests[reqId];
    }
  }
}



export var Client = {
  connect: function (address: string, callback: Function) {
    this.socket = io(address);
    this.controller = new Broker(this.socket);
    this.client.on('initialized', () => {
      if (!this.initialized) {
        this.initialized = true;
        callback(this.controller);
      }
    });
  }
}
