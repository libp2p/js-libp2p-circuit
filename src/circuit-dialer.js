'use strict'

const pull = require('pull-stream')
const handshake = require('pull-handshake')
const Peer = require('./peer')
const Connection = require('interface-connection').Connection
const mafmt = require('mafmt')
const PeerInfo = require('peer-info')
const isFunction = require('lodash.isfunction')
const multiaddr = require('multiaddr')
const lp = require('pull-length-prefixed')
const debug = require('debug')

const log = debug('libp2p:circuit:dialer')
log.err = debug('libp2p:circuit:error:dialer')

const multicodec = require('./multicodec')

const createListener = require('./listener')

class CircuitDialer {
  /**
   * Creates an instance of Dialer.
   * @param {Swarm} swarm - the swarm
   *
   * @memberOf CircuitDialer
   */
  constructor (swarm) {
    this.swarm = swarm
    this.relayPeers = new Map()

    this.swarm.on('peer-mux-established', this._addRelayPeer.bind(this))
    this.swarm.on('peer-mux-closed', (peerInfo) => {
      this.relayPeers.delete(peerInfo.id.toB58String())
    })
  }

  /**
   * Dial a peer over a relay
   *
   * @param {multiaddr} ma - the multiaddr of the peer to dial
   * @param {Object} options - dial options
   * @param {Function} cb - a callback called once dialed
   * @returns {Connection} - the connection
   *
   * @memberOf CircuitDialer
   */
  dial (ma, options, cb) {
    if (isFunction(options)) {
      cb = options
      options = {}
    }

    if (!cb) {
      cb = () => {
      }
    }

    let idB58Str
    ma = multiaddr(ma)
    idB58Str = ma.getPeerId() // try to get the peerId from the multiaddr
    if (!idB58Str) {
      let err = 'No valid peer id in multiaddr'
      log.err(err)
      cb(err)
    }

    let dstConn = new Connection()
    PeerInfo.create(idB58Str, (err, dstPeer) => {
      if (err) {
        log.err(err)
        cb(err)
      }

      dstConn.setPeerInfo(dstPeer)
      dstPeer.multiaddr.add(ma)
      this._initiateRelay(dstPeer, (err, conn) => {
        if (err) {
          log.err(err)
          return dstConn.setInnerConn(pull.empty())
        }

        dstConn.setInnerConn(conn)
        cb(null, dstConn)
      })
    })

    return dstConn
  }

  /**
   * Initate the relay connection
   *
   * @param {PeerInfo} dstPeer - the destination peer
   * @param {Function} cb - callback to call with relayed connection or error
   * @returns {void}
   *
   * @memberOf CircuitDialer
   */
  _initiateRelay (dstPeer, cb) {
    let relays = Array.from(this.relayPeers.values())
    let next = (relayPeer) => {
      if (!relayPeer) {
        const err = `no relay peers were found!`
        log.err(err)
        return cb(err)
      }

      log(`Trying relay peer ${relayPeer.peerInfo.id.toB58String()}`)
      this._dialRelay(relayPeer.peerInfo, (err, conn) => {
        if (err) {
          if (relays.length > 0) {
            return next(relays.shift())
          }
          return cb(err)
        }

        this._negotiateRelay(conn, dstPeer, (err, conn) => {
          if (err) {
            log.err(`An error has occurred negotiating the relay connection`, err)
            return cb(err)
          }

          return cb(null, conn)
        })
      })
    }

    next(relays.shift())
  }

  /**
   * Create listener
   *
   * @param {any} options
   * @param {any} handler
   * @returns {Listener}
   *
   * @memberOf CircuitDialer
   */
  createListener (handler) {
    return createListener(this.swarm, handler)
  }

  /**
   * Negotiate the relay connection
   *
   * @param {Connection} conn - a connection to the relay
   * @param {PeerInfo} peerInfo - the peerInfo of the peer to relay the connection for
   * @param {Function} cb - a callback with that return the negotiated relay connection
   * @returns {void}
   *
   * @memberOf CircuitDialer
   */
  _negotiateRelay (conn, peerInfo, cb) {
    let src = this.swarm._peerInfo.distinctMultiaddr()
    let dst = peerInfo.distinctMultiaddr()

    if (!(src && src.length > 0) || !(dst && dst.length > 0)) {
      let err = `No valid multiaddress for peer!`
      log.err(err)
      cb(err)
    }

    let stream = handshake({timeout: 1000 * 60}, cb)
    let shake = stream.handshake

    log(`negotiating relay for peer ${peerInfo.id}`)

    const values = [new Buffer(dst[0].toString())]

    pull(
      pull.values(values),
      lp.encode(),
      pull.collect((err, encoded) => {
        if (err) {
          return cb(err)
        }

        shake.write(encoded[0])
        shake.read(1, (err, data) => {
          if (err) {
            log.err(err)
            return cb(err)
          }

          cb(null, shake.rest())
        })
      })
    )

    pull(stream, conn, stream)
  }

  /**
   * Dial a relay peer by its PeerInfo
   *
   * @param {PeerInfo} relayPeer - the PeerInfo of the relay peer
   * @param {Function} callback - a callback with the connection to the relay peer
   * @returns {Function|void}
   *
   * @memberOf CircuitDialer
   */
  _dialRelay (relayPeer, callback) {
    const idB58Str = relayPeer.id.toB58String()
    log('dialing relay %s', idB58Str)

    this.swarm.dial(relayPeer, multicodec, (err, conn) => {
      if (err) {
        return callback(err)
      }

      callback(null, conn)
    })
  }

  /**
   * Connect to a relay peer
   *
   * @param {PeerInfo} peerInfo - the PeerInfo of the relay
   * @returns {void}
   *
   * @memberOf CircuitDialer
   */
  _addRelayPeer (peerInfo) {
    // TODO: ask connected peers for all their connected peers
    // as well and try to establish a relay to them as well

    // TODO: ask peers if they can proactively dial on your behalf to other peers (active/passive)
    // should it be a multistream header?

    if (!this.relayPeers.has(peerInfo.id.toB58String())) {
      let peer = new Peer(null, peerInfo)
      this.relayPeers.set(peerInfo.id.toB58String(), peer)

      // attempt to dia the relay so that we have a connection
      this._dialRelay(peerInfo, (err, conn) => {
        if (err) {
          log.err(err)
          return
        }
        peer.attachConnection(conn)
      })
    }
  }

  /**
   * Filter check for all multiaddresses
   * that this transport can dial on
   *
   * @param {any} multiaddrs
   * @returns {Array<multiaddr>}
   *
   * @memberOf CircuitDialer
   */
  filter (multiaddrs) {
    if (!Array.isArray(multiaddrs)) {
      multiaddrs = [multiaddrs]
    }
    return multiaddrs.filter((ma) => {
      return mafmt.Circuit.matches(ma)
    })
  }
}

module.exports = CircuitDialer
