import * as Promise from 'bluebird';
import { EventEmitter2 } from 'eventemitter2';
/**
 * sync remote model data on server
 */
export declare class ModelProxy extends EventEmitter2 {
    protected broker: Broker;
    protected keypath: string;
    protected data: any;
    id: string | number;
    constructor(broker: Broker, keypath: string, data: any);
    getModel(keypath: string): PromiseLike<ModelProxy>;
    replace(data: any): void;
    /**
     * return Rx.Observable
     */
    observe(event: string): void;
    on(evt: string, handler: Function): this;
    dispose(): void;
}
export interface ModelSpec {
    className: string;
    id: string | number;
    data: any;
}
export declare class ModelContainerProxy extends ModelProxy {
    protected broker: Broker;
    protected keypath: string;
    protected data: any;
    dataMap: {};
    constructor(broker: Broker, keypath: string, data: any);
    getModel(keypath: string): PromiseLike<ModelProxy>;
    forEach(cb: Function): this;
    forEachValue(cb: Function): this;
}
/**
 * class: Broker(socket)
 * acts as a client endpoint for remote controller on server
 */
export declare class Broker {
    private socket;
    private __requests;
    private __proxies;
    private __reqId;
    onconnected: Function;
    constructor(socket: SocketIOClient.Socket);
    noop(): void;
    /**
     * create a local proxy to sync with remote model
     */
    getModel(keypath: string): PromiseLike<ModelProxy>;
    getModels(...keypaths: string[]): PromiseLike<ModelProxy[]>;
    /**
     * get multi models
     */
    getMultiModels(...keypaths: string[]): PromiseLike<{
        [keypath: string]: ModelProxy;
    }>;
    register(keypath: string, model: ModelProxy): ModelProxy;
    unregister(keypath: any): void;
    /**
     * send a "synchronic" request to remote controller and wait for a response
     */
    invoke(method: string, args: any, timeout?: number): Promise<{}>;
    /**
     * subscribe specific event from a remote model
     */
    subscribe(keypath: string, evt: string): this;
    /**
     *
     */
    unsubscribe(keypath: string, evt: string): this;
    /**
     * handle request timeout error;
     */
    __handleTimeout(broker: Broker, reqId: number): void;
}
export declare class Client {
    private socket;
    private controller;
    private initialized;
    constructor(address: string, callback: Function);
    static connect(address: string, callback: Function): PromiseLike<Client>;
}
