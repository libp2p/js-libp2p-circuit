'use strict'

require('setimmediate')
require('safe-buffer')

const pull = require('pull-stream')
const debug = require('debug')
const PeerInfo = require('peer-info')
const PeerId = require('peer-id')
const EE = require('events').EventEmitter
const once = require('once')
const utilsFactory = require('./utils')
const StreamHandler = require('./stream-handler')
const assignInWith = require('lodash/assignInWith')
const proto = require('../protocol')

const multicodec = require('./../multicodec')

const log = debug('libp2p:swarm:circuit:relay')
log.err = debug('libp2p:swarm:circuit:error:relay')

class Hop extends EE {
  /**
   * Construct a Circuit object
   *
   * This class will handle incoming circuit connections and
   * either start a relay or hand the relayed connection to
   * the swarm
   *
   * @param {Swarm} swarm
   * @param {Object} options
   */
  constructor (swarm, options) {
    super()
    this.swarm = swarm
    this.peerInfo = this.swarm._peerInfo
    this.utils = utilsFactory(swarm)
    this.config = assignInWith(
      {
        active: false,
        enabled: false
      },
      options,
      (orig, src) => {
        typeof src === 'undefined' ? false : src
      })

    this.active = this.config.active
  }

  /**
   * Handle the relay message
   *
   * @param {CircuitRelay} message
   * @param {StreamHandler} streamHandler
   * @returns {*}
   */
  handle (message, streamHandler) {
    if (!this.config.enabled) {
      return this.utils.writeResponse(streamHandler, proto.CircuitRelay.Status.HOP_CANT_SPEAK_RELAY)
    }

    if (message.type === proto.CircuitRelay.Type.CAN_HOP) {
      return this.utils.writeResponse(streamHandler, proto.CircuitRelay.Status.SUCCESS)
    }

    if (message.dstPeer.id.toString() === this.peerInfo.id.toB58String()) {
      return this.utils.writeResponse(streamHandler, proto.CircuitRelay.Status.HOP_CANT_RELAY_TO_SELF)
    }

    if (!message.dstPeer.addrs.length) {
      message.dstPeer.addrs.push(`/ipfs/${message.dstPeer.id}`)
    }

    this.utils.validateAddrs(message, streamHandler, proto.CircuitRelay.Type.HOP, (err) => {
      if (err) {
        return log(err)
      }

      return this._circuit(streamHandler.rest(), message, (err) => {
        if (err) {
          log.err(err)
          setImmediate(() => this.emit('circuit:error', err))
        }
        setImmediate(() => this.emit('circuit:success'))
      })
    })
  }

  /**
   * The handler called to process a connection
   *
   * @param {Connection} conn
   * @param {CircuitRelay} message
   * @param {Function} cb
   * @returns {*}
   * @private
   */
  _circuit (conn, message, cb) {
    this._dialPeer(message.dstPeer, (err, dstConn) => {
      if (err) {
        const errStreamHandler = new StreamHandler(conn)
        this.utils.writeResponse(errStreamHandler, proto.CircuitRelay.Status.HOP_CANT_DIAL_DST)
        pull(pull.empty(), errStreamHandler.rest())
        log.err(err)
        return cb(err)
      }

      const srcStreamHandler = new StreamHandler(conn)
      srcStreamHandler.write(proto.CircuitRelay.encode({
        type: proto.CircuitRelay.Type.STATUS,
        code: proto.CircuitRelay.Status.SUCCESS
      }), (err) => {
        if (err) {
          log.err(err)
          return cb(err)
        }

        const streamHandler = new StreamHandler(dstConn)
        const stopMsg = Object.assign({}, message)
        stopMsg.type = proto.CircuitRelay.Type.STOP
        streamHandler.write(proto.CircuitRelay.encode(stopMsg), (err) => {
          if (err) {
            const errStreamHandler = new StreamHandler(conn)
            this.utils.writeResponse(errStreamHandler, proto.CircuitRelay.Status.HOP_CANT_OPEN_DST_STREAM)
            pull(pull.empty(), errStreamHandler.rest())

            log.err(err)
            return cb(err)
          }

          const srcConn = srcStreamHandler.rest()
          // circuit the src and dst streams
          pull(
            srcConn,
            streamHandler.rest(),
            srcConn
          )

          cb()
        })
      })
    })
  }

  /**
   * Dial the dest peer and create a circuit
   *
   * @param {Multiaddr} dstPeer
   * @param {Function} callback
   * @returns {Function|void}
   * @private
   */
  _dialPeer (dstPeer, callback) {
    const peerInfo = new PeerInfo(PeerId.createFromBytes(dstPeer.id))
    dstPeer.addrs.forEach((a) => peerInfo.multiaddrs.add(a))
    this.swarm.dial(peerInfo, multicodec.relay, once((err, conn) => {
      if (err) {
        log.err(err)
        return callback(err)
      }

      callback(null, conn)
    }))
  }
}

module.exports = Hop
