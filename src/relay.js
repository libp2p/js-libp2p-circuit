'use strict'

const pull = require('pull-stream')
const lp = require('pull-length-prefixed')
const multiaddr = require('multiaddr')
const config = require('./config')
const Peer = require('./peer')
const handshake = require('pull-handshake')
const mss = require('multistream-select')
const Connection = require('interface-connection').Connection

const multicodec = require('./config').multicodec

const log = config.log

class Relay {
  constructor (libp2p) {
    this.libp2p = libp2p
    this.peers = new Map()

    this._onConnection = this._onConnection.bind(this)
    this._dialPeer = this._dialPeer.bind(this)
  }

  start (cb) {
    this.libp2p.handle(multicodec, this._onConnection)
    cb()
  }

  stop (cb) {
    this.libp2p.unhandle(multicodec)
    cb()
  }

  _dialPeer (ma, callback) {
    let idB58Str

    try {
      idB58Str = ma.peerId() // try to get the peerid from the multiaddr
    } catch (err) {
      log.err(err)
    }

    if (idB58Str) {
      const peer = this.peers.get(idB58Str)
      if (peer && peer.isConnected()) {
        return
      }
    }

    this.libp2p.dialByMultiaddr(ma, multicodec, (err, conn) => {
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
        }

        const peer = this.peers.get(idB58Str)
        callback(null, peer)
      })
    })
  }

  _onConnection (protocol, conn) {
    conn.getPeerInfo((err, peerInfo) => {
      if (err) {
        log.err('Failed to identify incomming conn', err)
        return pull(pull.empty(), conn)
      }

      const idB58Str = peerInfo.id.toB58String()
      let srcPeer = this.peers.get(idB58Str)
      if (!srcPeer) {
        log('new peer', idB58Str)
        srcPeer = new Peer(conn, peerInfo)
        this.peers.set(idB58Str, srcPeer)
      }
      this._processConnection(srcPeer, conn)
    })
  }

  _processConnection (srcPeer, conn) {
    let stream = handshake({timeout: 1000 * 60})
    let shake = stream.handshake

    lp.decodeFromReader(shake, (err, msg) => {
      if (err) {
        log.err(err)
        return pull(pull.empty(), conn)
      }

      let addr = multiaddr(msg.toString())
      srcPeer.attachConnection(new Connection(shake.rest(), conn))
      this._circuit(srcPeer, addr)
    })

    pull(stream, conn, stream)
  }

  _circuit (srcPeer, ma, callback) {
    this._dialPeer(ma, (err, destPeer) => {
      if (err) {
        log.err(err)
        return callback(err)
      }

      let srcAddrs = destPeer.peerInfo.distinctMultiaddr()

      if (!(srcAddrs && srcAddrs.length > 0)) {
        log.err(`No valid multiaddress for peer!`)
      }

      let stream = handshake({timeout: 1000 * 60}, callback)
      let shake = stream.handshake

      mss.util.writeEncoded(shake, `${srcAddrs[0].toString()}/ipfs/${srcPeer.peerInfo.id.toB58String()}`)
      pull(stream, destPeer.conn, stream)
      pull(srcPeer.conn, shake.rest(), srcPeer.conn)
    })
  }
}

module.exports = Relay
