'use strict'

require('setimmediate')
require('safe-buffer')

const pull = require('pull-stream')
const debug = require('debug')
const PeerInfo = require('peer-info')
const PeerId = require('peer-id')
const EE = require('events').EventEmitter
const multiaddr = require('multiaddr')
const constants = require('./constants')
const once = require('once')
const utilsFactory = require('./utils')
const StreamHandler = require('./stream-handler')
const waterfall = require('async/waterfall')

const multicodec = require('./../multicodec')

const log = debug('libp2p:swarm:circuit:relay')
log.err = debug('libp2p:swarm:circuit:error:relay')

let utils
class Hop extends EE {
  /**
   * Construct a Circuit object
   *
   * This class will handle incoming circuit connections and
   * either start a relay or hand the relayed connection to
   * the swarm
   *
   * @param {any} options - configuration for Relay
   */
  constructor (options) {
    super()
    this.config = Object.assign({active: false}, options)
    this.swarm = null
    this.active = this.config.active
  }

  _writeErr (streamHandler, errCode, cb) {
    errCode = String(errCode)
    setImmediate(() => this.emit('circuit:error', errCode))
    streamHandler.write([Buffer.from(errCode)])
    return cb(errCode)
  }

  _readSrcAddr (streamHandler, cb) {
    streamHandler.read((err, srcMa) => {
      if (err) {
        log.err(err)

        // TODO: pull-length-prefixed should probably return an `Error` object with an error code
        if (typeof err === 'string' && err.includes('size longer than max permitted length of')) {
          return this._writeErr(streamHandler, constants.RESPONSE.HOP.SRC_ADDR_TOO_LONG, cb)
        }
      }

      try {
        srcMa = multiaddr(srcMa.toString()) // read the src multiaddr
      } catch (err) {
        return this._writeErr(streamHandler, constants.RESPONSE.HOP.SRC_MULTIADDR_INVALID, cb)
      }

      cb(null, srcMa)
    })
  }

  _readDstAddr (streamHandler, cb) {
    streamHandler.read((err, dstMa) => {
      if (err) {
        log.err(err)

        // TODO: pull-length-prefixed should probably return an `Error` object with an error code
        if (typeof err === 'string' && err.includes('size longer than max permitted length of')) {
          return this._writeErr(streamHandler, constants.RESPONSE.HOP.DST_ADDR_TOO_LONG, cb)
        }
      }

      try {
        dstMa = multiaddr(dstMa.toString()) // read the src multiaddr
      } catch (err) {
        return this._writeErr(streamHandler, constants.RESPONSE.HOP.DST_MULTIADDR_INVALID, cb)
      }

      if (dstMa.getPeerId() === this.swarm._peerInfo.id.toB58String()) {
        return this._writeErr(streamHandler, constants.RESPONSE.HOP.CANT_CONNECT_TO_SELF, cb)
      }

      cb(null, dstMa)
    })
  }

  /**
   * Mount the relay
   *
   * @param {swarm} swarm
   * @return {void}
   */
  mount (swarm) {
    this.swarm = swarm
    utils = utilsFactory(swarm)
    this.swarm.handle(multicodec.hop, (proto, conn) => {
      const streamHandler = new StreamHandler(conn, 1000 * 60)
      waterfall([
        (cb) => this._readDstAddr(streamHandler, (err, dstMa) => {
          if (err) {
            return cb(err)
          }

          if (!this.active && !utils.isPeerConnected(dstMa.getPeerId())) {
            return this._writeErr(streamHandler, constants.RESPONSE.HOP.NO_CONN_TO_DST, cb)
          }

          cb(null, dstMa)
        }),
        (dstMa, cb) => {
          this._readSrcAddr(streamHandler, (err, srcMa) => {
            cb(err, dstMa, srcMa)
          })
        }
      ], (err, dstMa, srcMa) => {
        if (err || (!dstMa || !srcMa)) {
          log.err(`Error handling incoming relay request`, err)
          return
        }

        return this._circuit(streamHandler.rest(), dstMa, srcMa, (err) => {
          if (err) {
            log.err(err)
            setImmediate(() => this.emit('circuit:error', err))
          }
          setImmediate(() => this.emit('circuit:success'))
        })
      })
    })

    this.emit('mounted')
  }

  /**
   * The handler called to process a connection
   *
   * @param {Connection} conn
   * @param {Multiaddr} dstAddr
   * @param {Multiaddr} srcAddr
   * @param {Function} cb
   *
   * @return {void}
   */
  _circuit (conn, dstAddr, srcAddr, cb) {
    this._dialPeer(dstAddr, (err, dstConn) => {
      if (err) {
        const errStreamHandler = new StreamHandler(conn, 1000 * 60)
        this._writeErr(errStreamHandler, constants.RESPONSE.CANT_DIAL_DST)
        pull(pull.empty(), errStreamHandler.rest())
        log.err(err)
        return cb(err)
      }

      const streamHandler = new StreamHandler(dstConn, 1000 * 60)
      streamHandler.write([new Buffer(srcAddr.toString())], (err) => {
        if (err) {
          const errStreamHandler = new StreamHandler(conn, 1000 * 60)
          this._writeErr(errStreamHandler, constants.RESPONSE.CANT_OPEN_DST_STREAM)
          pull(pull.empty(), errStreamHandler.rest())

          log.err(err)
          return cb(err)
        }

        // circuit the src and dst streams
        pull(
          conn,
          streamHandler.rest(),
          conn
        )

        cb()
      })
    })
  }

  /**
   * Dial the dest peer and create a circuit
   *
   * @param {Multiaddr} ma
   * @param {Function} callback
   * @returns {Function|void}
   * @private
   */
  _dialPeer (ma, callback) {
    const peerInfo = new PeerInfo(PeerId.createFromB58String(ma.getPeerId()))
    peerInfo.multiaddrs.add(ma)
    this.swarm.dial(peerInfo, multicodec.stop, once((err, conn) => {
      if (err) {
        log.err(err)
        return callback(err)
      }

      callback(null, conn)
    }))
  }
}

module.exports = Hop
