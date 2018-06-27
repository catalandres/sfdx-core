/*
 * Copyright (c) 2016, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root  or https://opensource.org/licenses/BSD-3-Clause
 */

import { Time, TIME_UNIT } from '../util/time';
import { Org } from '../org';
import * as Faye from 'faye';
import { JsonMap } from '../types';
import { asString } from '../util/json';
import { Logger } from '../logger';
import { SfdxError } from '../sfdxError';
import { EventEmitter } from 'events';
import * as _ from 'lodash';
import { StatusResult } from './client';

/**
 * Comet client interface. The is to allow for mocking the inner client cometd implementation.
 * Generally this is the Faye interface but it could be an adapter for the cometd npm.
 */
export abstract class CometClient extends EventEmitter {
    // tslint:disable-next-line:no-unused-variable
    private url: string;

    protected constructor(url: string) {
        super();
        this.url = url;
    }

    public abstract disable(label: string): void;
    public abstract addExtension(extension: JsonMap): void;
    public abstract setHeader(name: string, value: string): void;
    public abstract handshake(callback: () => void): void;
    public abstract subscribe(channel: string, callback: (message: JsonMap) => void): CometSubscription;
    public abstract disconnect(): void;
}

/**
 * Inner streaming client interface. This implements the Cometd behavior.
 * Also allows for mocking the functional behavior.
 * @interface
 */
export interface StreamingClientIfc {
    getCometClient: (url: string) => CometClient;
    setLogger: (logLine: (message: string) => void) => void;
}

/**
 * The subscription object returned from the cometd subscribe object.
 */
export interface CometSubscription {
    callback(callback: () => void): void;
    errback(callback: (error: Error) => void): void;
}

/**
 * Options for the StreamingClient
 * @interface
 */
export interface StreamingOptions<T> {
    // The org streaming target.
    org: Org;
    // The hard timeout that happens with subscribe
    subscribeTimeout: Time;
    // The hard timeout that happens with a handshake.
    handshakeTimeout: Time;
    // The streaming channel aka topic
    channel: string;
    // The salesforce api version
    apiVersion: string;
    // The function for processing streaming messages
    streamProcessor: (message: JsonMap) => StatusResult<T>;
    // The function for build the inner client impl. Allows for mocking.
    streamingImpl: StreamingClientIfc;
}

/**
 * Default Streaming Options. Uses Faye as the cometd impl.
 */
export class DefaultStreamingOptions<T> implements StreamingOptions<T> {
    public apiVersion: string;
    public org: Org;
    public streamProcessor: (message: JsonMap) => StatusResult<T>;
    public subscribeTimeout: Time;
    public handshakeTimeout: Time;
    public channel: string;
    public streamingImpl: StreamingClientIfc;

    /**
     * Constructor for DefaultStreamingOptions
     * @param {Org} org The streaming target org
     * @param {string} apiVersion The salesforce api version
     * @param {string} channel The streaming channel or topic. If the topics is a system topic then api 36.0 is used.
     * System topics are deprecated.
     * @param {(message: JsonMap) => StatusResult<T>} streamProcessor The function the called can specify to process
     * streaming messages
     * @see StatusResult
     */
    constructor(org: Org, apiVersion: string, channel: string, streamProcessor: (message: JsonMap) => StatusResult<T>) {

        if (!apiVersion) {
            throw new SfdxError('Missing apiVersion', 'MissingArg');
        }

        if (!streamProcessor) {
            throw new SfdxError('Missing stream processor', 'MissingArg');
        }

        if (!org) {
            throw new SfdxError('Missing org', 'MissingArg');
        }

        if (!channel) {
            throw new SfdxError('Missing streaming channel', 'MissingArg');
        }

        this.org = org;
        this.apiVersion = apiVersion;

        if (_.startsWith(apiVersion, '/system')) {
            this.apiVersion = '36.0';
        }

        this.streamProcessor = streamProcessor;
        this.channel = channel;
        this.subscribeTimeout = new Time(3, TIME_UNIT.MINUTES);
        this.handshakeTimeout = new Time(1, TIME_UNIT.MINUTES);
        this.streamingImpl = {
            getCometClient: (url: string) => {
                return new Faye.Client(url);
            },
            setLogger: (logLine: (message: string) => void) => {
                Faye.logger = {};
                _.each(['info', 'error', 'fatal', 'warn', 'debug'], (element) => {
                    _.set(Faye.logger, element, logLine);
                });
            }
        };
    }
}

