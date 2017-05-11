'use strict'

const Buffer = require('safe-buffer').Buffer

const Connection = require('interface-connection').Connection
const isFunction = require('lodash.isfunction')
const multiaddr = require('multiaddr')
const constants = require('./constants')
const once = require('once')
const waterfall = require('async/waterfall')
const utilsFactory = require('./utils')
const StreamHandler = require('./stream-handler')

const debug = require('debug')
const log = debug('libp2p:circuit:dialer')
log.err = debug('libp2p:circuit:error:dialer')

const multicodec = require('../multicodec')

class Dialer {
  /**
   * Creates an instance of Dialer.
   * @param {Swarm} swarm - the swarm
   * @param {any} options - config options
   *
   * @memberOf Dialer
   */
  constructor (swarm, options) {
    this.swarm = swarm
    this.relayPeers = new Map()
    this.options = options
    this.utils = utilsFactory(swarm)
  }

  /**
   * Dial a peer over a relay
   *
   * @param {multiaddr} ma - the multiaddr of the peer to dial
   * @param {Object} options - dial options
   * @param {Function} cb - a callback called once dialed
   * @returns {Connection} - the connection
   *
   * @memberOf Dialer
   */
  dial (ma, options, cb) {
    throw new Error('abstract class, method not implemented')
  }

  /**
   * Dial the destination peer over a relay
   *
   * @param {multiaddr} dstMa
   * @param {Connection|PeerInfo} relay
   * @param {Function} cb
   * @return {Function|void}
   * @private
   */
  dialPeer (dstMa, relay, cb) {
    if (isFunction(relay)) {
      cb = relay
      relay = null
    }

    if (!cb) {
      cb = () => {}
    }

    dstMa = multiaddr(dstMa)
    // if no relay provided, dial on all available relays until one succeeds
    if (!relay) {
      const relays = Array.from(this.relayPeers.values())
      let next = (nextRelay) => {
        if (!nextRelay) {
          let err = `no relay peers were found or all relays failed to dial`
          log.err(err)
          return cb(err)
        }

        return this.negotiateRelay(nextRelay, dstMa, (err, conn) => {
          if (err) {
            log.err(err)
            return next(relays.shift())
          }
          cb(null, conn)
        })
      }
      next(relays.shift())
    } else {
      return this.negotiateRelay(relay, dstMa, (err, conn) => {
        if (err) {
          log.err(`An error has occurred negotiating the relay connection`, err)
          return cb(err)
        }

        return cb(null, conn)
      })
    }
  }

  /**
   * Negotiate the relay connection
   *
   * @param {Multiaddr|PeerInfo|Connection} relay - the Connection or PeerInfo of the relay
   * @param {multiaddr} dstMa - the multiaddr of the peer to relay the connection for
   * @param {Function} callback - a callback with that return the negotiated relay connection
   * @returns {void}
   *
   * @memberOf Dialer
   */
  negotiateRelay (relay, dstMa, callback) {
    dstMa = multiaddr(dstMa)

    // TODO: whats the best addr to send? First one seems as good as any.
    const srcMa = this.swarm._peerInfo.multiaddrs.toArray()[0]
    const relayConn = new Connection()

    let streamHandler = null
    waterfall([
      (cb) => {
        if (relay instanceof Connection) {
          return cb(null, relay)
        }
        return this.dialRelay(this.utils.peerInfoFromMa(relay), cb)
      },
      (conn, cb) => {
        log(`negotiating relay for peer ${dstMa.getPeerId()}`)
        streamHandler = new StreamHandler(conn, 1000 * 60)
        streamHandler.write([
          new Buffer(dstMa.toString()),
          new Buffer(srcMa.toString())
        ], (err) => {
          if (err) {
            log.err(err)
            return cb(err)
          }

          cb(null)
        })
      },
      (cb) => {
        streamHandler.read((err, msg) => {
          if (err) {
            log.err(err)
            return cb(err)
          }

          if (Number(msg.toString()) !== constants.RESPONSE.SUCCESS) {
            return cb(new Error(`Got ${msg.toString()} error code trying to dial over relay`))
          }

          relayConn.setInnerConn(streamHandler.rest())
          cb(null, relayConn)
        })
      }
    ], callback)
  }

  /**
   * Dial a relay peer by its PeerInfo
   *
   * @param {PeerInfo} peer - the PeerInfo of the relay peer
   * @param {Function} cb - a callback with the connection to the relay peer
   * @returns {Function|void}
   *
   * @memberOf Dialer
   */
  dialRelay (peer, cb) {
    cb = once(cb || (() => {}))

    const relayConn = new Connection()
    relayConn.setPeerInfo(peer)
    // attempt to dia the relay so that we have a connection
    this.swarm.dial(peer, multicodec.hop, once((err, conn) => {
      if (err) {
        log.err(err)
        return cb(err)
      }

      relayConn.setInnerConn(conn)
      this.relayPeers.set(this.utils.getB58String(peer), peer)
      cb(null, relayConn)
    }))
  }
}

module.exports = Dialer
