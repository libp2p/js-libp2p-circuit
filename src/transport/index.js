'use strict'

const config = require('../config')
const mss = require('multistream-select')
const pull = require('pull-stream')
const handshake = require('pull-handshake')
const Peer = require('../peer')
const Connection = require('interface-connection').Connection
const mafmt = require('mafmt')
const PeerInfo = require('peer-info')
const isFunction = require('lodash.isfunction')
const EventEmmiter = require('events').EventEmitter
const multiaddr = require('multiaddr')
const includes = require('lodash/includes')
const lp = require('pull-length-prefixed')

const log = config.log

class Circuit {
  /**
   * Creates an instance of Dialer.
   * @param {Swarm} swarm - the swarm
   *
   * @memberOf Dialer
   */
  constructor (swarm) {
    this.swarm = swarm
    this.relayPeers = new Map()
    this.peers = new Map()

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
   * @returns {void}
   *
   * @memberOf Dialer
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
    try {
      idB58Str = ma.getPeerId() // try to get the peerid from the multiaddr
    } catch (err) {
      log.err(err)
      cb(err)
    }

    if (this.peers.has(idB58Str)) {
      return cb(null,
        this.peers.get(idB58Str).conn)
    }

    PeerInfo.create(idB58Str, (err, dstPeer) => {
      if (err) {
        log.err(err)
        cb(err)
      }

      dstPeer.multiaddr.add(ma)

      let relays = Array.from(this.relayPeers.values())
      let next = (relayPeer) => {
        if (!relayPeer) {
          return cb(`no relay peers were found!`)
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

            let stream = handshake({timeout: 1000 * 60}, cb)
            let shake = stream.handshake

            lp.decodeFromReader(shake, (err, msg) => {
              if (err) {
                return cb(err)
              }

              if (msg.toString() === 'ok') {
                cb(null, new Connection(shake.rest(), conn))
              } else {
                return cb(new Error(`ko`))
              }
            })

            pull(stream, conn, stream)
            this.peers.set(idB58Str, new Peer(conn, dstPeer))
          })
        })
      }

      next(relays.shift())
    })
  }

  createListener (options, handler) {
    if (isFunction(options)) {
      handler = options
      options = {}
    }

    handler = handler || (() => {
    })

    return new EventEmmiter()
  }

  /**
   * Negotiate the relay connection
   *
   * @param {Connection} conn - a connection to the relay
   * @param {PeerInfo} peerInfo - the peerInfo of the peer to relay the connection for
   * @param {Callback} callback - a callback with that return the negotiated relay connection
   * @returns {void}
   *
   * @memberOf Dialer
   */
  _negotiateRelay (conn, peerInfo, callback) {
    let src = this.swarm._peerInfo.distinctMultiaddr()
    let dst = peerInfo.distinctMultiaddr()

    if (!(src && src.length > 0) || !(dst && dst.length > 0)) {
      log.err(`No valid multiaddress for peer!`)
      callback(`No valid multiaddress for peer!`)
    }

    let stream = handshake({timeout: 1000 * 60}, callback)
    let shake = stream.handshake

    log(`negotiating relay for peer ${peerInfo.id}`)
    mss.util.writeEncoded(shake, dst[0].toString())

    pull(stream, conn, stream)
    callback(null, new Connection(shake.rest(), conn))
  }

  /**
   * Connect to a relay peer
   *
   * @param {PeerInfo} peerInfo - the PeerInfo of the relay
   * @returns {void}
   *
   * @memberOf Dialer
   */
  _addRelayPeer (peerInfo) {
    if (!this.relayPeers.has(peerInfo.id.toB58String())) {
      for (let ma of peerInfo.multiaddrs) {
        if (mafmt.Circuit.matches(ma)) {
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
          break
        }
      }
    }
  }

  /**
   * Dial a relay peer by its PeerInfo
   *
   * @param {PeerInfo} relayPeer - the PeerInfo of the relay peer
   * @param {Function} callback - a callback with the connection to the relay peer
   * @returns {void}
   *
   * @memberOf Dialer
   */
  _dialRelay (relayPeer, callback) {
    const idB58Str = relayPeer.id.toB58String()
    log('dialing %s', idB58Str)

    if (this.peers.has(idB58Str)) {
      return callback(null, this.peers.get(idB58Str))
    }

    this.swarm.dial(relayPeer, config.multicodec, (err, conn) => {
      if (err) {
        return callback(err)
      }

      callback(null, conn)
    })
  }

  filter (multiaddrs) {
    if (!Array.isArray(multiaddrs)) {
      multiaddrs = [multiaddrs]
    }
    return multiaddrs.filter((ma) => {
      return mafmt.Circuit.matches(ma)
    })
  }

}

module.exports = Circuit
