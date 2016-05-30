import * as io from 'socket.io-client';
import * as Promise from 'bluebird'
import {EventEmitter2} from 'eventemitter2';
import {pick, mapValues, merge, set} from 'lodash';

const MAX_SAFE_INTEGER = 9007199254740990;


class ReactBinding {
  constructor(model: ModelProxy, target: any) {

  }
}
/**
 * sync remote model data on server
 */
export class ModelProxy extends EventEmitter2 {
  public id: string | number;
  constructor(protected broker: Broker, protected keypath: string, protected data: any) {
    super({ wildcard: true, maxListeners: 255 });
    this.id = data.id;
    let initialized = false
    this.on('change', (keypath, value) => {
      if (initialized) {
        set(this.data, keypath, value);
      }
    });
    setImmediate(() => {
      Object.keys(data).forEach(k => this.emit('change', k, data[k]));
      initialized = true
    })
  }

  getModel(keypath: string): PromiseLike<ModelProxy> {
    return this.broker.getModel(`${this.keypath}.${keypath}`);
  }

  protected _set(keypath: string, value) {
    if (!keypath || keypath === '') {
      this.data = value;
      return;
    }
    
    if (!this.data) {
      this.data = {};
    }

    let keypaths = keypath.split('.')
    let ret = this.data;
    let last = keypaths.pop();
    keypaths.forEach((p) => {
      if (!ret[p]) {
        ret[p] = {}
      }
      ret = ret[p];
    })
    ret[last] = value;
  }

  replace(data) {
    this.data = data;
  }

  /**
   * return Rx.Observable
   */
  observe(event: string) {
    // return Rx.Observable
  }

  on(evt: string, handler: Function) {
    this.broker.subscribe(this.keypath, evt);
    super.on(evt, handler);
    return this;
  }

  // emit(event: string, ...args: any[]) {
  //   //TODO: propagation
  //   return super.emit(event, ...args);
  // }

  dispose() {
    this.removeAllListeners();
  }
}

export interface ModelSpec {
  className: string;
  id: string | number;
  data: any;
}


export class ModelContainerProxy extends ModelProxy {
  constructor(protected broker: Broker, protected keypath: string, protected data: any) {
    super(broker, keypath, {});
    Object.keys(data).forEach((k) => {
      let p = this.keypath + '.' + k;
      let m = createProxy(data[k], this.broker, p);
      this.data[k] = m
      broker.register(p, m);
    })

    this.on('add', (id:string, modelSpec: ModelSpec) => {
      debugger
      id = id.toString();
      let p = this.keypath + '.' + id;
      this.data[id] = createProxy(modelSpec, this.broker, p)  
      broker.register(p, this.data[id]);
    });

    this.on('remove', (index) => {
      var m = this.data[index];
      if (m) {
        delete this.data[index]
        m.dispose();
        broker.unregister(this.keypath + '.' + index);
      }
    });
  }

  getModel(keypath: string): PromiseLike<ModelProxy> {
    if (keypath == '') {
      return Promise.resolve(this);
    }

    var keys = keypath.split('.')
    let i = keys.shift();

    if (keys.length == 0) {
      return Promise.resolve(this.data[i]);
    } else {
      return this.data[i].getModel(keys.join('.'))
    }
  }

  forEach(cb: Function): this {
    Object.keys(this.data).forEach((k) => cb(this.data[k], k));
    return this;
  }

  forEachValue(cb: Function): this {
    Object.keys(this.data).forEach(k => cb(this.data[k].data, k));
    return this
  }
}

var ProxyConstructors = {
  'Model': ModelProxy,
  'ModelContainer': ModelContainerProxy
}

function createProxy(modelSpec: ModelSpec, broker: Broker, keypath: string): ModelProxy {
  let ctor = ProxyConstructors[modelSpec.className]
  if (ctor) {
    return new ctor(broker, keypath, modelSpec.data);
  } else {
    throw new Error('Cannot find that proxy for the class')
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
  private __proxies: { [keypath: string]: ModelProxy } = {};
  private __reqId: number = 0;
  public onconnected: Function = this.noop;

  constructor(private socket: SocketIOClient.Socket) {

    socket.on('connect', () => this.onconnected())
      .on('event', (keypath, eventName, ...args) => {
        // TODO: use pubsub to do event routing
        let m = this.__proxies[keypath];
        if (!m) {
          console.log('no such object proxy')
          return
        } else {
          m.emit(eventName, ...args);

          // propagation events
          let k = keypath.split('.'),
            sum = [],
            last = k.pop();
          while (k.length > 0) {
            sum.push([k.join('.'), last]);
            let i = k.pop()
            last = i + '.' + last;
          }

          sum.forEach(([prefix, path]) => {
            let m = this.__proxies[prefix];
            if (m)
              // m.emit(eventName + '.' + path, path, ...args);
              m.emit(path + '.' + eventName, path, ...args);
          })
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
          if (!this[m]) {
            this[m] = function (...args) {
              this.invoke(m, args);
            }.bind(this)
          }
        })
      });
  }

  noop() { }

  /**
   * create a local proxy to sync with remote model
   */
  getModel(keypath: string): PromiseLike<ModelProxy> {
    let p = this.__proxies[keypath];
    if (p) {
      return Promise.resolve(p);
    }
    return this.invoke('getModelSpec', [keypath]).then((data: ModelSpec) => {
      return this.__proxies[keypath] = createProxy(data, this, keypath);
    })
  }

  getModels(keypaths: string[]): PromiseLike<ModelProxy[]> {
    return this.getMultiModels(keypaths).then((maps) => {
      return keypaths.map(k => maps[k]);
    })
  }

  /**
   * get multi models
   */
  getMultiModels(keypaths: string[]): PromiseLike<{ [keypath: string]: ModelProxy }> {
    let ret = pick(this.__proxies, keypaths);

    return this.invoke('getMultiModelSpec', [keypaths]).then((specs) => {
      let m = mapValues(specs, (s, keypath) => createProxy(s, this, keypath))
      this.__proxies = merge(this.__proxies, m);
      return merge(ret, m);
    })
  }

  register(keypath: string, model: ModelProxy) {
    this.__proxies[keypath] = model;
    return model;
  }
  
  unregister(keypath) {
    delete this.__proxies[keypath];
  }

  /**
   * send a "synchronic" request to remote controller and wait for a response
   */
  invoke(method: string, args, timeout: number = 5000) {
    let reqId = this.__reqId++;
    if (!(args instanceof Array)) {
      args = [args];
    }
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
  subscribe(keypath: string, evt: string): this {
    this.socket.emit('subscribe', keypath, evt);
    return this;
  }

  /**
   *
   */
  unsubscribe(keypath: string, evt: string): this {
    this.socket.emit('unsubscribe', keypath, evt);

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
  private socket: SocketIOClient.Socket;
  private controller: Broker;
  private initialized: boolean = false;

  constructor(address: string, callback: Function) {
    this.socket = io(address);
    this.socket.on('initialized', () => {
      if (!this.initialized) {
        this.initialized = true;
        callback(this.controller);
      }
    });
    this.controller = new Broker(this.socket);
  }

  static connect(address: string, callback: Function): PromiseLike<Client> {
    return new Promise(resolve => new Client(address, resolve));
  }
}
