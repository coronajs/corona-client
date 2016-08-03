"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var io = require('socket.io-client');
var Promise = require('bluebird');
var eventemitter2_1 = require('eventemitter2');
var lodash_1 = require('lodash');
var MAX_SAFE_INTEGER = 9007199254740990;
var ReactBinding = (function () {
    function ReactBinding(model, target) {
    }
    return ReactBinding;
}());
/**
 * sync remote model data on server
 */
var ModelProxy = (function (_super) {
    __extends(ModelProxy, _super);
    function ModelProxy(broker, keypath, data) {
        var _this = this;
        _super.call(this, { wildcard: true, maxListeners: 255 });
        this.broker = broker;
        this.keypath = keypath;
        this.data = data;
        this.id = data.id;
        var initialized = false;
        this.on('change', function (keypath, value) {
            if (initialized) {
                lodash_1.set(_this.data, keypath, value);
            }
        });
        setImmediate(function () {
            Object.keys(data).forEach(function (k) { return _this.emit('change', k, data[k]); });
            initialized = true;
        });
    }
    ModelProxy.prototype.getModel = function (keypath) {
        return this.broker.getModel(this.keypath + "." + keypath);
    };
    // protected _set(keypath: string, value) {
    //   if (!keypath || keypath === '') {
    //     this.data = value;
    //     return;
    //   }
    //   if (!this.data) {
    //     this.data = {};
    //   }
    //   let keypaths = keypath.split('.')
    //   let ret = this.data;
    //   let last = keypaths.pop();
    //   keypaths.forEach((p) => {
    //     if (!ret[p]) {
    //       ret[p] = {}
    //     }
    //     ret = ret[p];
    //   })
    //   ret[last] = value;
    // }
    ModelProxy.prototype.replace = function (data) {
        this.data = data;
    };
    /**
     * return Rx.Observable
     */
    ModelProxy.prototype.observe = function (event) {
        // return Rx.Observable
    };
    ModelProxy.prototype.on = function (evt, handler) {
        this.broker.subscribe(this.keypath, evt);
        _super.prototype.on.call(this, evt, handler);
        return this;
    };
    // emit(event: string, ...args: any[]) {
    //   //TODO: propagation
    //   return super.emit(event, ...args);
    // }
    ModelProxy.prototype.dispose = function () {
        this.removeAllListeners();
    };
    return ModelProxy;
}(eventemitter2_1.EventEmitter2));
exports.ModelProxy = ModelProxy;
var ModelContainerProxy = (function (_super) {
    __extends(ModelContainerProxy, _super);
    function ModelContainerProxy(broker, keypath, data) {
        var _this = this;
        _super.call(this, broker, keypath, {});
        this.broker = broker;
        this.keypath = keypath;
        this.data = data;
        this.dataMap = {};
        Object.keys(data).forEach(function (k) {
            var p = _this.keypath + '.' + k;
            var m = createProxy(data[k], _this.broker, p);
            _this.data[k] = m;
            broker.register(p, m);
        });
        this.on('add', function (id, modelSpec) {
            var p = _this.keypath + '.' + id;
            _this.data[id] = createProxy(modelSpec, _this.broker, p);
            broker.register(p, _this.data[id]);
            _this.dataMap[id] = _this.data[id].data;
        });
        this.on('remove', function (id) {
            var m = _this.data[id];
            if (m) {
                delete _this.data[id];
                m.dispose();
                broker.unregister(_this.keypath + '.' + id);
                delete _this.dataMap[id];
            }
        });
        // 处理dataMap
        this.on('*.change', function (id, prop, val) {
            // 如果之前的根不是 Object
            if (typeof _this.dataMap[id] != 'object') {
                lodash_1.set(_this.dataMap, id + "." + prop, val);
            }
            else if (!prop || prop === '' && typeof val != 'object') {
                _this.dataMap[id] = val;
            }
        });
        var self = this;
        this.forEachValue(function (data, key) {
            self.dataMap[key] = data;
        });
    }
    ModelContainerProxy.prototype.getModel = function (keypath) {
        if (keypath == '') {
            return Promise.resolve(this);
        }
        var keys = keypath.split('.');
        var i = keys.shift();
        if (keys.length == 0) {
            return Promise.resolve(this.data[i]);
        }
        else {
            return this.data[i].getModel(keys.join('.'));
        }
    };
    ModelContainerProxy.prototype.forEach = function (cb) {
        var _this = this;
        Object.keys(this.data).forEach(function (k) { return cb(_this.data[k], k); });
        return this;
    };
    ModelContainerProxy.prototype.forEachValue = function (cb) {
        var _this = this;
        Object.keys(this.data).forEach(function (k) { return cb(_this.data[k].data, k); });
        return this;
    };
    return ModelContainerProxy;
}(ModelProxy));
exports.ModelContainerProxy = ModelContainerProxy;
var ProxyConstructors = {
    'Model': ModelProxy,
    'ModelContainer': ModelContainerProxy
};
function createProxy(modelSpec, broker, keypath) {
    var ctor = ProxyConstructors[modelSpec.className];
    if (ctor) {
        return new ctor(broker, keypath, modelSpec.data);
    }
    else {
        throw new Error('Cannot find that proxy for the class');
    }
}
/**
 * class: Broker(socket)
 * acts as a client endpoint for remote controller on server
 */
