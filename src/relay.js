'use strict'

const pull = require('pull-stream')
const lp = require('pull-length-prefixed')
const multiaddr = require('multiaddr')
const Peer = require('./peer')
const handshake = require('pull-handshake')
const Connection = require('interface-connection').Connection
const RelaySession = require('./relay-session')
const utils = require('./utils')
const debug = require('debug')

const multicodec = require('./config').multicodec

const log = debug('libp2p:circuit:relay')
log.err = debug('libp2p:circuit:error:relay')

class Relay {
  constructor (libp2p) {
    this.libp2p = libp2p
    this.peers = new Map()
    this.relaySessions = new Map()

    this._onConnection = this._onConnection.bind(this)
  }

  start (cb) {
    cb = cb || function () {}
    this.libp2p.handle(multicodec, this._onConnection)
    cb()
  }

  stop (cb) {
    cb = cb || function () {}
    this.libp2p.unhandle(multicodec)
    cb()
  }

  _dialPeer (ma, callback) {
    // let idB58Str

    // try {
    //   idB58Str = ma.getPeerId() // try to get the peerid from the multiaddr
    // } catch (err) {
    //   log.err(err)
    // }

    // if (idB58Str) {
    //   const peer = this.peers.get(idB58Str)
    //   if (peer && peer.isConnected) {
    //     return callback(null, peer)
    //   }
    // }

    let addr = ma.toString()
    if (addr.startsWith('/p2p-circuit')) {
      addr = addr.substring(String('/p2p-circuit').length)
    }

    this.libp2p.dialByMultiaddr(multiaddr(addr), multicodec, (err, conn) => {
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

        callback(null, this.peers.get(idB58Str))
      })
    })
  }

  _onConnection (protocol, conn) {
    setImmediate(() => conn.getPeerInfo((err, peerInfo) => {
      if (err) {
        log.err('Failed to identify incoming conn', err)
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
    }))
  }

  _processConnection (srcPeer, conn) {
    let stream = handshake({timeout: 1000 * 60})
    let shake = stream.handshake

    lp.decodeFromReader(shake, (err, msg) => {
      if (err) {
        log.err(err)
        return
      }

      let addr = multiaddr(msg.toString())
      let newConn = new Connection(shake.rest(), conn)
      srcPeer.attachConnection(newConn)
      this._circuit(srcPeer, addr, (err) => {
        if (err) {
          log.err(err)
          return null
        }
      })
    })

    return pull(stream, conn, stream)
  }

  _circuit (srcPeer, ma, callback) {
    this._dialPeer(ma, (err, destPeer) => {
      if (err) {
        log.err(err)
        return callback(err)
      }

      let relaySession = new RelaySession(srcPeer, destPeer)
      this.relaySessions.set(
        utils.getCircuitStrAddr(srcPeer.peerInfo, destPeer.peerInfo),
        relaySession
      )

      // create the circuit
      relaySession.circuit()
      return callback()
    })
  }
}

module.exports = Relay
