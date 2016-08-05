'use strict';
/**
 * Module dependencies.
 */

const uid2 = require('uid2');
const Adapter = require('socket.io-adapter');
const Emitter = require('events').EventEmitter;
const Promise = require('bluebird');

/**
 * Returns a redis Adapter class.
 *
 * @param {{pubClient: Promise.Redis, subClient: Promise.Redis, key: String, subEvent: String, uid2: integer}} opts
 * @returns {{new(*=): {onmessage: (function(String, String)), delAll: (function(String, Function)), add: (function(String, String, Function)), del: (function(String, String, Function)), broadcast: (function(Object, Object, Boolean))}}}
 * @api public
 * @export
 */

function adapter(opts = {}) {
  const pub = opts.pubClient;
  const sub = opts.subClient;
  const prefix = opts.key || 'socket.io';
  const subEvent = opts.subEvent || 'message';
  
  if (!pub) throw new Error([" No Pub specified"]);
  if (!sub) throw new Error([" No Sub specified"]);

  // this server's key
  const uid = opts.uid2 ? uid2(opts.uid2) : uid2(6);
  /** Create Redis adapter
   * @constructor 
   * @type {{new(*=): {onmessage: (function(String, String)), delAll: (function(String, Function)), add: (function(String, String, Function)), del: (function(String, String, Function)), broadcast: (function(Object, Object, Boolean))}}}
   */
  const Redis = class extends Adapter {
    constructor(nsp) {
      super(nsp);
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
    /** Called with a subscription message
     * @param {String} channel
     * @param {String} msg
     * @api private
     */
    onmessage(channel, msg) {
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
    }

    /** Broadcasts a packet.
     * @param {Object} packet to emit
     * @param {Object} opts
     * @param {Boolean} remote whether the packet came from another node
     * @api public
     */
    broadcast(packet, opts, remote) {
      const newPacket = Object.assign({}, packet);
      Adapter.prototype.broadcast.call(this, packet, opts);
      newPacket.nsp = packet.nsp;
      newPacket.type = packet.type;
      if (!remote) {
        const chn = this.prefix + '#' + newPacket.nsp + '#';
        const msg = JSON.stringify([uid, newPacket, opts]);
        if (opts.rooms) {
          opts.rooms.map((room) => {
            const chnRoom = chn + room + '#';
            pub.publish(chnRoom, msg);
          });
        } else {
          pub.publish(chn, msg);
        }
      }
    }

    /** Subscribe client to room messages.
     * @param {String} id client id
     * @param {String} room
     * @param {Function} fn callback (optional)
     * @api public
     */
    add(id, room, fn) {
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
    }

    /** Unsubscribe client from room messages.
     * @param {String} id session id
     * @param {String} room id
     * @param {Function} fn callback (optional)
     * @api public
     */
    del(id, room, fn) {
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
    }

    /** Unsubscribe client completely.
     * @param {String} id client id
     * @param {Function} fn callback (optional)
     * @api public
     */

    delAll(id, fn) {
      const rooms = this.sids[id];

      if (!rooms) {
        if (fn) process.nextTick(fn.bind(null, null));
        return;
      }
      const room_keys = Object.keys(rooms)
      Promise.map(room_keys, (room) => {
        this.del(id, room, () => {
          delete this.sids[id];
          if (fn) fn(null);
        });
      }, {concurrency: room_keys.length})
          .catch((err) => {
            this.emit('error', err);
            if (fn) fn(err);
          });

    }
  }
  Redis.uid = uid;
  Redis.pubClient = pub;
  Redis.subClient = sub;
  Redis.prefix = prefix;

  return Redis;
}
/**
 * Module exports.
 */

module.exports = adapter;
