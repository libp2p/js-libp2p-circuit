'use strict'

const pull = require('pull-stream')
const lp = require('pull-length-prefixed')
const Peer = require('./peer')
const handshake = require('pull-handshake')
const debug = require('debug')
const PeerInfo = require('peer-info')
const PeerId = require('peer-id')

const multicodec = require('./multicodec')

const log = debug('libp2p:circuit:relay')
log.err = debug('libp2p:circuit:error:relay')

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
   * The handler called to process a connection
   *
   * @param {Connection} conn
   * @param {Multiaddr} dstAddr
   * @param {Function} cb
   *
   * @return {void}
   */
  handler (conn, dstAddr, cb) {
    this._circuit(conn, dstAddr, cb)
  }

  _dialPeer (ma, callback) {
    const peerInfo = new PeerInfo(PeerId.createFromB58String(ma.getPeerId()))
    peerInfo.multiaddr.add(ma)
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

  /**
   * Circuit two peers
   *
   * @param {Connection} srcConn
   * @param {Multiaddr} dstMa
   * @param {Function} cb
   * @return {void}
   * @private
   */
  _circuit (srcConn, dstMa, cb) {
    this._dialPeer(dstMa, (err, dstConn) => {
      if (err) {
        log.err(err)
        return cb(err)
      }

      let stream = handshake({timeout: 1000 * 60}, cb)
      let shake = stream.handshake

      dstConn.getPeerInfo((err, peerInfo) => {
        if (err) {
          log.err(err)
          return cb(err)
        }

        pull(
          pull.values([new Buffer(`/ipfs/${peerInfo.id.toB58String()}`)]),
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

      // create handshake stream
      pull(
        stream,
        dstConn,
        stream
      )
    })
  }
}

module.exports = Circuit
