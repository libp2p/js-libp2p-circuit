'use strict'

const config = require('../config')
const pull = require('pull-stream')
const multiaddr = require('multiaddr')
const PeerInfo = require('peer-info')
const Peer = require('../peer')
const lp = require('pull-length-prefixed')
const handshake = require('pull-handshake')
const Connection = require('interface-connection').Connection
const EventEmitter = require('events').EventEmitter
const mss = require('multistream-select')

const debug = require('debug')

const multicodec = config.multicodec

const log = debug('libp2p:circuit:listener')
log.err = debug('libp2p:circuit:error:listener')

class Listener extends EventEmitter {
  constructor (swarm) {
    super()
    this.swarm = swarm
    this.peers = new Map()

    this._onConnection = this._onConnection.bind(this)
  }

  listen (cb) {
    cb = cb || (() => {
    })
    this.swarm.handle(multicodec, this._onConnection)
    this.emit('listening')
    cb()
  }

  close (options, cb) {
    if (typeof options === 'function') {
      cb = options
      options = {}
    }
    cb = cb || (() => {
    })
    options = options || {}

    this.swarm.unhandle(multicodec)
    this.emit('close')
    cb()
  }

  _onConnection (protocol, conn) {
    conn.getPeerInfo((err, peerInfo) => {
      if (err) {
        log.err('Failed to identify incoming conn', err)
        this.emit('error', err)
        return pull(pull.empty(), conn)
      }

      const idB58Str = peerInfo.id.toB58String()
      let relayPeer = this.peers.get(idB58Str)
      if (!relayPeer) {
        log('new relay peer', idB58Str)
        relayPeer = peerInfo
        this.peers.set(idB58Str, new Peer(conn, peerInfo))
      }
      this._processConnection(relayPeer, conn, (err) => {
        if (err) {
          log.err(err)
          this.emit('error', new Error(err))
        }
      })
    })
  }

  _processConnection (relayPeer, conn, cb) {
    let stream = handshake({timeout: 1000 * 60})
    let shake = stream.handshake

    lp.decodeFromReader(shake, (err, msg) => {
      if (err) {
        return cb(err)
      }

      let addr = multiaddr(msg.toString())
      try {
        PeerInfo.create(addr.getPeerId(), (err, peerInfo) => {
          if (err) {
            log.err(err)
            this.handler(err)
          }

          mss.util.writeEncoded(shake, 'ok')
          peerInfo.multiaddr.add(addr)
          const conn = new Connection(shake.rest(), peerInfo)
          this.emit('connection', conn)
        })
      } catch (err) {
        cb(err)
      }
    })

    pull(stream, conn, stream)
  }
}

module.exports = Listener
module.exports.listener = (swarm) => {
  const listener = new Listener(swarm)
  listener.listen()
  return listener
}
