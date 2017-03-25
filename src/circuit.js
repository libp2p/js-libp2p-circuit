'use strict'

const pull = require('pull-stream')
const lp = require('pull-length-prefixed')
const multiaddr = require('multiaddr')
const Peer = require('./peer')
const handshake = require('pull-handshake')
const Connection = require('interface-connection').Connection
const utils = require('./utils')
const debug = require('debug')
const includes = require('lodash/includes')
const PeerInfo = require('peer-info')
const PeerId = require('peer-id')

const multicodec = require('./multicodec')

const log = debug('libp2p:circuit:listener')
log.err = debug('libp2p:circuit:error:listener')

class Circuit {

  /**
   * Construct a Circuit object
   *
   * This class will handle incoming circuit connections and
   * either start a relay or hand the relayed connection to
   * the swarm
   *
   * @param {Swarm} swarm - the swarm this circuit is attched to
   */
  constructor (swarm) {
    this.swarm = swarm
    this.peers = new Map()
    this.relaySessions = new Map()

    this.handler = this.handler.bind(this)
  }

  /**
   * The handler that will be mounted by the swarm
   *
   * @param {Connection} conn - this is the incoming connection
   * @param {Function} cb - callback that will either return the relayed
   *                        connection or null if the request was a to relay
   *                        to another peer
   */
  handler (conn, cb) {
    setImmediate(() => conn.getPeerInfo((err, peerInfo) => {
      if (err) {
        log.err('Failed to identify incoming conn', err)
        return cb(err, pull(pull.empty(), conn))
      }

      const idB58Str = peerInfo.id.toB58String()
      let srcPeer = this.peers.get(idB58Str)
      if (!srcPeer) {
        log('new peer: ', idB58Str)
        srcPeer = new Peer(conn, peerInfo)
        this.peers.set(idB58Str, srcPeer)
      }
      return this._processConnection(srcPeer, conn, cb)
    }))
  }

  _processConnection (peerInfo, conn, cb) {
    let stream = handshake({timeout: 1000 * 60})
    let shake = stream.handshake

    lp.decodeFromReader(shake, (err, msg) => {
      if (err) {
        log.err(err)
        return
      }

      let addr = multiaddr(msg.toString())
      let newConn = new Connection(shake.rest(), conn)
      peerInfo.attachConnection(newConn)

      // make a circuit
      if (includes(addr.protoNames(), 'p2p-circuit')) {
        this._circuit(shake.rest(), addr, cb)
        return
      }

      // we just got a circuit connection lets return it to the swarm
      let idB58Str = addr.getPeerId()
      if (!idB58Str) {
        let err = 'No valid peer id in multiaddr'
        log.err(err)
        cb(err)
      }

      let peer = new Peer(conn, peerInfo)
      this.peers.set(idB58Str, peer)

      cb(null, newConn)
    })

    pull(stream, conn, stream)
  }

  _dialPeer (ma, callback) {
    const peerInfo = new PeerInfo(PeerId.createFromB58String(ma.getPeerId()))
    this.swarm.dial(peerInfo, multicodec, (err, conn) => {
      if (err) {
        log.err(err)
        return callback(err)
      }

      conn.getPeerInfo((err, peerInfo) => {
        if (err) {
          err(err)
          return
        }

        const idB58Str = peerInfo.id.toB58String()
        // If already had a dial to me, just add the conn
        if (!this.peers.has(idB58Str)) {
          this.peers.set(idB58Str, new Peer(conn, peerInfo))
        } else {
          this.peers.get(idB58Str).attachConnection(conn)
        }

        callback(null, this.peers.get(idB58Str).conn)
      })
    })
  }

  _circuit (srcConn, dstMa, cb) {
    this._dialPeer(dstMa, (err, dstConn) => {
      if (err) {
        log.err(err)
        return cb(err)
      }

      let stream = handshake({timeout: 1000 * 60}, cb)
      let shake = stream.handshake

      // create handshake stream
      pull(
        stream,
        dstConn,
        stream
      )

      dstConn.getPeerInfo((err, peerInfo) => {
        pull(
          pull.values([new Buffer(utils.getDstAddrAsString(peerInfo))]),
          lp.encode(),
          pull.collect((err, encoded) => {
            if (err) {
              return cb(err)
            }

            shake.write(encoded[0])
            // circuit the src and dst streams
            pull(
              srcConn,
              shake.rest(),
              srcConn
            )
            cb()
          })
        )
      })
    })
  }
}

module.exports = Circuit