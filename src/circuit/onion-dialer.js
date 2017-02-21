'use strict'

require('setimmediate')
require('safe-buffer')

const Dialer = require('./dialer')
const isFunction = require('lodash.isfunction')
const multiaddr = require('multiaddr')
const Connection = require('interface-connection').Connection
const multicodec = require('../multicodec')

const debug = require('debug')
const log = debug('libp2p:circuit:oniondialer')
log.err = debug('libp2p:circuit:error:oniondialer')

class OnionDialer extends Dialer {
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
    if (isFunction(options)) {
      cb = options
      options = {}
    }

    if (!cb) {
      cb = () => {}
    }

    let maddrs = multiaddr(ma).toString().split('/p2p-circuit').filter((a) => a.length)
    if (maddrs.length > 0) {
      const id = multiaddr(maddrs[maddrs.length - 1]).getPeerId()
      if (this.swarm._peerInfo.id.toB58String() === id) {
        let err = `cant dial to self!`
        log.err(err)
        return cb(err)
      }
    }

    let dstConn = new Connection()
    setImmediate(this._onionDial.bind(this), maddrs, (err, conn) => {
      if (err) {
        log.err(err)
        return cb(err)
      }
      dstConn.setInnerConn(conn)
      cb(null, dstConn)
    })

    return dstConn
  }

  /**
   * Dial a peer using onion dial - dial all relays in the ma
   * in sequence and circuit dest over the all the pipes
   *
   * @param {multiaddr} maddrs
   * @param {Connection} relay
   * @param {Function} cb
   * @return {void}
   * @private
   */
  _onionDial (maddrs, relay, cb) {
    if (isFunction(relay)) {
      cb = relay
      relay = null
    }

    const dial = (dstAddr, relayPeer) => {
      if (maddrs.length) {
        this._createRelayPipe(dstAddr, relayPeer, (err, upgraded) => {
          if (err) {
            log.err(err)
            return cb(err)
          }
          return this._onionDial(maddrs, upgraded, cb)
        })
      } else {
        this.dialPeer(dstAddr, relayPeer, (err, conn) => {
          if (err) {
            return cb(err)
          }
          cb(null, conn)
        })
      }
    }

    if (maddrs.length >= 2) {
      const relayAddr = multiaddr(maddrs.shift())
      const destAddr = multiaddr(maddrs.shift())
      dial(destAddr, relayAddr)
    } else {
      dial(multiaddr(maddrs.shift()), relay)
    }
  }

  /**
   * Creates a relay connection that can be used explicitly from two multiaddrs
   *
   * @param {Multiaddr} dstAddr
   * @param {Multiaddr} relayPeer
   * @param {Function} cb
   * @returns {void|Function}
   * @private
   */
  _createRelayPipe (dstAddr, relayPeer, cb) {
    this.dialPeer(dstAddr, relayPeer, (err, conn) => {
      if (err) {
        log.err(err)
        return cb(err)
      }

      dstAddr = multiaddr(dstAddr)
      this.relayPeers.set(dstAddr.getPeerId(), conn)
      this._handshake(this.utils.peerInfoFromMa(dstAddr), conn, (err, upgraded) => {
        if (err) {
          log.err(err)
          return cb(err)
        }

        cb(null, upgraded)
      })
    })
  }

  /**
   * Upgrade a raw connection to a relayed link (hop)
   *
   * @param {PeerInfo} pi
   * @param {Connection} conn
   * @param {Function} cb
   *
   * @return {Function|void}
   * @private
   */
  _handshake (pi, conn, cb) {
    const proxyConn = new Connection()
    const handler = this.swarm.connHandler(pi, multicodec.hop, proxyConn)
    handler.handleNew(conn, (err, upgradedConn) => {
      if (err) {
        log.err(err)
        return cb(err)
      }

      if (!upgradedConn) {
        proxyConn.setInnerConn(conn)
        upgradedConn = proxyConn
      }

      cb(null, upgradedConn)
    })
  }
}

module.exports = OnionDialer
