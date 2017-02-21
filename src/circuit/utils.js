'use strict'

const multiaddr = require('multiaddr')
const PeerInfo = require('peer-info')
const PeerId = require('peer-id')

module.exports = function (swarm) {
  /**
   * Get b58 string from multiaddr or peerinfo
   *
   * @param {Multiaddr|PeerInfo} peer
   * @return {*}
   */
  function getB58String (peer) {
    let b58Id = null
    if (multiaddr.isMultiaddr(peer)) {
      const relayMa = multiaddr(peer)
      b58Id = relayMa.getPeerId()
    } else if (PeerInfo.isPeerInfo(peer)) {
      b58Id = peer.id.toB58String()
    }

    return b58Id
  }

  /**
   * Helper to make a peer info from a multiaddrs
   *
   * @param {Multiaddr|PeerInfo|PeerId} ma
   * @param {Swarm} swarm
   * @return {PeerInfo}
   * @private
   */
  // TODO: this is ripped off of libp2p, should probably be a generally available util function
  function peerInfoFromMa (peer) {
    let p
    // PeerInfo
    if (PeerInfo.isPeerInfo(peer)) {
      p = peer
      // Multiaddr instance (not string)
    } else if (multiaddr.isMultiaddr(peer)) {
      const peerIdB58Str = peer.getPeerId()
      try {
        p = swarm._peerBook.get(peerIdB58Str)
      } catch (err) {
        p = new PeerInfo(PeerId.createFromB58String(peerIdB58Str))
      }
      p.multiaddrs.add(peer)
      // PeerId
    } else if (PeerId.isPeerId(peer)) {
      const peerIdB58Str = peer.toB58String()
      p = swarm._peerBook.has(peerIdB58Str) ? swarm._peerBook.get(peerIdB58Str) : peer
    }

    return p
  }

  /**
   * Checks if peer has an existing connection
   *
   * @param {String} peerId
   * @param {Swarm} swarm
   * @return {Boolean}
   */
  function isPeerConnected (peerId) {
    return swarm.muxedConns[peerId] || swarm.conns[peerId]
  }

  return {
    getB58String: getB58String,
    peerInfoFromMa: peerInfoFromMa,
    isPeerConnected: isPeerConnected
  }
}
