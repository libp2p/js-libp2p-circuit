'use strict'

const Connection = require('interface-connection').Connection
const isFunction = require('lodash.isfunction')
const multiaddr = require('multiaddr')
const once = require('once')
const waterfall = require('async/waterfall')
const utilsFactory = require('./utils')
const StreamHandler = require('./stream-handler')

const debug = require('debug')
const log = debug('libp2p:circuit:dialer')
log.err = debug('libp2p:circuit:error:dialer')

const multicodec = require('../multicodec')
const proto = require('../protocol')

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

    const srcMas = this.swarm._peerInfo.multiaddrs.toArray()
    waterfall([
      (cb) => {
        if (relay instanceof Connection) {
          return cb(null, new StreamHandler(relay))
        }
        return this.dialRelay(this.utils.peerInfoFromMa(relay), cb)
      },
      (streamHandler, cb) => {
        log(`negotiating relay for peer ${dstMa.getPeerId()}`)
        streamHandler.write(
          proto.CircuitRelay.encode({
            type: proto.CircuitRelay.Type.HOP,
            srcPeer: {
              id: this.swarm._peerInfo.id.toB58String(),
              addrs: srcMas.map((addr) => addr.toString())
            },
            dstPeer: {
              id: dstMa.getPeerId(),
              addrs: [dstMa.toString()]
            }
          }),
          (err) => {
            if (err) {
              log.err(err)
              return cb(err)
            }

            cb(null, streamHandler)
          })
      },
      (streamHandler, cb) => {
        streamHandler.read((err, msg) => {
          if (err) {
            log.err(err)
            return cb(err)
          }

          const message = proto.CircuitRelay.decode(msg)
          if (message.type !== proto.CircuitRelay.Type.STATUS) {
            return cb(new Error(`Got invalid message type - ` +
              `expected ${proto.CircuitRelay.Type.STATUS} got ${message.type}`))
          }

          if (message.code !== proto.CircuitRelay.Status.SUCCESS) {
            return cb(new Error(`Got ${message.code} error code trying to dial over relay`))
          }

          cb(null, new Connection(streamHandler.rest()))
        })
      }
    ], callback)
  }

  /**
   * Does the peer support the HOP protocol
   *
   * @param {PeerInfo} peer
   * @param {Function} cb
   * @returns {*}
   */
  canHop (peer, cb) {
    cb = once(cb || (() => {}))

    if (!this.relayPeers.get(this.utils.getB58String(peer))) {
      return this.dialRelay(peer, (err, streamHandler) => {
        if (err) {
          return log.err(err)
        }

        streamHandler.write(proto.CircuitRelay.encode({
          type: proto.CircuitRelay.Type.CAN_HOP
        }), (err) => {
          if (err) {
            log.err(err)
            return cb(err)
          }

          this.relayPeers.set(this.utils.getB58String(peer), peer)
          cb(null)
        })
      })
    }

    return cb()
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
    this.swarm.dial(peer, multicodec.relay, once((err, conn) => {
      if (err) {
        log.err(err)
        return cb(err)
      }

      relayConn.setInnerConn(conn)
      cb(null, new StreamHandler(conn))
    }))
  }
}

module.exports = Dialer
