'use strict'

const config = require('../config')
const mss = require('multistream-select')
const pull = require('pull-stream')
const handshake = require('pull-handshake')
const Peer = require('../peer')
const Connection = require('interface-connection').Connection

const log = config.log

class Dialer {
  constructor (libp2p, relayPeers) {
    this.libp2p = libp2p
    this.relayPeers = relayPeers || new Map()
    this.peers = new Map()

  // Speed up any new peer that comes in my way
  // this.libp2p.swarm.on('peer-mux-established', this._isRelayPeer)
  // this.libp2p.swarm.on('peer-mux-closed', () => {
  //   // TODO: detach relay connection
  // })
  }

  dial (peerInfo, callback) {
    if (this.peers.has(peerInfo.id.toB58String())) {
      return callback(null,
        this.peers.get(peerInfo.id.toB58String()).conn)
    }

    let next = (relayPeer) => {
      if (!relayPeer) {
        return callback(`no relay peers were found!`)
      }

      log(`Trying relay peer ${relayPeer.id.toB58String()}`)
      this._dialRelay(relayPeer, (err, conn) => {
        if (err) {
          if (relays.length > 0) {
            return next(relays.shift())
          }
          return callback(err)
        }

        this._negotiateRelay(conn, peerInfo, (err, conn) => {
          if (err) {
            log.err(`An error has occurred negotiating the relay connection`, err)
            return callback(err)
          }

          this.peers.set(peerInfo.id.toB58String(), new Peer(conn, peerInfo))
          callback(null, conn)
        })
      })
    }

    let relays = Array.from(this.relayPeers.values())
    next(relays.shift())
  }

  _negotiateRelay (conn, peerInfo, callback) {
    let src = this.libp2p.peerInfo.distinctMultiaddr()
    let dst = peerInfo.distinctMultiaddr()

    if (!(src && src.length > 0) || !(dst && dst.length > 0)) {
      log.err(`No valid multiaddress for peer!`)
      callback(`No valid multiaddress for peer!`)
    }

    let stream = handshake({timeout: 1000 * 60}, callback)
    let shake = stream.handshake

    log(`negotiating relay for peer ${peerInfo.id.toB58String()}`)
    mss.util.writeEncoded(shake, `${dst[0].toString()}/ipfs/${peerInfo.id.toB58String()}`)

    pull(stream, conn, stream)
    callback(null, new Connection(shake.rest(), peerInfo))
  }

  _isRelayPeer (peerInfo) {
    this._dialRelay(peerInfo, (peerInfo, conn) => {
      // TODO: implement relay peer discovery here
    })
  }

  _dialRelay (relayPeer, callback) {
    const idB58Str = relayPeer.id.toB58String()
    log('dialing %s', idB58Str)

    if (this.peers.has(idB58Str)) {
      return callback(null, this.peers.get(idB58Str))
    }

    this.libp2p.dialByPeerInfo(relayPeer, config.multicodec, (err, conn) => {
      if (err) {
        return callback(err)
      }

      callback(null, conn)
    })
  }
}

module.exports = Dialer