export enum StreamingConnectionState {
    CONNECTED
}

/**
 * Indicators to test error names for StreamingTimeouts
 */
export enum StreamingTimeoutError {
    HANDSHAKE = 'handshake',
    SUBSCRIBE = 'subscribe'
}

/**
 * Api wrapper to supper Salesforce streaming. The client contains an internal implementation of a cometd specification.
 * @example
 *
 *  streamProcessor(message: JsonMap): StatusResult<string> {
 *      if (!message..payload.id) {
 *          throw new SfdxErro('Not found.', 'NotFound');
 *      }
 *
 *      return {
 *          completed: true,
 *          payload: message.payload.id
 *      }
 *  }
 *
 *  const options: StreamingOptions<string> =
 *      new DefaultStreamingOptions(await CoreOrg.create(this.org.name), this.force.config.getApiVersion(),
 *      TOPIC, this.streamProcessor.bind(this));
 *
 *  try  {
 *      const asyncStatusClient: StreamingClient<string> = await StreamingClient.init(options);
 *
 *      await asyncStatusClient.handshake();
 *
 *      await asyncStatusClient.subscribe(async () => {
 *               const requestResponse = await scratchOrgInfoApi.request(scratchOrgInfo);
 *               this.scratchOrgInfoId = requestResponse.id;
 *           });
 *
 *  } catch(e) {
 *      // handle streaming message errors and timeouts here. ex. If the handshake fails you could try polling.
 *      ....
 *  }
 *
 * Salesforce client and timeout information
 *
 * Streaming API imposes two timeouts, as supported in the Bayeux protocol.
 *
 * Socket timeout: 110 seconds
 * A client receives events (JSON-formatted HTTP responses) while it waits on a connection. If no events are generated
 * and the client is still waiting, the connection times out after 110 seconds and the server closes the connection.
 * Clients should reconnect before two minutes to avoid the connection timeout.
 *
 * Reconnect timeout: 40 seconds
 * After receiving the events, a client needs to reconnect to receive the next set of events. If the reconnection
 * doesn't happen within 40 seconds, the server expires the subscription and the connection is closed. If this happens,
 * the client must start again and handshake, subscribe, and connect. Each Streaming API client logs into an instance
 * and maintains a session. When the client handshakes, connects, or subscribes, the session timeout is restarted. A
 * client session times out if the client doesn’t reconnect to the server within 40 seconds after receiving a response
 * (an event, subscribe result, and so on).
 *
 * Note that these timeouts apply to the Streaming API client session and not the Salesforce authentication session. If
 * the client session times out, the authentication session remains active until the organization-specific timeout
 * policy goes into effect.
 */
export class StreamingClient<T> {

    public static async init<U>(options: StreamingOptions<U>): Promise<StreamingClient<U>> {

        const streamingClient: StreamingClient<U> = new StreamingClient<U>(options);
        await streamingClient.options.org.refreshAuth();
        streamingClient.logger = await Logger.child('StreamingClient');

        const accessToken = options.org.getConnection().getConnectionOptions().accessToken;

        if (accessToken && accessToken.length > 5) {
            streamingClient.logger.debug(`accessToken: XXXXXX${accessToken.substring(accessToken.length - 5, accessToken.length - 1)}`);
            streamingClient.cometClient.setHeader('Authorization', `OAuth ${accessToken}`);
        } else {
            throw new SfdxError('Missing or invalid access token', 'MissingOrInvalidAcc essToken');
        }

        streamingClient.log(`Streaming client target url: ${streamingClient.targetUrl}`);
        return streamingClient;
    }

    private readonly targetUrl: string;
    private readonly options: StreamingOptions<T>;
    private logger: Logger;
    private cometClient: CometClient;

    /**
     * Constructs a streaming client.
     * @param {StreamingOptions<T>} options Config options for the StreamingClient
     * @see StreamingOptions
     */
    private constructor(options: StreamingOptions<T>) {

        this.options = options;

        const instanceUrl: string = asString(options.org.getConnection().getAuthInfoFields().instanceUrl);
        const urlElements = [instanceUrl, 'cometd', options.apiVersion];

        this.targetUrl = urlElements.join('/');
        this.cometClient = this.options.streamingImpl.getCometClient(this.targetUrl);
        this.options.streamingImpl.setLogger(this.log.bind(this));

        this.cometClient.on('transport:up', () => this.log('Transport up event received'));
        this.cometClient.on('transport:down', () => this.log('Transport down event received'));

        this.cometClient.addExtension({
            incoming: this.incoming.bind(this)
        });

        this.cometClient.disable('websocket');
    }