var Broker = (function () {
    function Broker(socket) {
        var _this = this;
        this.socket = socket;
        this.__requests = {};
        this.__proxies = {};
        this.__reqId = 0;
        this.onconnected = this.noop;
        socket.on('connect', function () { return _this.onconnected(); })
            .on('event', function (keypath, eventName) {
            var args = [];
            for (var _i = 2; _i < arguments.length; _i++) {
                args[_i - 2] = arguments[_i];
            }
            // TODO: use pubsub to do event routing
            var m = _this.__proxies[keypath];
            if (!m) {
                console.log('no such object proxy');
                return;
            }
            else {
                m.emit.apply(m, [eventName].concat(args));
                // propagation events
                var k = keypath.split('.'), sum = [], last = k.pop();
                while (k.length > 0) {
                    sum.push([k.join('.'), last]);
                    var i = k.pop();
                    last = i + '.' + last;
                }
                sum.forEach(function (_a) {
                    var prefix = _a[0], path = _a[1];
                    var m = _this.__proxies[prefix];
                    if (m)
                        // m.emit(eventName + '.' + path, path, ...args);
                        m.emit.apply(m, [path + '.' + eventName, path].concat(args));
                });
            }
        }).on('rpc:result', function (reqId, result) {
            var req = _this.__requests[reqId];
            if (req) {
                req.resolve(result);
                clearTimeout(req.timeout);
                delete _this.__requests[reqId];
            }
            else {
                console.log('req doesnt exist');
            }
        }).on('rpc:error', function (reqId, error) {
            var req = _this.__requests[reqId];
            if (req) {
                req.reject(error);
                clearTimeout(req.timeout);
                delete _this.__requests[reqId];
            }
            else {
                console.log('req doesnt exist');
            }
        }).on('meta:methods', function (methods) {
            console.log('server exposed:', methods);
            methods.forEach(function (m) {
                if (!_this[m]) {
                    _this[m] = function () {
                        var args = [];
                        for (var _i = 0; _i < arguments.length; _i++) {
                            args[_i - 0] = arguments[_i];
                        }
                        this.invoke(m, args);
                    }.bind(_this);
                }
            });
        });
    }
    Broker.prototype.noop = function () { };
    /**
     * create a local proxy to sync with remote model
     */
    Broker.prototype.getModel = function (keypath) {
        var _this = this;
        var p = this.__proxies[keypath];
        if (p) {
            return Promise.resolve(p);
        }
        return this.invoke('getModelSpec', [keypath]).then(function (data) {
            return _this.__proxies[keypath] = createProxy(data, _this, keypath);
        });
    };
    Broker.prototype.getModels = function () {
        var keypaths = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            keypaths[_i - 0] = arguments[_i];
        }
        keypaths = lodash_1.flatten(keypaths);
        return this.getMultiModels(keypaths).then(function (maps) {
            return keypaths.map(function (k) { return maps[k]; });
        });
    };
    /**
     * get multi models
     */
    Broker.prototype.getMultiModels = function () {
        var _this = this;
        var keypaths = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            keypaths[_i - 0] = arguments[_i];
        }
        keypaths = lodash_1.flatten(keypaths);
        var ret = lodash_1.pick(this.__proxies, keypaths);
        return this.invoke('getMultiModelSpec', [keypaths]).then(function (specs) {
            var m = lodash_1.mapValues(specs, function (s, keypath) { return createProxy(s, _this, keypath); });
            _this.__proxies = lodash_1.merge(_this.__proxies, m);
            return lodash_1.merge(ret, m);
        });
    };
    Broker.prototype.register = function (keypath, model) {
        this.__proxies[keypath] = model;
        return model;
    };
    Broker.prototype.unregister = function (keypath) {
        delete this.__proxies[keypath];
    };
    /**
     * send a "synchronic" request to remote controller and wait for a response
     */
    Broker.prototype.invoke = function (method, args, timeout) {
        var _this = this;
        if (timeout === void 0) { timeout = 5000; }
        var reqId = this.__reqId++;
        if (!(args instanceof Array)) {
            args = [args];
        }
        if (reqId >= MAX_SAFE_INTEGER) {
            this.__reqId = 0;
        }
        console.log('invoke', method);
        this.socket.emit('rpc:invoke', method, reqId, args);
        var timer = setTimeout(this.__handleTimeout, timeout, this, reqId);
        return new Promise(function (resolve, reject) {
            _this.__requests[reqId] = {
                resolve: resolve,
                reject: reject,
                timeout: timer
            };
        });
    };
    /**
     * subscribe specific event from a remote model
     */
    Broker.prototype.subscribe = function (keypath, evt) {
        this.socket.emit('subscribe', keypath, evt);
        return this;
    };
    /**
     *
     */
    Broker.prototype.unsubscribe = function (keypath, evt) {
        this.socket.emit('unsubscribe', keypath, evt);
        return this;
    };
    /**
     * handle request timeout error;
     */
    Broker.prototype.__handleTimeout = function (broker, reqId) {
        var req = broker.__requests[reqId];
        if (req) {
            req.reject(new Error('timeout'));
            delete broker.__requests[reqId];
        }
    };
    return Broker;
}());
exports.Broker = Broker;
var Client = (function () {
    function Client(address, callback) {
        var _this = this;
        this.initialized = false;
        this.socket = io(address);
        var timeout = setTimeout(function () {
            throw new Error('wait for server initialized timeout');
        }, 10000);
        this.socket.on('initialized', function () {
            if (!_this.initialized) {
                _this.initialized = true;
                clearTimeout(timeout);
                callback(_this.controller);
            }
        });
        this.controller = new Broker(this.socket);
    }
    Client.connect = function (address, callback) {
        return new Promise(function (resolve) { return new Client(address, resolve); });
    };
    return Client;
}());
exports.Client = Client;
