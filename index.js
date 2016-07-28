'use strict';
/**
 * Module dependencies.
 */

const uid2 = require('uid2');
const Adapter = require('socket.io-adapter');
const Emitter = require('events').EventEmitter;
const Promise = require('bluebird');

/**
 * Module exports.
 */

module.exports = adapter;

/**
 * Returns a redis Adapter class.
 *
 * @param {String} optional, redis uri
 * @return {RedisAdapter} adapter
 * @api public
 */

function adapter(uri, opts){
  opts = opts || {};

  // handle options only
  if ('object' == typeof uri) {
    opts = uri;
    uri = null;
  }

  // opts
  const pub = opts.pubClient;
  const sub = opts.subClient;
  const prefix = opts.key || 'socket.io';
  const subEvent = opts.subEvent || 'message';

  
  if (!pub) throw new Error([" No Pub specified"]);
  if (!sub) throw new Error([" No Sub specified"]);

  // this server's key
  const uid = opts.uid2 ? uid2(opts.uid2) : uid2(6);

  /**
   * Adapter constructor.
   *
   * @param {String} namespace name
   * @api public
   */

  function Redis(nsp){
    Adapter.call(this, nsp);

    this.uid = uid;
    this.prefix = prefix;
    this.channel = prefix + '#' + nsp.name + '#';
    this.channelMatches = (messageChannel, subscribedChannel) => messageChannel.startsWith(subscribedChannel); 
    this.pubClient = pub;
    this.subClient = sub;

    sub.subscribe(this.channel, (err) => {
      if (err) this.emit('error', err);
    });
    sub.on(subEvent, this.onmessage.bind(this));
  }

  /**
   * Inherits from `Adapter`.
   */

  Redis.prototype.__proto__ = Adapter.prototype;

  /**
   * Called with a subscription message
   *
   * @api private
   */

  Redis.prototype.onmessage = function(channel, msg){
    if (!this.channelMatches(channel.toString(), this.channel)) {
      return;
    }
    const args = JSON.parse(msg);
    
    if (uid == args.shift()) return;
    
    const packet = args[0];

    if (packet && packet.nsp === undefined) {
      packet.nsp = '/';
    }

    if (!packet || packet.nsp != this.nsp.name) {
        return;
    }
    args.push(true);
    
    this.broadcast.apply(this, args);
  };

  /**
   * Broadcasts a packet.
   *
   * @param {Object} packet to emit
   * @param {Object} options
   * @param {Boolean} whether the packet came from another node
   * @api public
   */

  Redis.prototype.broadcast = function(packet, opts, remote){
    const newPacket = Object.assign({}, packet);
    Adapter.prototype.broadcast.call(this, packet, opts);
    newPacket.nsp = packet.nsp;
    newPacket.type = packet.type;
    if (!remote) {
      const chn = this.prefix + '#' + newPacket.nsp + '#';
      const msg = JSON.stringify([uid, newPacket, opts]);
      if (opts.rooms) {
        opts.rooms.map( (room) => {
          const chnRoom = chn + room + '#';
          pub.publish(chnRoom, msg);
        });
      } else {
        pub.publish(chn, msg);
      }
    }
  };

  /**
   * Subscribe client to room messages.
   *
   * @param {String} client id
   * @param {String} room
   * @param {Function} callback (optional)
   * @api public
   */

  Redis.prototype.add = function(id, room, fn){
    Adapter.prototype.add.call(this, id, room);
    const channel = this.prefix + '#' + this.nsp.name + '#' + room + '#';
    sub.subscribe(channel, (err) => {
      if (err) {
        this.emit('error', err);
        if (fn) fn(err);
        return;
      }
      if (fn) fn(null);
    });
  };

  /**
   * Unsubscribe client from room messages.
   *
   * @param {String} session id
   * @param {String} room id
   * @param {Function} callback (optional)
   * @api public
   */

  Redis.prototype.del = function(id, room, fn){
    const hasRoom = Object.keys(this.rooms).includes(room);// this.rooms.hasOwnProperty(room);
    Adapter.prototype.del.call(this, id, room);

    if (hasRoom && !this.rooms[room]) {
      const channel = this.prefix + '#' + this.nsp.name + '#' + room + '#';
      sub.unsubscribe(channel, (err) => {
        if (err) {
          this.emit('error', err);
          if (fn) fn(err);
          return;
        }
        if (fn) fn(null);
      });
    } else {
      if (fn) process.nextTick(fn.bind(null, null));
    }
  };

  /**
   * Unsubscribe client completely.
   *
   * @param {String} client id
   * @param {Function} callback (optional)
   * @api public
   */

  Redis.prototype.delAll = function(id, fn){
    const rooms = this.sids[id];

    if (!rooms) {
      if (fn) process.nextTick(fn.bind(null, null));
      return;
    }

    Promise.map( Object.keys(rooms), (room) => {
        this.del(id, room, () => {
                    delete this.sids[id];
                    if (fn) fn(null);
                });
    }, { concurrency: Infinity })
    .catch( (err) => {
        this.emit('error', err);
        if (fn) fn(err);
    });

  };

  Redis.uid = uid;
  Redis.pubClient = pub;
  Redis.subClient = sub;
  Redis.prefix = prefix;

  return Redis;

}
