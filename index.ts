import * as io from 'socket.io-client';
import * as Promise from 'bluebird'
const MAX_SAFE_INTEGER = 9007199254740990;
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
BlankProxy.prototype['subscribe'] = BlankProxy.prototype.on
BlankProxy.prototype['addListener'] = BlankProxy.prototype.on
/**
 * sync remote model data on server
 */
export class ModelProxy extends BlankProxy {
  private value: any;
  constructor(protected broker: Broker, protected objid: string) {
    super(broker, objid);
    this.on('update', this.handleUpdate.bind(this))
  }

  handleUpdate(keypath, value) {
    this._set(keypath, value);
  }

  private _set(keypath, value) {
    if (!keypath || keypath === '') {
      this.value = value;
      return;
    }
    if(!this.value){
      this.value = {};
    }
    
    let keypaths = keypath.split('.')
    let ret = this.value;
    let last = keypaths.pop();
    keypaths.forEach((p) => {
      if(!ret[p]){
        ret[p] = {}
      }
      ret = ret[p];
    })
    ret[last] = value;
  }

  replace(data) {
    this.value = data;
  }
  
  /**
   * return Rx.Observable
   */
  observe(event:string){
    // return Rx.Observable
  }
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
  private __events: { [keypath: string]: { [eventName: string]: Array<Function> } } = {};
  private __reqId: number = 0;
  public onconnected: Function = this.noop;

  constructor(private socket: SocketIOClient.Socket) {

    socket.on('connect', () => this.onconnected())
      .on('event', (objid, eventName, args) => {
        // TODO: use pubsub to do event routing
        let objevts = this.__events[objid];
        if (!objevts) {
          return console.log('no such object proxy')
        } else {
          let handlers = objevts[eventName];
          if (!handlers) {
            return
          }
          handlers.forEach(function (h) {
            return h.apply(this, args);
          });
        }
      }).on('rpc:result', (reqId, result) => {
        let req = this.__requests[reqId];
        if (req) {
          req.resolve(result);
          clearTimeout(req.timeout);
          delete this.__requests[reqId];
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
  getModel(keypath: string) {
    let m = new ModelProxy(this, keypath);
    this.invoke('getModel', [keypath]).then((data) => {
      m.replace(data);
    })
    return m;
  }

  /**
   * send a "synchronic" request to remote controller and wait for a response
   */
  invoke(method: string, args, timeout: number = 5000) {
    let reqId = this.__reqId++;
    if (reqId >= MAX_SAFE_INTEGER) {
      this.__reqId = 0;
    }

    console.log('invoke', method);
    this.socket.emit('rpc:invoke', method, reqId, args);
    let timer = setTimeout(this.__handleTimeout, timeout, this, reqId);
    return new Promise((resolve, reject) => {
      this.__requests[reqId] = {
        resolve: resolve,
        reject: reject,
        timeout: timer
      }
    });
  }

  /**
   * subscribe specific event from a remote model
   */
  subscribe(keypath: string, evt: string, handler: Function): this {
    this.socket.emit('subscribe', keypath, evt);
    let objevents = this.__events[keypath];
    if (!objevents) {
      objevents = this.__events[keypath] = {};
    }
    if (!objevents[evt]) {
      objevents[evt] = [];
    }
    objevents[evt].push(handler);

    return this;
  }
  
  

  /**
   *
   */
  unsubscribe(keypath: string, evt: string, handler: Function): this {
    this.socket.emit('subscribe', keypath, evt);
    let objevents = this.__events[keypath];
    if (objevents && objevents[evt]) {
      let i = objevents[evt].indexOf(handler);
      objevents[evt].splice(i, 1);
    }
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

export class Client {
  private socket:SocketIOClient.Socket;
  private controller:Broker;
  private initialized: boolean=false;
  
  constructor(address: string, callback: Function) {
    this.socket = io(address);
    this.controller = new Broker(this.socket);
    this.socket.on('initialized', () => {
      if (!this.initialized) {
        this.initialized = true;
        callback(this.controller);
      }
    });
  }
  
  static connect (address: string, callback: Function):Client {
    return new Client(address, callback);
  }
}
