'use strict'

const pull = require('pull-stream')
const handshake = require('pull-handshake')
const Connection = require('interface-connection').Connection
const mafmt = require('mafmt')
const PeerInfo = require('peer-info')
const PeerId = require('peer-id')
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
   * @param {any} config
   *
   * @memberOf CircuitDialer
   */
  constructor (swarm, config) {
    this.swarm = swarm
    this.relayPeers = new Map()
    this.config = config
    this._swarmHandler = null

    const relays = this.filter(swarm._peerInfo.multiaddrs)
    if (relays.length === 0) {
      this.swarm._peerInfo.multiaddr.add(`/p2p-circuit/ipfs/${this.swarm._peerInfo.id.toB58String()}`)
    }

    // if we have relay addresses in swarm config, then dial those relays
    this.swarm.on('listening', () => {
      relays.forEach((relay) => {
        // once dialed and muxed the circuit will register the relay
        const relayPeer = new PeerInfo(PeerId.createFromB58String(relay.getPeerId()))
        // get a dialable address

        let addr = relay
        // if we have an explicit transport addres (ip4,ws,etc...) then leave it and dial that explicitly
        let reliable = multiaddr(relay.toString().replace(/^\/p2p-circuit/, '')).decapsulate('ipfs')
        if (mafmt.Reliable.matches(reliable)) {
          addr = reliable
        }

        relayPeer.multiaddr.add(addr)
        this._addRelayPeer(relayPeer)
      })
    })

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
      cb = () => {}
    }

    let dstConn = new Connection()
    let mas = multiaddr(ma).toString().split('/p2p-circuit')

    mas = mas.filter((m) => m.length) // filter out empty
    const dialNext = (relay, dst) => {
      this._addRelayPeer(relay, (err, relayConn) => {
        if (err) {
          log.err(err)
          return cb(err)
        }

        this._dialPeer(multiaddr(dst), relayConn, (err, conn) => {
          if (err) {
            log.err(err)
            return cb(err)
          }

          if (mas.length > 1) {
            conn.getPeerInfo((err, peerInfo) => {
              if (err) {
                log.err(err)
                return cb(err)
              }

              this.relayPeers.set(peerInfo.id.toB58String(), conn) // add the connection to the list of relays
              dialNext(peerInfo, mas.shift())
            })
          } else {
            dstConn.setInnerConn(conn)
          }
        })
      })
    }

    if (mas.length > 1) {
      const relayMa = multiaddr(mas.shift())
      const relayPeer = new PeerInfo(PeerId.createFromB58String(relayMa.getPeerId()))
      relayPeer.multiaddr.add(relayMa)
      dialNext(relayPeer, mas.shift())
    } else {
      this._dialPeer(mas.shift(), (err, conn) => {
        if (err) {
          log.err(err)
          return cb(err)
        }

        dstConn.setInnerConn(conn)
        cb(null, dstConn)
      })
    }

    return dstConn
  }

  _dialPeer (ma, relay, cb) {
    if (isFunction(relay)) {
      cb = relay
      relay = null
    }

    if (!cb) {
      cb = () => {}
    }

    ma = multiaddr(ma)
    PeerInfo.create(ma.getPeerId(), (err, dstPeer) => {
      if (err) {
        log.err(err)
        return cb(err)
      }

      if (!(ma.toString().indexOf('p2p-circuit') > 0)) {
        ma = multiaddr('/p2p-circuit').encapsulate(ma)
      }

      dstPeer.multiaddr.add(ma)
      this._initiateRelay(dstPeer, relay, (err, conn) => {
        if (err) {
          log.err(err)
          return cb(err)
        }

        cb(null, new Connection(conn, dstPeer))
      })
    })
  }

  /**
   * Initate the relay connection
   *
   * @param {PeerInfo} dstPeer - the destination peer
   * @param {Connection} relay - an existing relay connection to dial on
   * @param {Function} cb - callback to call with relayed connection or error
   * @returns {void}
   *
   * @memberOf CircuitDialer
   */
  _initiateRelay (dstPeer, relay, cb) {
    if (isFunction(relay)) {
      cb = relay
      relay = null
    }

    if (!cb) {
      cb = () => {}
    }

    const relays = Array.from(this.relayPeers.values()).shift()
    const next = (relayPeer) => {
      if (!relayPeer) {
        const err = `no relay peers were found!`
        log.err(err)
        return cb(err)
      }

      relayPeer.getPeerInfo((err, peerInfo) => {
        if (err) {
          log.err(err)
          return cb(err)
        }

        log(`Trying relay peer ${peerInfo.id.toB58String()}`)
        this._dialRelay(peerInfo, (err, conn) => {
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
      })
    }

    if (relay) {
      next(relay)
    } else {
      next(relays)
    }
  }

  /**
   * Create a listener
   *
   * @param {Function} handler
   * @param {any} options
   * @returns {listener}
   */
  createListener (handler, options) {
    return createListener(this.swarm, handler, this.config)
  }

  installSwarmHandler (handler) {
    this._swarmHandler = handler
  }

  get handler () {
    return this._swarmHandler
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
   * @param {Function} cb
   * @returns {void}
   *
   * @memberOf CircuitDialer
   */
  _addRelayPeer (peerInfo, cb) {
    cb = cb || (() => {})

    const relay = this.relayPeers.get(peerInfo.id.toB58String())
    if (relay) {
      cb(null, relay)
    }

    const relayConn = new Connection()
    relayConn.setPeerInfo(peerInfo)
    // attempt to dia the relay so that we have a connection
    this.relayPeers.set(peerInfo.id.toB58String(), relayConn)
    this._dialRelay(peerInfo, (err, conn) => {
      if (err) {
        log.err(err)
        this.relayPeers.delete(peerInfo.id.toB58String())
        return cb(err)
      }

      relayConn.setInnerConn(conn)
      cb(null, cb)
    })
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