    /**
     * Provides a convenient way to handshake with the server endpoint before trying to subscribe.
     * @returns {Promise<StreamingConnectionState>}
     */
    public handshake(): Promise<StreamingConnectionState> {

        let timeout: NodeJS.Timer;

        return new Promise((resolve, reject) => {
            timeout = setTimeout(() => {
                const timeoutError: SfdxError = SfdxError.create('@salesforce/core',
                    'streaming', 'genericHandshakeTimeoutMessage', [this.targetUrl]);
                timeoutError.name = StreamingTimeoutError.HANDSHAKE;
                this.doTimeout(timeout, timeoutError);
                reject(timeoutError);
            }, this.options.handshakeTimeout.milliseconds);

            this.cometClient.handshake(() => {
                this.log('handshake completed');
                clearTimeout(timeout);
                this.log('cleared handshake timeout');
                resolve(StreamingConnectionState.CONNECTED);
            });
        });
    }

    /**
     * Subscribe to streaming events.
     * @param {() => Promise<void>} streamInit - This function should initialize the data that result in streaming updates.
     * @returns {Promise<T>} - When the streaming processor set in the options completes it returns a payload in the
     * StatusResult options. The payload is just echoed here for convenience.
     * @see StatusResult
     */
    public subscribe(streamInit: () => Promise<void>): Promise<T> {
        let timeout: NodeJS.Timer;

        // This outer promise is to hold the streaming promise chain open until the streaming processor
        // says it's complete.
        return new Promise((subscribeResolve, subscribeReject) => {
            // This is the inner promise chain that's satisfied when the client impl (Faye/Mock) says it's subscribed.
            return streamInit().then(() => {
                return new Promise((subscriptionResolve, subscriptionReject) => {

                    timeout = setTimeout(() => {
                        const timeoutError: SfdxError = SfdxError.create('@salesforce/core',
                            'streaming', 'genericTimeoutMessage');
                        timeoutError.name = StreamingTimeoutError.SUBSCRIBE;
                        this.doTimeout(timeout, timeoutError);
                        subscribeReject(timeoutError);
                    }, this.options.handshakeTimeout.milliseconds);

                    // Initialize the subscription.
                    const subscription: CometSubscription = this.cometClient.subscribe(this.options.channel,
                        (message) => {
                            try {
                                // The result of the stream processor determines the state of the outer promise.
                                const result: StatusResult<T> = this.options.streamProcessor(message);

                                // The stream processor says it's complete. Clean up and resolve the outer promise.
                                if (result && result.completed) {
                                    clearTimeout(timeout);
                                    this.cometClient.disconnect();
                                    subscribeResolve(result.payload);
                                }
                            } catch (e) {
                                // it's completely valid for the stream processor to throw an error. If it does we will
                                // reject the outer promise. Keep in mind if we are here the subscription was resolved.
                                clearTimeout(timeout);
                                subscribeReject(e);
                            }
                        });

                    subscription.callback(() => {
                        subscriptionResolve();
                    });

                    subscription.errback((error) => {
                        subscriptionReject(error);
                    });
                })
                .then(() => {
                    // Now that we successfully have a subscription started up we are safe to initialize the function that
                    // will affect the streaming events. I.E. create an org or run apex tests.
                    return;
                })
                .catch((error) => {
                    // Need to catch the subscription rejection or it will result in an unhandled rejection error.
                    clearTimeout(timeout);

                    // No subscription so we can reject the out promise as well.
                    subscribeReject(error);
                });
            });
        });
    }

    private incoming(message, cb): void {
        this.log(message);
        cb(message);
    }

    private doTimeout(timeout: NodeJS.Timer, error: SfdxError) {
        this.disconnect();
        clearTimeout(timeout);
        this.log(error);
        return error;
    }

    private disconnect() {

        // This is a patch for faye. If Faye encounters errors while attempting to handshake it will keep trying
        // and will prevent the timeout from disconnecting. Here for example we will detect there is no client id but
        // unauthenticated connections are being made to salesforce. Let's close the dispatcher if it exists and
        // has no clientId.
        if (this.cometClient['_dispatcher']) {
            const dispatcher = this.cometClient['_dispatcher'];
            if (!dispatcher.clientId) {
                dispatcher.close();
            } else {
                this.cometClient.disconnect();
            }
        }
    }

    private log(message) {
        this.logger.debug(message);
    }

}
